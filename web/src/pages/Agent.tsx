import {
  Check, CircleDashed, Cloud, Database, Eye, MessageSquare, PenLine, Play, Plug, RotateCcw, ScanText, Send, Split, Square, type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  AgentScenario, AgentScenarioId, AgentSession, AgentSystem, AgentToolInfo, AgentTurnResponse, ModelInfo,
} from '../../../shared/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Collapse } from '../components/Collapse';
import { HowItWorks } from '../components/HowItWorks';
import { Orb } from '../components/Orb';
import { TraceTimeline } from '../components/TraceTimeline';
import { Button, Card, Chip, ErrorNote, Page, PageHeader, Segmented, Skeleton, Status, TurnBadge } from '../components/ui';
import { VendorControls } from '../components/VendorControls';
import { api } from '../lib/api';
import { modelName, money, ms } from '../lib/format';
import { base, EASE, fast, spring } from '../lib/motion';
import { useIndicator } from '../lib/indicator';
import { useApi } from '../lib/useApi';

type Msg = { id: string; role: 'user'; text: string } | { id: string; role: 'agent'; res: AgentTurnResponse };

const SYSTEMS: Record<AgentSystem, { name: string; icon: LucideIcon }> = {
  salesforce: { name: 'Salesforce Service Cloud', icon: Cloud },
  sap: { name: 'SAP S/4HANA', icon: Database },
};
const DECLINE = 'No, leave it for now.';
/** Pause between the lines of a played call, so each turn can be read. */
const PLAY_GAP_MS = 700;

// ---- replaying a turn ----
// The API answers a turn in one response. The page then replays what the agent did in the order it did it:
// what it learned, each system call, the routing decision, the reply. Only the pacing is added here.
type Stage = 'read' | 'act' | 'route' | 'reply';
type Step = { kind: 'slot' | 'call'; id: string } | { kind: 'route' | 'reply' | 'end' };
const STAGE_OF: Record<Step['kind'], Stage | null> = { slot: 'read', call: 'act', route: 'route', reply: 'reply', end: null };
/** How long each step stays on screen before the next one. */
const DWELL_MS: Record<Step['kind'], number> = { slot: 420, call: 520, route: 520, reply: 650, end: 0 };
const FIRST_STEP_MS = 220;

const STAGES: { id: Stage; label: string; short: string; icon: LucideIcon }[] = [
  { id: 'read', label: 'Read the turn', short: 'Read', icon: ScanText },
  { id: 'act', label: 'Act in systems', short: 'Act', icon: Plug },
  { id: 'route', label: 'Route the turn', short: 'Route', icon: Split },
  { id: 'reply', label: 'Reply', short: 'Reply', icon: MessageSquare },
];

const stepsOf = (res: AgentTurnResponse): Step[] => [
  ...res.filled.map((id) => ({ kind: 'slot' as const, id })),
  ...res.calls.map((c) => ({ kind: 'call' as const, id: c.id })),
  { kind: 'route' },
  { kind: 'reply' },
  { kind: 'end' },
];

/** How many steps of the latest turn are on screen. With reduced motion the whole turn shows at once. */
function useReplay(key: string | null, steps: Step[], instant: boolean): number {
  const [state, setState] = useState<{ key: string | null; shown: number }>({ key, shown: 0 });
  const shown = state.key === key ? state.shown : 0;
  useEffect(() => {
    if (!key || shown >= steps.length) return;
    if (instant) return setState({ key, shown: steps.length });
    const t = setTimeout(() => setState({ key, shown: shown + 1 }), shown === 0 ? FIRST_STEP_MS : DWELL_MS[steps[shown - 1].kind]);
    return () => clearTimeout(t);
  }, [key, shown, steps, instant]);
  return key ? shown : 0;
}

interface Reveal {
  slots: Set<string>;
  calls: Set<string>;
  routed: boolean;
  replied: boolean;
  /** The step about to appear, while the turn is still replaying. */
  next: Step | null;
}
const ALL: Reveal = { slots: new Set(), calls: new Set(), routed: true, replied: true, next: null };

