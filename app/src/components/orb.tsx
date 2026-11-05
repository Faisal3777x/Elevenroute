import { useId } from 'react';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { C, VENDOR_COLORS } from '@/constants/theme';

import type { ModelInfo } from '../../../shared/types';

/** Gradient "orb" badge for a model. The violet / ember accents live only here. */
export function Orb({ model, size = 32 }: { model: Pick<ModelInfo, 'vendor' | 'tier'> | undefined; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const base = model ? VENDOR_COLORS[model.vendor][model.tier] : C.ink3;
  const accent = model?.vendor === 'anthropic' || model?.tier === 'fast' ? C.ember : C.violet;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={`g${id}`} cx="35%" cy="30%" r="75%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
          <Stop offset="0.35" stopColor={base} stopOpacity={0.9} />
          <Stop offset="0.8" stopColor={base} />
          <Stop offset="1" stopColor={accent} />
        </RadialGradient>
        <RadialGradient id={`h${id}`} cx="72%" cy="78%" r="40%">
          <Stop offset="0" stopColor={accent} stopOpacity={0.55} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={48} fill={`url(#g${id})`} />
      <Circle cx={50} cy={50} r={48} fill={`url(#h${id})`} />
    </Svg>
  );
}
