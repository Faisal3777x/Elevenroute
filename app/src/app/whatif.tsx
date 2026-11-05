import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { Orb } from '@/components/orb';
import { ApiErrorNote, Body, Card, Chip, Empty, Label, Muted, Row, Screen, Segmented, Stat, StatGrid } from '@/components/ui';
import { C, F, S } from '@/constants/theme';
import { api } from '@/lib/api';
import { count, money, pct } from '@/lib/format';
import { useApi } from '@/lib/use-api';

import type { ModelInfo, TurnType, WhatIfResult } from '../../../shared/types';

const SHARES = [0.1, 0.25, 0.5, 0.75, 1].map((v) => ({ value: v, label: `${v * 100}%` }));
const VOLUMES = [
  { value: 0, label: 'Logged rate' },
  { value: 100_000, label: '100k' },
  { value: 1_000_000, label: '1M' },
  { value: 10_000_000, label: '10M' },
];

export default function WhatIfScreen() {
  const models = useApi<ModelInfo[]>('/providers');
  const [from, setFrom] = useState('claude-sonnet-5-5');
  const [to, setTo] = useState('gemini-2.5-flash');
  const [share, setShare] = useState(0.5);
  const [turnType, setTurnType] = useState<TurnType | 'all'>('simple');
  const [volume, setVolume] = useState(0);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .post<WhatIfResult>('/whatif/simulate', { fromModel: from, toModel: to, share, turnType, volume: volume || null })
      .then((r) => live && (setResult(r), setError(null)))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [from, to, share, turnType, volume]);

  const list = models.data ?? [];
  const nameOf = (id: string) => list.find((m) => m.id === id)?.name ?? id;
  const saving = result ? result.delta < 0 : false;

  return (
    <Screen title="What-if" subtitle="Move a share of logged traffic to another model and see the cost and quality trade-off.">
      {error ? <ApiErrorNote error={error} /> : null}

      <Card>
        <View style={{ gap: S.lg }}>
          <Picker label="Move traffic from" models={list} value={from} onChange={setFrom} />
          <Picker label="To" models={list} value={to} onChange={setTo} />
          <Row wrap gap={S.xl}>
            <View style={{ gap: 6 }}><Label>Share</Label><Segmented small value={share} onChange={setShare} options={SHARES} /></View>
            <View style={{ gap: 6 }}>
              <Label>Turns</Label>
              <Segmented small value={turnType} onChange={setTurnType} options={[{ value: 'simple', label: 'Simple' }, { value: 'complex', label: 'Complex' }, { value: 'all', label: 'All' }]} />
            </View>
            <View style={{ gap: 6 }}><Label>Monthly conversations</Label><Segmented small value={volume} onChange={setVolume} options={VOLUMES} /></View>
          </Row>
        </View>
      </Card>

      {result && result.loggedTurns === 0 ? (
        <Empty title="No logged traffic" body="The simulator re-prices logged token counts. Generate traffic on the Overview page first." />
      ) : null}

      {result && result.loggedTurns > 0 ? (
        <>
          <Card>
            <Body style={{ fontFamily: F.light, fontSize: 22, lineHeight: 30 }}>
              Moving {pct(share * 100)} of {turnType === 'all' ? '' : `${turnType} `}turns from {nameOf(from)} to {nameOf(to)}{' '}
              {saving ? 'saves' : 'adds'} <Body style={{ fontFamily: F.medium, fontSize: 22, color: saving ? C.ok : C.bad }}>{money(Math.abs(result.delta))}</Body> a month
              at {count(Math.round(result.monthlyConversations))} conversations.
            </Body>
          </Card>
          <StatGrid>
            <Stat label="Current monthly cost" value={money(result.currentMonthly)} />
            <Stat label="Projected monthly cost" value={money(result.projectedMonthly)} />
            <View style={{ flexGrow: 1, flexBasis: 150, backgroundColor: C.card, borderRadius: 20, padding: S.lg, gap: 4 }}>
              <Label>Change</Label>
              <Row gap={6}>
                <Icon name={saving ? 'down' : 'up'} color={saving ? C.ok : C.bad} size={20} />
                <Body style={{ fontFamily: F.light, fontSize: 28, color: saving ? C.ok : C.bad }}>
                  {result.currentMonthly ? pct((result.delta / result.currentMonthly) * 100, 1) : '—'}
                </Body>
              </Row>
              <Muted>{saving ? 'saving' : 'increase'}</Muted>
            </View>
            <Stat label="Quality on moved traffic" value={`${result.qualityFrom.toFixed(2)} → ${result.qualityTo.toFixed(2)}`} hint={result.qualityTo < result.qualityFrom ? 'lower quality' : 'same or better'} />
            <Stat label="Traffic moved" value={pct(result.movedTurnsPct, 1)} hint="of all logged turns" />
            <Stat label="Blocked by policy" value={pct(result.blockedPct, 0)} hint={`can't move to ${nameOf(to)}`} />
          </StatGrid>
          <Muted>Costs come from logged token counts re-priced at current catalogue prices. Quality uses the latest test scores for each language and turn type, or the configured estimate before the first test run.</Muted>
        </>
      ) : null}
    </Screen>
  );
}

function Picker({ label, models, value, onChange }: { label: string; models: ModelInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <Row wrap gap={6}>
        {models.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Chip label={m.name} active={m.id === value} onPress={() => onChange(m.id)} />
          </View>
        ))}
      </Row>
      <Row gap={6}><Orb model={models.find((m) => m.id === value)} size={14} /><Muted>{models.find((m) => m.id === value)?.name}</Muted></Row>
    </View>
  );
}
