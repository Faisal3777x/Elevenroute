import Svg, { Circle, Path } from 'react-native-svg';

import { C } from '@/constants/theme';

export type IconName = 'check' | 'x' | 'clock' | 'alert' | 'down' | 'up' | 'right' | 'refresh' | 'send' | 'plus' | 'bolt';

const PATHS: Record<IconName, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 7v5l3 2',
  alert: 'M12 7.5v6M12 16.5v.5',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  right: 'M9 6l6 6-6 6',
  refresh: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4',
  send: 'M5 12h13M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
};

export function Icon({ name, size = 16, color = C.ink, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const ring = name === 'clock' || name === 'alert';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {ring && <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} />}
      <Path d={PATHS[name]} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
