import { Check, Save } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import type {
  ClassifierRule, CustomerPolicy, Language, LanguagePref, ModelInfo, PreviewResponse, RoutingConfig, Strategy, UseCase, Vendor,
} from '../../../shared/types';
import { Collapse } from '../components/Collapse';
import { Orb } from '../components/Orb';
import { RoutingVisualiser } from '../components/RoutingVisualiser';
import { Button, Card, Chip, ErrorNote, Field, Page, PageHeader, Segmented, Skeleton, Status, TextArea, Toggle, TurnBadge } from '../components/ui';
import { api } from '../lib/api';
import { LANGS, money, USE_CASES } from '../lib/format';
import { base, spring } from '../lib/motion';
import { runFromPreview } from '../lib/runs';
import { modelColor, VENDOR_NAMES, VENDOR_ORDER } from '../lib/theme';
import { useApi } from '../lib/useApi';

const NUM_FIELDS: { key: keyof Strategy; label: string; hint?: string }[] = [
  { key: 'simpleQualityFloor', label: 'Simple-turn quality floor', hint: 'Cheapest model at or above this wins' },
  { key: 'exclusionFloor', label: 'Test exclusion floor', hint: 'Below this test score a model is removed' },
  { key: 'latencyBudgetMs', label: 'Latency budget (ms)', hint: 'Slower answers fail over' },
  { key: 'complexThreshold', label: 'Complex threshold', hint: 'Score at or above = complex' },
  { key: 'breakerFailures', label: 'Breaker: failures' },
  { key: 'breakerWindowS', label: 'Breaker: window (s)' },
  { key: 'breakerCooldownS', label: 'Breaker: cooldown (s)' },
  { key: 'alertDropPct', label: 'Alert on score drop (%)' },
];

export default function RoutingRules() {
  const cfg = useApi<RoutingConfig>('/routing');
  const models = useApi<ModelInfo[]>('/providers');
  return (
    <Page>
      <PageHeader title="Routing rules" subtitle="See exactly how a request is classified and ranked, then tune the thresholds, classifier, customer policies and language preferences." />
      {cfg.error && !cfg.data ? <ErrorNote error={cfg.error} onRetry={cfg.reload} /> : null}
      {!cfg.data ? <Skeleton className="h-[420px]" /> : null}
      {cfg.data ? (
        <>
          <Preview config={cfg.data} models={models.data ?? []} />
          <PolicyEditor initial={cfg.data.policies} models={models.data ?? []} onSaved={cfg.reload} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <StrategyEditor initial={cfg.data.strategy} onSaved={cfg.reload} />
            <LanguageEditor initial={cfg.data.languages} onSaved={cfg.reload} />
          </div>
          <RulesEditor initial={cfg.data.rules} onSaved={cfg.reload} />
        </>
      ) : null}
    </Page>
  );
}

function useSaver<T>(path: string, wrap: (v: T) => unknown, onSaved: () => void) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const markDirty = () => {
    setDirty(true);
    setState((s) => (typeof s === 'object' ? 'idle' : s));
  };
  const fail = (error: string) => setState({ error });
  const save = async (value: T) => {
    setState('saving');
    try {
      await api.put(path, wrap(value));
      setDirty(false);
      setState('saved');
      onSaved();
      setTimeout(() => setState('idle'), 2500);
    } catch (err) {
      setState({ error: (err as Error).message });
    }
  };
  const note = (
    <AnimatePresence>
      {state === 'saved' && <motion.span key="ok" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={base}><Status kind="ok" label="Saved" /></motion.span>}
      {typeof state === 'object' && <motion.span key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Status kind="fail" label={state.error} /></motion.span>}
      {dirty && state === 'idle' && <motion.span key="dirty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Status kind="warn" label="Unsaved changes" /></motion.span>}
    </AnimatePresence>
  );
  return { save, saving: state === 'saving', note, markDirty, fail };
}

