import { Check, Cpu, Pause, Play, RotateCcw, User, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import type { Candidate, Language, ModelInfo, RouteTrace, TurnType } from '../../../shared/types';
import { money, ms } from '../lib/format';
import { base, fast } from '../lib/motion';
import { BAD, sortModels, VENDOR_SHORT, VIOLET } from '../lib/theme';
import { Orb } from './Orb';
import { TurnBadge } from './ui';

/** One routing decision to visualise. Built only from real API responses. */
export interface RouteRun {
  kind: 'chat' | 'preview';
  message: string;
  language: Language;
  customer: string;
  trace: RouteTrace;
  reason: string;
  turnType: TurnType;
  /** chat only */
  reply?: string;
  modelUsed?: string | null;
  costUsd?: number;
  latencyMs?: number;
  failover?: boolean;
}

type Step =
  | { k: 'request'; ms: number }
  | { k: 'classify'; ms: number }
  | { k: 'checks'; ms: number }
  | { k: 'try'; i: number; ms: number }
  | { k: 'result'; i: number; ms: number }
  | { k: 'selected'; ms: number }
  | { k: 'response'; ms: number }
  | { k: 'done'; ms: number };

function buildSteps(run: RouteRun): Step[] {
  const steps: Step[] = [{ k: 'request', ms: 750 }, { k: 'classify', ms: 1100 }, { k: 'checks', ms: 1000 }];
  if (run.kind === 'chat') {
    run.trace.attempts.forEach((a, i) => {
      steps.push({ k: 'try', i, ms: 700 });
      steps.push({ k: 'result', i, ms: a.ok ? 300 : 900 });
    });
  } else if (planned(run)) {
    steps.push({ k: 'try', i: -1, ms: 700 });
  }
  steps.push({ k: 'selected', ms: 1000 });
  if (run.kind === 'chat') steps.push({ k: 'response', ms: 1000 });
  steps.push({ k: 'done', ms: 0 });
  return steps;
}

const planned = (run: RouteRun) => run.trace.candidates.find((c) => c.rank === 1);

type NodeState = 'neutral' | 'eligible' | 'ineligible' | 'trying' | 'failed' | 'selected' | 'planned';

// ---------- geometry ----------
interface Pt { x: number; y: number }
interface Layout { w: number; h: number; horizontal: boolean; user: Pt; router: Pt; models: Map<string, Pt>; nodeW: number; labels: { text: string; x: number; y: number }[] }

function layout(w: number, ids: ModelInfo[]): Layout {
  const horizontal = w >= 720;
  const models = new Map<string, Pt>();
  const labels: Layout['labels'] = [];
  if (horizontal) {
    const mx = w - 112;
    ids.forEach((m, i) => {
      // Two models per vendor, with room above each pair for the vendor label.
      const y = 66 + i * 60 + Math.floor(i / 2) * 30;
      models.set(m.id, { x: mx, y });
      if (i % 2 === 0) labels.push({ text: VENDOR_SHORT[m.vendor], x: mx - 92, y: y - 46 });
    });
    return { w, h: 470, horizontal, user: { x: 96, y: 235 }, router: { x: Math.round(w * 0.43), y: 235 }, models, nodeW: 190, labels };
  }
  // Two columns with a guaranteed gap between them.
  const nodeW = Math.min(200, Math.floor(w * 0.47));
  ids.forEach((m, i) => models.set(m.id, { x: i % 2 === 0 ? w * 0.25 : w * 0.75, y: 330 + Math.floor(i / 2) * 74 }));
  return { w, h: 520, horizontal, user: { x: w / 2, y: 48 }, router: { x: w / 2, y: 182 }, models, nodeW, labels };
}

type Curve = [Pt, Pt, Pt, Pt];
function curveToModel(L: Layout, m: Pt): Curve {
  if (L.horizontal) {
    const a = { x: L.router.x + 104, y: L.router.y };
    const b = { x: m.x - L.nodeW / 2 - 4, y: m.y };
    const mid = (a.x + b.x) / 2;
    return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
  }
  const a = { x: L.router.x, y: L.router.y + 64 };
  const b = { x: m.x, y: m.y - 26 };
  const mid = (a.y + b.y) / 2;
  return [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
}
function curveUser(L: Layout): Curve {
  if (L.horizontal) {
    const a = { x: L.user.x + 80, y: L.user.y };
    const b = { x: L.router.x - 104, y: L.router.y };
    return [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
  }
  const a = { x: L.user.x, y: L.user.y + 34 };
  const b = { x: L.router.x, y: L.router.y - 64 };
  return [a, a, b, b];
}
const d = ([a, b, c, e]: Curve) => `M${a.x},${a.y} C${b.x},${b.y} ${c.x},${c.y} ${e.x},${e.y}`;
function sample([a, b, c, e]: Curve, n = 24): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * e.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * e.y,
    };
  });
}

