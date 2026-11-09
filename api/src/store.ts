// Workspaces and their cached routing state. Each user's data lives in their workspace. Config is stored
// in workspace_settings and held in memory per workspace, so a routing decision never touches the database.
import type {
  ClassifierRule, CustomerPolicy, LanguagePref, Mode, ModelInfo, RoutingConfig, Strategy, Vendor, VendorState,
} from '../../shared/types.ts';
import { Breaker } from './breaker.ts';
import { db } from './db.ts';
import { seedLanguages, seedModels, seedPolicies, seedRules, seedStrategy } from './seed.ts';

const clone = <T>(v: T): T => structuredClone(v);

export const SETTING_KEYS = ['models', 'strategy', 'rules', 'policies', 'languages', 'segments', 'mode'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const healthy = (): Record<Vendor, VendorState> => ({ openai: 'healthy', google: 'healthy', anthropic: 'healthy' });

export class Workspace {
  models: ModelInfo[] = clone(seedModels);
  strategy: Strategy = clone(seedStrategy);
  rules: ClassifierRule[] = clone(seedRules);
  policies: CustomerPolicy[] = clone(seedPolicies);
  languages: LanguagePref[] = clone(seedLanguages);
  /** Per-model quality by "language:turnType" segment, from the latest test run. */
  segments: Record<string, Record<string, number>> = {};
  mode: Mode = 'demo';

  // In-process only (not persisted): simulated outage switches, sticky pins, live circuit breaker, traffic job.
  vendorStates = healthy();
  readonly pins = new Map<string, string>();
  readonly breaker = new Breaker(() => this.strategy);
  readonly traffic = { running: false, done: 0, total: 0 };

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  getModel(id: string): ModelInfo | undefined {
    return this.models.find((m) => m.id === id);
  }

  /** Quality used for routing: segment test score, else overall test score, else the configured estimate. */
  effectiveQuality(m: ModelInfo, segment?: string): number {
    const seg = segment ? this.segments[m.id]?.[segment] : undefined;
    return seg ?? m.testScore ?? m.quality;
  }

  routingConfig(): RoutingConfig {
    return { strategy: this.strategy, rules: this.rules, policies: this.policies, languages: this.languages };
  }

  async save(...keys: SettingKey[]): Promise<void> {
    for (const key of keys) {
      await db.query(
        `insert into workspace_settings (workspace_id, key, value) values ($1, $2, $3::jsonb)
         on conflict (workspace_id, key) do update set value = excluded.value, updated_at = now()`,
        [this.id, key, JSON.stringify(this[key])],
      );
    }
  }

  /** Restores the seed configuration and deletes this workspace's traffic, tests and alerts. */
  async reset(): Promise<void> {
    await db.tx(async (q) => {
      for (const table of ['workspace_settings', 'turns', 'test_runs', 'alerts']) await q.query(`delete from ${table} where workspace_id = $1`, [this.id]);
    });
    const fresh = new Workspace(this.id);
    for (const key of SETTING_KEYS) (this as any)[key] = fresh[key];
    this.vendorStates = healthy();
    this.pins.clear();
    this.breaker.reset();
  }
}

// ---- loading and caching (one instance per workspace in this process) ----
const cache = new Map<string, Promise<Workspace>>();

export function openWorkspace(id: string): Promise<Workspace> {
  let ws = cache.get(id);
  if (!ws) {
    ws = load(id);
    cache.set(id, ws);
    ws.catch(() => cache.delete(id));
  }
  return ws;
}

async function load(id: string): Promise<Workspace> {
  const ws = new Workspace(id);
  const rows = await db.query<{ key: SettingKey; value: unknown }>('select key, value from workspace_settings where workspace_id = $1', [id]);
  for (const r of rows) if ((SETTING_KEYS as readonly string[]).includes(r.key)) (ws as any)[r.key] = r.value;
  ws.strategy = { ...clone(seedStrategy), ...ws.strategy };
  return ws;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

const userWorkspace = new Map<string, string>();

/** The user's workspace id, creating a personal workspace (seeded with the demo setup) on first use. */
export async function workspaceIdFor(user: AuthUser): Promise<string> {
  const cached = userWorkspace.get(user.id);
  if (cached) return cached;
  const found = await db.one<{ workspace_id: string }>(
    'select workspace_id from workspace_members where user_id = $1 order by created_at limit 1',
    [user.id],
  );
  let id = found?.workspace_id;
  if (!id) {
    const name = `${user.email ? user.email.split('@')[0] : 'My'}'s workspace`;
    id = await db.tx(async (q) => {
      const ws = (await q.one<{ id: string }>('insert into workspaces (name) values ($1) returning id', [name]))!.id;
      await q.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [ws, user.id]);
      return ws;
    });
  }
  userWorkspace.set(user.id, id);
  return id;
}

export async function workspaceInfo(id: string): Promise<{ id: string; name: string }> {
  return (await db.one<{ id: string; name: string }>('select id, name from workspaces where id = $1', [id]))!;
}

// ---- API keys (server-wide, from the environment only) ----
export const keyEnv: Record<Vendor, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export function hasKey(vendor: Vendor): boolean {
  return Boolean(process.env[keyEnv[vendor]]);
}

export function blendedCost(m: Pick<ModelInfo, 'costIn' | 'costOut'>): number {
  // Typical support turn: about 3 input tokens per output token.
  return (3 * m.costIn + m.costOut) / 4;
}
