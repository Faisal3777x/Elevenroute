import type { Language, ModelInfo, UseCase } from '../../../shared/types';

export function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a < 0.01) return `${sign}$${a.toFixed(5)}`;
  if (a < 100) return `${sign}$${a.toFixed(2)}`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

export const ms = (n: number) => (n < 10 ? `${n.toFixed(2)} ms` : `${Math.round(n).toLocaleString('en-US')} ms`);
export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;
export const score = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2));
export const count = (n: number) => Math.round(n).toLocaleString('en-US');

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
  { value: 'es', label: 'Español' },
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
