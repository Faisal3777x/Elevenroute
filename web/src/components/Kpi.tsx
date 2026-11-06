import { TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { fadeUp, spring } from '../lib/motion';
import { AnimatedNumber } from './AnimatedNumber';
import { InfoTip } from './Tooltip';

/**
 * KPI card with a counting number, an optional week-over-week trend and a tooltip.
 * `goodWhen` says which direction is an improvement, so the trend is coloured honestly.
 */
export function Kpi({ label, value, format, hint, info, trend, goodWhen = 'down', tag, emphasis }: {
  label: string;
  value: number;
  format: (n: number) => string;
  hint?: ReactNode;
  info?: ReactNode;
  trend?: number | null;
  goodWhen?: 'up' | 'down' | 'neutral';
  tag?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      transition={spring}
      className={`card flex min-w-0 flex-col gap-1.5 p-4 transition-shadow duration-300 hover:shadow-[var(--shadow-lift)] sm:p-5 ${emphasis ? 'bg-ink text-white' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium ${emphasis ? 'text-white/70' : 'text-ink-2'}`}>{label}</span>
        <span className="flex items-center gap-1">
          {tag}
          {info ? <InfoTip content={info} label={`About ${label}`} /> : null}
        </span>
      </div>
      <AnimatedNumber value={value} format={format} className={`h-display truncate text-[24px] leading-tight sm:text-[30px] ${emphasis ? 'text-white' : ''}`} />
      <div className="flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1">
        {trend !== null && trend !== undefined ? <Trend value={trend} goodWhen={goodWhen} dark={emphasis} /> : null}
        {hint ? <span className={`text-[12.5px] ${emphasis ? 'text-white/65' : 'text-ink-3'}`}>{hint}</span> : null}
      </div>
    </motion.div>
  );
}

function Trend({ value, goodWhen, dark }: { value: number; goodWhen: 'up' | 'down' | 'neutral'; dark?: boolean }) {
  const up = value >= 0;
  const good = goodWhen === 'neutral' ? null : (goodWhen === 'up') === up;
  const Icon = up ? TrendingUp : TrendingDown;
  const color = dark ? 'text-white/80' : good === null ? 'text-ink-2' : good ? 'text-ok' : 'text-warn';
  return (
    <span className={`inline-flex items-center gap-1 text-[12.5px] font-medium ${color}`} title="Last 7 days vs the previous 7 days">
      <Icon size={13} aria-hidden="true" />
      {up ? '+' : '−'}{Math.abs(value).toFixed(1)}%
      <span className="sr-only">vs previous 7 days</span>
      <span aria-hidden="true" className={`font-normal ${dark ? 'text-white/55' : 'text-ink-3'}`}>vs prior week</span>
    </span>
  );
}
