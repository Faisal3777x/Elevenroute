import { useState } from 'react';
import { View } from 'react-native';

import { Orb } from '@/components/orb';
import { ApiErrorNote, Body, Card, Field, Grid, Label, Mono, Muted, Pill, Row, Screen, Segmented, Status, Toggle } from '@/components/ui';
import { VendorSwitches } from '@/components/vendor-switches';
import { F, S, VENDOR_NAMES } from '@/constants/theme';
import { api } from '@/lib/api';
import { money, ms, score } from '@/lib/format';
import { useApi } from '@/lib/use-api';

import type { ModelInfo, Vendor } from '../../../shared/types';

const NUMERIC = [
  { key: 'costIn', label: 'Input $/1k' },
  { key: 'costOut', label: 'Output $/1k' },
  { key: 'latencyMs', label: 'Latency ms' },
  { key: 'errorRate', label: 'Error rate' },
  { key: 'quality', label: 'Quality 0–1' },
] as const;

export default function ProvidersScreen() {
  const models = useApi<ModelInfo[]>('/providers');
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

  return (
    <Screen title="Providers" subtitle="Vendor status, outage switches and the model catalogue." onRefresh={models.reload} refreshing={models.loading && !!models.data}>
      {models.error && !models.data ? <ApiErrorNote error={models.error} onRetry={models.reload} /> : null}
      {error ? <ApiErrorNote error={error} /> : null}

      <Card title="Vendors">
        <VendorSwitches />
      </Card>

      <Grid min={340}>
        {(models.data ?? []).map((m) => (
          <ModelCard key={m.id} model={m} onPatch={(b) => patch(m.id, b)} onDelete={async () => {
            await api.del(`/providers/${m.id}`);
            models.reload();
          }} />
        ))}
      </Grid>

      <AddModel onAdded={models.reload} />
      <Muted>Demo prices, latencies and quality scores are illustrative simulation settings, not vendor quotes.</Muted>
    </Screen>
  );
}

function ModelCard({ model: m, onPatch, onDelete }: { model: ModelInfo; onPatch: (b: Partial<ModelInfo>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(Object.fromEntries(NUMERIC.map((n) => [n.key, String(m[n.key])])));
    setEditing(true);
  };
  const saveEdit = async () => {
    setSaving(true);
    await onPatch(Object.fromEntries(NUMERIC.map((n) => [n.key, Number(draft[n.key])])) as Partial<ModelInfo>);
    setSaving(false);
    setEditing(false);
  };

  return (
    <Card>
      <View style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Row gap={S.md} style={{ flex: 1 }}>
            <Orb model={m} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontFamily: F.medium, fontSize: 16 }}>{m.name}</Body>
              <Muted>{VENDOR_NAMES[m.vendor]} · {m.tier} · {m.regions.join(', ')}</Muted>
            </View>
          </Row>
          {m.excluded ? <Status kind="excluded" /> : m.enabled ? <Status kind="ok" label="In routing" /> : <Status kind="fail" label="Disabled" />}
        </Row>

        <Row wrap gap={S.lg}>
          <Metric label="Price in / out" value={`${money(m.costIn)} / ${money(m.costOut)}`} />
          <Metric label="Latency" value={ms(m.latencyMs)} />
          <Metric label="Error rate" value={`${(m.errorRate * 100).toFixed(1)}%`} />
          <Metric label="Quality" value={score(m.quality)} />
          <Metric label="Test score" value={score(m.testScore)} />
        </Row>

        {editing ? (
          <View style={{ gap: S.sm }}>
            <Row wrap gap={S.sm}>
              {NUMERIC.map((n) => (
                <View key={n.key} style={{ width: 140 }}>
                  <Field label={n.label} value={draft[n.key]} onChangeText={(t) => setDraft({ ...draft, [n.key]: t })} keyboardType="decimal-pad" />
                </View>
              ))}
            </Row>
            <Row wrap>
              <Pill label="Save" small onPress={saveEdit} loading={saving} />
              <Pill label="Cancel" small variant="secondary" onPress={() => setEditing(false)} />
              <Pill label="Delete model" small variant="ghost" onPress={onDelete} />
            </Row>
          </View>
        ) : (
          <Row style={{ justifyContent: 'space-between' }} wrap>
            <Toggle value={m.enabled} onChange={(enabled) => onPatch({ enabled })} label={m.enabled ? 'Enabled' : 'Disabled'} />
            <Pill label="Edit" small variant="secondary" onPress={startEdit} />
          </Row>
        )}
      </View>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Mono style={{ color: '#000', fontSize: 13 }}>{value}</Mono>
    </View>
  );
}

function AddModel({ onAdded }: { onAdded: () => void }) {
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
    <Card title="Add a model">
      <View style={{ gap: S.md }}>
        <Row wrap gap={S.sm}>
          <View style={{ flex: 1, minWidth: 180 }}><Field label="Vendor model id" value={id} onChangeText={setId} placeholder="gpt-5-nano" autoCapitalize="none" /></View>
          <View style={{ flex: 1, minWidth: 180 }}><Field label="Display name" value={name} onChangeText={setName} placeholder="GPT-5 nano" /></View>
        </Row>
        <Row wrap gap={S.md}>
          <Segmented small value={vendor} onChange={setVendor} options={(['openai', 'google', 'anthropic'] as Vendor[]).map((v) => ({ value: v, label: VENDOR_NAMES[v] }))} />
          <Segmented small value={tier} onChange={setTier} options={[{ value: 'fast', label: 'Fast' }, { value: 'flagship', label: 'Flagship' }]} />
        </Row>
        {error ? <Muted style={{ color: '#c0262d' }}>{error}</Muted> : null}
        <View style={{ alignSelf: 'flex-start' }}>
          <Pill label="Add model" icon="plus" small onPress={add} disabled={!id.trim() || !name.trim()} />
        </View>
      </View>
    </Card>
  );
}
