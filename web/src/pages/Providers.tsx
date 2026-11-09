import { KeyRound, Pencil, Plus, Trash } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useState } from 'react';

import type { ModelInfo, PreviewResponse, RoutingConfig, TestCase, Vendor, VendorState } from '../../../shared/types';
import { FlowArrow } from '../components/Flow';
import { Modal } from '../components/Modal';
import { Orb } from '../components/Orb';
import { Button, Card, ErrorNote, Field, Page, PageHeader, Segmented, SimulatedTag, Skeleton, Status, Toggle, TurnBadge } from '../components/ui';
import { useVendors } from '../components/VendorControls';
import { api } from '../lib/api';
import { money, ms, score } from '../lib/format';
import { base, fadeUp } from '../lib/motion';
import { modelColor, VENDOR_NAMES, VENDOR_ORDER } from '../lib/theme';
import { useApi } from '../lib/useApi';

const STATES: { value: VendorState; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'down', label: 'Down' },
  { value: 'slow', label: 'Slow' },
];

const collapse: Variants = { hidden: { opacity: 0, height: 0 }, show: { opacity: 1, height: 'auto' } };

const NUMERIC = [
  { key: 'costIn', label: 'Input $ / 1k tokens' },
  { key: 'costOut', label: 'Output $ / 1k tokens' },
  { key: 'latencyMs', label: 'Simulated latency (ms)' },
  { key: 'errorRate', label: 'Simulated error rate (0–1)' },
  { key: 'quality', label: 'Quality estimate (0–1)' },
] as const;

