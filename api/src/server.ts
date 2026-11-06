import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type {
  ChatRequest, ClassifierRule, CustomerPolicy, Language, LanguagePref, ModelInfo, PreviewResponse, Strategy, UseCase, Vendor, VendorState, WhatIfRequest,
} from '../../shared/types.ts';
import { liveBreaker } from './breaker.ts';
import { runTurn } from './chat.ts';
import { LANGUAGES, TEST_CASES, USE_CASES } from './content.ts';
import { listAlerts, listResults, listRuns, runTests } from './evaluation.ts';
import { clearPins, decide } from './router.ts';
import { overview, savings, whatIf, whatIfBaseline } from './stats.ts';
import { hasKey, resetAll, routingConfig, save, state } from './store.ts';
import { clearTraffic, generateTraffic, trafficStatus } from './traffic.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, unknown>;
type Handler = (ctx: { body: Body; params: Record<string, string>; query: URLSearchParams }) => unknown;

const VENDORS: Vendor[] = ['openai', 'google', 'anthropic'];
const STATES: VendorState[] = ['healthy', 'down', 'slow'];

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, pattern, keys, handler });
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
function applyModelFields(m: ModelInfo, b: Body): void {
  for (const k of MODEL_NUMBERS) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, `${k} must be a non-negative number`);
    m[k] = v;
  }
  if (typeof b.name === 'string' && b.name.trim()) m.name = b.name.trim();
  if (typeof b.liveModel === 'string' && b.liveModel.trim()) m.liveModel = b.liveModel.trim();
  if (typeof b.enabled === 'boolean') m.enabled = b.enabled;
  if (b.tier !== undefined) m.tier = oneOf(b.tier, ['flagship', 'fast'] as const, 'tier');
  if (Array.isArray(b.regions)) m.regions = b.regions.filter((r): r is 'US' | 'EU' => r === 'US' || r === 'EU');
  if (Array.isArray(b.languages)) m.languages = b.languages.filter((l): l is Language => LANGUAGES.includes(l as Language));
}

function vendorStatuses() {
  return VENDORS.map((vendor) => ({ vendor, state: state.vendorStates[vendor], breakerOpen: liveBreaker.isOpen(vendor), hasKey: hasKey(vendor) }));
}

// ---- routes ----
route('GET', '/health', () => ({ ok: true }));
route('GET', '/config', () => ({ mode: state.mode, keys: Object.fromEntries(VENDORS.map((v) => [v, hasKey(v)])) }));
route('POST', '/mode', ({ body }) => {
  state.mode = oneOf(body.mode, ['demo', 'live'] as const, 'mode');
  save('mode');
  liveBreaker.reset();
  return { mode: state.mode };
});

route('POST', '/chat', ({ body }) => runTurn(chatRequest(body)));
route('POST', '/route/preview', ({ body }): PreviewResponse => {
  const req = chatRequest(body);
  const t0 = performance.now();
  const d = decide({ message: req.message, language: req.language, useCase: req.use_case, customerId: req.customer_id, requireKeys: state.mode === 'live', breaker: liveBreaker });
  return {
    turn_type: d.classification.turnType,
    route_reason: d.reason,
    ranked: d.ranked.map((m) => m.id),
    trace: { classification: d.classification, policy: `${d.policy.name}: ${d.policy.note}`, qualityFloor: d.floor, candidates: d.candidates, attempts: [], sticky: false, overheadMs: performance.now() - t0 },
  };
});

route('GET', '/stats/overview', ({ query }) => overview(Math.min(90, Math.max(1, Number(query.get('days')) || 14))));
route('GET', '/stats/savings', ({ query }) => savings(Math.min(90, Math.max(1, Number(query.get('days')) || 14))));
route('GET', '/whatif/baseline', () => whatIfBaseline());
route('POST', '/whatif/simulate', ({ body }) => {
  const volume = body.volume === null || body.volume === undefined ? null : Number(body.volume);
  return whatIf({
    fromModel: str(body.fromModel, 'fromModel', 100),
    toModel: str(body.toModel, 'toModel', 100),
    share: Number(body.share) || 0,
    turnType: oneOf(body.turnType ?? 'all', ['simple', 'complex', 'all'] as const, 'turnType'),
    volume: volume !== null && Number.isFinite(volume) && volume > 0 ? volume : null,
  } satisfies WhatIfRequest);
});