/** Width of an element, tracked with a callback ref so it follows whichever element is mounted. */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

// ---------- component ----------
export function RoutingVisualiser({ run, models, autoPlay = true, placeholder }: { run: RouteRun | null; models: ModelInfo[]; autoPlay?: boolean; placeholder?: ReactNode }) {
  const reduce = useReducedMotion();
  const steps = useMemo(() => (run ? buildSteps(run) : []), [run]);
  const last = Math.max(0, steps.length - 1);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [ref, width] = useWidth();

  // New run: start again (or jump to the end when motion is reduced).
  useEffect(() => {
    setIdx(reduce ? last : 0);
    setPlaying(!reduce && autoPlay);
  }, [run, reduce, autoPlay, last]);

  useEffect(() => {
    if (!playing || reduce || idx >= last) return;
    const t = setTimeout(() => setIdx((i) => Math.min(last, i + 1)), steps[idx]?.ms ?? 600);
    return () => clearTimeout(t);
  }, [playing, idx, last, steps, reduce]);

  const ordered = useMemo(() => sortModels(models), [models]);
  const L = useMemo(() => (width ? layout(width, ordered) : null), [width, ordered]);

  if (!run) {
    return (
      <div ref={ref} className="flex min-h-[260px] items-center justify-center rounded-[18px] border border-dashed border-line text-center text-[14px] text-ink-3">
        {placeholder ?? 'Send a request to see how it is routed.'}
      </div>
    );
  }

  const at = (k: Step['k']) => {
    const i = steps.findIndex((s) => s.k === k);
    return i >= 0 && idx >= i;
  };
  const stepIndex = (k: 'try' | 'result', i: number) => steps.findIndex((s) => s.k === k && 'i' in s && s.i === i);
  const current = steps[idx];
  const attempts = run.trace.attempts;
  const cand = (id: string) => run.trace.candidates.find((c) => c.modelId === id);
  const plannedId = planned(run)?.modelId;
  const selectedId = run.kind === 'chat' ? run.modelUsed ?? null : plannedId ?? null;
  const eligibleCount = run.trace.candidates.filter((c) => c.eligible).length;

  function stateOf(id: string): NodeState {
    if (!at('checks')) return 'neutral';
    const c = cand(id);
    if (run!.kind === 'chat') {
      for (let i = attempts.length - 1; i >= 0; i--) {
        if (attempts[i].modelId !== id) continue;
        if (idx >= stepIndex('result', i)) return attempts[i].ok ? 'selected' : 'failed';
        if (idx >= stepIndex('try', i)) return 'trying';
      }
    } else if (id === plannedId && idx >= stepIndex('try', -1)) {
      return at('selected') ? 'planned' : 'trying';
    }
    return c?.eligible ? 'eligible' : 'ineligible';
  }

  // Signal dot path for the current step.
  let signal: Pt[] | null = null;
  let signalColor = VIOLET;
  if (L && !reduce && current) {
    if (current.k === 'request') signal = sample(curveUser(L));
    if (current.k === 'try') {
      const id = current.i === -1 ? plannedId : attempts[current.i]?.modelId;
      const p = id ? L.models.get(id) : undefined;
      if (p) signal = sample(curveToModel(L, p));
    }
    if (current.k === 'response' && selectedId) {
      const p = L.models.get(selectedId);
      if (p) signal = [...sample(curveToModel(L, p)).reverse(), ...sample(curveUser(L)).reverse()];
    }
    if (current.k === 'result' && attempts[current.i] && !attempts[current.i].ok) signalColor = BAD;
  }

  const summary = run.kind === 'chat'
    ? `${run.turnType} turn routed to ${models.find((m) => m.id === run.modelUsed)?.name ?? 'a human handoff'}${run.failover ? ' after a failover' : ''}.`
    : `Dry run: ${run.turnType} turn would route to ${cand(plannedId ?? '')?.name ?? 'no eligible model'}.`;

  return (
    <div className="flex flex-col gap-4">
      <div ref={ref} className="relative w-full overflow-hidden rounded-[18px] border border-line bg-canvas" style={{ height: L?.h ?? 450 }} role="img" aria-label={`Routing diagram. ${summary}`}>
        {/* faint grid */}
        <div aria-hidden="true" className="absolute inset-0 opacity-[0.5]" style={{ backgroundImage: 'radial-gradient(circle, #e6e1dc 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        {L && (
          <>
            <svg className="absolute inset-0" width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true" style={{ willChange: 'transform' }}>
              {/* user ↔ router */}
              <path d={d(curveUser(L))} fill="none" stroke="#d9d3cd" strokeWidth={1.5} />
              <motion.path
                d={d(curveUser(L))}
                fill="none"
                stroke={VIOLET}
                strokeWidth={2}
                strokeLinecap="round"
                initial={false}
                animate={{ pathLength: at('request') ? 1 : 0, opacity: at('request') ? 0.7 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.7, ease: 'easeInOut' }}
              />
              {/* router → models */}
              {ordered.map((m) => {
                const p = L.models.get(m.id)!;
                const s = stateOf(m.id);
                const path = d(curveToModel(L, p));
                const active = s === 'trying' || s === 'selected' || s === 'failed' || s === 'planned';
                return (
                  <g key={m.id}>
                    <motion.path
                      d={path}
                      fill="none"
                      stroke={s === 'ineligible' ? '#e3ddd7' : '#d9d3cd'}
                      strokeWidth={1.5}
                      strokeDasharray={s === 'ineligible' ? '3 5' : undefined}
                      animate={{ opacity: s === 'ineligible' ? 0.6 : 1 }}
                      transition={fast}
                    />
                    <motion.path
                      d={path}
                      fill="none"
                      stroke={s === 'failed' ? BAD : VIOLET}
                      strokeWidth={s === 'selected' ? 2.6 : 2}
                      strokeLinecap="round"
                      strokeDasharray={s === 'planned' ? '6 6' : undefined}
                      initial={false}
                      animate={{ pathLength: active ? 1 : 0, opacity: active ? (s === 'failed' ? 0.75 : 0.85) : 0 }}
                      transition={reduce ? { duration: 0 } : { duration: 0.65, ease: 'easeInOut' }}
                    />
                  </g>
                );
              })}
              {signal && (
                // Moved with transforms (GPU-friendly); the halo is a second circle, not a CSS filter.
                <motion.g
                  key={`sig-${idx}`}
                  initial={{ x: signal[0].x, y: signal[0].y, opacity: 0 }}
                  animate={{ x: signal.map((p) => p.x), y: signal.map((p) => p.y), opacity: [0, 1, 1, 1, 0.9] }}
                  transition={{ duration: ((current?.ms ?? 700) / 1000) * 0.85, ease: 'easeInOut' }}>
                  <circle r={11} fill={signalColor} opacity={0.18} />
                  <circle r={5} fill={signalColor} />
                </motion.g>
              )}
            </svg>

            {L.labels.map((l) => (
              <span key={l.text} className="absolute text-[11px] font-medium tracking-wide text-ink-3 uppercase" style={{ left: l.x, top: l.y }}>
                {l.text}
              </span>
            ))}

            {/* user node */}
            <Node x={L.user.x} y={L.user.y} w={L.horizontal ? 160 : Math.min(280, L.w - 32)}>
              <div className={`rounded-2xl border bg-canvas px-3 py-2.5 shadow-[var(--shadow-card)] transition-colors ${at('response') ? 'border-ok/40' : 'border-line'}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                  <User size={12} aria-hidden="true" /> Customer · {run.language.toUpperCase()}
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink">“{run.message}”</p>
                <AnimatePresence>
                  {at('response') && (
                    <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={base} className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-ok">
                      <Check size={12} aria-hidden="true" /> Response delivered
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </Node>

            {/* router node */}
            <Node x={L.router.x} y={L.router.y} w={208}>
              <motion.span
                aria-hidden="true"
                className="absolute -inset-1 rounded-[20px] border-4 border-violet/15"
                animate={{ opacity: current?.k === 'classify' || current?.k === 'checks' ? 1 : 0 }}
                transition={base}
              />
              <div className="relative rounded-2xl border border-ink/80 bg-ink px-3.5 py-3 text-white shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-1.5 text-[12px] font-medium">
                  <Cpu size={13} aria-hidden="true" /> ElevenRoute router
                </div>
                <AnimatePresence initial={false}>
                  {at('classify') && (
                    <motion.div key="cls" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={base} className="mt-2">
                      <span className="rounded-full bg-white/95 px-0.5 py-0.5"><TurnBadge turnType={run.turnType} score={run.trace.classification.score} /></span>
                    </motion.div>
                  )}
                  {at('checks') && (
                    <motion.ul key="chk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={base} className="mt-2 space-y-0.5 text-[11.5px] text-white/80">
                      <li>✓ Policy: {run.customer}</li>
                      <li>✓ Language: {run.language.toUpperCase()} · floor ≥ {run.trace.qualityFloor.toFixed(2)}</li>
                      <li>✓ {eligibleCount} of {run.trace.candidates.length} models eligible{run.trace.sticky ? ' · sticky' : ''}</li>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
            </Node>

            {/* model nodes */}
            {ordered.map((m) => {
              const p = L.models.get(m.id)!;
              return <ModelNode key={m.id} x={p.x} y={p.y} w={L.nodeW} model={m} cand={cand(m.id)} state={stateOf(m.id)} attempt={attempts.find((a) => a.modelId === m.id)} reduce={!!reduce} compact={!L.horizontal} />;
            })}
          </>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        {reduce ? (
          <span className="text-[12.5px] text-ink-3">Animation off (reduced motion): showing the final route.</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => (idx >= last ? (setIdx(0), setPlaying(true)) : setPlaying(!playing))}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[13px] font-medium hover:border-ink/25">
              {playing && idx < last ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {playing && idx < last ? 'Pause' : idx >= last ? 'Play again' : 'Play'}
            </button>
            <button type="button" onClick={() => { setIdx(0); setPlaying(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-card hover:text-ink">
              <RotateCcw size={14} aria-hidden="true" /> Replay
            </button>
            <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={last} aria-valuenow={idx} aria-label="Routing animation progress">
              <motion.div className="h-full rounded-full bg-ink" animate={{ width: `${last ? (idx / last) * 100 : 100}%` }} transition={base} />
            </div>
          </>
        )}
        <span className="text-[12px] text-ink-3">{run.kind === 'chat' ? 'Real routing trace' : 'Dry run: decision only, no model call'}</span>
      </div>

      <StepLog run={run} steps={steps} idx={idx} models={models} />
    </div>
  );
}

function Node({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  return (
    <div className="absolute" style={{ left: x, top: y, width: w, transform: 'translate(-50%, -50%)' }}>
      {children}
    </div>
  );
}

function ModelNode({ x, y, w, model, cand, state, attempt, reduce, compact }: {
  x: number; y: number; w: number; model: ModelInfo; cand?: Candidate; state: NodeState;
  attempt?: { ok: boolean; latencyMs: number; error?: string }; reduce: boolean; compact: boolean;
}) {
  const styles: Record<NodeState, string> = {
    neutral: 'border-line',
    eligible: 'border-line',
    ineligible: 'border-line opacity-45',
    trying: 'border-violet ring-4 ring-violet/10',
    failed: 'border-bad/60 bg-bad/[0.03]',
    selected: 'border-ink shadow-[var(--shadow-lift)]',
    planned: 'border-violet border-dashed',
  };
  let sub: ReactNode = <span className="text-ink-3">{money(cand?.cost ?? 0)}/1k · q {cand?.quality.toFixed(2)}</span>;
  if (state === 'eligible' && cand?.rank) sub = <span className="text-ink-2">Rank #{cand.rank} · q {cand.quality.toFixed(2)}</span>;
  if (state === 'ineligible') sub = <span className="text-ink-3">Filtered: {cand?.note || 'not eligible'}</span>;
  if (state === 'trying') sub = <span className="text-violet">Calling…</span>;
  if (state === 'failed') sub = <span className="text-bad">{attempt?.error?.includes('timed out') ? 'Timed out' : 'Errored'} · {ms(attempt?.latencyMs ?? 0)}</span>;
  if (state === 'selected') sub = <span className="font-medium text-ink">Selected · {ms(attempt?.latencyMs ?? 0)}</span>;
  if (state === 'planned') sub = <span className="font-medium text-violet">Would route here</span>;

  return (
    <div className="absolute" style={{ left: x, top: y, width: w, transform: 'translate(-50%, -50%)' }} title={state === 'ineligible' ? cand?.note : undefined}>
      {state === 'selected' && !reduce && (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-2xl border-2 border-violet"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 1.12 }}
          transition={{ duration: 1.1, repeat: 2, ease: 'easeOut' }}
        />
      )}
      <div className={`relative flex items-center gap-2 rounded-2xl border bg-canvas px-2.5 ${compact ? 'py-1.5' : 'py-2'} transition-[border-color,box-shadow,opacity] duration-300 ${styles[state]}`}>
        <Orb model={model} size={compact ? 20 : 24} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[12.5px] font-medium text-ink">{model.name}</div>
          <div className="truncate text-[11px]">{sub}</div>
        </div>
        <AnimatePresence>
          {(state === 'failed' || state === 'selected') && (
            <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={fast} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${state === 'failed' ? 'bg-bad text-white' : 'bg-ink text-white'}`}>
              {state === 'failed' ? <X size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Text equivalent of the diagram, revealed step by step (all at once with reduced motion). */
function StepLog({ run, steps, idx, models }: { run: RouteRun; steps: Step[]; idx: number; models: ModelInfo[] }) {
  const name = (id: string | null | undefined) => (id ? models.find((m) => m.id === id)?.name ?? id : 'Human handoff');
  const cand = (id: string | null | undefined) => run.trace.candidates.find((c) => c.modelId === id);
  const c = run.trace.classification;
  const items: { key: string; title: ReactNode; body?: ReactNode; tone?: 'bad' | 'ok' }[] = [];

  steps.slice(0, idx + 1).forEach((s, n) => {
    if (s.k === 'request') items.push({ key: `${n}`, title: 'Request received', body: `${run.customer} · ${run.language === 'en' ? 'English' : 'Spanish'}` });
    if (s.k === 'classify')
      items.push({
        key: `${n}`,
        title: <>Classified as <TurnBadge turnType={run.turnType} score={c.score} /></>,
        body: c.hits.length ? c.hits.map((h) => `${h.weight > 0 ? '+' : ''}${h.weight} ${h.label}`).join(' · ') : 'No classifier rules fired',
      });
    if (s.k === 'checks') {
      const filtered = run.trace.candidates.filter((x) => !x.eligible);
      items.push({
        key: `${n}`,
        title: `Policy, language and quality checks: ${run.trace.candidates.length - filtered.length} of ${run.trace.candidates.length} models eligible`,
        body: `${run.trace.policy} · quality floor ≥ ${run.trace.qualityFloor.toFixed(2)}${filtered.length ? ` · filtered: ${filtered.map((f) => `${f.name} (${f.note})`).join(', ')}` : ''}`,
      });
    }
    if (s.k === 'try' && s.i === -1) {
      const p = planned(run);
      items.push({ key: `${n}`, title: `Ranked #1: ${p?.name}`, body: 'Dry run: the router did not call the model.' });
    }
    if (s.k === 'result') {
      const a = run.trace.attempts[s.i];
      items.push({
        key: `${n}`,
        tone: a.ok ? 'ok' : 'bad',
        title: a.ok ? `${name(a.modelId)} answered in ${ms(a.latencyMs)}` : `${name(a.modelId)} ${a.error?.includes('timed out') ? 'timed out' : 'errored'} after ${ms(a.latencyMs)}: failing over`,
        body: a.ok ? undefined : a.error,
      });
    }
    if (s.k === 'selected') {
      const id = run.kind === 'chat' ? run.modelUsed : planned(run)?.modelId;
      const sc = cand(id);
      items.push({
        key: `${n}`,
        title: run.kind === 'chat' ? `Selected ${name(id)}` : `Would select ${sc?.name ?? 'no eligible model'}`,
        body: (
          <>
            {run.reason}
            {sc ? <span className="mt-1 block text-ink-2">Quality {sc.quality.toFixed(2)} · list price {money(sc.cost)}/1k tokens</span> : null}
          </>
        ),
      });
    }
    if (s.k === 'response')
      items.push({
        key: `${n}`,
        tone: run.modelUsed ? 'ok' : 'bad',
        title: run.modelUsed ? 'Response delivered' : 'All providers failed: apology and human handoff',
        body: `Cost ${money(run.costUsd ?? 0)} · total latency ${ms(run.latencyMs ?? 0)} · routing overhead ${ms(run.trace.overheadMs)}`,
      });
  });

  return (
    <ol className="flex flex-col gap-2" aria-label="Routing steps">
      <AnimatePresence initial={false}>
        {items.map((it, i) => (
          <motion.li key={it.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={base} className="flex gap-3">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${it.tone === 'bad' ? 'bg-bad text-white' : it.tone === 'ok' ? 'bg-ok text-white' : 'bg-line text-ink'}`}>{i + 1}</span>
            <div className="min-w-0 text-[13px] leading-relaxed">
              <div className="font-medium text-ink">{it.title}</div>
              {it.body ? <div className="text-ink-3">{it.body}</div> : null}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
