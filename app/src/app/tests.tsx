import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ScoreBar } from '@/components/charts';
import { Icon } from '@/components/icon';
import { Orb } from '@/components/orb';
import {
  ApiErrorNote, Body, Card, Chip, Empty, Grid, Label, Mono, Muted, Pill, Row, Screen, Segmented, Status,
} from '@/components/ui';
import { C, F, S, modelColor } from '@/constants/theme';
import { api } from '@/lib/api';
import { LANGS, USE_CASES, modelName, ms, score, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/use-api';

import type { Alert, ModelInfo, RoutingConfig, TestResult, TestRun } from '../../../shared/types';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export default function TestsScreen() {
  const models = useApi<ModelInfo[]>('/providers');
  const results = useApi<TestResult[]>('/tests/results');
  const runs = useApi<TestRun[]>('/tests/runs');
  const alerts = useApi<Alert[]>('/alerts');
  const routing = useApi<RoutingConfig>('/routing');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [by, setBy] = useState<'useCase' | 'language'>('useCase');
  const [selected, setSelected] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.post('/tests/run');
      await Promise.all([models.reload(), results.reload(), runs.reload(), alerts.reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const floor = routing.data?.strategy.exclusionFloor ?? 0.7;
  const scored = (models.data ?? []).filter((m) => m.testScore !== null).sort((a, b) => (b.testScore ?? 0) - (a.testScore ?? 0));
  const cols = by === 'useCase' ? USE_CASES.map((u) => ({ key: u.value, label: u.label })) : LANGS.map((l) => ({ key: l.value, label: l.label }));
  const heat = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of results.data ?? []) {
      const k = `${r.modelId}|${by === 'useCase' ? r.useCase : r.language}`;
      map.set(k, [...(map.get(k) ?? []), r.score]);
    }
    return map;
  }, [results.data, by]);
  const activeModel = selected ?? scored[0]?.id ?? null;
  const rows = (results.data ?? []).filter((r) => r.modelId === activeModel);

  return (
    <Screen
      title="Test results"
      subtitle="24 conversations · 6 call types × 2 languages × simple and complex. Every model, same tests."
      onRefresh={results.reload}
      actions={<Pill label="Run tests" icon="check" onPress={run} loading={running} />}>
      {models.error && !models.data ? <ApiErrorNote error={models.error} onRetry={models.reload} /> : null}
      {error ? <ApiErrorNote error={error} /> : null}

      {models.data && scored.length === 0 ? (
        <Empty title="No test runs yet" body="Run the suite to score every model on task completion, accuracy, tone and latency. Models under the floor are removed from routing automatically." action={<Pill label="Run tests" icon="check" onPress={run} loading={running} />} />
      ) : null}

      {scored.length > 0 && (
        <>
          <Grid>
            <Card title="Scores" right={<Muted>floor {floor.toFixed(2)} ▏</Muted>}>
              <View style={{ gap: S.md }}>
                {scored.map((m) => (
                  <View key={m.id} style={{ gap: 6 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row gap={S.sm} style={{ flexShrink: 1 }}>
                        <Orb model={m} size={18} />
                        <Body style={{ fontFamily: F.medium, fontSize: 14 }}>{m.name}</Body>
                        {m.excluded ? <Status kind="excluded" /> : null}
                      </Row>
                      <Mono style={{ color: C.ink, fontSize: 13 }}>{score(m.testScore)}</Mono>
                    </Row>
                    <ScoreBar value={m.testScore ?? 0} floor={floor} color={modelColor(m)} />
                  </View>
                ))}
              </View>
            </Card>

            <Card title="Alerts">
              <View style={{ gap: S.sm }}>
                {(alerts.data ?? []).slice(0, 8).map((a) => (
                  <Row key={a.id} gap={S.sm} style={{ alignItems: 'flex-start' }}>
                    <Icon name="alert" size={16} color={a.message.includes('restored') ? C.ok : C.bad} />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14 }}>{a.message}</Body>
                      <Muted>{timeAgo(a.ts)}</Muted>
                    </View>
                  </Row>
                ))}
                {alerts.data?.length === 0 ? <Muted>No alerts. A score drop of more than 10% since a model&apos;s previous run raises one.</Muted> : null}
              </View>
            </Card>
          </Grid>

          <Card
            title="Heatmap"
            right={<Segmented small value={by} onChange={setBy} options={[{ value: 'useCase', label: 'Call type' }, { value: 'language', label: 'Language' }]} />}>
            <ScrollView horizontal>
              <View style={{ gap: 4 }}>
                <Row gap={4}>
                  <View style={{ width: 130 }} />
                  {cols.map((c) => <Label key={c.key} style={{ width: 84, textAlign: 'center' }} numberOfLines={1}>{c.label}</Label>)}
                </Row>
                {scored.map((m) => (
                  <Row key={m.id} gap={4}>
                    <Text style={{ width: 130, fontFamily: F.medium, fontSize: 13, color: C.ink }} numberOfLines={1}>{m.name}</Text>
                    {cols.map((c) => {
                      const v = avg(heat.get(`${m.id}|${c.key}`) ?? []);
                      const a = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0.06, (v - 0.5) / 0.5));
                      return (
                        <View key={c.key} style={{ width: 84, height: 34, borderRadius: 8, backgroundColor: `rgba(13,107,102,${a})`, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: F.medium, fontSize: 12, color: a > 0.55 ? C.white : C.ink }}>{Number.isNaN(v) ? '—' : v.toFixed(2)}</Text>
                        </View>
                      );
                    })}
                  </Row>
                ))}
              </View>
            </ScrollView>
            <Muted style={{ marginTop: S.sm }}>Darker = higher score. Values are averages of (accuracy + tone) / 10, × 0.6 when the task wasn&apos;t completed.</Muted>
          </Card>

          <Card title="Scored conversations">
            <Row wrap gap={6} style={{ marginBottom: S.md }}>
              {scored.map((m) => <Chip key={m.id} label={m.name} active={m.id === activeModel} onPress={() => setSelected(m.id)} />)}
            </Row>
            <View style={{ gap: S.sm }}>
              {rows.map((r) => (
                <View key={r.caseId} style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: S.sm, gap: 2 }}>
                  <Row wrap gap={S.sm} style={{ justifyContent: 'space-between' }}>
                    <Body style={{ fontSize: 14, fontFamily: F.medium }}>{r.caseId}</Body>
                    <Row gap={S.sm}>
                      <Status kind={r.completed ? 'ok' : 'fail'} label={r.completed ? 'Completed' : 'Not completed'} />
                      <Mono style={{ color: C.ink }}>{r.score.toFixed(2)}</Mono>
                    </Row>
                  </Row>
                  <Mono>accuracy {r.accuracy.toFixed(1)}/5 · tone {r.tone.toFixed(1)}/5 · {ms(r.latencyMs)}</Mono>
                  {r.reply !== '(simulated reply)' ? <Muted numberOfLines={3}>{r.reply}</Muted> : null}
                </View>
              ))}
            </View>
          </Card>

          <Card title="Run history">
            <View style={{ gap: S.sm }}>
              {(runs.data ?? []).map((run) => {
                const vals = Object.values(run.scores);
                return (
                  <Row key={run.id} wrap style={{ justifyContent: 'space-between' }}>
                    <Body style={{ fontSize: 14 }}>Run #{run.id} · {run.mode}</Body>
                    <Muted>{timeAgo(run.ts)} · mean {avg(vals).toFixed(2)} · best {modelName(models.data, Object.entries(run.scores).sort((a, b) => b[1] - a[1])[0]?.[0])}</Muted>
                  </Row>
                );
              })}
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}