route('GET', '/providers', () => state.models);
route('POST', '/providers', ({ body }) => {
  const id = str(body.id, 'id', 60).toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  if (state.models.some((m) => m.id === id)) throw new HttpError(409, `model ${id} already exists`);
  const m: ModelInfo = {
    id, name: str(body.name, 'name', 80), vendor: oneOf(body.vendor, VENDORS, 'vendor'), tier: 'fast', liveModel: id,
    regions: ['US'], languages: [...LANGUAGES], costIn: 0.001, costOut: 0.004, latencyMs: 800, errorRate: 0.01, quality: 0.8,
    enabled: true, testScore: null, excluded: false,
  };
  applyModelFields(m, body);
  state.models.push(m);
  save('models');
  return m;
});
route('PATCH', '/providers/:id', ({ body, params }) => {
  const m = state.models.find((x) => x.id === params.id);
  if (!m) throw new HttpError(404, 'model not found');
  applyModelFields(m, body);
  save('models');
  return m;
});
route('DELETE', '/providers/:id', ({ params }) => {
  const before = state.models.length;
  state.models = state.models.filter((m) => m.id !== params.id);
  if (state.models.length === before) throw new HttpError(404, 'model not found');
  save('models');
  return { ok: true };
});

route('GET', '/vendors', () => vendorStatuses());
route('PUT', '/vendors/:vendor/state', ({ body, params }) => {
  const vendor = oneOf(params.vendor, VENDORS, 'vendor');
  state.vendorStates[vendor] = oneOf(body.state, STATES, 'state');
  return vendorStatuses();
});

route('GET', '/routing', () => routingConfig());
route('PUT', '/routing/strategy', ({ body }) => {
  const s = state.strategy as unknown as Record<string, number | boolean>;
  for (const [k, v] of Object.entries(body)) {
    if (!(k in s)) continue;
    if (typeof s[k] === 'boolean' && typeof v === 'boolean') s[k] = v;
    else if (typeof s[k] === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= 0) s[k] = v;
    else throw new HttpError(400, `invalid value for ${k}`);
  }
  save('strategy');
  return state.strategy as Strategy;
});
route('PUT', '/routing/rules', ({ body }) => {
  if (!Array.isArray(body.rules)) throw new HttpError(400, 'rules must be an array');
  for (const r of body.rules as Partial<ClassifierRule>[]) {
    const rule = state.rules.find((x) => x.id === r.id);
    if (!rule) continue;
    if (typeof r.weight === 'number' && Number.isFinite(r.weight)) rule.weight = r.weight;
    if (typeof r.enabled === 'boolean') rule.enabled = r.enabled;
    if (typeof r.words === 'number' && r.words > 0) rule.words = r.words;
    if (Array.isArray(r.phrases)) rule.phrases = r.phrases.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());
  }
  save('rules');
  return state.rules;
});
route('PUT', '/routing/policies', ({ body }) => {
  if (!Array.isArray(body.policies)) throw new HttpError(400, 'policies must be an array');
  state.policies = (body.policies as CustomerPolicy[]).map((p) => ({
    id: str(p.id, 'id', 60),
    name: str(p.name, 'name', 80),
    allowedVendors: Array.isArray(p.allowedVendors) ? p.allowedVendors.filter((v) => VENDORS.includes(v)) : null,
    region: p.region === 'US' || p.region === 'EU' ? p.region : null,
    qualityFloor: typeof p.qualityFloor === 'number' ? p.qualityFloor : null,
    note: typeof p.note === 'string' ? p.note : '',
  }));
  save('policies');
  return state.policies;
});
route('PUT', '/routing/languages', ({ body }) => {
  if (!Array.isArray(body.languages)) throw new HttpError(400, 'languages must be an array');
  state.languages = (body.languages as LanguagePref[]).map((l) => ({
    language: oneOf(l.language, LANGUAGES, 'language'),
    qualityFloor: typeof l.qualityFloor === 'number' ? l.qualityFloor : null,
    vendorOrder: Array.isArray(l.vendorOrder) ? l.vendorOrder.filter((v) => VENDORS.includes(v)) : [...VENDORS],
  }));
  save('languages');
  return state.languages;
});

route('POST', '/tests/run', () => runTests());
route('GET', '/tests/cases', () => TEST_CASES);
route('GET', '/tests/results', ({ query }) => listResults(query.get('run') ? Number(query.get('run')) : undefined));
route('GET', '/tests/runs', () => listRuns());
route('GET', '/alerts', () => listAlerts());

route('POST', '/traffic/generate', ({ body }) => generateTraffic(Math.min(2000, Math.max(1, Number(body.count) || 500))));
route('GET', '/traffic/status', () => trafficStatus());
route('POST', '/traffic/clear', () => clearTraffic());

route('POST', '/reset', () => {
  resetAll();
  clearPins();
  liveBreaker.reset();
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

export interface AppOptions {
  /** When set, every request except /health needs this password (HTTP Basic auth, any username). */
  password?: string;
  /** Folder with the built web dashboard (web/dist). When set, the dashboard is served from this server. */
  webDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const webDir = options.webDir ? resolve(options.webDir) : undefined;
  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (options.password && url.pathname !== '/health' && !authorized(req, options.password)) {
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
        const body = req.method === 'GET' ? {} : await readBody(req);
        return send(res, 200, await r.handler({ body, params, query: url.searchParams }));
      }
      send(res, 404, { error: `no route for ${req.method} ${path}` });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: err instanceof Error ? err.message : 'internal error' });
    }
  });
}
