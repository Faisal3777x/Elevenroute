import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ReasonText, Trace } from '@/components/trace';
import {
  ApiErrorNote, Body, Card, Chip, Field, Grid, Label, Muted, Pill, Row, Screen, Segmented, Status, Toggle,
} from '@/components/ui';
import { F, S, VENDOR_NAMES } from '@/constants/theme';
import { api } from '@/lib/api';
import { LANGS, USE_CASES } from '@/lib/format';
import { useApi } from '@/lib/use-api';

import type {
  ClassifierRule, CustomerPolicy, Language, LanguagePref, PreviewResponse, RoutingConfig, Strategy, UseCase, Vendor,
} from '../../../shared/types';

const VENDORS: Vendor[] = ['openai', 'google', 'anthropic'];

const NUM_FIELDS: { key: keyof Strategy; label: string }[] = [
  { key: 'simpleQualityFloor', label: 'Simple-turn quality floor' },
  { key: 'exclusionFloor', label: 'Test exclusion floor' },
  { key: 'latencyBudgetMs', label: 'Latency budget (ms)' },
  { key: 'complexThreshold', label: 'Complex threshold (score ≥)' },
  { key: 'breakerFailures', label: 'Breaker: failures' },
  { key: 'breakerWindowS', label: 'Breaker: window (s)' },
  { key: 'breakerCooldownS', label: 'Breaker: cooldown (s)' },
  { key: 'alertDropPct', label: 'Alert on score drop (%)' },
];

export default function RulesScreen() {
  const cfg = useApi<RoutingConfig>('/routing');
  return (
    <Screen title="Routing rules" subtitle="Preview a decision, then tune the strategy, classifier, customer policies and language preferences.">
      {cfg.error && !cfg.data ? <ApiErrorNote error={cfg.error} onRetry={cfg.reload} /> : null}
      {cfg.data ? (
        <>
          <Preview policies={cfg.data.policies} />
          <Grid>
            <StrategyEditor initial={cfg.data.strategy} />
            <LanguageEditor initial={cfg.data.languages} />
          </Grid>
          <RulesEditor initial={cfg.data.rules} />
          <PolicyEditor initial={cfg.data.policies} />
        </>
      ) : null}
    </Screen>
  );
}

function useSaver<T>(path: string, wrap: (v: T) => unknown) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const save = async (value: T) => {
    setState('saving');
    try {
      await api.put(path, wrap(value));
      setState('saved');
    } catch (err) {
      setState((err as Error).message);
    }
  };
  const note = state === 'saved' ? <Status kind="ok" label="Saved" /> : state !== 'idle' && state !== 'saving' ? <Status kind="fail" label={state} /> : null;
  return { save, saving: state === 'saving', note };
}

