import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type {
  ChatRequest, ClassifierRule, CustomerPolicy, Language, LanguagePref, ModelInfo, PreviewResponse, Strategy, UseCase, Vendor, VendorState, WhatIfRequest,
} from '../../shared/types.ts';
import { AuthError, authEnabled, canUseLiveMode, demoOnly, userFromRequest } from './auth.ts';
import { runTurn } from './chat.ts';
import { LANGUAGES, TEST_CASES, USE_CASES } from './content.ts';
import { backend } from './db.ts';
import { clearTests, listAlerts, listResults, listRuns, runTests } from './evaluation.ts';
import { decide } from './router.ts';
import { overview, savings, whatIf, whatIfBaseline } from './stats.ts';
import { hasKey, openWorkspace, workspaceIdFor, workspaceInfo, type AuthUser, type Workspace } from './store.ts';
import { clearTraffic, generateTraffic, trafficStatus } from './traffic.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, unknown>;
interface Ctx {
  body: Body;
  params: Record<string, string>;
  query: URLSearchParams;
  user: AuthUser;
  /** The signed-in user's workspace; every read and write is scoped to it. */
  ws: Workspace;
}
type Handler = (ctx: Ctx) => unknown;

const VENDORS: Vendor[] = ['openai', 'google', 'anthropic'];
const STATES: VendorState[] = ['healthy', 'down', 'slow'];

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; open: boolean }[] = [];
/** Registers a route. Every route needs a signed-in user unless `open` is set. */
function route(method: string, path: string, handler: Handler, open = false) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, pattern, keys, handler, open });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new HttpError(400, `${field} must be one of ${allowed.join(', ')}`);
  return value as T;
}
function str(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${field} must be a non-empty string (max ${max} chars)`);
  return value;
}

function chatRequest(b: Body): ChatRequest {
  return {
    conversation_id: typeof b.conversation_id === 'string' && b.conversation_id ? b.conversation_id.slice(0, 100) : crypto.randomUUID(),
    message: str(b.message, 'message'),
    language: oneOf<Language>(b.language ?? 'en', LANGUAGES, 'language'),
    use_case: oneOf<UseCase>(b.use_case ?? 'faq', USE_CASES, 'use_case'),
    customer_id: typeof b.customer_id === 'string' ? b.customer_id : 'default',
  };
}

const MODEL_NUMBERS = ['costIn', 'costOut', 'latencyMs', 'errorRate', 'quality'] as const;
const MODEL_RANGES: Record<(typeof MODEL_NUMBERS)[number], { min: number; max: number; label: string }> = {
  costIn: { min: 0, max: 1000, label: 'Input price per 1k tokens' },
  costOut: { min: 0, max: 1000, label: 'Output price per 1k tokens' },
  latencyMs: { min: 1, max: 120_000, label: 'Latency' },
  errorRate: { min: 0, max: 1, label: 'Error rate' },
  quality: { min: 0, max: 1, label: 'Quality' },
};
function applyModelFields(m: ModelInfo, b: Body): void {
  // Validate every number before changing anything, so a bad field never leaves a half-edited model.
  const nums: Partial<Record<(typeof MODEL_NUMBERS)[number], number>> = {};
  for (const k of MODEL_NUMBERS) {
    if (b[k] === undefined) continue;
    const r = MODEL_RANGES[k];
    const v = typeof b[k] === 'string' && !(b[k] as string).trim() ? NaN : Number(b[k]);
    if (!Number.isFinite(v) || v < r.min || v > r.max) throw new HttpError(400, `${r.label} must be between ${r.min} and ${r.max}`);
    nums[k] = v;
  }
  Object.assign(m, nums);
  if (typeof b.name === 'string' && b.name.trim()) m.name = b.name.trim();
  if (typeof b.liveModel === 'string' && b.liveModel.trim()) m.liveModel = b.liveModel.trim();
  if (typeof b.enabled === 'boolean') m.enabled = b.enabled;
  if (b.tier !== undefined) m.tier = oneOf(b.tier, ['flagship', 'fast'] as const, 'tier');
  if (Array.isArray(b.regions)) m.regions = b.regions.filter((r): r is 'US' | 'EU' => r === 'US' || r === 'EU');
  if (Array.isArray(b.languages)) m.languages = b.languages.filter((l): l is Language => LANGUAGES.includes(l as Language));
}

function vendorStatuses(ws: Workspace) {
  return VENDORS.map((vendor) => ({ vendor, state: ws.vendorStates[vendor], breakerOpen: ws.breaker.isOpen(vendor), hasKey: hasKey(vendor) }));
}

// ---- routes ----
route('GET', '/health', () => ({ ok: true }), true);
route('GET', '/me', async ({ user, ws }) => ({
  user,
  workspace: await workspaceInfo(ws.id),
  auth: authEnabled ? 'supabase' : 'off',
  database: backend,
}));
route('GET', '/config', ({ ws, user }) => ({ mode: ws.mode, keys: Object.fromEntries(VENDORS.map((v) => [v, hasKey(v)])), liveAllowed: canUseLiveMode(user) }));
route('POST', '/mode', async ({ body, ws, user }) => {
  const mode = oneOf(body.mode, ['demo', 'live'] as const, 'mode');
  if (mode === 'live' && !canUseLiveMode(user)) {
    throw new HttpError(403, demoOnly
      ? 'Live mode is locked on this shared server (DEMO_ONLY): everyone shares one workspace, so nobody can spend its API keys'
      : 'Live mode spends real API credit; ask an admin to add your email to LIVE_MODE_EMAILS');
  }
  ws.mode = mode;
  await ws.save('mode');
  ws.breaker.reset();
  return { mode: ws.mode };
});

route('POST', '/chat', ({ body, ws }) => runTurn(ws, chatRequest(body)));

route('POST', '/route/preview', ({ body, ws }): PreviewResponse => {
  const req = chatRequest(body);
  const t0 = performance.now();
  const d = decide(ws, { message: req.message, language: req.language, useCase: req.use_case, customerId: req.customer_id, requireKeys: ws.mode === 'live', breaker: ws.breaker });
  return {
    turn_type: d.classification.turnType,
    route_reason: d.reason,
    ranked: d.ranked.map((m) => m.id),
    trace: { classification: d.classification, policy: `${d.policy.name}: ${d.policy.note}`, qualityFloor: d.floor, candidates: d.candidates, attempts: [], sticky: false, overheadMs: performance.now() - t0 },
  };
});

const days = (q: URLSearchParams) => Math.min(90, Math.max(1, Number(q.get('days')) || 14));
route('GET', '/stats/overview', ({ query, ws }) => overview(ws, days(query)));
route('GET', '/stats/savings', ({ query, ws }) => savings(ws, days(query)));
route('GET', '/whatif/baseline', ({ ws }) => whatIfBaseline(ws));
route('POST', '/whatif/simulate', ({ body, ws }) => {
  const volume = body.volume === null || body.volume === undefined ? null : Number(body.volume);
  return whatIf(ws, {
    fromModel: str(body.fromModel, 'fromModel', 100),
    toModel: str(body.toModel, 'toModel', 100),
    share: Number(body.share) || 0,
    turnType: oneOf(body.turnType ?? 'all', ['simple', 'complex', 'all'] as const, 'turnType'),
    volume: volume !== null && Number.isFinite(volume) && volume > 0 ? volume : null,
  } satisfies WhatIfRequest);
});

route('GET', '/providers', ({ ws }) => ws.models);
route('POST', '/providers', async ({ body, ws }) => {
  const id = str(body.id, 'id', 60).toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  if (ws.models.some((m) => m.id === id)) throw new HttpError(409, `model ${id} already exists`);
  const m: ModelInfo = {
    id, name: str(body.name, 'name', 80), vendor: oneOf(body.vendor, VENDORS, 'vendor'), tier: 'fast', liveModel: id,
    regions: ['US'], languages: [...LANGUAGES], costIn: 0.001, costOut: 0.004, latencyMs: 800, errorRate: 0.01, quality: 0.8,
    enabled: true, testScore: null, excluded: false,
  };
  applyModelFields(m, body);
  ws.models.push(m);
  await ws.save('models');
  return m;
});
route('PATCH', '/providers/:id', async ({ body, params, ws }) => {
  const m = ws.models.find((x) => x.id === params.id);
  if (!m) throw new HttpError(404, 'model not found');
  applyModelFields(m, body);
  await ws.save('models');
  return m;
});
route('DELETE', '/providers/:id', async ({ params, ws }) => {
  const before = ws.models.length;
  ws.models = ws.models.filter((m) => m.id !== params.id);
  if (ws.models.length === before) throw new HttpError(404, 'model not found');
  await ws.save('models');
  return { ok: true };
});

route('GET', '/vendors', ({ ws }) => vendorStatuses(ws));
route('PUT', '/vendors/:vendor/state', ({ body, params, ws }) => {
  const vendor = oneOf(params.vendor, VENDORS, 'vendor');
  ws.vendorStates[vendor] = oneOf(body.state, STATES, 'state');
  return vendorStatuses(ws);
});

route('GET', '/routing', ({ ws }) => ws.routingConfig());
/** Allowed range per numeric strategy field; anything else is rejected before any field changes. */
const STRATEGY_RANGES: Record<string, { min: number; max: number; int?: boolean; label: string }> = {
  simpleQualityFloor: { min: 0, max: 1, label: 'Simple-turn quality floor' },
  exclusionFloor: { min: 0, max: 1, label: 'Test exclusion floor' },
  latencyBudgetMs: { min: 100, max: 120_000, int: true, label: 'Latency budget' },
  complexThreshold: { min: -20, max: 20, label: 'Complex threshold' },
  breakerFailures: { min: 1, max: 100, int: true, label: 'Breaker failures' },
  breakerWindowS: { min: 1, max: 3600, label: 'Breaker window' },
  breakerCooldownS: { min: 1, max: 3600, label: 'Breaker cooldown' },
  alertDropPct: { min: 0, max: 100, label: 'Alert on score drop' },
};
route('PUT', '/routing/strategy', async ({ body, ws }) => {
  const s = ws.strategy as unknown as Record<string, number | boolean>;
  const next: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in s)) continue;
    if (typeof s[k] === 'boolean') {
      if (typeof v !== 'boolean') throw new HttpError(400, `invalid value for ${k}`);
      next[k] = v;
      continue;
    }
    const r = STRATEGY_RANGES[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || (r && (v < r.min || v > r.max || (r.int && !Number.isInteger(v))))) {
      throw new HttpError(400, r ? `${r.label} must be ${r.int ? 'a whole number ' : ''}between ${r.min} and ${r.max}` : `invalid value for ${k}`);
    }
    next[k] = v;
  }
  Object.assign(s, next);
  await ws.save('strategy');
  return ws.strategy as Strategy;
});
route('PUT', '/routing/rules', async ({ body, ws }) => {
  if (!Array.isArray(body.rules)) throw new HttpError(400, 'rules must be an array');
  for (const r of body.rules as Partial<ClassifierRule>[]) {
    const rule = ws.rules.find((x) => x.id === r.id);
    if (!rule) continue;
    if (typeof r.weight === 'number' && Number.isFinite(r.weight)) rule.weight = r.weight;
    if (typeof r.enabled === 'boolean') rule.enabled = r.enabled;
    if (typeof r.words === 'number' && r.words > 0) rule.words = r.words;
    if (Array.isArray(r.phrases)) rule.phrases = r.phrases.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());
  }
  await ws.save('rules');
  return ws.rules;
});
route('PUT', '/routing/policies', async ({ body, ws }) => {
  if (!Array.isArray(body.policies)) throw new HttpError(400, 'policies must be an array');
  ws.policies = (body.policies as CustomerPolicy[]).map((p) => ({
    id: str(p.id, 'id', 60),
    name: str(p.name, 'name', 80),
    allowedVendors: Array.isArray(p.allowedVendors) ? p.allowedVendors.filter((v) => VENDORS.includes(v)) : null,
    region: p.region === 'US' || p.region === 'EU' ? p.region : null,
    qualityFloor: typeof p.qualityFloor === 'number' ? p.qualityFloor : null,
    note: typeof p.note === 'string' ? p.note : '',
  }));
  await ws.save('policies');
  return ws.policies;
});
route('PUT', '/routing/languages', async ({ body, ws }) => {
  if (!Array.isArray(body.languages)) throw new HttpError(400, 'languages must be an array');
  ws.languages = (body.languages as LanguagePref[]).map((l) => ({
    language: oneOf(l.language, LANGUAGES, 'language'),
    qualityFloor: typeof l.qualityFloor === 'number' ? l.qualityFloor : null,
    vendorOrder: Array.isArray(l.vendorOrder) ? l.vendorOrder.filter((v) => VENDORS.includes(v)) : [...VENDORS],
  }));
  await ws.save('languages');
  return ws.languages;
});

route('POST', '/tests/run', ({ ws }) => runTests(ws));
route('POST', '/tests/clear', ({ ws }) => clearTests(ws));
route('GET', '/tests/cases', () => TEST_CASES);
route('GET', '/tests/results', ({ query, ws }) => listResults(ws, query.get('run') ? Number(query.get('run')) : undefined));
route('GET', '/tests/runs', ({ ws }) => listRuns(ws));
route('GET', '/alerts', ({ ws }) => listAlerts(ws));

route('POST', '/traffic/generate', ({ body, ws }) => generateTraffic(ws, Math.min(2000, Math.max(1, Number(body.count) || 500))));
route('GET', '/traffic/status', ({ ws }) => trafficStatus(ws));
route('POST', '/traffic/clear', ({ ws }) => clearTraffic(ws));

route('POST', '/reset', async ({ ws }) => {
  await ws.reset();
  return { ok: true };
});

// ---- server ----
async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, 'body too large');
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ---- sharing: password gate and the built web dashboard ----
const sha = (s: string) => createHash('sha256').update(s).digest();

/** HTTP Basic auth: any username, the shared password. Compared in constant time. */
function authorized(req: IncomingMessage, password: string): boolean {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  return timingSafeEqual(sha(decoded.slice(decoded.indexOf(':') + 1)), sha(password));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/** A file inside root for this URL path, or null. Never resolves outside root. */
async function staticFile(root: string, pathname: string): Promise<string | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(root, `.${rel}`);
  if (!file.startsWith(root + sep)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function sendFile(res: ServerResponse, file: string, immutable: boolean) {
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(await readFile(file));
}

/** Arrived through a tunnel or reverse proxy (Cloudflare adds cf-connecting-ip; others add forwarding headers). */
const proxied = (req: IncomingMessage) => ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'forwarded'].some((h) => h in req.headers);

export interface AppOptions {
  /**
   * Share-mode password (HTTP Basic auth, any username) for requests through a tunnel or proxy, except /health.
   * Only used while sign-in is off: with Supabase auth on, every API call already needs a signed-in user,
   * and the Authorization header carries the user's token instead.
   */
  password?: string;
  requirePasswordLocally?: boolean;
  /** Folder with the built web dashboard (web/dist). When set, the dashboard is served from this server. */
  webDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const webDir = options.webDir ? resolve(options.webDir) : undefined;
  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    const guarded = !authEnabled && options.password && url.pathname !== '/health' && (options.requirePasswordLocally || proxied(req));
    if (guarded && !authorized(req, options.password!)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Basic realm="ElevenRoute", charset="UTF-8"' });
      return void res.end(JSON.stringify({ error: 'password required' }));
    }

    // The dashboard calls the API under /api/...; the phone app and scripts use the bare paths.
    let path = url.pathname;
    if (path === '/api' || path.startsWith('/api/')) path = path.slice(4) || '/';
    else if (webDir && req.method === 'GET') {
      const file = await staticFile(webDir, path);
      if (file) return void (await sendFile(res, file, path.startsWith('/assets/')));
      // Page loads and refreshes (e.g. /providers) get the app; API clients asking for JSON fall through.
      if ((req.headers.accept ?? '').includes('text/html')) return void (await sendFile(res, resolve(webDir, 'index.html'), false));
    }

    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(path);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let user = null as unknown as AuthUser;
        let ws = null as unknown as Workspace;
        if (!r.open) {
          user = await userFromRequest(req);
          ws = await openWorkspace(await workspaceIdFor(user));
          // A workspace left in live mode by someone who may no longer use it (e.g. DEMO_ONLY) drops back to demo.
          if (ws.mode === 'live' && !canUseLiveMode(user)) {
            ws.mode = 'demo';
            await ws.save('mode');
          }
        }
        const body = req.method === 'GET' ? {} : await readBody(req);
        return send(res, 200, await r.handler({ body, params, query: url.searchParams, user, ws }));
      }
      send(res, 404, { error: `no route for ${req.method} ${path}` });
    } catch (err) {
      const status = err instanceof AuthError ? 401 : err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: err instanceof Error ? err.message : 'internal error' });
    }
  });
}
