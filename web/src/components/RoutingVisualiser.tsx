import { animate, stagger, svg, utils } from 'animejs';
import { Check, ChevronDown, ListTree, Pause, Play, User, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import type { Candidate, Language, ModelInfo, RouteTrace, TurnType } from '../../../shared/types';
import { useOnScreen } from '../lib/anime';
import { money, ms } from '../lib/format';
import { base, fast } from '../lib/motion';
import { BAD, sortModels, VENDOR_SHORT, VIOLET } from '../lib/theme';
import { BrandOrb, Orb } from './Orb';
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
  | { k: 'idle'; ms: number }
  | { k: 'request'; ms: number }
  | { k: 'classify'; ms: number }
  | { k: 'checks'; ms: number }
  | { k: 'try'; i: number; ms: number }
  | { k: 'result'; i: number; ms: number }
  | { k: 'selected'; ms: number }
  | { k: 'response'; ms: number }
  | { k: 'done'; ms: number };

function buildSteps(run: RouteRun): Step[] {
  // 'idle' starts each loop: the previous route fades out calmly before the next request travels.
  const steps: Step[] = [{ k: 'idle', ms: 650 }, { k: 'request', ms: 750 }, { k: 'classify', ms: 1100 }, { k: 'checks', ms: 1000 }];
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
/** The same curve, drawn from its end back to its start (for the response travelling back). */
const dReverse = ([a, b, c, e]: Curve) => `M${e.x},${e.y} C${c.x},${c.y} ${b.x},${b.y} ${a.x},${a.y}`;

/** Lines drawing in and out (anime.js drawables). */
const DRAW_IN_MS = 720;
const DRAW_OUT_MS = 520;

/**
 * SVG paths for the current step: the one the travelling dot follows, and the chosen connection the
 * light keeps flowing along. Computed before render so the anime.js effects can depend on them.
 */
function routePaths(run: RouteRun | null, steps: Step[], idx: number, L: Layout | null): { signalD: string | null; flowD: string | null } {
  const current = steps[idx];
  if (!run || !L || !current) return { signalD: null, flowD: null };
  const attempts = run.trace.attempts;
  const plannedId = planned(run)?.modelId;
  const selectedId = run.kind === 'chat' ? run.modelUsed ?? null : plannedId ?? null;
  let signalD: string | null = null;
  if (current.k === 'request') signalD = d(curveUser(L));
  if (current.k === 'try') {
    const id = current.i === -1 ? plannedId : attempts[current.i]?.modelId;
    const p = id ? L.models.get(id) : undefined;
    if (p) signalD = d(curveToModel(L, p));
  }
  if (current.k === 'response' && selectedId) {
    const p = L.models.get(selectedId);
    if (p) {
      const u = curveUser(L);
      // Back along the model's connection, through the router, then back to the customer.
      signalD = `${dReverse(curveToModel(L, p))} L${u[3].x},${u[3].y} ${dReverse(u).replace(/^M[^C]*/, '')}`;
    }
  }
  const selIdx = steps.findIndex((st) => st.k === 'selected');
  const target = selectedId && selIdx >= 0 && idx >= selIdx ? L.models.get(selectedId) : undefined;
  return { signalD, flowD: target ? d(curveToModel(L, target)) : null };
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

/** How long the finished route stays on screen before the loop starts again. */
const LOOP_HOLD_MS = 2200;

// ---------- component ----------
export function RoutingVisualiser({ run, models, autoPlay = true, placeholder }: { run: RouteRun | null; models: ModelInfo[]; autoPlay?: boolean; placeholder?: ReactNode }) {
  const reduce = useReducedMotion();
  const steps = useMemo(() => (run ? buildSteps(run) : []), [run]);
  const last = Math.max(0, steps.length - 1);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  // Off-screen the loop holds its place instead of re-rendering a diagram nobody can see.
  const [screenRef, onScreen] = useOnScreen<HTMLDivElement>();
  const [ref, width] = useWidth();

  // New run: start straight at the request (or jump to the end when motion is reduced).
  useEffect(() => {
    setIdx(reduce ? last : 1);
    setPlaying(!reduce && autoPlay);
  }, [run, reduce, autoPlay, last]);

  useEffect(() => {
    if (!playing || reduce || !onScreen) return;
    // Loop forever: hold the final route, then go back to 'idle' (a calm reset). Pause stops it.
    const t = idx >= last ? setTimeout(() => setIdx(0), LOOP_HOLD_MS) : setTimeout(() => setIdx((i) => Math.min(last, i + 1)), steps[idx]?.ms ?? 600);
    return () => clearTimeout(t);
  }, [playing, idx, last, steps, reduce, onScreen]);

  const ordered = useMemo(() => sortModels(models), [models]);
  const L = useMemo(() => (width ? layout(width, ordered) : null), [width, ordered]);
  const { signalD, flowD } = routePaths(run, steps, idx, L);

  // anime.js drives every connection line and the travelling dot.
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const signalPathRef = useRef<SVGPathElement>(null);
  const flowRef = useRef<SVGPathElement>(null);
  const drawn = useRef(new Map<string, boolean>());

  // Connections: draw in along the curve when a step activates them, wipe out forward when they end.
  // Runs after every render but only animates lines whose on/off state actually changed.
  useEffect(() => {
    const root = svgRef.current;
    if (!root) return;
    root.querySelectorAll<SVGPathElement>('[data-conn]').forEach((el) => {
      const key = el.dataset.conn!;
      const on = el.dataset.on === '1';
      const was = drawn.current.get(key);
      if (was === on) return;
      drawn.current.set(key, on);
      const [line] = svg.createDrawable(el);
      if (reduce || (was === undefined && !on)) {
        line.setAttribute('draw', on ? '0 1' : '0 0');
        return;
      }
      animate(line, on
        ? { draw: ['0 0', '0 1'], duration: DRAW_IN_MS, ease: 'inOutSine' }
        : { draw: ['0 1', '1 1'], duration: DRAW_OUT_MS, ease: 'inOutSine' });
    });
  });

  // The dot follows the exact path for this step, fading in at the start and out on arrival.
  useEffect(() => {
    const dot = dotRef.current;
    const guide = signalPathRef.current;
    if (!dot) return;
    const step = steps[idx];
    if (reduce || !step || !guide || !signalD) {
      utils.set(dot, { opacity: 0 });
      return;
    }
    const { translateX, translateY } = svg.createMotionPath(guide);
    const dur = Math.max(300, step.ms * 0.92);
    const anim = animate(dot, {
      translateX,
      translateY,
      opacity: [{ to: 1, duration: dur * 0.18 }, { to: 1, duration: dur * 0.64 }, { to: 0, duration: dur * 0.18 }],
      duration: dur,
      ease: 'inOutSine',
    });
    return () => {
      anim.pause();
    };
  }, [idx, signalD, steps, reduce]);

  // Light keeps flowing along the chosen connection until the next cycle begins.
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const [light] = svg.createDrawable(el);
    if (reduce || !flowD || !onScreen) {
      light.setAttribute('draw', '0 0');
      return;
    }
    const anim = animate(light, { draw: ['0 0', '0 0.16', '0.84 1', '1 1'], duration: 1700, delay: 250, loop: true, loopDelay: 350, ease: 'inOutSine' });
    return () => {
      anim.pause();
      light.setAttribute('draw', '0 0');
    };
  }, [flowD, reduce, onScreen]);

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

  const summary = run.kind === 'chat'
    ? `${run.turnType} turn routed to ${models.find((m) => m.id === run.modelUsed)?.name ?? 'a human handoff'}${run.failover ? ' after a failover' : ''}.`
    : `Dry run: ${run.turnType} turn would route to ${cand(plannedId ?? '')?.name ?? 'no eligible model'}.`;

  return (
    <div ref={screenRef} className="flex flex-col gap-4">
      <div ref={ref} className="relative w-full overflow-hidden rounded-[18px] border border-line bg-canvas" style={{ height: L?.h ?? 450 }} role="img" aria-label={`Routing diagram. ${summary}`}>
        {/* faint grid */}
        <div aria-hidden="true" className="absolute inset-0 opacity-[0.5]" style={{ backgroundImage: 'radial-gradient(circle, #e6e1dc 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        {L && (
          <>
            <svg ref={svgRef} className="absolute inset-0" width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
              {/* user ↔ router */}
              <path d={d(curveUser(L))} fill="none" stroke="#d9d3cd" strokeWidth={1.5} />
              <path data-conn="user" data-on={at('request') ? '1' : '0'} d={d(curveUser(L))} fill="none" stroke={VIOLET} strokeOpacity={0.7} strokeWidth={2} strokeLinecap="round" />
              {/* router → models: grey base line, plus a coloured line that anime.js draws in and out */}
              {ordered.map((m) => {
                const p = L.models.get(m.id)!;
                const s = stateOf(m.id);
                const path = d(curveToModel(L, p));
                const active = s === 'trying' || s === 'selected' || s === 'failed' || s === 'planned';
                return (
                  <g key={m.id}>
                    <path
                      d={path}
                      fill="none"
                      stroke={s === 'ineligible' ? '#e3ddd7' : '#d9d3cd'}
                      strokeWidth={1.5}
                      strokeDasharray={s === 'ineligible' ? '3 5' : undefined}
                      style={{ opacity: s === 'ineligible' ? 0.6 : 1, transition: 'opacity 300ms ease' }}
                    />
                    <path
                      data-conn={m.id}
                      data-on={active ? '1' : '0'}
                      d={path}
                      fill="none"
                      stroke={s === 'failed' ? BAD : VIOLET}
                      strokeOpacity={s === 'failed' ? 0.75 : s === 'planned' ? 0.6 : 0.85}
                      strokeWidth={s === 'selected' ? 2.6 : 2}
                      strokeLinecap="round"
                      style={{ transition: 'stroke 300ms ease, stroke-opacity 300ms ease, stroke-width 300ms ease' }}
                    />
                  </g>
                );
              })}
              {/* flowing light along the chosen connection */}
              <path ref={flowRef} d={flowD ?? 'M0,0'} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={2.4} strokeLinecap="round" />
              {/* invisible guide the dot follows, and the dot itself (moved with transforms, no filters) */}
              <path ref={signalPathRef} d={signalD ?? 'M0,0'} fill="none" stroke="none" />
              <g ref={dotRef} style={{ opacity: 0 }}>
                <circle r={11} fill={VIOLET} opacity={0.18} />
                <circle r={5} fill={VIOLET} />
              </g>
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
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  <span className="inline-flex h-[22px] w-[22px] shrink-0 rounded-full ring-1 ring-white/25">
                    <BrandOrb size={22} live={!reduce} drift={false} />
                  </span>
                  ElevenRoute router
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
              onClick={() => setPlaying(!playing)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[13px] font-medium hover:border-ink/25">
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={last} aria-valuenow={idx} aria-label="Routing animation progress">
              <motion.div className="h-full rounded-full bg-ink" animate={{ width: `${last ? (idx / last) * 100 : 100}%` }} transition={base} />
            </div>
          </>
        )}
      </div>

      <TracePanel label={run.kind === 'chat' ? 'Real routing trace' : 'Dry run: decision only, no model call'} count={run.trace.attempts.length}>
        <StepLog run={run} steps={steps} idx={idx} models={models} />
      </TracePanel>
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
          transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.4, ease: 'easeOut' }}
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

/**
 * "Real routing trace" button that morphs into the step-by-step trace (anime.js): the pill's width, height
 * and corner radius tween to the card's size, then the steps cascade in. The close button morphs it back.
 * With reduced motion it simply opens and closes.
 */
function TracePanel({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const panelId = useId();

  const toggle = () => {
    const el = shell.current;
    if (!el) return setOpen(!open);
    const from = el.getBoundingClientRect();
    flushSync(() => setOpen(!open)); // render the other state now so its natural size can be measured
    if (reduce) return;
    const to = el.getBoundingClientRect();
    const opening = !open;
    animate(el, {
      width: [from.width, to.width],
      height: [from.height, to.height],
      borderRadius: opening ? ['999px', '18px'] : ['18px', '999px'],
      duration: opening ? 820 : 560,
      ease: opening ? 'inOutQuart' : 'inOutQuad',
      onComplete: () => {
        // Hand sizing back to the layout: the trace keeps growing while the replay runs.
        el.style.width = '';
        el.style.height = '';
        el.style.borderRadius = '';
      },
    });
    animate(el.querySelectorAll('[data-trace-content]'), { opacity: [0, 1], duration: opening ? 420 : 280, delay: opening ? 300 : 160, ease: 'outQuad' });
    if (opening) {
      animate(el.querySelectorAll('[data-trace-item]'), { opacity: [0, 1], y: [10, 0], duration: 460, delay: stagger(60, { start: 420 }), ease: 'outQuad' });
    }
  };

  return (
    <div
      ref={shell}
      className={`overflow-hidden border bg-canvas ${open ? 'w-full rounded-[18px] border-line' : 'w-fit rounded-full border-line hover:border-ink/25'}`}>
      {open ? (
        <div data-trace-content id={panelId} className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
              <BrandOrb size={18} live={!reduce} drift={false} />
              {label}
            </div>
            <button type="button" onClick={toggle} aria-expanded="true" aria-controls={panelId} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-card hover:text-ink">
              <X size={14} aria-hidden="true" /> Close
            </button>
          </div>
          {children}
        </div>
      ) : (
        <button type="button" data-trace-content onClick={toggle} aria-expanded="false" className="inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-medium text-ink">
          <ListTree size={14} aria-hidden="true" />
          {label}
          {count > 0 ? <span className="rounded-full bg-card px-2 py-0.5 text-[11.5px] text-ink-2">{count} model call{count === 1 ? '' : 's'}</span> : null}
          <ChevronDown size={14} className="text-ink-3" aria-hidden="true" />
        </button>
      )}
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
          <motion.li key={it.key} data-trace-item initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={base} className="flex gap-3">
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
