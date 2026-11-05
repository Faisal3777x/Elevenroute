import type { ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, F, MAX_WIDTH, RADIUS, S, WIDE } from '@/constants/theme';
import { API_BASE } from '@/lib/api';

import type { VendorState } from '../../../shared/types';
import { Icon, type IconName } from './icon';

export function useWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WIDE;
}

// ---------- layout ----------
export function Screen({ title, subtitle, actions, children, onRefresh, refreshing = false }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.canvas }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      contentContainerStyle={{
        paddingTop: Platform.OS === 'web' ? (wide ? S.xxl : S.xl) : insets.top + S.lg,
        paddingBottom: Platform.OS === 'ios' ? S.xxl : 120,
        paddingHorizontal: wide ? S.xxl : S.lg,
      }}>
      <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: S.lg }}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 200, gap: S.xs }}>
            <Text style={styles.h1} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

export function Grid({ children, min = 320 }: { children: ReactNode; min?: number }) {
  const wide = useWide();
  return <View style={[styles.grid, wide && { flexDirection: 'row', flexWrap: 'wrap' }]}>{wrap(children, wide, min)}</View>;
}
function wrap(children: ReactNode, wide: boolean, min: number) {
  if (!wide) return children;
  return (Array.isArray(children) ? children : [children]).filter(Boolean).map((c, i) => (
    <View key={i} style={{ flexGrow: 1, flexBasis: min, minWidth: min }}>{c}</View>
  ));
}

export function Row({ children, gap = S.sm, style, wrap: w = false }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, w && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Card({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {title || right ? (
        <Row style={{ justifyContent: 'space-between', marginBottom: S.md }} wrap>
          {title ? <Text style={styles.h2}>{title}</Text> : <View />}
          {right}
        </Row>
      ) : null}
      {children}
    </View>
  );
}

export const Divider = () => <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: C.line, marginVertical: S.sm }} />;

// ---------- text ----------
type TProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean };
export const H2 = (p: TProps) => <Text {...p} style={[styles.h2, p.style]} />;
export const Body = (p: TProps) => <Text {...p} style={[styles.body, p.style]} />;
export const Muted = (p: TProps) => <Text {...p} style={[styles.muted, p.style]} />;
export const Label = (p: TProps) => <Text {...p} style={[styles.label, p.style]} />;
export const Mono = (p: TProps) => <Text {...p} style={[styles.mono, p.style]} />;

// ---------- controls ----------
export function Pill({ label, onPress, variant = 'primary', disabled, loading, icon, small, accessibilityLabel }: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  const primary = variant === 'primary';
  const color = primary ? C.white : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.pill,
        small && styles.pillSmall,
        primary && { backgroundColor: C.ink, borderColor: C.ink },
        variant === 'ghost' && { borderColor: 'transparent', backgroundColor: 'transparent' },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
      ]}>
      {loading ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={color} /> : null}
      <Text style={[styles.pillText, small && { fontSize: 13 }, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, small }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, small && { paddingVertical: 5, paddingHorizontal: 10 }, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, small && { fontSize: 12 }, active && { color: C.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.chip, active && { backgroundColor: C.ink, borderColor: C.ink }, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.chipText, active && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: S.xs, flexGrow: 1 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput placeholderTextColor={C.ink3} {...props} style={[styles.input, style]} />
    </View>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
      <View style={[styles.track, value && { backgroundColor: C.ink }]}>
        <View style={[styles.thumb, value && { transform: [{ translateX: 16 }] }]} />
      </View>
      <Body style={{ flexShrink: 1 }}>{label}</Body>
    </Pressable>
  );
}

// ---------- status ----------
const STATUS: Record<VendorState | 'excluded' | 'ok' | 'fail', { color: string; icon: IconName; label: string }> = {
  healthy: { color: C.ok, icon: 'check', label: 'Healthy' },
  ok: { color: C.ok, icon: 'check', label: 'OK' },
  down: { color: C.bad, icon: 'x', label: 'Down' },
  fail: { color: C.bad, icon: 'x', label: 'Failed' },
  slow: { color: C.warn, icon: 'clock', label: 'Slow' },
  excluded: { color: C.bad, icon: 'alert', label: 'Excluded' },
};