// ---------- live preview ----------
function Preview({ config, models }: { config: RoutingConfig; models: ModelInfo[] }) {
  const [message, setMessage] = useState('I was charged twice for the same order and I want a refund for the duplicate today. Who approves this?');
  const [language, setLanguage] = useState<Language>('en');
  const [useCase, setUseCase] = useState<UseCase>('refund');
  const [customer, setCustomer] = useState('default');
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message.trim()) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      api
        .post<PreviewResponse>('/route/preview', { message, language, use_case: useCase, customer_id: customer }, c.signal)
        .then((r) => { setResult(r); setError(null); })
        .catch((err: Error) => err.name !== 'AbortError' && setError(err.message));
    }, 220);
    return () => { clearTimeout(t); c.abort(); };
  }, [message, language, useCase, customer, config]);

  // Rebuilt only when a new decision arrives, so typing doesn't restart the diagram.
  const run = useMemo(
    () => (result ? runFromPreview({ message, language, use_case: useCase, customer_id: customer }, result, config.policies) : null),
    [result], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const hits = new Map(result?.trace.classification.hits.map((h) => [h.id, h]) ?? []);
  const threshold = config.strategy.complexThreshold;
  const s = result?.trace.classification.score ?? 0;
  const lo = -6;
  const hi = 8;
  const pos = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;
  const ranked = [...(result?.trace.candidates ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  return (
    <Card title="Live classifier preview" subtitle="A dry run: the router classifies and ranks, but no model is called and nothing is logged.">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-3">
          <TextArea label="Customer message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          <div className="flex flex-wrap gap-3">
            <Segmented size="sm" label="Language" value={language} onChange={setLanguage} options={LANGS} />
            {config.policies.length > 1 ? <Segmented size="sm" label="Customer" value={customer} onChange={setCustomer} options={config.policies.map((p) => ({ value: p.id, label: p.name }))} /> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">{USE_CASES.map((u) => <Chip key={u.value} active={u.value === useCase} onClick={() => setUseCase(u.value)}>{u.label}</Chip>)}</div>
          {error ? <ErrorNote error={error} /> : null}

          {/* score gauge */}
          {result ? (
            <div className="mt-2 rounded-2xl bg-canvas p-4 ring-1 ring-line">
              <div className="mb-3 flex items-center justify-between">
                <TurnBadge turnType={result.turn_type} score={s} />
                <span className="text-[12px] text-ink-3">threshold {threshold}: score ≥ {threshold} is complex</span>
              </div>
              <div className="relative h-2.5 rounded-full" style={{ background: `linear-gradient(90deg, rgb(4 71 255 / 0.18) 0%, rgb(4 71 255 / 0.18) ${pos(threshold)}, rgb(255 71 4 / 0.2) ${pos(threshold)}, rgb(255 71 4 / 0.2) 100%)` }}>
                <span className="absolute -top-1.5 h-5.5 w-0.5 rounded bg-ink/60" style={{ left: pos(threshold) }} aria-hidden="true" />
                <motion.span className="absolute -top-[5px] h-5 w-5 -translate-x-1/2 rounded-full border-2 border-canvas bg-ink shadow" animate={{ left: pos(s) }} transition={spring} aria-hidden="true" />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-ink-3"><span>← simpler</span><span>more complex →</span></div>
            </div>
          ) : null}

          {/* rules that matched */}
          <div className="mt-1 flex flex-col gap-1.5" aria-label="Classifier rules">
            {config.rules.map((r) => {
              const h = hits.get(r.id);
              return (
                <motion.div key={r.id} layout transition={spring} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors ${h ? 'bg-ink text-white' : 'bg-canvas text-ink-3 ring-1 ring-line'} ${!r.enabled ? 'opacity-50' : ''}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {h ? <Check size={13} aria-hidden="true" /> : <span className="h-3 w-3 rounded-full border border-ink/20" aria-hidden="true" />}
                    <span className="truncate">{h?.label ?? r.label}{!r.enabled ? ' (off)' : ''}</span>
                  </span>
                  <span className={`font-mono text-[12px] ${h ? 'text-white' : ''}`}>{r.weight > 0 ? '+' : ''}{r.weight}</span>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="label">Ranked candidates{result ? ` · quality for ${language === 'es' ? 'Spanish' : 'English'} ${result.turn_type} turns` : ''}</span>
          <LayoutGroup>
            <ol className="flex flex-col gap-1.5">
              {ranked.map((c) => (
                <motion.li key={c.modelId} layout transition={spring} className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ring-1 ${c.rank === 1 ? 'bg-canvas shadow-[var(--shadow-card)] ring-ink/20' : 'bg-canvas/60 ring-line'} ${c.eligible ? '' : 'opacity-50'}`}>
                  <span className="w-7 font-mono text-[12px] text-ink-3">{c.rank ? `#${c.rank}` : '—'}</span>
                  <Orb model={models.find((m) => m.id === c.modelId)} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{c.name}</div>
                    <div className="truncate text-[12px] text-ink-3">{c.eligible ? `quality ${c.quality.toFixed(2)} · ${money(c.cost)}/1k` : `Filtered: ${c.note}`}{c.eligible && c.note ? ` · ${c.note}` : ''}</div>
                  </div>
                  {c.rank === 1 ? <Status kind="ok" label="Chosen" /> : null}
                </motion.li>
              ))}
            </ol>
          </LayoutGroup>
          {result ? <p className="text-[13px] leading-relaxed text-ink-2">{result.route_reason}</p> : null}
          <Collapse label="Show as routing diagram">
            <RoutingVisualiser run={run} models={models} />
          </Collapse>
        </div>
      </div>
    </Card>
  );
}

// ---------- editors ----------
function PolicyEditor({ initial, models, onSaved }: { initial: CustomerPolicy[]; models: ModelInfo[]; onSaved: () => void }) {
  const [policies, setPoliciesRaw] = useState(initial);
  const { save, saving, note, markDirty } = useSaver<CustomerPolicy[]>('/routing/policies', (policies) => ({ policies }), onSaved);
  const setPolicies = (v: CustomerPolicy[]) => { markDirty(); setPoliciesRaw(v); };
  const update = (id: string, patch: Partial<CustomerPolicy>) => setPolicies(policies.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const toggleVendor = (p: CustomerPolicy, v: Vendor) => {
    const current = p.allowedVendors ?? VENDOR_ORDER;
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    update(p.id, { allowedVendors: next.length === VENDOR_ORDER.length ? null : next });
  };
  const allowed = (p: CustomerPolicy) => models.filter((m) => (!p.allowedVendors || p.allowedVendors.includes(m.vendor)) && (!p.region || m.regions.includes(p.region)));

  return (
    <Card title="Customer policies" subtitle="Which vendors and data regions each customer allows. The models each policy permits update as you edit." right={<>{note}<Button size="sm" icon={Save} onClick={() => save(policies)} loading={saving}>Save policies</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {policies.map((p) => {
          const ok = allowed(p);
          return (
            <motion.div layout key={p.id} className="flex flex-col gap-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-medium">{p.name}</span>
                <span className="text-[12px] text-ink-3">{ok.length} of {models.length} models allowed</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Vendors allowed for ${p.name}`}>
                {VENDOR_ORDER.map((v) => <Chip key={v} active={(p.allowedVendors ?? VENDOR_ORDER).includes(v)} onClick={() => toggleVendor(p, v)}>{VENDOR_NAMES[v]}</Chip>)}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="label">Data region</span>
                  <Segmented size="sm" label={`Data region for ${p.name}`} value={p.region ?? 'any'} onChange={(r) => update(p.id, { region: r === 'any' ? null : (r as 'US' | 'EU') })} options={[{ value: 'any', label: 'Any' }, { value: 'US', label: 'US only' }, { value: 'EU', label: 'EU only' }]} />
                </div>
                <Field className="w-[150px]" label="Quality floor" placeholder="none" inputMode="decimal" value={p.qualityFloor === null ? '' : String(p.qualityFloor)} onChange={(e) => update(p.id, { qualityFloor: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
              </div>
              <div className="flex flex-wrap gap-1">
                <AnimatePresence initial={false}>
                  {models.map((m) => {
                    const yes = ok.includes(m);
                    return (
                      <motion.span key={m.id} layout animate={{ opacity: yes ? 1 : 0.35 }} transition={base} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] ring-1 ${yes ? 'ring-line' : 'line-through ring-transparent'}`} style={{ color: yes ? undefined : '#6b645e' }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: modelColor(m) }} aria-hidden="true" /> {m.name}
                      </motion.span>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function StrategyEditor({ initial, onSaved }: { initial: Strategy; onSaved: () => void }) {
  const [s, setSRaw] = useState(initial);
  const [text, setTextRaw] = useState<Record<string, string>>(() => Object.fromEntries(NUM_FIELDS.map((f) => [f.key, String(initial[f.key])])));
  const { save, saving, note, markDirty, fail } = useSaver<Strategy>('/routing/strategy', (v) => v, onSaved);
  const setS = (v: Strategy) => { markDirty(); setSRaw(v); };
  const setText = (v: Record<string, string>) => { markDirty(); setTextRaw(v); };
  // An empty or non-numeric box is an error, never a silent 0 (an empty latency budget used to save as 0 ms).
  const commit = () => {
    const bad = NUM_FIELDS.find((f) => !text[f.key]?.trim() || !Number.isFinite(Number(text[f.key])));
    if (bad) return fail(`${bad.label} needs a number`);
    save({ ...s, ...Object.fromEntries(NUM_FIELDS.map((f) => [f.key, Number(text[f.key])])) } as Strategy);
  };
  return (
    <Card title="Strategy" right={<>{note}<Button size="sm" icon={Save} onClick={commit} loading={saving}>Save strategy</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NUM_FIELDS.map((f) => <Field key={f.key} label={f.label} hint={f.hint} inputMode="decimal" value={text[f.key]} onChange={(e) => setText({ ...text, [f.key]: e.target.value })} />)}
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <Toggle checked={s.sticky} onChange={(sticky) => setS({ ...s, sticky })} label="Sticky conversations" description="Keep a conversation on its first model while it stays allowed." />
        <Toggle checked={s.upgradeStickyOnComplex} onChange={(v) => setS({ ...s, upgradeStickyOnComplex: v })} label="Upgrade sticky calls on complex turns" description="An escalating call moves up to a stronger model." />
        <Toggle checked={s.downgradeStickyOnSimple} onChange={(v) => setS({ ...s, downgradeStickyOnSimple: v })} label="Let simple follow-ups move to a cheaper model" description="A “thanks” or “yes” after a complex turn goes to the cheapest model above the floor instead of staying on the flagship." />
      </div>
    </Card>
  );
}

function LanguageEditor({ initial, onSaved }: { initial: LanguagePref[]; onSaved: () => void }) {
  const [langs, setLangsRaw] = useState(initial);
  const { save, saving, note, markDirty } = useSaver<LanguagePref[]>('/routing/languages', (languages) => ({ languages }), onSaved);
  const setLangs = (v: LanguagePref[]) => { markDirty(); setLangsRaw(v); };
  const update = (l: Language, patch: Partial<LanguagePref>) => setLangs(langs.map((x) => (x.language === l ? { ...x, ...patch } : x)));
  const promote = (p: LanguagePref, v: Vendor) => {
    const i = p.vendorOrder.indexOf(v);
    if (i <= 0) return;
    const next = [...p.vendorOrder];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    update(p.language, { vendorOrder: next });
  };
  return (
    <Card title="Language preferences" right={<>{note}<Button size="sm" icon={Save} onClick={() => save(langs)} loading={saving}>Save languages</Button></>}>
      <div className="flex flex-col gap-5">
        {langs.map((p) => (
          <div key={p.language} className="flex flex-col gap-2.5">
            <span className="text-[15px] font-medium">{LANGS.find((l) => l.value === p.language)?.label}</span>
            <Field className="max-w-[220px]" label="Simple-turn floor" placeholder="global floor" inputMode="decimal" value={p.qualityFloor === null ? '' : String(p.qualityFloor)} onChange={(e) => update(p.language, { qualityFloor: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
            <span className="label">Tie-break vendor order (click to move up)</span>
            <LayoutGroup id={`order-${p.language}`}>
              <div className="flex flex-wrap gap-1.5">
                {p.vendorOrder.map((v, i) => (
                  <motion.div key={v} layout transition={spring}>
                    <Chip onClick={() => promote(p, v)}>{i + 1}. {VENDOR_NAMES[v]}</Chip>
                  </motion.div>
                ))}
              </div>
            </LayoutGroup>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RulesEditor({ initial, onSaved }: { initial: ClassifierRule[]; onSaved: () => void }) {
  const [rules, setRulesRaw] = useState(initial);
  const { save, saving, note, markDirty } = useSaver<ClassifierRule[]>('/routing/rules', (rules) => ({ rules }), onSaved);
  const setRules = (v: ClassifierRule[]) => { markDirty(); setRulesRaw(v); };
  const update = (id: string, patch: Partial<ClassifierRule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <Card title="Classifier rules" subtitle="Weighted signals; their sum decides simple vs complex." right={<>{note}<Button size="sm" icon={Save} onClick={() => save(rules.map((r) => ({ ...r, phrases: r.phrases?.filter(Boolean) })))} loading={saving}>Save rules</Button></>}>
      <div className="flex flex-col divide-y divide-line">
        {rules.map((r) => (
          <div key={r.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Toggle checked={r.enabled} onChange={(enabled) => update(r.id, { enabled })} label={r.label} />
              <div className="flex gap-2">
                {r.words !== undefined ? <Field className="w-[96px]" label="Words" inputMode="numeric" value={String(r.words)} onChange={(e) => update(r.id, { words: Number(e.target.value) || 0 })} /> : null}
                <Field className="w-[96px]" label="Weight" inputMode="numeric" value={String(r.weight)} onChange={(e) => update(r.id, { weight: Number(e.target.value) || 0 })} />
              </div>
            </div>
            {r.phrases ? <TextArea label="Phrases (comma-separated)" value={r.phrases.join(', ')} onChange={(e) => update(r.id, { phrases: e.target.value.split(',').map((p) => p.trim()) })} rows={2} /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
