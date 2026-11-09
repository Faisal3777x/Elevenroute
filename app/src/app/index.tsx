import { useState } from 'react';
import { View } from 'react-native';

import { Legend, SeriesTable, SplitBars, StackedBars } from '@/components/charts';
import { Orb } from '@/components/orb';
import { signOut } from '@/components/sign-in';
import {
  ApiErrorNote, Body, Card, Empty, Grid, Muted, Pill, Row, Screen, Segmented, Stat, StatGrid, Status,
} from '@/components/ui';
import { C, F, S, modelColor } from '@/constants/theme';
import { api } from '@/lib/api';
import { count, modelName, money, ms, timeAgo } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useApi } from '@/lib/use-api';

import type { AppConfig, Mode, ModelInfo, Overview } from '../../../shared/types';

export default function OverviewScreen() {
  const stats = useApi<Overview>('/stats/overview');
  const models = useApi<ModelInfo[]>('/providers');
  const config = useApi<AppConfig>('/config');
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [genError, setGenError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      await api.post('/traffic/generate', { count: 500 });
      await stats.reload();
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const setMode = async (mode: Mode) => {
    try {
      await api.post('/mode', { mode });
      config.reload();
    } catch (err) {
      setGenError((err as Error).message);
    }
  };

  const s = stats.data;
  const ms_ = models.data ?? [];
  const byId = (id: string) => ms_.find((m) => m.id === id);
  const series = (s?.costByModel ?? [])
    .map((c) => ({ key: c.modelId, label: modelName(ms_, c.modelId), color: modelColor(byId(c.modelId)), values: c.values }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const noKeys = config.data && !Object.values(config.data.keys).some(Boolean);

  return (
    <Screen
      title="Overview"
      subtitle="What every model costs, where turns go, and when providers failed."
      onRefresh={stats.reload}
      refreshing={stats.loading && !!s}
      actions={
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Pill label="Generate traffic" icon="bolt" onPress={generate} loading={generating} />
          {supabase ? <Pill label="Sign out" variant="secondary" onPress={signOut} /> : null}
        </View>
      }>
      {stats.error && !s ? <ApiErrorNote error={stats.error} onRetry={stats.reload} /> : null}
      {genError ? <ApiErrorNote error={genError} /> : null}

      {config.data && (
        <Card>
          <Row wrap style={{ justifyContent: 'space-between' }} gap={S.md}>
            <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
              <Body style={{ fontFamily: F.medium }}>{config.data.mode === 'demo' ? 'Demo mode' : 'Live mode'}</Body>
              <Muted>
                {config.data.mode === 'demo'
                  ? 'Simulated providers. No API keys needed and no cost.'
                  : noKeys
                    ? 'No API keys found. Add them to .env and restart the API.'
                    : `Real calls with keys for: ${Object.entries(config.data.keys).filter(([, v]) => v).map(([k]) => k).join(', ')}.`}
              </Muted>
            </View>
            <Segmented options={[{ value: 'demo' as Mode, label: 'Demo' }, { value: 'live' as Mode, label: 'Live' }]} value={config.data.mode} onChange={setMode} />
          </Row>
        </Card>
      )}

      {s && s.requests === 0 ? (
        <Empty
          title="No traffic yet"
          body="Generate 500 synthetic conversations across every call type, language and customer, including two replayed provider incidents. It uses simulated providers, so it never spends API credit."
          action={<Pill label="Generate traffic" icon="bolt" onPress={generate} loading={generating} />}
        />
      ) : null}

      {s && s.requests > 0 ? (
        <>
          <StatGrid>
            <Stat label="Requests" value={count(s.requests)} hint={`${count(s.conversations)} conversations`} />
            <Stat label="Total cost" value={money(s.totalCost)} hint="last 14 days" />
            <Stat label="Cost per conversation" value={money(s.costPerConversation)} />
            <Stat label="Failovers" value={count(s.failovers)} hint={`${((s.failovers / s.requests) * 100).toFixed(1)}% of turns`} />
            <Stat label="Latency p95" value={ms(s.p95LatencyMs)} hint={`avg ${ms(s.avgLatencyMs)}`} />
            <Stat label="Routing overhead p95" value={ms(s.p95OverheadMs)} hint="budget 20 ms" />
          </StatGrid>

          <Card
            title="Cost per model over time"
            right={<Segmented small options={[{ value: 'chart' as const, label: 'Chart' }, { value: 'table' as const, label: 'Table' }]} value={view} onChange={setView} />}>
            {view === 'chart' ? (
              <>
                <StackedBars days={s.days} series={series} />
                <Legend items={series} />
              </>
            ) : (
              <SeriesTable days={s.days} series={series} />
            )}
          </Card>

          <Grid>
            <Card title="Where turns go">
              <SplitBars
                labels={['simple', 'complex']}
                rows={[...s.share]
                  .sort((a, b) => b.simple + b.complex - (a.simple + a.complex))
                  .map((r) => ({ key: r.modelId, label: modelName(ms_, r.modelId), color: modelColor(byId(r.modelId)), a: r.simple, b: r.complex, lead: <Orb model={byId(r.modelId)} size={18} /> }))}
              />
            </Card>

            <Card title="Failover history">
              <StackedBars days={s.days} series={[{ key: 'f', label: 'Failovers', color: C.ink2, values: s.failoverDaily }]} height={110} format={(n) => `${Math.round(n)}`} />
              <View style={{ gap: S.sm, marginTop: S.md }}>
                {s.recentFailovers.slice(0, 6).map((f, i) => (
                  <Row key={i} gap={S.sm} style={{ alignItems: 'flex-start' }}>
                    <Status kind={f.reason === 'timeout' ? 'slow' : 'down'} label={f.reason === 'timeout' ? 'Timeout' : 'Error'} />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14 }}>{modelName(ms_, f.from)} → {modelName(ms_, f.to)}</Body>
                      <Muted>{timeAgo(f.ts)} · {f.language.toUpperCase()}</Muted>
                    </View>
                  </Row>
                ))}
                {s.recentFailovers.length === 0 ? <Muted>No failovers in this period.</Muted> : null}
              </View>
            </Card>
          </Grid>
        </>
      ) : null}
    </Screen>
  );
}
