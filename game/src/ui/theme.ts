import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export const C = {
  bg: '#120d1f',
  panel: '#1e1630',
  panel2: '#2a2040',
  line: '#3a2d55',
  floorA: '#2b2142',
  floorB: '#251c3a',
  text: '#f3ecff',
  muted: '#a99bc4',
  zombie: '#8fe36b',
  coin: '#ffd25e',
  danger: '#ff6b6b',
  purple: '#9b7bff',
  wood: '#6b4630',
  woodDark: '#4a2f20',
};

export const native = Platform.OS !== 'web';

export function buzz(kind: 'tap' | 'ok' | 'no' | 'win' = 'tap') {
  if (!native) return;
  try {
    if (kind === 'tap') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (kind === 'ok') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (kind === 'no') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (kind === 'win') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are a nicety; never let them break a tap.
  }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const num = (n: number) => Math.floor(n).toLocaleString('en-US');
