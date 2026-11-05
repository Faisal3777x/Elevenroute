import { NativeTabs } from 'expo-router/native-tabs';

import { C } from '@/constants/theme';

/** iOS / Android: system tab bar. Routing rules and What-if stay on the web dashboard. */
export default function AppTabs() {
  return (
    <NativeTabs backgroundColor={C.canvas} indicatorColor={C.line} labelStyle={{ selected: { color: C.ink } }} tintColor={C.ink}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="bar_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="playground">
        <NativeTabs.Trigger.Label>Playground</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="providers">
        <NativeTabs.Trigger.Label>Providers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'server.rack', selected: 'server.rack' }} md="dns" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tests">
        <NativeTabs.Trigger.Label>Tests</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'checkmark.seal', selected: 'checkmark.seal.fill' }} md="verified" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rules" hidden />
      <NativeTabs.Trigger name="whatif" hidden />
    </NativeTabs>
  );
}