export default function Providers() {
  const models = useApi<ModelInfo[]>('/providers');
  const routing = useApi<RoutingConfig>('/routing');
  const vendors = useVendors();
  const [editing, setEditing] = useState<ModelInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (id: string, body: Partial<ModelInfo>) => {
    setError(null);
    try {
      const updated = await api.patch<ModelInfo>(`/providers/${id}`, body);
      models.setData(models.data?.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const affected = (vendors.data ?? []).filter((v) => v.state !== 'healthy');
  const floor = routing.data?.strategy.exclusionFloor ?? 0.7;

  return (
    <Page>
      <PageHeader
        title="Providers"
        subtitle="Availability, pricing, latency and quality for every model. Use the switches to simulate an outage and watch traffic move."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add model</Button>}
      />
      {models.error && !models.data ? <ErrorNote error={models.error} onRetry={models.reload} /> : null}
      {error ? <ErrorNote error={error} /> : null}

      <AnimatePresence>
        {affected.length > 0 && (
          // Named variants (not inline targets) so "show" reaches the Card inside, which animates by variant.
          <motion.div key="redirect" variants={collapse} initial="hidden" animate="show" exit="hidden" transition={base} className="overflow-hidden">
            <TrafficRedirect states={Object.fromEntries((vendors.data ?? []).map((v) => [v.vendor, v.state])) as Record<Vendor, VendorState>} models={models.data ?? []} budgetMs={routing.data?.strategy.latencyBudgetMs ?? 2000} />
          </motion.div>
        )}
      </AnimatePresence>

      {!models.data || !vendors.data ? <Skeleton className="h-96" /> : null}

      {models.data && vendors.data
        ? VENDOR_ORDER.map((vendor) => {
            const v = vendors.data!.find((x) => x.vendor === vendor);
            const list = models.data!.filter((m) => m.vendor === vendor).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'flagship' ? -1 : 1));
            if (!v) return null;
            return (
              <motion.section key={vendor} variants={fadeUp} className="card overflow-hidden">
                <div className={`flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 transition-colors duration-300 sm:px-6 ${v.state === 'down' ? 'border-bad/20 bg-bad/[0.035]' : v.state === 'slow' ? 'border-warn/20 bg-warn/[0.04]' : 'border-line'}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Orb model={{ vendor, tier: 'flagship' }} size={40} live={v.state} ping />
                    <div>
                      <h2 className="h-display text-[22px] leading-tight">{VENDOR_NAMES[vendor]}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Status kind={v.state} label={v.state === 'healthy' ? 'Healthy' : v.state === 'down' ? 'Down (simulated)' : 'Slow (simulated)'} />
                        {v.breakerOpen ? <Status kind="warn" label="Circuit breaker open" /> : <span className="text-[12px] text-ink-3">Breaker closed</span>}
                        <span className={`inline-flex items-center gap-1 text-[12px] ${v.hasKey ? 'text-ok' : 'text-ink-3'}`}>
                          <KeyRound size={12} aria-hidden="true" /> {v.hasKey ? 'API key present' : 'No API key (demo only)'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Segmented label={`Simulate state for ${VENDOR_NAMES[vendor]}`} value={v.state} onChange={(s) => vendors.set(vendor, s)} options={STATES} />
                </div>
                <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-2">
                  {list.map((m) => <ModelTile key={m.id} model={m} floor={floor} vendorState={v.state} onToggle={(enabled) => patch(m.id, { enabled })} onEdit={() => setEditing(m)} />)}
                </div>
              </motion.section>
            );
          })
        : null}

      <p className="text-[12.5px] text-ink-3">Demo prices, latencies and quality estimates are illustrative simulation settings, not vendor quotes. A simulated outage is a test switch and never a real provider incident.</p>

      <EditModal model={editing} onClose={() => setEditing(null)} onSave={async (b) => { if (editing) await patch(editing.id, b); setEditing(null); }} onDelete={async () => {
        if (!editing) return;
        await api.del(`/providers/${editing.id}`);
        setEditing(null);
        models.reload();
      }} />
      <AddModal open={adding} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); models.reload(); }} />
    </Page>
  );
}

function ModelTile({ model: m, floor, vendorState, onToggle, onEdit }: { model: ModelInfo; floor: number; vendorState: VendorState; onToggle: (v: boolean) => void; onEdit: () => void }) {
  const vendorDown = vendorState !== 'healthy';
  // A model out of routing (disabled or excluded by tests) stops moving, like a down provider.
  const life: VendorState = !m.enabled || m.excluded ? 'down' : vendorState;
  return (
    <div className="flex flex-col gap-4 bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Orb model={m} size={34} live={life} />
          <div className="min-w-0">
            <div className="truncate text-[15.5px] font-medium">{m.name}</div>
            <div className="text-[12.5px] text-ink-3 capitalize">{m.tier} · {m.regions.join(', ')} · {m.languages.map((l) => l.toUpperCase()).join(', ')}</div>
          </div>
        </div>
        {m.excluded ? <Status kind="excluded" /> : !m.enabled ? <Status kind="fail" label="Disabled" /> : vendorDown ? <Status kind="warn" label="Failing over" /> : <Status kind="ok" label="In routing" />}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
        <Metric label="Input / 1k" value={money(m.costIn)} />
        <Metric label="Output / 1k" value={money(m.costOut)} />
        <Metric label="Latency" value={ms(m.latencyMs)} />
        <Metric label="Error rate" value={`${(m.errorRate * 100).toFixed(1)}%`} />
        <Metric label="Quality est." value={score(m.quality)} />
        <Metric label="Test score" value={score(m.testScore)} />
      </dl>

      <div>
        <div className="mb-1 flex justify-between text-[11.5px] text-ink-3">
          <span>Latest test score vs exclusion floor ({floor.toFixed(2)})</span>
          <span>{m.testScore === null ? 'not tested yet' : score(m.testScore)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-line">
          <motion.div className="h-full rounded-full" style={{ background: modelColor(m) }} initial={{ width: 0 }} animate={{ width: `${(m.testScore ?? 0) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
          <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `${floor * 100}%` }} aria-hidden="true" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Toggle checked={m.enabled} onChange={onToggle} label={m.enabled ? 'Enabled for routing' : 'Disabled'} />
        <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>Edit</Button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="font-mono text-[13px] text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** Where traffic goes while a vendor is down or slow, derived from the router's real ranking and failover rule. */
function TrafficRedirect({ states, models, budgetMs }: { states: Record<Vendor, VendorState>; models: ModelInfo[]; budgetMs: number }) {
  const cases = useApi<TestCase[]>('/tests/cases');
  const [rows, setRows] = useState<{ label: 'simple' | 'complex'; from?: string; to?: string; affectedState?: VendorState }[]>([]);
  const key = JSON.stringify(states);

  useEffect(() => {
    const samples = ['order_status-en-simple', 'refund-en-complex'].map((id) => cases.data?.find((c) => c.id === id)).filter(Boolean) as TestCase[];
    if (!samples.length) return;
    const c = new AbortController();
    Promise.all(samples.map((s) => api.post<PreviewResponse>('/route/preview', { message: s.message, language: s.language, use_case: s.useCase, customer_id: 'default' }, c.signal)))
      .then((res) =>
        setRows(
          res.map((r, i) => {
            const ranked = r.ranked.map((id) => models.find((m) => m.id === id)).filter(Boolean) as ModelInfo[];
            const primary = ranked[0];
            const hit = primary && states[primary.vendor] !== 'healthy';
            const fallback = hit ? ranked.find((m) => states[m.vendor] === 'healthy') : undefined;
            return { label: samples[i].turnType, from: primary?.id, to: hit ? fallback?.id : primary?.id, affectedState: hit ? states[primary.vendor] : undefined };
          }),
        ),
      )
      .catch(() => {});
    return () => c.abort();
    // `key` stands in for `states` so polling (new object, same values) doesn't refetch.
  }, [key, cases.data, models]);

  const name = (id?: string) => models.find((m) => m.id === id)?.name ?? 'Human handoff';
  return (
    <Card title="Traffic redirect during the simulated outage" right={<SimulatedTag>Simulated outage</SimulatedTag>} subtitle="Default customer, English. Derived from the router’s current ranking and its failover rule (next model from a healthy vendor).">
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <motion.div layout key={r.label} className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line">
            <TurnBadge turnType={r.label} />
            <span className="flex items-center gap-1.5 text-[14px]">
              <Orb model={models.find((m) => m.id === r.from)} size={16} />
              <span className={r.affectedState ? 'text-ink-3 line-through' : 'font-medium'}>{name(r.from)}</span>
            </span>
            <AnimatePresence>
              {r.affectedState && (
                <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={base} className="flex items-center gap-1.5 text-[14px]">
                  <FlowArrow color={modelColor(models.find((m) => m.id === r.to))} label="fails over to" slow={r.affectedState === 'slow'} />
                  <Orb model={models.find((m) => m.id === r.to)} size={16} live />
                  <span className="font-medium">{name(r.to)}</span>
                </motion.span>
              )}
            </AnimatePresence>
            <span className="text-[12.5px] text-ink-3">
              {r.affectedState === 'down' ? 'after a fast error (~150 ms)' : r.affectedState === 'slow' ? `after the ${ms(budgetMs)} latency budget` : 'not affected'}
            </span>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

function EditModal({ model, onClose, onSave, onDelete }: { model: ModelInfo | null; onClose: () => void; onSave: (b: Partial<ModelInfo>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (model) setDraft({ ...Object.fromEntries(NUMERIC.map((n) => [n.key, String(model[n.key])])), liveModel: model.liveModel });
  }, [model]);
  return (
    <Modal
      open={!!model}
      onClose={onClose}
      title={model ? `Edit ${model.name}` : 'Edit model'}
      footer={
        <>
          <Button variant="ghost" icon={Trash} onClick={onDelete} className="mr-auto text-bad">Delete</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              await onSave({ ...Object.fromEntries(NUMERIC.map((n) => [n.key, Number(draft[n.key])])), liveModel: draft.liveModel } as Partial<ModelInfo>);
              setSaving(false);
            }}>
            Save changes
          </Button>
        </>
      }>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NUMERIC.map((n) => <Field key={n.key} label={n.label} inputMode="decimal" value={draft[n.key] ?? ''} onChange={(e) => setDraft({ ...draft, [n.key]: e.target.value })} />)}
        <Field label="Vendor model name (live mode)" value={draft.liveModel ?? ''} onChange={(e) => setDraft({ ...draft, liveModel: e.target.value })} />
      </div>
    </Modal>
  );
}

function AddModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<Vendor>('openai');
  const [tier, setTier] = useState<'fast' | 'flagship'>('fast');
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    try {
      await api.post('/providers', { id, name, vendor, tier, liveModel: id });
      setId('');
      setName('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a model" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Plus} onClick={add} disabled={!id.trim() || !name.trim()}>Add model</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Vendor model id" placeholder="gpt-5-nano" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="none" />
        <Field label="Display name" placeholder="GPT-5 nano" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-col gap-1.5"><span className="label">Vendor</span><Segmented size="sm" label="Vendor" value={vendor} onChange={setVendor} options={VENDOR_ORDER.map((v) => ({ value: v, label: VENDOR_NAMES[v] }))} /></div>
        <div className="flex flex-col gap-1.5"><span className="label">Tier</span><Segmented size="sm" label="Tier" value={tier} onChange={setTier} options={[{ value: 'fast', label: 'Fast' }, { value: 'flagship', label: 'Flagship' }]} /></div>
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
      </div>
    </Modal>
  );
}