function revealOf(steps: Step[], shown: number): Reveal {
  const seen = steps.slice(0, shown);
  const ids = (kind: 'slot' | 'call') => new Set(seen.flatMap((s) => (s.kind === kind ? [s.id] : [])));
  return { slots: ids('slot'), calls: ids('call'), routed: seen.some((s) => s.kind === 'route'), replied: seen.some((s) => s.kind === 'reply'), next: steps[shown] ?? null };
}

/** The agent's state as far as the replay has got: nothing from this turn shows before its step has played. */
function sessionAt(res: AgentTurnResponse, before: AgentSession | null, r: Reveal): AgentSession {
  const s = res.session;
  if (r.replied) return s;
  return {
    ...s,
    status: 'active',
    awaiting: before?.awaiting ?? null,
    slots: s.slots.map((x) => (res.filled.includes(x.id) && !r.slots.has(x.id) ? { ...x, value: null, turn: null } : x)),
    calls: s.calls.filter((c) => c.turn !== s.turns || r.calls.has(c.id)),
    ...(r.routed ? {} : { turns: before?.turns ?? 0, models: before?.models ?? [], costUsd: before?.costUsd ?? 0, baselineUsd: before?.baselineUsd ?? 0, latencyMs: before?.latencyMs ?? 0 }),
  };
}

/** How ElevenAgent works. Each point describes what this page shows, nothing more. */
const AGENT_POINTS = [
  { title: 'State that outlives the model', body: 'The agent holds what the customer said and what it has done. When the router moves a turn to another model or vendor, nothing is asked twice.' },
  { title: 'It acts in your systems', body: 'It looks up the case, prices the renewal, posts the refund. Here the Salesforce Service Cloud and SAP S/4HANA connectors are sample connectors with fixed records.' },
  { title: 'Writes wait for a yes', body: 'Reads run as soon as the agent knows enough. Anything that changes a record waits for the customer to confirm, and a person takes over if no model can answer.' },
];

