import { Check, Filter, ListOrdered, ShieldCheck, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import type { ModelInfo, RouteTrace } from '../../../shared/types';
import { money, ms } from '../lib/format';
import { fadeUp, stagger } from '../lib/motion';
import { Orb } from './Orb';
import { TurnBadge } from './ui';

/** Polished route-trace timeline: classifier → checks → ranking → attempts. */
export function TraceTimeline({ trace, models }: { trace: RouteTrace; models: ModelInfo[] }) {
  const c = trace.classification;
  const model = (id: string) => models.find((m) => m.id === id);
  const ranked = [...trace.candidates].filter((x) => x.rank).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const filtered = trace.candidates.filter((x) => !x.eligible);

  return (
    <motion.ol variants={stagger} initial="hidden" animate="show" className="relative ml-2 border-l border-line pl-5">
      <Item icon={<Sparkles size={13} />} title={<>Classified <TurnBadge turnType={c.turnType} score={c.score} /></>}>
        {c.hits.length ? (
          <div className="flex flex-wrap gap-1.5">
            {c.hits.map((h, i) => (
              <span key={i} className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11.5px] text-ink-2 ring-1 ring-line">
                {h.weight > 0 ? '+' : ''}{h.weight} {h.label}
              </span>
            ))}
          </div>
        ) : 'No rules fired.'}
      </Item>
      <Item icon={<ShieldCheck size={13} />} title="Policy and quality checks">
        {trace.policy} · quality floor ≥ {trace.qualityFloor.toFixed(2)}{trace.sticky ? ' · sticky conversation' : ''}
      </Item>
      {filtered.length > 0 && (
        <Item icon={<Filter size={13} />} title={`${filtered.length} filtered out`}>
          {filtered.map((f) => `${f.name}: ${f.note}`).join(' · ')}
        </Item>
      )}
      <Item icon={<ListOrdered size={13} />} title="Ranked candidates">
        <div className="flex flex-col gap-1">
          {ranked.map((r) => (
            <div key={r.modelId} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-6 font-mono text-ink-3">#{r.rank}</span>
              <Orb model={model(r.modelId)} size={14} />
              <span className="font-medium text-ink">{r.name}</span>
              <span className="text-ink-3">q {r.quality.toFixed(2)} · {money(r.cost)}/1k{r.note ? ` · ${r.note}` : ''}</span>
            </div>
          ))}
        </div>
      </Item>
      {trace.attempts.map((a, i) => (
        <Item key={i} tone={a.ok ? 'ok' : 'bad'} icon={a.ok ? <Check size={13} /> : <X size={13} />} title={`${a.ok ? 'Answered' : 'Failed'}: ${model(a.modelId)?.name ?? a.modelId} · ${ms(a.latencyMs)}`}>
          {a.error ?? 'Response returned within the latency budget.'}
        </Item>
      ))}
      <motion.li variants={fadeUp} className="text-[12px] text-ink-3">Routing overhead {ms(trace.overheadMs)} (time spent choosing a model, excluding the model call)</motion.li>
    </motion.ol>
  );
}

function Item({ icon, title, children, tone }: { icon: ReactNode; title: ReactNode; children?: ReactNode; tone?: 'ok' | 'bad' }) {
  const dot = tone === 'bad' ? 'bg-bad text-white' : tone === 'ok' ? 'bg-ok text-white' : 'bg-canvas text-ink-2 ring-1 ring-line';
  return (
    <motion.li variants={fadeUp} className="relative mb-3.5">
      <span className={`absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full ${dot}`} aria-hidden="true">{icon}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">{title}</div>
      {children ? <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{children}</div> : null}
    </motion.li>
  );
}
