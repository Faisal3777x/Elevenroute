import { RotateCcw, Route, Send, TriangleExclamationPoint, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChatRequest, ChatResponse, Language, ModelInfo, RoutingConfig, TestCase, UseCase } from '../../../shared/types';
import { Collapse } from '../components/Collapse';
import { Orb } from '../components/Orb';
import { RoutingVisualiser } from '../components/RoutingVisualiser';
import { TraceTimeline } from '../components/TraceTimeline';
import { Button, Card, Chip, ErrorNote, Page, PageHeader, Segmented, Status, TurnBadge } from '../components/ui';
import { VendorControls } from '../components/VendorControls';
import { api } from '../lib/api';
import { LANGS, USE_CASES, modelName, money, ms } from '../lib/format';
import { useMode } from '../lib/mode';
import { base, spring } from '../lib/motion';
import { runFromChat } from '../lib/runs';
import { useApi } from '../lib/useApi';

type Msg = { id: string; role: 'user'; text: string } | { id: string; role: 'agent'; req: ChatRequest; res: ChatResponse };

const newConversation = () => `play-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default function Playground() {
  const models = useApi<ModelInfo[]>('/providers');
  const routing = useApi<RoutingConfig>('/routing');
  const cases = useApi<TestCase[]>('/tests/cases');
  const { config } = useMode();
  const [customer, setCustomer] = useState('default');
  const [language, setLanguage] = useState<Language>('en');
  const [useCase, setUseCase] = useState<UseCase>('refund');
  const [conversationId, setConversationId] = useState(newConversation);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const visualiser = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, sending, reduce]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setError(null);
    setSending(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: message }]);
    const req: ChatRequest = { conversation_id: conversationId, message, language, use_case: useCase, customer_id: customer };
    try {
      const res = await api.post<ChatResponse>('/chat', req);
      const id = `a${Date.now()}`;
      setMessages((m) => [...m, { id, role: 'agent', req, res }]);
      setSelected(id);
      if (res.failover_used) setToast(res.route_reason.split('· Failover: ')[1] ?? 'A provider failed and another one answered.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const agentMsgs = messages.filter((m): m is Extract<Msg, { role: 'agent' }> => m.role === 'agent');
  const current = agentMsgs.find((m) => m.id === selected) ?? agentMsgs[agentMsgs.length - 1];
  // Memoised so typing doesn't restart the visualiser animation.
  const run = useMemo(() => (current ? runFromChat(current.req, current.res, routing.data?.policies) : null), [current, routing.data]);
  const suggestions = (cases.data ?? []).filter((c) => c.language === language && c.useCase === useCase);
  const ms_ = models.data ?? [];

  const showInVisualiser = (id: string) => {
    setSelected(id);
    if (window.matchMedia('(max-width: 1023px)').matches) visualiser.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <Page>
      <PageHeader
        title="Playground"
        subtitle="Chat with the router. A short confirmation should go to a low-cost model; a dispute or multi-step request needs a stronger one. Every reply shows why."
        actions={<Button variant="secondary" icon={RotateCcw} onClick={() => { setMessages([]); setSelected(null); setConversationId(newConversation()); }}>New conversation</Button>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* chat */}
        <motion.section variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: base } }} className="card flex min-h-[560px] flex-col overflow-hidden lg:h-[calc(100dvh-220px)]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <span className="text-[13px] text-ink-2">
              {routing.data?.policies.find((p) => p.id === customer)?.name ?? 'Default'} · {LANGS.find((l) => l.value === language)?.label} · {USE_CASES.find((u) => u.value === useCase)?.label}
            </span>
            <span className="text-[12px] text-ink-3">{config?.mode === 'live' ? 'Live: real provider calls' : 'Demo: simulated providers'}</span>
          </div>

          <div ref={list} className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-5" aria-live="polite" aria-busy={sending}>
            {messages.length === 0 && !sending ? (
              <div className="m-auto max-w-sm text-center">
                <p className="h-display text-xl">Start with a suggestion</p>
                <p className="mt-1.5 text-[13.5px] text-ink-3">Try the simple message, then the complex one, and compare which model each one gets and what it costs.</p>
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {messages.map((m) =>
                m.role === 'user' ? (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="max-w-[85%] self-end rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white">
                    {m.text}
                  </motion.div>
                ) : (
                  <AgentReply key={m.id} msg={m} models={ms_} active={current?.id === m.id} onVisualise={() => showInVisualiser(m.id)} />
                ),
              )}
              {sending && <Typing key="typing" />}
            </AnimatePresence>
            {error ? <ErrorNote error={error} /> : null}
          </div>

          <div className="border-t border-line bg-canvas/60 px-4 py-3 sm:px-5">
            <div className="scroll-x mb-2.5 flex gap-1.5 pb-0.5">
              {suggestions.map((c) => (
                <Chip key={c.id} onClick={() => send(c.message)} className="shrink-0">
                  <TurnBadge turnType={c.turnType} />
                  <span className="max-w-[220px] truncate">{c.message}</span>
                </Chip>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}>
              <label htmlFor="pg-input" className="sr-only">Customer message</label>
              <input
                id="pg-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={language === 'es' ? 'Escribe un mensaje del cliente…' : 'Type a customer message…'}
                className="h-11 min-w-0 flex-1 rounded-full border border-line bg-canvas px-4 text-[15px] placeholder:text-ink-3 focus:border-ink/30 focus:outline-none"
              />
              <Button type="submit" icon={Send} loading={sending} disabled={!input.trim()}>Send</Button>
            </form>
          </div>
        </motion.section>

        {/* side panel */}
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
          <Card title="Request settings">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="label">Customer policy</span>
                <Segmented size="sm" label="Customer policy" value={customer} onChange={setCustomer} options={(routing.data?.policies ?? [{ id: 'default', name: 'Default' }]).map((p) => ({ value: p.id, label: p.name }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="label">Language</span>
                <Segmented size="sm" label="Language" value={language} onChange={setLanguage} options={LANGS} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="label">Call type</span>
                <div className="flex flex-wrap gap-1.5">
                  {USE_CASES.map((u) => <Chip key={u.value} active={u.value === useCase} onClick={() => setUseCase(u.value)}>{u.label}</Chip>)}
                </div>
              </div>
              <Collapse label="Simulate a provider outage">
                <VendorControls compact />
                <p className="mt-2 text-[12px] text-ink-3">Test switch only. It never reflects a real provider incident.</p>
              </Collapse>
            </div>
          </Card>
          <div ref={visualiser} className="scroll-mt-20">
            <Card title="Routing visualiser" subtitle={current ? 'Replaying the selected reply’s real trace.' : undefined}>
              <RoutingVisualiser run={run} models={ms_} placeholder="Send a message to watch it get routed." />
            </Card>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="fixed right-4 bottom-28 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-warn/30 bg-canvas p-4 shadow-[var(--shadow-lift)] lg:bottom-6">
            <TriangleExclamationPoint size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
            <div className="text-[13.5px]">
              <div className="font-medium text-ink">Failover</div>
              <div className="text-ink-2">{toast}</div>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="rounded-full p-1 text-ink-3 hover:bg-card hover:text-ink">
              <X size={14} aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}

function AgentReply({ msg, models, active, onVisualise }: { msg: Extract<Msg, { role: 'agent' }>; models: ModelInfo[]; active: boolean; onVisualise: () => void }) {
  const { res } = msg;
  const model = models.find((m) => m.id === res.model_used);
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={base}
      className={`max-w-[94%] self-start rounded-[20px] rounded-bl-md border bg-canvas p-4 transition-[border-color,box-shadow] ${active ? 'border-ink/25 shadow-[var(--shadow-card)]' : 'border-line'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <Orb model={model} size={22} />
        <span className="text-[14px] font-medium">{modelName(models, res.model_used)}</span>
        <TurnBadge turnType={res.turn_type} />
        {res.failover_used ? <Status kind="warn" label="Failover" /> : null}
        {!res.model_used ? <Status kind="fail" label="All providers failed" /> : null}
      </header>
      <p className="mt-2.5 text-[15px] leading-relaxed text-ink">{res.reply}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[11.5px] text-ink-2">
        <span className="rounded-full bg-card px-2.5 py-1">{money(res.cost_usd)} cost</span>
        <span className="rounded-full bg-card px-2.5 py-1">{ms(res.latency_ms)} latency</span>
        <span className="rounded-full bg-card px-2.5 py-1">{ms(res.trace.overheadMs)} routing</span>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{res.route_reason}</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <Collapse label="Why this model?">
          <div className="pt-1"><TraceTimeline trace={res.trace} models={models} /></div>
        </Collapse>
        <Button size="sm" variant="ghost" icon={Route} onClick={onVisualise}>Visualise route</Button>
      </div>
    </motion.article>
  );
}

function Typing() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={base} className="flex items-center gap-3 self-start rounded-[20px] rounded-bl-md border border-line bg-canvas px-4 py-3" aria-label="Routing your request">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-2" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />
        ))}
      </span>
      <span className="text-[13px] text-ink-2">Classifying and routing…</span>
    </motion.div>
  );
}
