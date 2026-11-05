// Cached routing state. Config lives in SQLite (kv table) and is held in memory
// so a routing decision never touches the database.
import type {
  ClassifierRule, CustomerPolicy, LanguagePref, Mode, ModelInfo, RoutingConfig, Strategy, Vendor, VendorState,
} from '../../shared/types.ts';
import { db, kvGet, kvSet } from './db.ts';
import { seedLanguages, seedModels, seedPolicies, seedRules, seedStrategy } from './seed.ts';

const clone = <T>(v: T): T => structuredClone(v);

export const state = {
  models: kvGet<ModelInfo[]>('models') ?? clone(seedModels),
  strategy: kvGet<Strategy>('strategy') ?? clone(seedStrategy),
  rules: kvGet<ClassifierRule[]>('rules') ?? clone(seedRules),
  policies: kvGet<CustomerPolicy[]>('policies') ?? clone(seedPolicies),
  languages: kvGet<LanguagePref[]>('languages') ?? clone(seedLanguages),
  /** Per-model quality by "language:turnType" segment, from the latest test run. */
  segments: kvGet<Record<string, Record<string, number>>>('segments') ?? {},
  mode: (kvGet<Mode>('mode') ?? (process.env.MODE === 'live' ? 'live' : 'demo')) as Mode,
  vendorStates: { openai: 'healthy', google: 'healthy', anthropic: 'healthy' } as Record<Vendor, VendorState>,
};

export function save(key: 'models' | 'strategy' | 'rules' | 'policies' | 'languages' | 'segments' | 'mode'): void {
  kvSet(key, state[key]);
}

export function routingConfig(): RoutingConfig {
  return { strategy: state.strategy, rules: state.rules, policies: state.policies, languages: state.languages };
}

export const keyEnv: Record<Vendor, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export function hasKey(vendor: Vendor): boolean {
  return Boolean(process.env[keyEnv[vendor]]);
}

export function getModel(id: string): ModelInfo | undefined {
  return state.models.find((m) => m.id === id);
}

export function blendedCost(m: Pick<ModelInfo, 'costIn' | 'costOut'>): number {
  // Typical support turn: about 3 input tokens per output token.
  return (3 * m.costIn + m.costOut) / 4;
}

/** Quality used for routing: segment test score, else overall test score, else the configured estimate. */
export function effectiveQuality(m: ModelInfo, segment?: string): number {
  const seg = segment ? state.segments[m.id]?.[segment] : undefined;
  return seg ?? m.testScore ?? m.quality;
}

export function resetAll(): void {
  db.exec('DELETE FROM kv; DELETE FROM turns; DELETE FROM test_runs; DELETE FROM test_results; DELETE FROM alerts;');
  state.models = clone(seedModels);
  state.strategy = clone(seedStrategy);
  state.rules = clone(seedRules);
  state.policies = clone(seedPolicies);
  state.languages = clone(seedLanguages);
  state.segments = {};
  state.vendorStates = { openai: 'healthy', google: 'healthy', anthropic: 'healthy' };
}
