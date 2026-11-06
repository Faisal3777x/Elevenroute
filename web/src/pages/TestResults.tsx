import { ChevronDown, FlaskConical, TrendingDown, TrendingUp, TriangleExclamationPoint } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { Alert, ModelInfo, RoutingConfig, TestCase, TestResult, TestRun } from '../../../shared/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ChartTooltip } from '../components/ChartTooltip';
import { Orb } from '../components/Orb';
import { Tooltip as Tip } from '../components/Tooltip';
import { Button, Card, Chip, Empty, ErrorNote, Page, PageHeader, Segmented, SimulatedTag, Skeleton, Status, TurnBadge } from '../components/ui';
import { api } from '../lib/api';
import { LANGS, USE_CASES, modelName, ms, score, timeAgo } from '../lib/format';
import { useMode } from '../lib/mode';
import { base, fadeUp, spring } from '../lib/motion';
import { INK3, LINE, modelColor } from '../lib/theme';
import { useApi } from '../lib/useApi';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
type Metric = 'score' | 'accuracy' | 'tone' | 'latency' | 'completion';

export default function TestResults() {
  const models = useApi<ModelInfo[]>('/providers');
  const results = useApi<TestResult[]>('/tests/results');
  const runs = useApi<TestRun[]>('/tests/runs');
  const alerts = useApi<Alert[]>('/alerts');
  const routing = useApi<RoutingConfig>('/routing');
  const cases = useApi<TestCase[]>('/tests/cases');
  const { config } = useMode();
  const [running, setRunning] = useState<{ started: number } | null>(null);
  const [done, setDone] = useState<{ id: number; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const started = Date.now();
    setRunning({ started });
    setDone(null);
    setError(null);
    try {
      const r = await api.post<TestRun>('/tests/run');
      await Promise.all([models.reload(), results.reload(), runs.reload(), alerts.reload()]);
      setDone({ id: r.id, seconds: (Date.now() - started) / 1000 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const floor = routing.data?.strategy.exclusionFloor ?? 0.7;
  const tested = (models.data ?? []).filter((m) => m.testScore !== null).sort((a, b) => (b.testScore ?? 0) - (a.testScore ?? 0));
  const perModel = useMemo(() => {
    const map = new Map<string, TestResult[]>();
    for (const r of results.data ?? []) map.set(r.modelId, [...(map.get(r.modelId) ?? []), r]);
    return map;
  }, [results.data]);
  const caseCount = cases.data?.length ?? 24;
  const modelCount = (models.data ?? []).filter((m) => m.enabled).length;
  const prevScores = runs.data?.[1]?.scores;

  return (
    <Page>
      <PageHeader
        title="Test results"
        subtitle={`${caseCount} conversations: 6 call types × English and Spanish × simple and complex. Every model gets the same tests; a model under the floor is removed from routing automatically.`}
        eyebrow={config?.mode === 'live' ? <SimulatedTag>Live judge: strongest model with a key</SimulatedTag> : <SimulatedTag>Demo: simulated judge</SimulatedTag>}
        actions={<Button icon={FlaskConical} onClick={run} loading={!!running}>Run tests</Button>}
      />
      {error ? <ErrorNote error={error} /> : null}
      <AnimatePresence>{running || done ? <RunProgress key="progress" running={running} done={done} models={modelCount} cases={caseCount} /> : null}</AnimatePresence>

      {!models.data || !results.data ? <Skeleton className="h-72" /> : null}
      {models.data && tested.length === 0 && !running ? (
        <Empty title="No test runs yet" body="Run the suite to score every model on task completion, accuracy, tone and latency." action={<Button icon={FlaskConical} onClick={run}>Run tests</Button>} />
      ) : null}

      {tested.length > 0 && results.data ? (
        <>
          <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tested.map((m) => <Scorecard key={m.id} model={m} rows={perModel.get(m.id) ?? []} floor={floor} prev={prevScores?.[m.id]} />)}
          </motion.div>
          <Comparison models={tested} perModel={perModel} floor={floor} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Heatmap models={tested} results={results.data} />
            <Alerts alerts={alerts.data ?? []} />
          </div>
          <Conversations models={tested} perModel={perModel} cases={cases.data ?? []} />
          <History runs={runs.data ?? []} models={models.data ?? []} />
        </>
      ) : null}
    </Page>
  );
}

function RunProgress({ running, done, models, cases }: { running: { started: number } | null; done: { id: number; seconds: number } | null; models: number; cases: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((Date.now() - running.started) / 1000), 100);
    return () => clearInterval(id);
  }, [running]);
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={base} className="overflow-hidden" role="status">
      <div className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
          <span className="font-medium">{running ? `Scoring ${models} models × ${cases} conversations…` : `Run #${done?.id} complete`}</span>
          <span className="font-mono text-[12.5px] text-ink-3">{running ? `${elapsed.toFixed(1)} s` : `${done?.seconds.toFixed(1)} s · ${models * cases} scored replies`}</span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
          {running ? (
            <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-ink" initial={{ left: '-33%' }} animate={{ left: '100%' }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
          ) : (
            <motion.div className="h-full rounded-full bg-ok" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={base} />
          )}
        </div>
        {running ? <span className="text-[12px] text-ink-3">The API scores the whole suite in one request, so progress is shown as elapsed time rather than a percentage.</span> : null}
      </div>
    </motion.div>
  );
}

