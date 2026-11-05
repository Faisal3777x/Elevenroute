import { Platform } from 'react-native';

import type { ModelInfo, Vendor } from '../../../shared/types';

/** Surfaces and ink from DESIGN.md. Accents (violet, ember) appear only inside model orbs. */
export const C = {
  canvas: '#fdfcfc',
  card: '#f5f3f1',
  line: '#ebe8e4',
  ink: '#000000',
  ink2: '#4a4541',
  ink3: '#857e77',
  white: '#ffffff',
  violet: '#0447ff',
  ember: '#ff4704',
  ok: '#16794a',
  warn: '#a15c07',
  bad: '#c0262d',
} as const;

/** Chart colours follow the vendor; the darker shade is the flagship model. */
export const VENDOR_COLORS: Record<Vendor, { flagship: string; fast: string }> = {
  openai: { flagship: '#0d6b66', fast: '#45b5ab' },
  google: { flagship: '#5235c4', fast: '#a596f0' },
  anthropic: { flagship: '#b8420e', fast: '#f2a06e' },
};

export const VENDOR_NAMES: Record<Vendor, string> = { openai: 'OpenAI', google: 'Google', anthropic: 'Anthropic' };

export function modelColor(m: Pick<ModelInfo, 'vendor' | 'tier'> | undefined): string {
  return m ? VENDOR_COLORS[m.vendor][m.tier] : C.ink3;
}

export const F = {
  light: 'Inter_300Light',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = 20;
export const MAX_WIDTH = 1120;
/** Width at which the web build switches to the sidebar dashboard layout. */
export const WIDE = 900;
