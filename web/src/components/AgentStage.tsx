import { Check, CircleDashed, Cloud, Database, Pause, Play, SkipForward, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import type { AgentScenario, AgentScenarioId, AgentSystem, AgentTurnResponse, ModelInfo } from '../../../shared/types';
import { useOnScreen } from '../lib/anime';
import { api } from '../lib/api';
import { modelName } from '../lib/format';
import { EASE, spring } from '../lib/motion';
import { useApi } from '../lib/useApi';
import { Orb } from './Orb';
import { TurnBadge } from './ui';

/**
 * The landing page's live ElevenAgent stage. It plays the scripted calls against the real agent and router as dry
 * runs (POST /agent/preview: nothing is logged, nothing waits), one turn at a time, and shows the state filling in.
 * Like the routing stage it loops, so it keeps a Pause control, holds still off-screen, and starts paused when the
 * visitor prefers reduced motion. Sized in rem and coloured with tokens only, as the dark landing page requires.
 */
const CALLS: AgentScenarioId[] = ['refund', 'insurance', 'appointment'];
/** A turn has four phases: the customer speaks, the agent updates its state, the router picks, the agent replies. */
const DWELL_MS = [1000, 1200, 800, 2400] as const;
/** Extra time on a finished call before the next one starts. */
const HOLD_MS = 2600;

const SYSTEMS: Record<AgentSystem, { name: string; icon: LucideIcon }> = {
  salesforce: { name: 'Salesforce Service Cloud', icon: Cloud },
  sap: { name: 'SAP S/4HANA', icon: Database },
};

type Pos = { epoch: number; call: number; turn: number; phase: number };
const button = 'press inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink/20 disabled:opacity-50';

export function AgentStage({ canFetch, k }: { canFetch: boolean; k: number }) {
  const reduce = useReducedMotion() ?? false;
  const scenarios = useApi<AgentScenario[]>(canFetch ? '/agent/scenarios' : null);
  const providers = useApi<ModelInfo[]>(canFetch ? '/providers' : null);
  const models = providers.data ?? [];

  const [pos, setPos] = useState<Pos>({ epoch: 0, call: 0, turn: 0, phase: 0 });
  const [replies, setReplies] = useState<{ epoch: number; list: AgentTurnResponse[] }>({ epoch: 0, list: [] });
  const [playing, setPlaying] = useState(!reduce);
  // "Show the whole turn now": set by Next, and at the start for visitors who prefer reduced motion.
  const [skip, setSkip] = useState(reduce);
  const [failed, setFailed] = useState(false);
  const [screenRef, onScreen] = useOnScreen<HTMLDivElement>();
  // Nothing is fetched until the stage has been on screen once.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (onScreen) setSeen(true);
  }, [onScreen]);

  const call = CALLS[pos.call];
  const scenario = scenarios.data?.find((s) => s.id === call);
  const script = scenario?.script.en ?? [];
  const list = replies.epoch === pos.epoch ? replies.list : [];
  const res = list[pos.turn];

  // One real dry run per turn. Each turn is requested once, even when effects run twice in development.
  const nonce = useRef(Math.random().toString(36).slice(2, 8));
  const requested = useRef(new Set<string>());
  const line = script[pos.turn];
  useEffect(() => {
    if (!canFetch || !seen || !line) return;
    const key = `${pos.epoch}:${pos.turn}`;
    if (requested.current.has(key)) return;
    requested.current.add(key);
    const epoch = pos.epoch;
    api
      .post<AgentTurnResponse>('/agent/preview', { session_id: `landing-${nonce.current}-${epoch}`, scenario: call, language: 'en', customer_id: 'default', message: line })
      .then((r) => setReplies((p) => ({ epoch, list: [...(p.epoch === epoch ? p.list : []), r] })))
      .catch(() => setFailed(true));
  }, [canFetch, seen, line, pos.epoch, pos.turn, call]);

  const turns = script.length;
  const lastTurn = pos.phase === 3 && (pos.turn >= turns - 1 || (res ? res.session.status !== 'active' : false));
  const advance = () =>
    setPos((p) => {
      if (p.phase < 3) return { ...p, phase: p.phase + 1 };
      return lastTurn ? { epoch: p.epoch + 1, call: (p.call + 1) % CALLS.length, turn: 0, phase: 0 } : { ...p, turn: p.turn + 1, phase: 0 };
    });

  useEffect(() => {
    if (!turns || failed) return;
    if (skip) {
      if (!res) return;
      setPos((p) => ({ ...p, phase: 3 }));
      return setSkip(false);
    }
    if (!playing || !onScreen || (pos.phase === 0 && !res)) return;
    const t = setTimeout(advance, DWELL_MS[pos.phase] + (lastTurn ? HOLD_MS : 0));
    return () => clearTimeout(t);
    // `advance` only reads what is already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, failed, skip, playing, onScreen, pos, res, lastTurn]);

  /** Next: finish the turn on screen, or show the following one in full. */
  const next = () => {
    if (failed) {
      setFailed(false);
      requested.current.clear();
      return setPos((p) => ({ epoch: p.epoch + 1, call: p.call, turn: 0, phase: 0 }));
    }
    if (pos.phase === 3) advance();
    setSkip(true);
  };

  // The state as far as the turn has got: this turn's changes show from phase 1.
  const session = pos.phase >= 1 && res ? res.session : list[pos.turn - 1]?.session ?? null;
  const items: { key: string; who: 'customer' | 'agent'; text?: string; res?: AgentTurnResponse; routed?: boolean; replied?: boolean }[] = [];
  for (let t = 0; t <= pos.turn && t < turns; t++) {
    const past = t < pos.turn;
    items.push({ key: `${pos.epoch}-c${t}`, who: 'customer', text: script[t] });
    if (past || pos.phase >= 1) items.push({ key: `${pos.epoch}-a${t}`, who: 'agent', res: list[t], routed: past || pos.phase >= 2, replied: past || pos.phase >= 3 });
  }
  const done = lastTurn && res ? res.session : null;
  const answered = done ? done.models.filter((id): id is string => id !== null) : [];
  const pct = done && done.baselineUsd > 0 ? ((done.baselineUsd - done.costUsd) / done.baselineUsd) * 100 : 0;
  const orb = Math.round(20 * k);

  return (
    <div ref={screenRef} className="relative rounded-[1.75rem] bg-card p-4 ring-1 ring-line sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {playing && !reduce ? <span className="absolute inset-0 animate-ping rounded-full bg-ember/60" /> : null}
            <span className="relative h-2 w-2 rounded-full bg-ember" />
          </span>
          <span><strong className="font-medium text-ink">Real agent runs</strong> · sample connectors and prices</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing} className={button}>
            {playing ? <Pause size="0.875rem" aria-hidden="true" /> : <Play size="0.875rem" aria-hidden="true" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={next} disabled={!turns || (!failed && !res)} className={button}>
            <SkipForward size="0.875rem" aria-hidden="true" />
            Next
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-10">
        {/* Conversation */}
        <div>
          <div className="label mb-3 flex items-center justify-between gap-2">
            <span>Conversation</span>
            <span className="text-ink-3">{scenario?.title ?? ''}</span>
          </div>
          {/* Bottom-anchored: each new line grows in from zero height, which pushes the earlier ones up smoothly; the
              oldest leave through the top under a static fade. No layout projection (it froze, then jumped). */}
          <div className="relative flex h-[19rem] flex-col justify-end overflow-hidden [contain:layout_paint]" aria-live="polite">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-12 bg-gradient-to-b from-card to-transparent" />
            {!turns ? <div className="skeleton h-[5.25rem]" /> : null}
            <AnimatePresence initial={false}>
              {items.slice(-4).map((it) => (
                <motion.div
                  key={it.key}
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  transition={{ height: { duration: 0.45, ease: EASE }, opacity: { duration: 0.35, delay: 0.08 } }}
                  className={`flex shrink-0 flex-col ${it.who === 'customer' ? 'items-end' : 'items-start'}`}>
                  {it.who === 'customer' ? (
                    <div className="mt-3 max-w-[88%] rounded-[1.125rem] rounded-br-md bg-ink px-4 py-2.5 text-[0.875rem] leading-snug text-canvas">
                      <p className="line-clamp-3 [overflow-wrap:anywhere]">{it.text}</p>
                    </div>
                  ) : (
                    <div className="mt-3 max-w-[92%] rounded-[1.125rem] rounded-bl-md bg-canvas px-4 py-3 ring-1 ring-line">
                      <AnimatePresence mode="wait" initial={false}>
                        {it.routed && it.res ? (
                          <motion.div key="routed" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="flex flex-wrap items-center gap-2">
                            <Orb model={models.find((m) => m.id === it.res!.route.model_used)} size={orb} />
                            <span className="text-[0.8125rem] font-medium text-ink">{modelName(models, it.res.route.model_used)}</span>
                            <TurnBadge turnType={it.res.route.turn_type} />
                          </motion.div>
                        ) : (
                          <motion.p key="working" exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex h-5 items-center text-[0.8125rem] text-ink-3">Updating its state…</motion.p>
                        )}
                      </AnimatePresence>
                      {/* The reply opens its own space, so the bubbles above slide up instead of jumping. */}
                      <AnimatePresence initial={false}>
                        {it.replied && it.res ? (
                          <motion.div key="reply" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} transition={{ height: { duration: 0.4, ease: EASE }, opacity: { duration: 0.3, delay: 0.1 } }} className="overflow-hidden">
                            <p className="pt-2 line-clamp-4 text-[0.875rem] leading-snug text-ink [overflow-wrap:anywhere]">{it.res.reply}</p>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* State */}
        <div>
          <div className="label mb-3">What ElevenAgent knows</div>
          <ul className="flex flex-col divide-y divide-line rounded-2xl bg-canvas px-4 ring-1 ring-line">
            {(scenario?.slots ?? []).map((s) => {
              const got = session?.slots.find((x) => x.id === s.id);
              const filled = got !== undefined && got.value !== null;
              const waiting = session?.awaiting === s.id;
              return (
                <li key={`${pos.epoch}-${s.id}`} className="flex items-center gap-3 py-3">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {filled ? (
                      <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="inline-flex">
                        <Check size="1rem" strokeWidth={2.6} className="text-ok" aria-hidden="true" />
                      </motion.span>
                    ) : (
                      <CircleDashed size="1rem" className={`transition-colors duration-200 ${waiting ? 'text-ember' : 'text-ink-3'}`} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.75rem] text-ink-3">{s.label}</span>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={filled ? 'value' : waiting ? 'waiting' : 'unknown'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18, ease: EASE }} className={`block truncate text-[0.875rem] ${filled ? 'font-medium text-ink' : 'text-ink-3'}`}>
                        {got?.value ?? (waiting ? 'Asked, waiting' : 'Not known yet')}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </li>
              );
            })}
            {!scenario ? Array.from({ length: 3 }, (_, i) => <li key={i} className="py-3"><div className="skeleton h-9" /></li>) : null}
          </ul>
        </div>

        {/* Systems */}
        <div>
          <div className="label mb-3">What it does</div>
          <ul className="flex flex-col gap-1.5">
            {(scenario?.tools ?? []).map((t) => {
              const called = session?.calls.some((c) => c.id === t.id) ?? false;
              const Icon = SYSTEMS[t.system].icon;
              return (
                <li key={`${pos.epoch}-${t.id}`} className={`flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors duration-300 ${called ? 'bg-canvas ring-1 ring-ink/10' : 'ring-1 ring-transparent'}`}>
                  <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${called ? 'bg-ink text-canvas' : 'bg-ink/[0.06] text-ink-3'}`}>
                    {called ? <motion.span aria-hidden="true" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 2, opacity: 0 }} transition={{ duration: 0.7, ease: EASE }} className="pointer-events-none absolute inset-0 rounded-full border border-ink" /> : null}
                    <Icon size="0.9375rem" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[0.875rem] transition-colors duration-200 ${called ? 'font-medium text-ink' : 'text-ink-2'}`}>{t.operation}</span>
                    <span className="block text-[0.75rem] text-ink-3">{SYSTEMS[t.system].name} · {t.write ? 'Write' : 'Read'}</span>
                  </span>
                </li>
              );
            })}
            {!scenario ? Array.from({ length: 4 }, (_, i) => <li key={i} className="skeleton h-[3.25rem]" />) : null}
          </ul>
        </div>
      </div>

      {/* The call so far, and how it ended. */}
      <div className="mt-6 border-t border-line pt-4 text-[0.8125rem] text-ink-2">
        {/* A fixed-height row, so the page below never moves when a call finishes. */}
        <div className="flex min-h-[3.25rem] items-center sm:min-h-[1.875rem]" aria-live="polite">
        {failed ? (
          <span>The agent run could not reach the API. Press Next to try again.</span>
        ) : done ? (
          <motion.span key={`done-${pos.epoch}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium ${done.status === 'done' ? 'border-ok/40 text-ok' : 'border-ember/40 text-ember'}`}>
              {done.status === 'done' ? <Check size="0.75rem" strokeWidth={2.6} aria-hidden="true" /> : null}
              {done.status === 'done' ? 'Goal met' : 'Handed to a person'}
            </span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {answered.map((id, i) => <Orb key={i} model={models.find((m) => m.id === id)} size={Math.round(16 * k)} />)}
            </span>
            <span>
              {done.turns === 1 ? '1 turn' : `${done.turns} turns`}, {new Set(answered).size} {new Set(answered).size === 1 ? 'model' : 'models'}, one state.
              {pct > 0.05 ? <> <strong className="font-medium text-ink">{pct.toFixed(1)}% lower model cost</strong> than the best allowed model on every turn.</> : pct < -0.05 ? <> <strong className="font-medium text-ember">{Math.abs(pct).toFixed(1)}% extra cost</strong> against the best-model baseline.</> : null}
            </span>
          </motion.span>
        ) : (
          <span>{turns ? `Turn ${pos.turn + 1} of ${turns}` : 'Loading the calls…'}</span>
        )}
        </div>
        <p className="mt-2 text-[0.75rem] text-ink-3">Sample data: Salesforce and SAP are sample connectors with fixed records, and providers and prices are simulated. Replies follow the agent’s state.</p>
      </div>
    </div>
  );
}