function Scorecard({ model: m, rows, floor, prev }: { model: ModelInfo; rows: TestResult[]; floor: number; prev?: number }) {
  const s = m.testScore ?? 0;
  const change = prev ? ((s - prev) / prev) * 100 : null;
  return (
    <motion.div variants={fadeUp} whileHover={{ y: -2 }} transition={spring} className={`card flex flex-col gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-lift)] ${m.excluded ? 'ring-1 ring-bad/30' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Orb model={m} size={28} />
          <span className="truncate text-[15px] font-medium">{m.name}</span>
        </div>
        {m.excluded ? <Status kind="excluded" /> : <Status kind="ok" label="Above floor" />}
      </div>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber value={s} format={(n) => n.toFixed(2)} className="h-display text-[38px] leading-none" />
        {change !== null ? (
          <span className={`inline-flex items-center gap-0.5 text-[12.5px] font-medium ${change < -0.05 ? 'text-warn' : 'text-ink-2'}`}>
            {change >= 0 ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />}
            {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(1)}% vs previous run
          </span>
        ) : null}
      </div>
      <div className="relative h-2 rounded-full bg-line">
        <motion.div className="h-full rounded-full" style={{ background: modelColor(m) }} initial={{ width: 0 }} animate={{ width: `${s * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `${floor * 100}%` }} title={`Exclusion floor ${floor}`} aria-hidden="true" />
      </div>
      <dl className="grid grid-cols-4 gap-2 text-[12px]">
        <Stat label="Completed" value={`${Math.round(avg(rows.map((r) => (r.completed ? 1 : 0))) * 100)}%`} />
        <Stat label="Accuracy" value={`${avg(rows.map((r) => r.accuracy)).toFixed(1)}/5`} />
        <Stat label="Tone" value={`${avg(rows.map((r) => r.tone)).toFixed(1)}/5`} />
        <Stat label="Latency" value={ms(avg(rows.map((r) => r.latencyMs)))} />
      </dl>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-mono text-[12.5px] text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Comparison({ models, perModel, floor }: { models: ModelInfo[]; perModel: Map<string, TestResult[]>; floor: number }) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<Metric>('score');
  const value = (m: ModelInfo) => {
    const rows = perModel.get(m.id) ?? [];
    if (metric === 'score') return m.testScore ?? 0;
    if (metric === 'accuracy') return avg(rows.map((r) => r.accuracy));
    if (metric === 'tone') return avg(rows.map((r) => r.tone));
    if (metric === 'latency') return avg(rows.map((r) => r.latencyMs));
    return avg(rows.map((r) => (r.completed ? 1 : 0))) * 100;
  };
  const fmt = (n: number) => (metric === 'latency' ? ms(n) : metric === 'completion' ? `${n.toFixed(0)}%` : metric === 'score' ? n.toFixed(2) : `${n.toFixed(2)}/5`);
  const data = models.map((m) => ({ name: m.name, value: value(m), color: modelColor(m) }));
  return (
    <Card
      title="Model comparison"
      right={<Segmented size="sm" label="Metric" value={metric} onChange={setMetric} options={[{ value: 'score', label: 'Score' }, { value: 'completion', label: 'Completion' }, { value: 'accuracy', label: 'Accuracy' }, { value: 'tone', label: 'Tone' }, { value: 'latency', label: 'Latency' }]} />}>
      <div className="h-[260px]" role="img" aria-label={data.map((d) => `${d.name}: ${fmt(d.value)}`).join('; ')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: metric === 'score' ? 96 : 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={LINE} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} interval={0} />
            <YAxis tickFormatter={(v: number) => (metric === 'latency' ? `${Math.round(v)}` : metric === 'completion' ? `${v}%` : String(v))} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} width={44} domain={metric === 'score' ? [0, 1] : metric === 'completion' ? [0, 100] : metric === 'latency' ? [0, 'auto'] : [0, 5]} />
            <Tooltip cursor={{ fill: 'rgb(0 0 0 / 0.03)' }} content={<ChartTooltip format={fmt} />} />
            {metric === 'score' ? <ReferenceLine y={floor} stroke="#c0262d" strokeDasharray="4 4" label={{ value: `exclusion floor ${floor}`, position: 'right', fontSize: 11, fill: '#c0262d' }} /> : null}
            <Bar dataKey="value" name={metric[0].toUpperCase() + metric.slice(1)} radius={[6, 6, 0, 0]} isAnimationActive={!reduce} animationDuration={600}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Heatmap({ models, results }: { models: ModelInfo[]; results: TestResult[] }) {
  const [by, setBy] = useState<'useCase' | 'language' | 'turnType'>('useCase');
  const cols =
    by === 'useCase' ? USE_CASES.map((u) => ({ key: u.value, label: u.label }))
    : by === 'language' ? LANGS.map((l) => ({ key: l.value, label: l.label }))
    : [{ key: 'simple', label: 'Simple' }, { key: 'complex', label: 'Complex' }];
  const cell = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of results) {
      const k = `${r.modelId}|${r[by]}`;
      map.set(k, [...(map.get(k) ?? []), r.score]);
    }
    return map;
  }, [results, by]);
  return (
    <Card title="Quality heatmap" subtitle="Average case score. Darker is better; hover or focus a cell for details." right={<Segmented size="sm" label="Group by" value={by} onChange={setBy} options={[{ value: 'useCase', label: 'Call type' }, { value: 'language', label: 'Language' }, { value: 'turnType', label: 'Turn type' }]} />}>
      <div className="scroll-x">
        <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-1 text-[12px]">
          <thead>
            <tr>
              <th scope="col" className="w-[132px]"><span className="sr-only">Model</span></th>
              {cols.map((c) => <th key={c.key} scope="col" className="pb-1 text-center font-medium text-ink-2">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap">{m.name}</th>
                {cols.map((c) => {
                  const xs = cell.get(`${m.id}|${c.key}`) ?? [];
                  const v = avg(xs);
                  const a = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0.06, (v - 0.5) / 0.5));
                  return (
                    <td key={c.key} className="p-0">
                      <Tip content={<>{m.name} · {c.label}<br />Average score {Number.isNaN(v) ? '—' : v.toFixed(3)} over {xs.length} cases</>} className="w-full">
                        <motion.button
                          type="button"
                          className="h-9 w-full rounded-lg font-mono font-medium"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, backgroundColor: `rgba(13,107,102,${a})`, color: a > 0.55 ? '#fff' : '#0c0b0a' }}
                          transition={base}
                          aria-label={`${m.name}, ${c.label}: ${Number.isNaN(v) ? 'no data' : v.toFixed(2)}`}>
                          {Number.isNaN(v) ? '—' : v.toFixed(2)}
                        </motion.button>
                      </Tip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Card title="Quality alerts" subtitle="Raised when a score drops more than 10% since the previous run, or a model is excluded or restored.">
      <ul className="flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {alerts.slice(0, 8).map((a) => {
            const restored = a.message.includes('restored');
            return (
              <motion.li key={a.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={base} className={`flex items-start gap-3 rounded-2xl p-3 ring-1 ${restored ? 'ring-ok/25' : 'bg-bad/[0.03] ring-bad/20'}`}>
                <TriangleExclamationPoint size={16} className={`mt-0.5 shrink-0 ${restored ? 'text-ok' : 'text-bad'}`} aria-hidden="true" />
                <div className="text-[13.5px]">
                  <div className="text-ink">{a.message}</div>
                  <div className="text-[12px] text-ink-3">{timeAgo(a.ts)}</div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {alerts.length === 0 ? <li className="text-[13.5px] text-ink-3">No alerts. Scores are stable across runs.</li> : null}
      </ul>
    </Card>
  );
}

function Conversations({ models, perModel, cases }: { models: ModelInfo[]; perModel: Map<string, TestResult[]>; cases: TestCase[] }) {
  const [model, setModel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const active = model ?? models[0]?.id;
  const rows = (perModel.get(active ?? '') ?? []).slice().sort((a, b) => a.score - b.score);
  return (
    <Card title="Scored conversations" subtitle="Lowest scores first. Expand a row to see the message, expected outcome and scores.">
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Model">
        {models.map((m) => <Chip key={m.id} active={m.id === active} onClick={() => { setModel(m.id); setOpen(null); }}><Orb model={m} size={14} />{m.name}</Chip>)}
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => {
          const c = cases.find((x) => x.id === r.caseId);
          const isOpen = open === r.caseId;
          return (
            <li key={r.caseId}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.caseId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-left">
                <motion.span animate={{ rotate: isOpen ? 0 : -90 }} transition={base} className="text-ink-3"><ChevronDown size={15} aria-hidden="true" /></motion.span>
                <span className="min-w-[140px] flex-1 text-[13.5px] font-medium">{USE_CASES.find((u) => u.value === r.useCase)?.label} · {r.language.toUpperCase()}</span>
                <TurnBadge turnType={r.turnType} />
                <Status kind={r.completed ? 'ok' : 'fail'} label={r.completed ? 'Completed' : 'Not completed'} />
                <span className="w-12 text-right font-mono text-[13px] tabular-nums">{r.score.toFixed(2)}</span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={base} className="overflow-hidden">
                    <div className="mb-3 ml-7 grid gap-3 rounded-2xl bg-canvas p-4 text-[13px] ring-1 ring-line sm:grid-cols-2">
                      <div><div className="label mb-1">Customer</div><p className="text-ink">{c?.message}</p></div>
                      <div><div className="label mb-1">Expected outcome</div><p className="text-ink">{c?.expected}</p></div>
                      <div className="sm:col-span-2"><div className="label mb-1">Reply</div><p className="text-ink-2">{r.reply === '(simulated reply)' ? 'Demo mode: the simulated judge scores from the model’s quality setting, without generating a reply.' : r.reply}</p></div>
                      <div className="flex flex-wrap gap-4 font-mono text-[12px] text-ink-2 sm:col-span-2">
                        <span>accuracy {r.accuracy.toFixed(1)}/5</span><span>tone {r.tone.toFixed(1)}/5</span><span>{ms(r.latencyMs)}</span><span>score {r.score.toFixed(3)}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function History({ runs, models }: { runs: TestRun[]; models: ModelInfo[] }) {
  return (
    <Card title="Run history">
      <div className="scroll-x">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-2">
              <th scope="col" className="py-2 font-medium">Run</th>
              <th scope="col" className="py-2 font-medium">When</th>
              <th scope="col" className="py-2 font-medium">Judge</th>
              <th scope="col" className="py-2 text-right font-medium">Mean score</th>
              <th scope="col" className="py-2 pl-4 font-medium">Best model</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const best = Object.entries(r.scores).sort((a, b) => b[1] - a[1])[0];
              return (
                <tr key={r.id} className="border-b border-line/70">
                  <td className="py-2 font-medium">#{r.id}</td>
                  <td className="py-2 text-ink-2">{timeAgo(r.ts)}</td>
                  <td className="py-2">{r.mode === 'demo' ? <SimulatedTag>Simulated</SimulatedTag> : <SimulatedTag>Live</SimulatedTag>}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{avg(Object.values(r.scores)).toFixed(3)}</td>
                  <td className="py-2 pl-4">{best ? `${modelName(models, best[0])} (${score(best[1])})` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
