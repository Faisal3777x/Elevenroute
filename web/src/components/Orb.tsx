import { useId } from 'react';

import type { ModelInfo } from '../../../shared/types';
import { EMBER, INK3, VENDOR_COLORS, VIOLET } from '../lib/theme';

/** Abstract gradient "orb" identifying a model by vendor and tier. */
export function Orb({ model, size = 28, className }: { model: Pick<ModelInfo, 'vendor' | 'tier'> | undefined; size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const base = model ? VENDOR_COLORS[model.vendor][model.tier] : INK3;
  const accent = model?.vendor === 'anthropic' || model?.tier === 'fast' ? EMBER : VIOLET;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`g${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity={0.95} />
          <stop offset="0.35" stopColor={base} stopOpacity={0.9} />
          <stop offset="0.8" stopColor={base} />
          <stop offset="1" stopColor={accent} />
        </radialGradient>
        <radialGradient id={`h${id}`} cx="72%" cy="78%" r="40%">
          <stop offset="0" stopColor={accent} stopOpacity={0.55} />
          <stop offset="1" stopColor={accent} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#g${id})`} />
      <circle cx="50" cy="50" r="48" fill={`url(#h${id})`} />
    </svg>
  );
}
