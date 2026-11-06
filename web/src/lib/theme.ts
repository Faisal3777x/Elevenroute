import type { ModelInfo, Vendor } from '../../../shared/types';

/** Chart colours follow the vendor; the darker shade is the flagship model. */
export const VENDOR_COLORS: Record<Vendor, { flagship: string; fast: string }> = {
  openai: { flagship: '#0d6b66', fast: '#45b5ab' },
  google: { flagship: '#5235c4', fast: '#a596f0' },
  anthropic: { flagship: '#b8420e', fast: '#f2a06e' },
};

export const VENDOR_NAMES: Record<Vendor, string> = { openai: 'OpenAI', google: 'Google Gemini', anthropic: 'Anthropic' };
export const VENDOR_SHORT: Record<Vendor, string> = { openai: 'OpenAI', google: 'Google', anthropic: 'Anthropic' };
export const VENDOR_ORDER: Vendor[] = ['openai', 'google', 'anthropic'];

export const INK3 = '#6b645e';
export const LINE = '#ebe8e4';
export const VIOLET = '#0447ff';
export const EMBER = '#ff4704';
export const BAD = '#c0262d';
export const OK = '#16794a';

export function modelColor(m: Pick<ModelInfo, 'vendor' | 'tier'> | undefined): string {
  return m ? VENDOR_COLORS[m.vendor][m.tier] : INK3;
}

/** Models sorted by vendor, flagship first. */
export function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort(
    (a, b) => VENDOR_ORDER.indexOf(a.vendor) - VENDOR_ORDER.indexOf(b.vendor) || (a.tier === b.tier ? 0 : a.tier === 'flagship' ? -1 : 1),
  );
}
