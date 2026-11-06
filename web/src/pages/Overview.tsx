import { ArrowRight, Send, Zap } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ChatResponse, ModelInfo, Overview as OverviewData, PreviewResponse, RoutingConfig, Savings, TestCase } from '../../../shared/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ChartTooltip, SeriesFilter } from '../components/ChartTooltip';
import { Collapse } from '../components/Collapse';
import { Kpi } from '../components/Kpi';
import { Orb } from '../components/Orb';
import { RoutingVisualiser, type RouteRun } from '../components/RoutingVisualiser';
import { InfoTip } from '../components/Tooltip';
import { Button, Card, Chip, Empty, ErrorNote, Page, PageHeader, Segmented, SimulatedTag, Skeleton, Status } from '../components/ui';
import { VendorControls } from '../components/VendorControls';
import { api } from '../lib/api';
import { count, modelName, money, ms, pct, shortDate, timeAgo, weekTrend } from '../lib/format';
import { useMode } from '../lib/mode';
import { base, fadeUp } from '../lib/motion';
import { runFromChat, runFromPreview } from '../lib/runs';
import { INK3, LINE, modelColor } from '../lib/theme';
import { useApi } from '../lib/useApi';

const SAMPLES = [
  { id: 'order_status-en-simple', label: 'Simple · English' },
  { id: 'refund-en-complex', label: 'Complex · English' },
  { id: 'appointment-es-simple', label: 'Simple · Spanish' },
  { id: 'complaint-es-complex', label: 'Complex · Spanish' },
];

