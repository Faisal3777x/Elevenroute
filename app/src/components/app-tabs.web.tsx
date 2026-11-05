import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F, S } from '@/constants/theme';

import { Orb } from './orb';
import { useWide } from './ui';

const PAGES = [
  { name: 'index', href: '/', label: 'Overview' },
  { name: 'playground', href: '/playground', label: 'Playground' },
  { name: 'rules', href: '/rules', label: 'Routing rules' },
  { name: 'providers', href: '/providers', label: 'Providers' },
  { name: 'tests', href: '/tests', label: 'Test results' },
  { name: 'whatif', href: '/whatif', label: 'What-if' },
] as const;

/** Web: the full six-page dashboard. Sidebar when wide, floating pill bar when narrow. */
export default function AppTabs() {
  const wide = useWide();
  const links = PAGES.map((p) => (
    <TabTrigger key={p.name} name={p.name} asChild>
      <NavButton wide={wide}>{p.label}</NavButton>
    </TabTrigger>
  ));

  return (
    <Tabs style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: C.canvas }}>
      {/* Registers the routes. Visible navigation is rendered below. */}
      <TabList style={{ display: 'none' }}>
        {PAGES.map((p) => <TabTrigger key={p.name} name={p.name} href={p.href} />)}
      </TabList>

      {wide ? (
        <>
          <View style={styles.sidebar}>
            <Brand />
            <View style={{ gap: 2, marginTop: S.xl }}>{links}</View>
            <Text style={styles.foot}>Model-agnostic routing for voice and chat agents</Text>
          </View>
          <TabSlot style={{ flex: 1 }} />
        </>
      ) : (
        <>
          <TabSlot style={{ flex: 1 }} />
          <View style={styles.pillWrap} pointerEvents="box-none">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillBar} style={{ flexGrow: 0, maxWidth: '100%' }}>
              {links}
            </ScrollView>
          </View>
        </>
      )}
    </Tabs>
  );
}

function Brand() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
      <Orb model={{ vendor: 'google', tier: 'flagship' }} size={26} />
      <Text style={styles.brand}>ElevenRoute</Text>
    </View>
  );
}

function NavButton({ children, isFocused, wide, onPress, onLongPress }: TabTriggerSlotProps & { wide: boolean; children?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="link"
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [
        wide ? styles.navWide : styles.navPill,
        isFocused && (wide ? { backgroundColor: C.card } : { backgroundColor: C.ink }),
        pressed && { opacity: 0.7 },
      ]}>
      <Text style={[styles.navText, isFocused && { color: wide ? C.ink : C.white }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 240, paddingVertical: S.xxl, paddingHorizontal: S.lg, borderRightWidth: 1, borderColor: C.line, backgroundColor: C.canvas },
  brand: { fontFamily: F.light, fontSize: 22, letterSpacing: -0.44, color: C.ink },
  foot: { marginTop: 'auto', fontFamily: F.regular, fontSize: 12, color: C.ink3, lineHeight: 17 },
  navWide: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999 },
  navPill: { paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999 },
  navText: { fontFamily: F.medium, fontSize: 14, color: C.ink2 },
  pillWrap: { position: 'absolute', left: 0, right: 0, bottom: S.lg, alignItems: 'center', paddingHorizontal: S.lg },
  pillBar: {
    flexDirection: 'row', gap: 2, padding: 5, borderRadius: 999, backgroundColor: C.canvas, borderWidth: 1, borderColor: C.line,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
});
