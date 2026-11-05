import { View } from 'react-native';

import { F, S, VENDOR_NAMES } from '@/constants/theme';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import type { VendorState, VendorStatus } from '../../../shared/types';
import { Orb } from './orb';
import { Body, Muted, Row, Segmented, Status } from './ui';

const OPTIONS: { value: VendorState; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'down', label: 'Down' },
  { value: 'slow', label: 'Slow' },
];

/** Simulate outage: Healthy / Down / Slow per vendor. Works in demo and live mode. */
export function VendorSwitches({ compact = false }: { compact?: boolean }) {
  const { data, setData } = useApi<VendorStatus[]>('/vendors', 5000);
  if (!data) return null;
  const set = async (vendor: string, state: VendorState) => {
    setData(data.map((v) => (v.vendor === vendor ? { ...v, state } : v)));
    setData(await api.put<VendorStatus[]>(`/vendors/${vendor}/state`, { state }));
  };
  return (
    <View style={{ gap: compact ? S.sm : S.md }}>
      {data.map((v) => (
        <Row key={v.vendor} wrap style={{ justifyContent: 'space-between' }} gap={S.sm}>
          <Row gap={S.sm} style={{ minWidth: 150 }}>
            <Orb model={{ vendor: v.vendor, tier: 'flagship' }} size={compact ? 20 : 26} />
            <Body style={{ fontFamily: F.medium }}>{VENDOR_NAMES[v.vendor]}</Body>
            {!compact && <Status kind={v.state} />}
            {v.breakerOpen && <Status kind="slow" label="Breaker open" />}
          </Row>
          <Segmented small options={OPTIONS} value={v.state} onChange={(s) => set(v.vendor, s)} />
        </Row>
      ))}
      {!compact && <Muted>Down returns errors (about 150 ms to fail over). Slow exceeds the latency budget, so failover happens at the budget.</Muted>}
    </View>
  );
}