export default function Overview() {
  const stats = useApi<OverviewData>('/stats/overview');
  const savings = useApi<Savings>('/stats/savings');
  const models = useApi<ModelInfo[]>('/providers');
  const { config } = useMode();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = config?.mode !== 'live';

  const { reload: reloadStats } = stats;
  const { reload: reloadSavings } = savings;
  const refresh = useCallback(() => Promise.all([reloadStats(), reloadSavings()]), [reloadStats, reloadSavings]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.post('/traffic/generate', { count: 500 });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const s = stats.data;
  const ms_ = models.data ?? [];
  const costDaily = useMemo(() => (s ? s.days.map((_, i) => s.costByModel.reduce((sum, c) => sum + c.values[i], 0)) : []), [s]);

  return (
    <Page>
      <PageHeader
        eyebrow={demo ? <SimulatedTag>Demo data · simulated providers</SimulatedTag> : <SimulatedTag>Live data</SimulatedTag>}
        title="Overview"
        subtitle="Where every conversation turn went, what it cost, and how much routing saves compared with always using the best model."
        actions={<Button icon={Zap} onClick={generate} loading={generating}>Generate traffic</Button>}
      />

      {stats.error && !s ? <ErrorNote error={stats.error} onRetry={stats.reload} /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {!s && !stats.error ? <OverviewSkeleton /> : null}

      {s && s.requests === 0 ? (
        <Empty
          title="No traffic yet"
          body="Generate 500 synthetic conversations across every call type, language and customer, including two replayed provider incidents. Synthetic traffic always uses simulated providers, so it never spends API credit."
          action={<Button icon={Zap} onClick={generate} loading={generating}>Generate traffic</Button>}
        />
      ) : null}

      {s && s.requests > 0 ? (
        <>
          {savings.data && savings.data.turns > 0 ? <SavingsHero data={savings.data} models={ms_} demo={demo} /> : null}

          <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Kpi label="Total requests" value={s.requests} format={count} trend={weekTrend(s.requestsDaily)} goodWhen="neutral" hint={`${count(s.conversations)} conversations · 14 days`} info="Conversation turns routed in the last 14 days. Each customer message is one request." />
            <Kpi label="Total model cost" value={s.totalCost} format={money} trend={weekTrend(costDaily)} goodWhen="neutral" hint="last 14 days" info="Sum of the cost of every turn: tokens × the serving model's price per 1k tokens." />
            <Kpi label="Avg cost per conversation" value={s.costPerConversation} format={money} info="Total model cost divided by the number of distinct conversations." />
            {savings.data && savings.data.turns > 0 ? (
              <Kpi label="Estimated savings" value={savings.data.savingsPct} format={(n) => pct(n, 1)} hint={`${money(savings.data.savings)} vs best-model baseline`} tag={<SimulatedTag>Estimate</SimulatedTag>} info="Routed spend compared with the same logged tokens priced on the highest-quality model each customer may use. An estimate, not a measured saving." />
            ) : (
              <Kpi label="Estimated savings" value={0} format={() => '—'} hint="Needs logged traffic" />
            )}
            <Kpi label="Average latency" value={s.avgLatencyMs} format={ms} trend={weekTrend(s.latencyDaily, 'avg')} goodWhen="down" info="Mean end-to-end model response time per turn, including any failed attempts before a failover." />
            <Kpi label="P95 latency" value={s.p95LatencyMs} format={ms} info="The response time within which approximately 95% of measured requests are completed." />
            <Kpi label="Routing overhead (p95)" value={s.p95OverheadMs} format={ms} hint="budget 20 ms" info="Time ElevenRoute spends choosing a model, excluding the model call itself. 95% of decisions take this long or less." />
            <Kpi label="Failovers" value={s.failovers} format={count} trend={weekTrend(s.failoverDaily)} goodWhen="down" hint={`${((s.failovers / s.requests) * 100).toFixed(1)}% of turns`} info="Turns where the first model errored or exceeded the latency budget and another provider answered." />
          </motion.div>
        </>
      ) : null}

      <VisualiserCard models={ms_} onSent={refresh} />

      {s && s.requests > 0 ? (
        <>
          <CostChart data={s} models={ms_} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ShareChart data={s} models={ms_} />
            <FailoverCard data={s} models={ms_} />
          </div>
        </>
      ) : null}
    </Page>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-40" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}</div>
    </div>
  );
}

// ---------- savings hero ----------
function SavingsHero({ data, models, demo }: { data: Savings; models: ModelInfo[]; demo: boolean }) {
  const max = Math.max(data.baselineCost, data.actualCost, 1e-9);
  const top = [...data.baselineModels].sort((a, b) => b.turns - a.turns)[0];
  return (
    <motion.section variants={fadeUp} className="card relative overflow-hidden p-6 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 -right-24 h-96 w-96" style={{ background: 'radial-gradient(closest-side, rgb(4 71 255 / 0.08), transparent)' }} />
      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Estimated savings from routing · last {data.days} days</span>
            <SimulatedTag>Estimate</SimulatedTag>
            {demo ? <SimulatedTag>Simulated providers</SimulatedTag> : null}
            <InfoTip content="We price the same logged tokens on the highest-quality model each customer's policy allows (usually the most expensive) and compare with what routing actually spent. Both use current catalogue prices." />
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <AnimatedNumber value={data.savingsPct} format={(n) => pct(n, 1)} className="h-display text-[64px] leading-none sm:text-[76px]" />
            <span className="text-[15px] text-ink-2">lower model spend</span>
          </div>
          <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed text-ink-2">
            Routing cost <strong className="font-medium text-ink">{money(data.actualCost)}</strong> for {count(data.turns)} turns. Sending every turn to the best allowed model
            {top ? <> (mostly {modelName(models, top.modelId)})</> : null} would have cost <strong className="font-medium text-ink">{money(data.baselineCost)}</strong>.
          </p>
          <Link to="/whatif" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-ink hover:gap-2.5 transition-[gap]">
            Explore scenarios in What-if <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <div className="flex flex-col gap-4">
          <CompareBar label="Best-model baseline" value={data.baselineCost} max={max} color="#d4cdc6" />
          <CompareBar label="ElevenRoute routed" value={data.actualCost} max={max} color="#0c0b0a" />
          <div className="flex items-center justify-between rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line">
            <span className="text-[13px] text-ink-2">Estimated saving</span>
            <AnimatedNumber value={data.savings} format={money} className="font-mono text-[15px] font-medium text-ok" />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function CompareBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <AnimatedNumber value={value} format={money} className="font-mono text-ink" />
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-line/70">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(value / max) * 100}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </div>
  );
}

// ---------- routing visualiser ----------
function VisualiserCard({ models, onSent }: { models: ModelInfo[]; onSent: () => void }) {
  const cases = useApi<TestCase[]>('/tests/cases');
  const routing = useApi<RoutingConfig>('/routing');
  const [sample, setSample] = useState(SAMPLES[1].id);
  const [customer, setCustomer] = useState('default');
  const [run, setRun] = useState<RouteRun | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tc = cases.data?.find((c) => c.id === sample);

  const request = useMemo(() => (tc ? { message: tc.message, language: tc.language, use_case: tc.useCase, customer_id: customer } : null), [tc, customer]);

  // Dry run whenever the sample or customer changes: shows the decision without calling a model.
  useEffect(() => {
    if (!request) return;
    const c = new AbortController();
    api
      .post<PreviewResponse>('/route/preview', request, c.signal)
      .then((res) => setRun(runFromPreview(request, res, routing.data?.policies)))
      .catch((err: Error) => err.name !== 'AbortError' && setError(err.message));
    return () => c.abort();
  }, [request, routing.data]);

  const send = async () => {
    if (!request) return;
    setSending(true);
    setError(null);
    try {
      const req = { ...request, conversation_id: `overview-${Date.now().toString(36)}` };
      const res = await api.post<ChatResponse>('/chat', req);
      setRun(runFromChat(req, res, routing.data?.policies));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      title="How a request is routed"
      subtitle="Every frame comes from the router's real decision and trace. The preview is a dry run; Send makes a real request that is logged like any other."
      right={<Button icon={Send} size="sm" onClick={send} loading={sending} disabled={!request}>Send through router</Button>}>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sample request">
          {SAMPLES.map((s) => <Chip key={s.id} active={s.id === sample} onClick={() => setSample(s.id)}>{s.label}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label">Customer</span>
          <Segmented size="sm" label="Customer policy" value={customer} onChange={setCustomer} options={(routing.data?.policies ?? [{ id: 'default', name: 'Default' }]).map((p) => ({ value: p.id, label: p.name }))} />
        </div>
        <Collapse label="Simulate a provider outage to see failover">
          <div className="rounded-2xl bg-canvas p-4 ring-1 ring-line">
            <VendorControls compact />
            <p className="mt-3 text-[12px] text-ink-3">A simulated outage is a test switch, not a real provider incident. Set a provider to Down, then Send.</p>
          </div>
        </Collapse>
      </div>
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <RoutingVisualiser run={run} models={models} placeholder="Loading a sample decision…" />
    </Card>
  );
}

// ---------- charts ----------
function CostChart({ data, models }: { data: OverviewData; models: ModelInfo[] }) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const series = useMemo(
    () =>
      data.costByModel
        .map((c) => ({ key: c.modelId, label: modelName(models, c.modelId), color: modelColor(models.find((m) => m.id === c.modelId)), values: c.values }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [data, models],
  );
  const rows = useMemo(() => data.days.map((day, i) => Object.fromEntries([['day', day], ...series.map((s) => [s.key, s.values[i]])])), [data, series]);
  const toggle = (k: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  return (
    <Card
      title="Cost per model over time"
      subtitle="Daily model cost, stacked by model. Click a legend item to hide or show it."
      right={<Segmented size="sm" label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}>
      <AnimatePresence mode="wait" initial={false}>
        {view === 'chart' ? (
          <motion.div key="chart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={base}>
            <div className="h-[280px]" role="img" aria-label="Stacked bar chart of daily cost per model. A table view is available.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={LINE} />
                  <XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} minTickGap={18} />
                  <YAxis tickFormatter={(v: number) => money(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} width={58} />
                  <Tooltip cursor={{ fill: 'rgb(0 0 0 / 0.03)' }} content={<ChartTooltip format={money} total labelFormat={shortDate} />} />
                  {series.filter((s) => !hidden.has(s.key)).map((s, i, arr) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="cost" fill={s.color} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={!reduce} animationDuration={700} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SeriesFilter items={series} hidden={hidden} onToggle={toggle} />
          </motion.div>
        ) : (
          <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={base} className="scroll-x">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <caption className="sr-only">Daily cost per model</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-2">
                  <th scope="col" className="py-2 pr-3 font-medium">Day</th>
                  {series.map((s) => <th key={s.key} scope="col" className="px-2 py-2 text-right font-medium">{s.label}</th>)}
                  <th scope="col" className="py-2 pl-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d, i) => (
                  <tr key={d} className="border-b border-line/70">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">{shortDate(d)}</th>
                    {series.map((s) => <td key={s.key} className="px-2 py-1.5 text-right font-mono tabular-nums">{money(s.values[i])}</td>)}
                    <td className="py-1.5 pl-2 text-right font-mono font-medium tabular-nums">{money(series.reduce((sum, s) => sum + s.values[i], 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ShareChart({ data, models }: { data: OverviewData; models: ModelInfo[] }) {
  const reduce = useReducedMotion();
  const rows = [...data.share]
    .sort((a, b) => b.simple + b.complex - (a.simple + a.complex))
    .map((r) => ({ name: modelName(models, r.modelId), simple: r.simple, complex: r.complex, color: modelColor(models.find((m) => m.id === r.modelId)) }));
  return (
    <Card title="Where turns go" subtitle="Turns served per model. Solid = simple turns, light = complex turns.">
      <div style={{ height: Math.max(180, rows.length * 44) }} role="img" aria-label={rows.map((r) => `${r.name}: ${r.simple} simple, ${r.complex} complex`).join('; ')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap={10}>
            <CartesianGrid horizontal={false} stroke={LINE} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} />
            <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#4a4541' }} />
            <Tooltip cursor={{ fill: 'rgb(0 0 0 / 0.03)' }} content={<ChartTooltip format={count} total />} />
            <Bar dataKey="simple" name="Simple turns" stackId="t" isAnimationActive={!reduce} animationDuration={700}>
              {rows.map((r) => <Cell key={r.name} fill={r.color} />)}
            </Bar>
            <Bar dataKey="complex" name="Complex turns" stackId="t" radius={[0, 4, 4, 0]} isAnimationActive={!reduce} animationDuration={700}>
              {rows.map((r) => <Cell key={r.name} fill={r.color} fillOpacity={0.42} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function FailoverCard({ data, models }: { data: OverviewData; models: ModelInfo[] }) {
  const reduce = useReducedMotion();
  const rows = data.days.map((day, i) => ({ day, failovers: data.failoverDaily[i] }));
  return (
    <Card title="Failover history" subtitle="Turns where another provider had to answer. Includes the replayed incidents in synthetic traffic.">
      <div className="h-[120px]" role="img" aria-label="Daily failover counts">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fill: INK3 }} minTickGap={22} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fill: INK3 }} width={28} />
            <Tooltip cursor={{ fill: 'rgb(0 0 0 / 0.03)' }} content={<ChartTooltip format={count} labelFormat={shortDate} />} />
            <Bar dataKey="failovers" name="Failovers" fill="#4a4541" radius={[3, 3, 0, 0]} isAnimationActive={!reduce} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {data.recentFailovers.slice(0, 5).map((f, i) => (
          <motion.li key={`${f.ts}-${i}`} variants={fadeUp} className="flex items-start gap-3">
            <Status kind={f.reason === 'timeout' ? 'slow' : 'down'} label={f.reason === 'timeout' ? 'Timeout' : 'Error'} />
            <div className="min-w-0 flex-1 text-[13.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <Orb model={models.find((m) => m.id === f.from)} size={14} />
                {modelName(models, f.from)} <ArrowRight size={13} className="text-ink-3" aria-label="to" /> <Orb model={models.find((m) => m.id === f.to)} size={14} /> {modelName(models, f.to)}
              </div>
              <div className="text-[12px] text-ink-3">{timeAgo(f.ts)} · {f.language.toUpperCase()}</div>
            </div>
          </motion.li>
        ))}
        {data.recentFailovers.length === 0 ? <li className="text-[13px] text-ink-3">No failovers in this period.</li> : null}
      </ul>
    </Card>
  );
}