function Preview({ policies }: { policies: CustomerPolicy[] }) {
  const [message, setMessage] = useState('I was charged twice and I want a refund for the duplicate payment today. Who approves this?');
  const [language, setLanguage] = useState<Language>('en');
  const [useCase, setUseCase] = useState<UseCase>('refund');
  const [customer, setCustomer] = useState('default');
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message.trim()) return;
    const t = setTimeout(async () => {
      try {
        setResult(await api.post<PreviewResponse>('/route/preview', { message, language, use_case: useCase, customer_id: customer }));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [message, language, useCase, customer]);

  return (
    <Card title="Live classifier preview" right={<Muted>dry run · no model call</Muted>}>
      <View style={{ gap: S.md }}>
        <Field value={message} onChangeText={setMessage} multiline style={{ minHeight: 70, textAlignVertical: 'top', writingDirection: language === 'ar' ? 'rtl' : 'ltr' }} accessibilityLabel="Message to classify" />
        <Row wrap gap={S.md}>
          <Segmented small value={language} onChange={setLanguage} options={LANGS} />
          <Segmented small value={customer} onChange={setCustomer} options={policies.map((p) => ({ value: p.id, label: p.name }))} />
        </Row>
        <Row wrap gap={6}>
          {USE_CASES.map((u) => <Chip key={u.value} label={u.label} active={u.value === useCase} onPress={() => setUseCase(u.value)} />)}
        </Row>
        {error ? <Muted>{error}</Muted> : null}
        {result ? (
          <View style={{ gap: S.sm }}>
            <Row gap={S.sm}>
              <Body style={{ fontFamily: F.medium }}>{result.turn_type === 'simple' ? 'Simple turn' : 'Complex turn'}</Body>
              <Muted>score {result.trace.classification.score}</Muted>
            </Row>
            <ReasonText text={result.route_reason} />
            <Trace trace={result.trace} initiallyOpen />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function StrategyEditor({ initial }: { initial: Strategy }) {
  const [s, setS] = useState(initial);
  const [text, setText] = useState<Record<string, string>>(Object.fromEntries(NUM_FIELDS.map((f) => [f.key, String(initial[f.key])])));
  const { save, saving, note } = useSaver<Strategy>('/routing/strategy', (v) => v);
  const commit = () => save({ ...s, ...Object.fromEntries(NUM_FIELDS.map((f) => [f.key, Number(text[f.key])])) } as Strategy);
  return (
    <Card title="Strategy">
      <View style={{ gap: S.md }}>
        <Row wrap gap={S.sm}>
          {NUM_FIELDS.map((f) => (
            <View key={f.key} style={{ flexBasis: 150, flexGrow: 1 }}>
              <Field label={f.label} value={text[f.key]} onChangeText={(t) => setText({ ...text, [f.key]: t })} keyboardType="decimal-pad" />
            </View>
          ))}
        </Row>
        <Toggle label="Sticky conversations (stay on the first model)" value={s.sticky} onChange={(sticky) => setS({ ...s, sticky })} />
        <Toggle label="Upgrade sticky calls on complex turns" value={s.upgradeStickyOnComplex} onChange={(v) => setS({ ...s, upgradeStickyOnComplex: v })} />
        <Row><Pill label="Save strategy" small onPress={commit} loading={saving} />{note}</Row>
      </View>
    </Card>
  );
}

function RulesEditor({ initial }: { initial: ClassifierRule[] }) {
  const [rules, setRules] = useState(initial);
  const { save, saving, note } = useSaver<ClassifierRule[]>('/routing/rules', (rules) => ({ rules }));
  const update = (id: string, patch: Partial<ClassifierRule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <Card title="Classifier rules" right={<Muted>score ≥ threshold → complex</Muted>}>
      <View style={{ gap: S.lg }}>
        {rules.map((r) => (
          <View key={r.id} style={{ gap: S.sm }}>
            <Row wrap gap={S.md} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Toggle label={r.label} value={r.enabled} onChange={(enabled) => update(r.id, { enabled })} />
              </View>
              <Row gap={S.sm}>
                {r.words !== undefined ? (
                  <View style={{ width: 90 }}>
                    <Field label="Words" value={String(r.words)} onChangeText={(t) => update(r.id, { words: Number(t) || 0 })} keyboardType="number-pad" />
                  </View>
                ) : null}
                <View style={{ width: 90 }}>
                  <Field label="Weight" value={String(r.weight)} onChangeText={(t) => update(r.id, { weight: Number(t) || 0 })} keyboardType="numbers-and-punctuation" />
                </View>
              </Row>
            </Row>
            {r.phrases ? (
              <Field
                label="Phrases (comma-separated; Arabic matches inside words)"
                value={r.phrases.join(', ')}
                onChangeText={(t) => update(r.id, { phrases: t.split(',').map((p) => p.trim()) })}
                multiline
              />
            ) : null}
          </View>
        ))}
        <Row><Pill label="Save rules" small onPress={() => save(rules.map((r) => ({ ...r, phrases: r.phrases?.filter(Boolean) })))} loading={saving} />{note}</Row>
      </View>
    </Card>
  );
}

function PolicyEditor({ initial }: { initial: CustomerPolicy[] }) {
  const [policies, setPolicies] = useState(initial);
  const { save, saving, note } = useSaver<CustomerPolicy[]>('/routing/policies', (policies) => ({ policies }));
  const update = (id: string, patch: Partial<CustomerPolicy>) => setPolicies(policies.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const toggleVendor = (p: CustomerPolicy, v: Vendor) => {
    const current = p.allowedVendors ?? VENDORS;
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    update(p.id, { allowedVendors: next.length === VENDORS.length ? null : next });
  };
  return (
    <Card title="Customer policies">
      <Grid min={300}>
        {policies.map((p) => (
          <View key={p.id} style={{ gap: S.sm, paddingBottom: S.sm }}>
            <Body style={{ fontFamily: F.medium }}>{p.name}</Body>
            <Label>Allowed vendors</Label>
            <Row wrap gap={6}>
              {VENDORS.map((v) => <Chip key={v} label={VENDOR_NAMES[v]} active={(p.allowedVendors ?? VENDORS).includes(v)} onPress={() => toggleVendor(p, v)} />)}
            </Row>
            <Label>Data region</Label>
            <Segmented small value={p.region ?? 'any'} onChange={(r) => update(p.id, { region: r === 'any' ? null : r })} options={[{ value: 'any', label: 'Any' }, { value: 'US', label: 'US only' }, { value: 'EU', label: 'EU only' }]} />
            <View style={{ width: 160 }}>
              <Field label="Quality floor (blank = none)" value={p.qualityFloor === null ? '' : String(p.qualityFloor)} onChangeText={(t) => update(p.id, { qualityFloor: t.trim() === '' ? null : Number(t) })} keyboardType="decimal-pad" />
            </View>
          </View>
        ))}
      </Grid>
      <Row style={{ marginTop: S.md }}><Pill label="Save policies" small onPress={() => save(policies)} loading={saving} />{note}</Row>
    </Card>
  );
}

function LanguageEditor({ initial }: { initial: LanguagePref[] }) {
  const [langs, setLangs] = useState(initial);
  const { save, saving, note } = useSaver<LanguagePref[]>('/routing/languages', (languages) => ({ languages }));
  const update = (l: Language, patch: Partial<LanguagePref>) => setLangs(langs.map((x) => (x.language === l ? { ...x, ...patch } : x)));
  const promote = (p: LanguagePref, v: Vendor) => {
    const i = p.vendorOrder.indexOf(v);
    if (i <= 0) return;
    const next = [...p.vendorOrder];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    update(p.language, { vendorOrder: next });
  };
  return (
    <Card title="Language preferences">
      <View style={{ gap: S.lg }}>
        {langs.map((p) => (
          <View key={p.language} style={{ gap: S.sm }}>
            <Body style={{ fontFamily: F.medium }}>{LANGS.find((l) => l.value === p.language)?.label}</Body>
            <View style={{ width: 200 }}>
              <Field label="Simple-turn floor (blank = global)" value={p.qualityFloor === null ? '' : String(p.qualityFloor)} onChangeText={(t) => update(p.language, { qualityFloor: t.trim() === '' ? null : Number(t) })} keyboardType="decimal-pad" />
            </View>
            <Label>Tie-break order (tap to move up)</Label>
            <Row wrap gap={6}>
              {p.vendorOrder.map((v, i) => <Chip key={v} label={`${i + 1}. ${VENDOR_NAMES[v]}`} onPress={() => promote(p, v)} />)}
            </Row>
          </View>
        ))}
        <Row><Pill label="Save languages" small onPress={() => save(langs)} loading={saving} />{note}</Row>
      </View>
    </Card>
  );
}