const newSession = () => `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default function Agent() {
  const scenarios = useApi<AgentScenario[]>('/agent/scenarios');
  const models = useApi<ModelInfo[]>('/providers');
  const [scenarioId, setScenarioId] = useState<AgentScenarioId>('refund');
  const [sessionId, setSessionId] = useState(newSession);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const live = useRef(sessionId);
  const reduce = useReducedMotion() ?? false;

  const scenario = scenarios.data?.find((s) => s.id === scenarioId);
  const turns = messages.filter((m): m is Extract<Msg, { role: 'agent' }> => m.role === 'agent');
  const latest = turns[turns.length - 1] ?? null;
  const before = turns[turns.length - 2]?.res.session ?? null;
  const ms_ = models.data ?? [];

  const steps = useMemo(() => (latest ? stepsOf(latest.res) : []), [latest]);
  const shown = useReplay(latest?.id ?? null, steps, reduce);
  const replaying = latest !== null && shown < steps.length;
  const reveal = useMemo(() => revealOf(steps, shown), [steps, shown]);
  // What the page shows: the state as far as the replay has got. What the next action depends on: the real state.
  const session = latest ? latest.res.session : null;
  const view = useMemo(() => (latest ? sessionAt(latest.res, before, reveal) : null), [latest, before, reveal]);
  const closed = session !== null && session.status !== 'active';
  const stage: Stage | null = sending ? 'read' : replaying ? (shown === 0 ? 'read' : STAGE_OF[steps[shown - 1].kind]) : null;

  // The customer line that supplies what the agent is waiting for (the opening line before the first turn).
  const script = scenario?.script.en ?? [];
  const nextLine = !scenario || closed ? null : !session ? script[0] ?? null : script[scenario.scriptFills.indexOf(session.awaiting ?? '')] ?? null;
  const busy = sending || replaying;

  const restart = () => {
    const id = newSession();
    live.current = id;
    setSessionId(id);
    setMessages([]);
    setPlaying(false);
    setSending(false);
    setError(null);
    setInput('');
  };

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy || closed) return;
    const sid = sessionId;
    setInput('');
    setError(null);
    setSending(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: message }]);
    try {
      const res = await api.post<AgentTurnResponse>('/agent/turn', { session_id: sid, scenario: scenarioId, language: 'en', customer_id: 'default', message });
      // A reply to a conversation that was restarted meanwhile is dropped.
      if (live.current === sid) setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'agent', res }]);
    } catch (err) {
      if (live.current === sid) setError((err as Error).message);
      setPlaying(false);
    } finally {
      if (live.current === sid) setSending(false);
    }
  };

  // "Play the call": send the scripted lines one after another until the conversation closes. It ends by itself.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!playing || busy) return;
    if (!nextLine) return setPlaying(false);
    const t = setTimeout(() => void sendRef.current(nextLine), messages.length ? PLAY_GAP_MS : 0);
    return () => clearTimeout(t);
  }, [playing, busy, nextLine, messages.length]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, sending, shown, reduce]);

  return (
    <Page>
      <PageHeader
        title="ElevenAgent"
        subtitle="A stateful agent on top of the router. It remembers what the customer said, reads and writes your business systems, and lets ElevenRoute pick the model for every turn."
        actions={<Button variant="secondary" icon={RotateCcw} onClick={restart}>New conversation</Button>}
      />
      <HowItWorks label="How ElevenAgent works" steps={AGENT_POINTS} />

      {/* Which call to play. Changing it starts a new conversation. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {scenarios.data ? (
          <Segmented
            size="sm"
            label="Customer goal"
            value={scenarioId}
            onChange={(v) => {
              setScenarioId(v);
              restart();
            }}
            options={scenarios.data.map((s) => ({ value: s.id, label: s.title }))}
          />
        ) : (
          <Skeleton className="h-9 w-80 max-w-full" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* conversation: stays in view on wide screens while the state beside it is read */}
        <section className="card flex min-h-[560px] flex-col overflow-hidden lg:sticky lg:top-6 lg:h-[calc(100dvh-316px)] lg:self-start">
          <LoopStrip stage={stage} idle={closed ? 'Conversation closed' : session ? 'Waiting for the customer' : 'One loop per customer turn'} />

          <div ref={list} className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5" aria-live="polite" aria-busy={busy}>
            {messages.length === 0 && !sending ? (
              <div className="m-auto max-w-sm text-center">
                <p className="h-display text-xl">Play a call, or type as the customer</p>
                <p className="mt-1.5 text-[13.5px] text-ink-3">Watch the agent state fill in while the model behind each reply changes. Give the details in any order: the agent only asks for what it still needs.</p>
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {messages.map((m) =>
                m.role === 'user' ? (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="max-w-[85%] self-end rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white [overflow-wrap:anywhere]">
                    {m.text}
                  </motion.div>
                ) : (
                  // Keyed by turn number, so the "working" bubble below becomes this reply instead of being replaced by it.
                  <AgentReply key={`turn-${m.res.session.turns}`} res={m.res} reveal={m.id === latest?.id ? reveal : ALL} models={ms_} />
                ),
              )}
              {sending ? <AgentReply key={`turn-${(session?.turns ?? 0) + 1}`} res={null} reveal={ALL} models={ms_} /> : null}
            </AnimatePresence>
            {error ? <ErrorNote error={error} /> : null}
          </div>

          <div className="border-t border-line bg-canvas/60 px-4 py-3 sm:px-5">
            {closed && !replaying ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={base} className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13.5px] text-ink-2">This conversation is closed. The agent state shows how it ended.</p>
                <Button size="sm" icon={RotateCcw} onClick={restart}>New conversation</Button>
              </motion.div>
            ) : (
              <>
                <div className="scroll-x mb-2.5 flex items-center gap-1.5 pb-0.5">
                  <Button size="sm" variant={playing ? 'secondary' : 'primary'} icon={playing ? Square : Play} disabled={!playing && (!nextLine || busy)} onClick={() => setPlaying((p) => !p)}>
                    {playing ? 'Stop' : messages.length ? 'Play the rest' : 'Play the call'}
                  </Button>
                  {nextLine && !playing && !busy ? (
                    <Chip onClick={() => send(nextLine)} className="shrink-0">
                      <span className="text-ink-3">Customer:</span>
                      <span className="max-w-[240px] truncate">{nextLine}</span>
                    </Chip>
                  ) : null}
                  {session?.awaiting === 'confirm' && !playing && !busy ? (
                    <Chip onClick={() => send(DECLINE)} className="shrink-0">
                      <span className="text-ink-3">Or:</span>
                      {DECLINE}
                    </Chip>
                  ) : null}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}>
                  <label htmlFor="agent-input" className="sr-only">Customer message</label>
                  <input
                    id="agent-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={playing}
                    placeholder="Type as the customer…"
                    enterKeyHint="send"
                    className="h-11 min-w-0 flex-1 rounded-full border border-line bg-canvas px-4 text-[15px] placeholder:text-ink-3 focus:border-ink/30 focus:outline-none disabled:opacity-60"
                  />
                  <Button type="submit" icon={Send} loading={sending} disabled={!input.trim() || playing || busy}>Send</Button>
                </form>
              </>
            )}
          </div>
        </section>

        {/* state */}
        <div className="flex min-w-0 flex-col gap-5">
          {scenario ? <StatePanel key={sessionId} scenario={scenario} session={view} models={ms_} /> : <Skeleton className="h-96" />}
          <Card>
            <Collapse label="Simulate a provider outage mid-call">
              <VendorControls compact />
              <p className="mt-2 text-[12px] text-ink-3">Take a vendor down between two turns: the next reply comes from another vendor and the agent state is untouched.</p>
            </Collapse>
          </Card>
        </div>
      </div>
    </Page>
  );
}

// ---- the loop, as a strip above the conversation ----
function LoopStrip({ stage, idle }: { stage: Stage | null; idle: string }) {
  const at = stage ? STAGES.findIndex((s) => s.id === stage) : -1;
  // The pill slides from step to step on the compositor (useIndicator), and fades out between turns.
  const [strip, pill] = useIndicator<HTMLDivElement>('[aria-current="step"]', [stage], 320);
  return (
    <div className="border-b border-line px-3 py-2.5 sm:px-4">
      <div ref={strip} className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-ink" style={pill} />
      <ol aria-label="Agent loop" className="grid grid-cols-4 gap-1">
        {STAGES.map((s, i) => {
          const active = i === at;
          const done = at > i;
          return (
            <li key={s.id} aria-current={active ? 'step' : undefined} className="relative flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-medium">
              {/* Above the pill, which crosses the other labels on its way from one stage to the next. */}
              <span className={`relative z-[1] flex items-center gap-1.5 transition-colors duration-200 ${active ? 'text-white' : done ? 'text-ink' : 'text-ink-3'}`}>
                {done ? <Check size={13} strokeWidth={2.6} className="text-ok" aria-hidden="true" /> : <s.icon size={13} aria-hidden="true" />}
                <span aria-hidden="true" className="whitespace-nowrap">{s.short}</span>
                <span className="sr-only">{s.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      </div>
      <p className="mt-1.5 text-center text-[11.5px] text-ink-3" aria-live="polite">{stage ? 'Working on this turn' : idle}</p>
    </div>
  );
}

// ---- one agent turn in the conversation ----
const NEXT_LABEL = (step: Step | null, res: AgentTurnResponse | null): string | null => {
  if (!res || !step) return res ? null : 'Reading the turn';
  if (step.kind === 'slot') return 'Reading the turn';
  if (step.kind === 'call') return `Calling ${SYSTEMS[res.calls.find((c) => c.id === step.id)?.system ?? 'sap'].name}`;
  if (step.kind === 'route') return 'Routing the turn';
  if (step.kind === 'reply') return 'Writing the reply';
  return null;
};

function AgentReply({ res, reveal, models }: { res: AgentTurnResponse | null; reveal: Reveal; models: ModelInfo[] }) {
  const route = res?.route;
  const slots = res ? res.session.slots.filter((s) => res.filled.includes(s.id) && (reveal.replied || reveal.slots.has(s.id))) : [];
  const calls = res ? res.calls.filter((c) => reveal.replied || reveal.calls.has(c.id)) : [];
  const working = NEXT_LABEL(reveal.next, res);
  const routed = Boolean(route && reveal.routed);
  const replied = Boolean(res && reveal.replied);

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={base} className="max-w-[94%] self-start rounded-[20px] rounded-bl-md border border-line bg-canvas p-4">
      {slots.length || calls.length ? (
        <ul className={`flex flex-col gap-1.5 text-[12.5px] text-ink-2 ${routed ? 'mb-3 border-b border-line pb-3' : ''}`}>
          {slots.map((s) => (
            <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={base} className="flex items-center gap-2">
              <Check size={13} strokeWidth={2.6} className="shrink-0 text-ok" aria-hidden="true" />
              <span>Learned <span className="text-ink-3">{s.label.toLowerCase()}:</span> <span className="font-medium text-ink">{s.value}</span></span>
            </motion.li>
          ))}
          {calls.map((c) => {
            const Icon = SYSTEMS[c.system].icon;
            return (
              <motion.li key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={base} className="flex items-center gap-2">
                <Icon size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
                <span>{c.write ? 'Wrote to' : 'Read from'} {SYSTEMS[c.system].name} <span className="text-ink-3">·</span> <span className="font-medium text-ink">{c.operation}</span></span>
              </motion.li>
            );
          })}
        </ul>
      ) : null}

      {routed && route ? (
        <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={base} className="flex flex-wrap items-center gap-2">
          <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="inline-flex">
            <Orb model={models.find((m) => m.id === route.model_used)} size={22} />
          </motion.span>
          <span className="text-[14px] font-medium">{modelName(models, route.model_used)}</span>
          <TurnBadge turnType={route.turn_type} />
          {route.failover_used && route.model_used ? <Status kind="warn" label="Failover" /> : null}
          {!route.model_used ? <Status kind="fail" label="All providers failed" /> : null}
        </motion.header>
      ) : null}

      {replied && res && route ? (
        <>
          <Words text={res.reply} className="mt-2.5 text-[15px] leading-relaxed text-ink" />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...base, delay: 0.25 }}>
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[11.5px] text-ink-2">
              <span className="rounded-full bg-card px-2.5 py-1">{money(route.cost_usd)} cost</span>
              <span className="rounded-full bg-card px-2.5 py-1">{ms(route.latency_ms)} latency</span>
              <span className="rounded-full bg-card px-2.5 py-1">{res.contextTokens > 0 ? `${res.contextTokens.toLocaleString('en-US')} context tokens` : 'no context yet'}</span>
            </div>
            <Collapse label="Why this model?" className="mt-2">
              <p className="text-[12.5px] leading-relaxed text-ink-3">{route.route_reason}</p>
              <div className="pt-2"><TraceTimeline trace={route.trace} models={models} /></div>
            </Collapse>
          </motion.div>
        </>
      ) : working ? (
        <div className={`flex items-center gap-2.5 text-[13px] text-ink-2 ${routed || slots.length || calls.length ? 'mt-2.5' : ''}`}>
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-2" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />
            ))}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={working} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={fast}>{working}…</motion.span>
          </AnimatePresence>
        </div>
      ) : null}
    </motion.article>
  );
}

/** The reply arrives word by word, the way a spoken answer does. Screen readers get the whole sentence. */
function Words({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ');
  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <motion.span aria-hidden="true" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}>
        {words.map((w, i) => (
          <motion.span key={i} className="inline-block whitespace-pre" variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } } }}>
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        ))}
      </motion.span>
    </p>
  );
}

// ---- the agent's state ----
function StatePanel({ scenario, session, models }: { scenario: AgentScenario; session: AgentSession | null; models: ModelInfo[] }) {
  const slots = session?.slots ?? scenario.slots.map((s) => ({ ...s, value: null, turn: null }));
  const answered = (session?.models ?? []).filter((id): id is string => id !== null);
  const distinct = [...new Set(answered)];
  const vendors = new Set(distinct.map((id) => models.find((m) => m.id === id)?.vendor).filter(Boolean));
  const status = session?.status ?? 'active';

  return (
    <Card
      title="Agent state"
      subtitle={scenario.goal}
      right={
        // The one rare, happy moment of a call gets a gentle spring; every other status just fades in.
        status === 'done' ? <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: 0.5, bounce: 0.25 }} className="inline-flex"><Status kind="ok" label="Goal met" /></motion.span>
        : status === 'declined' ? <Status kind="warn" label="Customer declined" />
        : status === 'handoff' ? <Status kind="warn" label="Handed to a person" />
        : <span className="inline-flex items-center rounded-full border border-line bg-canvas px-2.5 py-[3px] text-[12px] font-medium text-ink-2">{session ? 'In progress' : 'Not started'}</span>
      }>
      <div className="flex flex-col gap-5">
        <section aria-label="What the agent knows">
          <h3 className="label mb-2">What it knows</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl bg-canvas">
            {slots.map((s) => {
              const waiting = session?.awaiting === s.id;
              const filled = s.value !== null;
              return (
                <li key={s.id} className="relative flex items-center gap-3 px-3.5 py-2.5">
                  {/* A soft sweep marks the moment a value arrives. */}
                  {filled ? <motion.span aria-hidden="true" initial={{ opacity: 0.16 }} animate={{ opacity: 0 }} transition={{ duration: 1.1, ease: EASE }} className="pointer-events-none absolute inset-0 bg-ok" /> : null}
                  <span className="relative flex h-[15px] w-[15px] shrink-0 items-center justify-center">
                    {filled ? (
                      <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="inline-flex">
                        <Check size={15} strokeWidth={2.6} className="text-ok" aria-hidden="true" />
                      </motion.span>
                    ) : (
                      <CircleDashed size={15} className={`transition-colors duration-200 ${waiting ? 'text-ember' : 'text-ink-3'}`} aria-hidden="true" />
                    )}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[12px] text-ink-3">{s.label}</span>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={filled ? 'value' : waiting ? 'waiting' : 'unknown'}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={fast}
                        className={`block truncate text-[14px] ${filled ? 'font-medium text-ink' : 'text-ink-3'}`}>
                        {s.value ?? (waiting ? 'Asked, waiting for the customer' : 'Not known yet')}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  {s.turn !== null ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={base} className="relative shrink-0 font-mono text-[11.5px] text-ink-3">turn {s.turn}</motion.span> : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="What the agent does">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="label">What it does</h3>
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-2xl bg-canvas px-3.5">
            {scenario.tools.map((t) => <ToolRow key={t.id} tool={t} scenario={scenario} session={session} />)}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">Sample connectors: fixed records, and no request leaves this server. Writes wait for the customer’s yes.</p>
        </section>

        <section aria-label="Totals" className="grid grid-cols-3 gap-2 text-center">
          <Total label="Turns">{session?.turns ?? 0}</Total>
          <Total label="Model cost">{session?.turns ? <AnimatedNumber value={session.costUsd} format={money} /> : '—'}</Total>
          <Total label="Model latency">{session?.turns ? <AnimatedNumber value={session.latencyMs} format={ms} /> : '—'}</Total>
        </section>

        {session && answered.length ? <Baseline session={session} /> : null}

        {answered.length ? (
          <section aria-label="Models that answered" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5">
              {(session?.models ?? []).map((id, i) => (
                <motion.span key={i} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} title={`Turn ${i + 1}: ${modelName(models, id)}`} className="inline-flex">
                  <Orb model={models.find((m) => m.id === id)} size={20} />
                  <span className="sr-only">Turn {i + 1}: {modelName(models, id)}</span>
                </motion.span>
              ))}
            </span>
            <span className="text-[12.5px] text-ink-2">
              One state, {distinct.length} {distinct.length === 1 ? 'model' : 'models'}{vendors.size > 1 ? ` from ${vendors.size} vendors` : ''}{session?.status === 'active' ? ' so far' : ''}.
            </span>
          </section>
        ) : null}
      </div>
    </Card>
  );
}

function Total({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-canvas px-2 py-3">
      <div className="font-mono text-[15px] text-ink">{children}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-3">{label}</div>
    </div>
  );
}

/** This call's model cost against the same tokens on the best allowed model: the Overview's comparison, for one call. */
function Baseline({ session }: { session: AgentSession }) {
  const { costUsd, baselineUsd } = session;
  const top = Math.max(costUsd, baselineUsd) || 1;
  const pct = baselineUsd > 0 ? ((baselineUsd - costUsd) / baselineUsd) * 100 : 0;
  const cheaper = pct > 0.05;
  const dearer = pct < -0.05;
  const bars = [
    { label: 'Routed, turn by turn', value: costUsd, cls: 'bg-ink' },
    { label: 'Best allowed model on every turn', value: baselineUsd, cls: 'bg-ink-3/45' },
  ];
  return (
    <section aria-label="Cost against the one-model baseline" className="rounded-2xl bg-canvas p-3.5">
      <div className="flex flex-col gap-2.5">
        {bars.map((b) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-ink-2">{b.label}</span>
              <AnimatedNumber value={b.value} format={money} className="font-mono text-ink" />
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: b.value / top }} transition={{ duration: 0.5, ease: EASE }} style={{ transformOrigin: 'left' }} className={`h-full rounded-full ${b.cls}`} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {cheaper ? (
          <><strong className="font-medium text-ok">{pct.toFixed(1)}% lower model cost</strong> on this call{session.status === 'active' ? ' so far' : ''}, at sample prices.</>
        ) : dearer ? (
          <><strong className="font-medium text-ember">{Math.abs(pct).toFixed(1)}% extra cost</strong> on this call{session.status === 'active' ? ' so far' : ''}: a failover or a pinned model made routing dearer than the baseline.</>
        ) : (
          <>Same cost as the baseline{session.status === 'active' ? ' so far' : ''}: every turn needed the best model.</>
        )}
      </p>
    </section>
  );
}

function ToolRow({ tool, scenario, session }: { tool: AgentToolInfo; scenario: AgentScenario; session: AgentSession | null }) {
  const call = session?.calls.find((c) => c.id === tool.id);
  const sys = SYSTEMS[tool.system];
  const Kind = tool.write ? PenLine : Eye;
  const missing = tool.needs.filter((n) => (session?.slots.find((s) => s.id === n)?.value ?? null) === null).map((n) => scenario.slots.find((s) => s.id === n)?.label.toLowerCase() ?? n);
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${call ? 'bg-ink text-white' : 'bg-card text-ink-3'}`}>
          {/* One ring going out marks the call. */}
          {call ? <motion.span aria-hidden="true" initial={{ scale: 1, opacity: 0.45 }} animate={{ scale: 2, opacity: 0 }} transition={{ duration: 0.7, ease: EASE }} className="pointer-events-none absolute inset-0 rounded-full border border-ink" /> : null}
          <sys.icon size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={`text-[14px] transition-colors duration-200 ${call ? 'font-medium text-ink' : 'text-ink-2'}`}>{tool.operation}</span>
            <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
              <Kind size={11} aria-hidden="true" />
              {tool.write ? 'Write' : 'Read'}
            </span>
          </div>
          <div className="text-[12px] text-ink-3">{sys.name}</div>
          {call ? (
            <motion.div className="cascade mt-1.5 flex flex-wrap gap-1.5 font-mono text-[11.5px] text-ink-2 [--cascade-start:40ms]">
              {Object.entries(call.result).map(([k, v]) => (
                <span key={k} className="rounded-full bg-card px-2.5 py-1">{k}: {v}</span>
              ))}
            </motion.div>
          ) : (
            <div className="mt-0.5 text-[12px] text-ink-3">{missing.length ? `Needs ${missing.join(', ')}` : 'Ready'}</div>
          )}
        </div>
        {call ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={base} className="shrink-0 font-mono text-[11.5px] text-ink-3">turn {call.turn}</motion.span> : null}
      </div>
    </li>
  );
}
