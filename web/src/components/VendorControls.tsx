import { motion } from 'motion/react';

import type { VendorState, VendorStatus } from '../../../shared/types';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { VENDOR_SHORT } from '../lib/theme';
import { Orb } from './Orb';
import { Segmented, Status } from './ui';

const OPTIONS: { value: VendorState; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'down', label: 'Down' },
  { value: 'slow', label: 'Slow' },
];

/** Simulate outage controls. Works in demo and live mode; never a real incident. */
export function useVendors() {
  const v = useApi<VendorStatus[]>('/vendors', 5000);
  const set = async (vendor: string, state: VendorState) => {
    v.setData(v.data?.map((x) => (x.vendor === vendor ? { ...x, state } : x)));
    v.setData(await api.put<VendorStatus[]>(`/vendors/${vendor}/state`, { state }));
  };
  return { ...v, set };
}

export function VendorControls({ compact = false, onChange }: { compact?: boolean; onChange?: () => void }) {
  const { data, set } = useVendors();
  if (!data) return <div className="skeleton h-28" />;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((v) => (
        <motion.div layout key={v.vendor} className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-[140px] items-center gap-2">
            <Orb model={{ vendor: v.vendor, tier: 'flagship' }} size={compact ? 18 : 22} />
            <span className="text-[14px] font-medium">{VENDOR_SHORT[v.vendor]}</span>
            {!compact ? <Status kind={v.state} /> : null}
            {v.breakerOpen ? <Status kind="warn" label="Breaker open" /> : null}
          </div>
          <Segmented
            size="sm"
            label={`Simulated state for ${VENDOR_SHORT[v.vendor]}`}
            options={OPTIONS}
            value={v.state}
            onChange={async (s) => {
              await set(v.vendor, s);
              onChange?.();
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}
