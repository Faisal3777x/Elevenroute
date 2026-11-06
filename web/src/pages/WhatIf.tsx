import { ArrowRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ModelInfo, TurnType, WhatIfResult } from '../../../shared/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ChartTooltip } from '../components/ChartTooltip';
import { Orb } from '../components/Orb';
import { InfoTip } from '../components/Tooltip';
import { Card, Chip, Empty, ErrorNote, Page, PageHeader, Segmented, SimulatedTag, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { count, money, ms, pct } from '../lib/format';
import { base, fadeUp, spring } from '../lib/motion';
import { INK3, LINE, modelColor, sortModels } from '../lib/theme';
import { useApi } from '../lib/useApi';

const VOLUMES = [
  { value: 0, label: 'Logged rate' },
  { value: 100_000, label: '100k' },
  { value: 1_000_000, label: '1M' },
  { value: 10_000_000, label: '10M' },
];

export default function WhatIf() {
  const models = useApi<ModelInfo[]>('/providers');
  const [from, setFrom] = useState('claude-sonnet-5-5');
  const [to, setTo] = useState('gemini-2.5-flash');
  const [share, setShare] = useState(50);
  const [turnType, setTurnType] = useState<TurnType | 'all'>('simple');
  const [volume, setVolume] = useState(0);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      api
        .post<WhatIfResult>('/whatif/simulate', { fromModel: from, toModel: to, share: share / 100, turnType, volume: volume || null }, c.signal)
        .then((r) => { setResult(r); setError(null); })
        .catch((err: Error) => err.name !== 'AbortError' && setError(err.message));
    }, 120);
    return () => { clearTimeout(t); c.abort(); };
  }, [from, to, share, turnType, volume]);

  const list = useMemo(() => sortModels(models.data ?? []), [models.data]);
  const name = (id: string) => list.find((m) => m.id === id)?.name ?? id;

  return (
    <Page>
      <PageHeader
        eyebrow={<SimulatedTag>Simulation · not realised savings</SimulatedTag>}
        title="What-if"
        subtitle="Shift a share of logged traffic from one model to another and see the projected cost, quality and latency trade-off before changing any rule."
      />
      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Picker label="Move traffic from" models={list} value={from} onChange={setFrom} />
          <Picker label="To" models={list} value={to} onChange={setTo} />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-2">
            <label htmlFor="share" className="label flex justify-between">
              <span>Share of eligible traffic to move</span>
              <span className="font-mono text-ink">{share}%</span>
            </label>
            <input
              id="share"
              type="range"
              min={0}
              max={100}
              step={5}
              value={share}
              onChange={(e) => setShare(Number(e.target.value))}
              aria-valuetext={`${share} percent`}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-line accent-ink [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-webkit-slider-thumb]:shadow"
              style={{ background: `linear-gradient(90deg, #0c0b0a ${share}%, #ebe8e4 ${share}%)` }}
            />
            <div className="flex justify-between text-[11px] text-ink-3"><span>0%</span><span>50%</span><span>100%</span></div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="label">Turns</span>
            <Segmented size="sm" label="Turn type" value={turnType} onChange={setTurnType} options={[{ value: 'simple', label: 'Simple' }, { value: 'complex', label: 'Complex' }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="label">Monthly conversations</span>
            <Segmented size="sm" label="Monthly conversations" value={volume} onChange={setVolume} options={VOLUMES} />
          </div>
        </div>
      </Card>

      {!result && !error ? <Skeleton className="h-64" /> : null}
      {result && result.loggedTurns === 0 ? <Empty title="No logged traffic" body="The simulator re-prices logged token counts. Generate traffic on the Overview page first." /> : null}

      {result && result.loggedTurns > 0 ? (
        <>
          <Headline r={result} from={name(from)} to={name(to)} share={share} turnType={turnType} />
          <Allocation r={result} models={list} />
          <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TradeOff
              title="Quality on moved traffic"
              info="Latest test scores for each language and turn type the moved traffic covers (or the configured estimate before the first test run)."
              from={result.qualityFrom.toFixed(2)}
              to={result.qualityTo.toFixed(2)}
              tone={result.qualityTo < result.qualityFrom - 0.005 ? 'worse' : result.qualityTo > result.qualityFrom + 0.005 ? 'better' : 'same'}
              note={`${result.qualityTo >= result.qualityFrom ? '+' : '−'}${Math.abs(result.qualityTo - result.qualityFrom).toFixed(2)} quality`}
            />
            <TradeOff
              title="Measured latency"
              info="Average latency of logged turns each model served without a failover. Shown only where it has been measured."
              from={result.latencyFrom === null ? 'not measured' : ms(result.latencyFrom)}
              to={result.latencyTo === null ? 'not measured' : ms(result.latencyTo)}
              tone={result.latencyFrom === null || result.latencyTo === null ? 'same' : result.latencyTo < result.latencyFrom ? 'better' : 'worse'}
              note={result.latencyFrom !== null && result.latencyTo !== null ? `${result.latencyTo <= result.latencyFrom ? '−' : '+'}${ms(Math.abs(result.latencyTo - result.latencyFrom))} per turn` : 'Needs logged turns for both models'}
            />
            <Metric title="Traffic moved" value={result.movedTurnsPct} format={(n) => pct(n, 1)} note="of all logged turns" />
            <Metric title="Blocked by customer policy" value={result.blockedPct} format={(n) => pct(n, 0)} note={`of matching turns can't move to ${name(to)}`} info="Turns whose customer policy (allowed vendors or data region) forbids the destination model. They stay where they are." />
          </motion.div>
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            Method: logged token counts re-priced at current catalogue prices and scaled to {count(result.monthlyConversations)} conversations a month. This is a projection, not a measured saving. In demo mode the logged traffic itself comes from simulated providers.
          </p>
        </>
      ) : null}
    </Page>
  );
}

function Picker({ label, models, value, onChange }: { label: string; models: ModelInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {models.map((m) => (
          <Chip key={m.id} active={m.id === value} onClick={() => onChange(m.id)}>
            <Orb model={m} size={14} /> {m.name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Headline({ r, from, to, share, turnType }: { r: WhatIfResult; from: string; to: string; share: number; turnType: TurnType | 'all' }) {
  const saving = r.delta < -1e-9;
  const increase = r.delta > 1e-9;
  const pctChange = r.currentMonthly ? (Math.abs(r.delta) / r.currentMonthly) * 100 : 0;
  const Icon = saving ? TrendingDown : increase ? TrendingUp : Minus;
  return (
    <motion.section variants={fadeUp} className={`card relative overflow-hidden p-6 sm:p-8 ${saving ? '' : ''}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-24 h-96 w-96 transition-[background] duration-500"
        style={{ background: `radial-gradient(closest-side, ${saving ? 'rgb(22 121 74 / 0.1)' : increase ? 'rgb(255 71 4 / 0.1)' : 'rgb(235 232 228 / 0.8)'}, transparent)` }}
      />
      <div className="relative grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-10">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold tracking-wide uppercase ${saving ? 'bg-ok/10 text-ok' : increase ? 'bg-ember/10 text-[#b8420e]' : 'bg-line text-ink-2'}`}>
              <Icon size={13} aria-hidden="true" /> {saving ? 'Simulated savings' : increase ? 'Simulated increase' : 'No change'}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <AnimatedNumber value={pctChange} format={(n) => pct(n, 1)} className="h-display text-[64px] leading-none" />
          </div>
          <div className="mt-1 text-[14px] text-ink-2">
            <AnimatedNumber value={Math.abs(r.delta)} format={money} className="font-medium text-ink" /> a month {saving ? 'less' : increase ? 'more' : ''}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Moving <strong className="font-medium text-ink">{share}%</strong> of {turnType === 'all' ? '' : `${turnType} `}turns from <strong className="font-medium text-ink">{from}</strong> to <strong className="font-medium text-ink">{to}</strong>
            {r.blockedPct > 0 ? `, except the ${pct(r.blockedPct)} customer policy keeps in place,` : ''} changes projected monthly model spend from
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AnimatedNumber value={r.currentMonthly} format={money} className="h-display text-[28px]" />
            <ArrowRight size={20} className="text-ink-3" aria-label="to" />
            <AnimatedNumber value={r.projectedMonthly} format={money} className={`h-display text-[28px] ${saving ? 'text-ok' : increase ? 'text-[#b8420e]' : ''}`} />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function Allocation({ r, models }: { r: WhatIfResult; models: ModelInfo[] }) {
  const reduce = useReducedMotion();
  const ids = models.map((m) => m.id).filter((id) => r.allocation.some((a) => a.modelId === id && (a.current > 0 || a.projected > 0)));
  const row = (label: string, key: 'current' | 'projected') => Object.fromEntries([['name', label], ...ids.map((id) => [id, r.allocation.find((a) => a.modelId === id)?.[key] ?? 0])]);
  const data = [row('Current', 'current'), row('Optimised', 'projected')];
  return (
    <Card
      title="Current vs optimised allocation"
      subtitle="Projected monthly cost by model, before and after the move."
      right={<InfoTip content="Both bars use logged token counts at current prices. 'Optimised' is the simulated allocation for the scenario above, not realised spend." />}>
      <div className="h-[170px]" role="img" aria-label={`Current monthly cost ${money(r.currentMonthly)}; optimised ${money(r.projectedMonthly)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={18}>
            <CartesianGrid horizontal={false} stroke={LINE} />
            <XAxis type="number" tickFormatter={(v: number) => money(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK3 }} />
            <YAxis type="category" dataKey="name" width={84} tickLine={false} axisLine={false} tick={{ fontSize: 12.5, fill: '#0c0b0a' }} />
            <Tooltip cursor={{ fill: 'rgb(0 0 0 / 0.03)' }} content={<ChartTooltip format={money} total />} />
            {ids.map((id, i) => {
              const m = models.find((x) => x.id === id);
              return <Bar key={id} dataKey={id} name={m?.name ?? id} stackId="a" fill={modelColor(m)} radius={i === ids.length - 1 ? [0, 6, 6, 0] : 0} isAnimationActive={!reduce} animationDuration={500} />;
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        <AnimatePresence initial={false}>
          {ids.map((id) => {
            const m = models.find((x) => x.id === id);
            const a = r.allocation.find((x) => x.modelId === id);
            const diff = (a?.projected ?? 0) - (a?.current ?? 0);
            return (
              <motion.span key={id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: modelColor(m) }} aria-hidden="true" />
                {m?.name}
                {Math.abs(diff) > 1e-9 ? <span className={`font-mono ${diff < 0 ? 'text-ok' : 'text-[#b8420e]'}`}>{diff < 0 ? '−' : '+'}{money(Math.abs(diff))}</span> : null}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>
    </Card>
  );
}

function TradeOff({ title, from, to, tone, note, info }: { title: string; from: string; to: string; tone: 'better' | 'worse' | 'same'; note: string; info?: string }) {
  return (
    <motion.div variants={fadeUp} className="card flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{title}</span>
        {info ? <InfoTip content={info} label={`About ${title}`} /> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <motion.span key={from} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={base} className="h-display text-[22px] text-ink-2">{from}</motion.span>
        <ArrowRight size={15} className="text-ink-3" aria-label="to" />
        <motion.span key={to} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={base} className="h-display text-[26px]">{to}</motion.span>
      </div>
      <span className={`text-[12.5px] font-medium ${tone === 'better' ? 'text-ok' : tone === 'worse' ? 'text-warn' : 'text-ink-3'}`}>{note}</span>
    </motion.div>
  );
}

function Metric({ title, value, format, note, info }: { title: string; value: number; format: (n: number) => string; note: string; info?: string }) {
  return (
    <motion.div variants={fadeUp} className="card flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{title}</span>
        {info ? <InfoTip content={info} label={`About ${title}`} /> : null}
      </div>
      <AnimatedNumber value={value} format={format} className="h-display text-[28px]" />
      <span className="text-[12.5px] text-ink-3">{note}</span>
    </motion.div>
  );
}