/** Status is always colour + icon + label, never colour alone. */
export function Status({ kind, label }: { kind: keyof typeof STATUS; label?: string }) {
  const s = STATUS[kind];
  return (
    <View style={[styles.status, { borderColor: s.color + '55' }]}>
      <Icon name={s.icon} size={12} color={s.color} strokeWidth={2.5} />
      <Text style={[styles.statusText, { color: s.color }]}>{label ?? s.label}</Text>
    </View>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.stat}>
      <Label>{label}</Label>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function ApiErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: C.bad + '44', borderWidth: 1 }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Icon name="alert" color={C.bad} />
        <View style={{ flex: 1, gap: S.xs }}>
          <Body style={{ fontFamily: F.medium }}>{error}</Body>
          <Muted>
            Start the API with `npm run api` in the project folder. The app looks for it at {API_BASE}; set EXPO_PUBLIC_API_URL to use another address.
          </Muted>
        </View>
      </Row>
      {onRetry ? <View style={{ marginTop: S.md, alignSelf: 'flex-start' }}><Pill label="Retry" icon="refresh" variant="secondary" small onPress={onRetry} /></View> : null}
    </Card>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: S.xxl, gap: S.sm }}>
      <H2 style={{ textAlign: 'center' }}>{title}</H2>
      <Muted style={{ textAlign: 'center', maxWidth: 420 }}>{body}</Muted>
      {action ? <View style={{ marginTop: S.sm }}>{action}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: S.md, marginBottom: S.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  h1: { fontFamily: F.light, fontSize: 36, letterSpacing: -0.72, color: C.ink, lineHeight: 42 },
  h2: { fontFamily: F.light, fontSize: 21, letterSpacing: -0.42, color: C.ink, lineHeight: 27 },
  subtitle: { fontFamily: F.regular, fontSize: 15, color: C.ink2, lineHeight: 21 },
  body: { fontFamily: F.regular, fontSize: 15, color: C.ink, lineHeight: 21 },
  muted: { fontFamily: F.regular, fontSize: 13, color: C.ink3, lineHeight: 18 },
  label: { fontFamily: F.medium, fontSize: 12, color: C.ink2, letterSpacing: 0.2 },
  mono: { fontFamily: F.mono, fontSize: 12, color: C.ink2, lineHeight: 17 },
  grid: { gap: S.lg },
  card: { backgroundColor: C.card, borderRadius: RADIUS, padding: S.lg, borderWidth: 1, borderColor: 'transparent' },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, paddingVertical: 11, paddingHorizontal: 18,
    borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.canvas, minHeight: 44,
  },
  pillSmall: { paddingVertical: 7, paddingHorizontal: 14, minHeight: 34 },
  pillText: { fontFamily: F.medium, fontSize: 15 },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.line, borderRadius: 999, padding: 3, alignSelf: 'flex-start' },
  segment: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 },
  segmentActive: { backgroundColor: C.canvas, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontFamily: F.medium, fontSize: 13, color: C.ink2 },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.canvas },
  chipText: { fontFamily: F.medium, fontSize: 13, color: C.ink },
  input: {
    fontFamily: F.regular, fontSize: 15, color: C.ink, backgroundColor: C.canvas, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44,
  },
  track: { width: 40, height: 24, borderRadius: 12, backgroundColor: C.line, padding: 3 },
  thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, alignSelf: 'flex-start', backgroundColor: C.canvas },
  statusText: { fontFamily: F.medium, fontSize: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.md },
  stat: { flexGrow: 1, flexBasis: 150, backgroundColor: C.card, borderRadius: RADIUS, padding: S.lg, gap: S.xs },
  statValue: { fontFamily: F.light, fontSize: 28, letterSpacing: -0.56, color: C.ink },
});
