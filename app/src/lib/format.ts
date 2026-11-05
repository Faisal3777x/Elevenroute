import type { Language, ModelInfo, UseCase } from '../../../shared/types';

export function money(n: number): string {
  if (n === 0) return '$0';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(5)}`;
  if (Math.abs(n) < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export const ms = (n: number) => (n < 10 ? `${n.toFixed(2)} ms` : `${Math.round(n).toLocaleString('en-US')} ms`);
export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;
export const score = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2));
export const count = (n: number) => n.toLocaleString('en-US');

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const LANGS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
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
