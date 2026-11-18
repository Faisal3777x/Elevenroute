import type { Language, ModelInfo, UseCase } from '../../../shared/types';

/**
 * Dollar amounts. Under $1 a figure keeps three significant digits (at least two decimals), so a $0.015 price never
 * shows as "$0.01" (a third off) and no amount is rounded by more than 0.5%: $0.015, $0.851, $0.00344.
 */
export function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a < 0.01) return `${sign}$${a.toFixed(5)}`;
  if (a < 1) return `${sign}$${a.toPrecision(3).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
  if (a < 100) return `${sign}$${a.toFixed(2)}`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

/** A signed whole number with a true minus sign (−5, not -5). */
export const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));

export const ms = (n: number) => (n < 10 ? `${n.toFixed(2)} ms` : `${Math.round(n).toLocaleString('en-US')} ms`);
export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;
export const score = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2));
export const count = (n: number) => Math.round(n).toLocaleString('en-US');
/** "1 turn", "1,709 turns": a counted noun, never "1 turns". */
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${Math.round(n) === 1 ? one : many}`;

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const LANGS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
];

export const USE_CASES: { value: UseCase; label: string }[] = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'refund', label: 'Refund' },
  { value: 'order_status', label: 'Order status' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'faq', label: 'FAQ' },
];

export function modelName(models: ModelInfo[] | undefined, id: string | null | undefined): string {
  if (!id) return 'Human handoff';
  return models?.find((m) => m.id === id)?.name ?? id;
}

/** Last 7 days vs the 7 before, when both windows have data. */
export function weekTrend(values: number[], mode: 'sum' | 'avg' = 'sum'): number | null {
  if (values.length < 14) return null;
  const agg = (xs: number[]) => {
    const nz = xs.filter((v) => v > 0);
    if (mode === 'avg') return nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0;
    return xs.reduce((a, b) => a + b, 0);
  };
  const prev = agg(values.slice(-14, -7));
  const last = agg(values.slice(-7));
  if (prev <= 0 || last <= 0) return null;
  return ((last - prev) / prev) * 100;
}
