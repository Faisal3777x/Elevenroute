import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type {
  AgentTurnRequest, ChatRequest, ClassifierRule, CustomerPolicy, Language, LanguagePref, ModelInfo, PreviewResponse, Strategy, UseCase, Vendor, VendorState, WhatIfRequest,
} from '../../shared/types.ts';
import { AGENT_SCENARIO_IDS, agentScenarios, agentTurn } from './agent.ts';
import { AuthError, authEnabled, canUseLiveMode, demoOnly, userFromRequest } from './auth.ts';
import { runTurn } from './chat.ts';
import { LANGUAGES, TEST_CASES, USE_CASES } from './content.ts';
import { backend, db } from './db.ts';
import { ALL, clientIp, HEAVY, hit, WRITES } from './limits.ts';
import { createSandbox, deleteSandbox, findSandbox, isAdmin, SandboxError, sandboxesEnabled, touchSandbox, visitorId } from './sandbox.ts';
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

/** A number within [min, max] (whole when `int`), or a 400. */
function num(value: unknown, field: string, min: number, max: number, int = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (int && !Number.isInteger(value))) {
    throw new HttpError(400, `${field} must be ${int ? 'a whole number ' : ''}between ${min} and ${max}`);
  }
  return value;
}
/** An array of at most `max` items, or a 400. */
function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array`);
  if (value.length > max) throw new HttpError(400, `${field} can have at most ${max} items`);
  return value;
}
/** customer_id picks a routing policy; unknown ids fall back to the default one. Kept short: it is logged on every turn. */
const customerId = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 60) : 'default');

function chatRequest(b: Body): ChatRequest {
  return {
    conversation_id: typeof b.conversation_id === 'string' && b.conversation_id ? b.conversation_id.slice(0, 100) : crypto.randomUUID(),
    message: str(b.message, 'message'),
    language: oneOf<Language>(b.language ?? 'en', LANGUAGES, 'language'),
    use_case: oneOf<UseCase>(b.use_case ?? 'faq', USE_CASES, 'use_case'),
    customer_id: customerId(b.customer_id),
  };
}

const MAX_MODELS = 40;

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
  if (typeof b.name === 'string' && b.name.trim().length > 80) throw new HttpError(400, 'name can be at most 80 characters');
  if (typeof b.liveModel === 'string' && b.liveModel.trim().length > 100) throw new HttpError(400, 'liveModel can be at most 100 characters');
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

// ElevenAgent: a stateful conversation on top of the router. Simulated providers and connectors only.
route('GET', '/agent/scenarios', () => agentScenarios());
function agentRequest(ws: Workspace, body: Body): AgentTurnRequest {
  const req: AgentTurnRequest = {
    session_id: str(body.session_id, 'session_id', 100),
    scenario: oneOf(body.scenario, AGENT_SCENARIO_IDS, 'scenario'),
    language: oneOf<Language>(body.language ?? 'en', LANGUAGES, 'language'),
    customer_id: customerId(body.customer_id),
    message: str(body.message, 'message'),
  };
  const session = ws.agentSessions.get(req.session_id);
  if (session && session.scenario !== req.scenario) throw new HttpError(400, 'This conversation belongs to another scenario. Start a new one.');
  if (session && session.status !== 'active') throw new HttpError(409, 'This conversation is finished. Start a new one.');
  return req;
}
route('POST', '/agent/turn', ({ body, ws }) => agentTurn(ws, agentRequest(ws, body)));
// The same turn as a dry run (the landing page's live stage): nothing is logged and nothing waits.
route('POST', '/agent/preview', ({ body, ws }) => agentTurn(ws, agentRequest(ws, body), { dry: true }));

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
  if (ws.models.length >= MAX_MODELS) throw new HttpError(400, `A workspace can have at most ${MAX_MODELS} models`);
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
    // Own fields only: `in` would also accept inherited names such as "toString" or "constructor".
    if (!Object.hasOwn(s, k)) continue;
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
  const rules = list(body.rules, 'rules', 100) as Partial<ClassifierRule>[];
  // Validate every rule before changing any, so a bad one never leaves a half-applied edit.
  const edits = rules.map((r) => {
    const rule = r && typeof r === 'object' ? ws.rules.find((x) => x.id === r.id) : undefined;
    if (!rule) return null;
    const phrases = r.phrases === undefined ? undefined : list(r.phrases, 'phrases', 200)
      .filter((p): p is string => typeof p === 'string' && Boolean(p.trim()))
      .map((p) => {
        if (p.trim().length > 100) throw new HttpError(400, 'Each phrase can be at most 100 characters');
        return p.trim();
      });
    return {
      rule,
      weight: r.weight === undefined ? undefined : num(r.weight, 'Rule weight', -20, 20),
      enabled: typeof r.enabled === 'boolean' ? r.enabled : undefined,
      words: r.words === undefined ? undefined : num(r.words, 'Word count', 1, 1000),
      phrases,
    };
  });
  for (const e of edits) {
    if (!e) continue;
    if (e.weight !== undefined) e.rule.weight = e.weight;
    if (e.enabled !== undefined) e.rule.enabled = e.enabled;
    if (e.words !== undefined) e.rule.words = e.words;
    if (e.phrases) e.rule.phrases = e.phrases;
  }
  await ws.save('rules');
  return ws.rules;
});
route('PUT', '/routing/policies', async ({ body, ws }) => {
  ws.policies = (list(body.policies, 'policies', 50) as CustomerPolicy[]).map((p) => {
    if (!p || typeof p !== 'object') throw new HttpError(400, 'each policy must be an object');
    if (typeof p.note === 'string' && p.note.length > 300) throw new HttpError(400, 'A policy note can be at most 300 characters');
    return {
      id: str(p.id, 'id', 60),
      name: str(p.name, 'name', 80),
      allowedVendors: Array.isArray(p.allowedVendors) ? p.allowedVendors.filter((v) => VENDORS.includes(v)) : null,
      region: p.region === 'US' || p.region === 'EU' ? p.region : null,
      qualityFloor: p.qualityFloor === null || p.qualityFloor === undefined ? null : num(p.qualityFloor, 'Quality floor', 0, 1),
      note: typeof p.note === 'string' ? p.note : '',
    };
  });
  await ws.save('policies');
  return ws.policies;
});
route('PUT', '/routing/languages', async ({ body, ws }) => {
  ws.languages = (list(body.languages, 'languages', 10) as LanguagePref[]).map((l) => ({
    language: oneOf(l?.language, LANGUAGES, 'language'),
    qualityFloor: l.qualityFloor === null || l.qualityFloor === undefined ? null : num(l.qualityFloor, 'Quality floor', 0, 1),
    vendorOrder: Array.isArray(l.vendorOrder) ? l.vendorOrder.filter((v) => VENDORS.includes(v)) : [...VENDORS],
  }));
  await ws.save('languages');
  return ws.languages;
});

route('POST', '/tests/run', ({ ws }) => runTests(ws));
route('POST', '/tests/clear', ({ ws }) => clearTests(ws));
route('GET', '/tests/cases', () => TEST_CASES);
route('GET', '/tests/results', ({ query, ws }) => {
  const run = query.get('run');
  if (run && !/^\d{1,9}$/.test(run)) throw new HttpError(400, 'run must be a test run id');
  return listResults(ws, run ? Number(run) : undefined);
});
route('GET', '/tests/runs', ({ ws }) => listRuns(ws));
route('GET', '/alerts', ({ ws }) => listAlerts(ws));

/** Turns a visitor's sandbox may hold before generating more traffic is refused (about ten "Generate traffic" clicks). */
const SANDBOX_MAX_TURNS = 20_000;
route('POST', '/traffic/generate', async ({ body, ws }) => {
  if (ws.sandboxOf) {
    const { n } = (await db.one<{ n: number }>('select count(*)::int as n from turns where workspace_id = $1', [ws.id]))!;
    if (n >= SANDBOX_MAX_TURNS) throw new HttpError(409, 'That is plenty of traffic. Reset traffic first, then generate more.');
  }
  return generateTraffic(ws, Math.min(2000, Math.max(1, Number(body.count) || 500)));
});
route('GET', '/traffic/status', ({ ws }) => trafficStatus(ws));
route('POST', '/traffic/clear', ({ ws }) => clearTraffic(ws));

route('POST', '/reset', async ({ ws }) => {
  // A visitor's "Reset everything" deletes their sandbox, which puts them back on the shared demo's starting data.
  if (ws.sandboxOf) await deleteSandbox(ws);
  else await ws.reset();
  return { ok: true };
});

// ---- server ----
/** The largest request body accepted. The biggest real one (every routing rule with its phrases) is a few kilobytes. */
const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
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
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
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

/**
 * Streams a file. Honours a single byte range (206), which browsers need to play and seek video (Safari won't play an
 * MP4 without it), and sends a Last-Modified so a revisit can be answered with 304 instead of the whole file.
 */
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, immutable: boolean) {
  const { size, mtime } = await stat(file);
  const modified = mtime.toUTCString();
  const headers: Record<string, string | number> = {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': modified,
    'accept-ranges': 'bytes',
  };
  if (headers['content-type'].toString().startsWith('text/html')) headers['content-security-policy'] = contentSecurityPolicy(file);
  if (req.headers['if-modified-since'] === modified && !req.headers.range) return void res.writeHead(304, headers).end();
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return void res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (size === 0) return void res.end();
  await pipeline(createReadStream(file, { start, end }), res).catch(() => res.destroy());
}

// ---- security headers ----

/**
 * Content-Security-Policy for an HTML page: scripts only from this site plus the page's own inline scripts (allowed by
 * hash, computed from the built file so it always matches), nothing from other sites except the YouTube ad option and
 * Supabase sign-in, no plugins, and no framing by other sites. Blocks injected scripts even if one ever slipped in.
 */
const cspCache = new Map<string, { mtime: number; csp: string }>();
function contentSecurityPolicy(file: string): string {
  const mtime = statSync(file).mtimeMs;
  const cached = cspCache.get(file);
  if (cached && cached.mtime === mtime) return cached.csp;
  const html = readFileSync(file, 'utf8');
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    // Browsers hash the script text after turning CRLF into LF (files built on Windows have CRLF).
    .map((m) => `'sha256-${createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  cspCache.set(file, { mtime, csp });
  return csp;
}

/** Origins allowed to call the API from a browser (CORS_ORIGINS, comma-separated). Unset: any origin (local development). */
const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

function setCommonHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!corsOrigins.length) res.setHeader('access-control-allow-origin', '*');
  else if (origin && corsOrigins.includes(origin)) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-visitor-id, x-admin-token');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  // HTTPS only (the hosted site): browsers then refuse plain-HTTP connections to the site for a year.
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

/** POSTs that change nothing (dry runs and simulations): they can run against the shared demo. Mirrors web/src/lib/api.ts. */
const READ_ONLY_POSTS = new Set(['/route/preview', '/whatif/simulate', '/agent/preview']);
/** Expensive or destructive calls, limited harder (limits.ts HEAVY). */
const HEAVY_PATHS = new Set(['/traffic/generate', '/traffic/clear', '/tests/run', '/tests/clear', '/reset']);

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
    setCommonHeaders(req, res);
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
      if (file) return void (await sendFile(req, res, file, path.startsWith('/assets/')));
      // Page loads and refreshes (e.g. /providers) get the app; API clients asking for JSON fall through.
      if ((req.headers.accept ?? '').includes('text/html')) return void (await sendFile(req, res, resolve(webDir, 'index.html'), false));
    }

    try {
      const ip = clientIp(req);
      const admin = isAdmin(req);
      // Admin-only diagnostic: which address the rate limits see, and the forwarding headers the host sends.
      if (admin && path === '/admin/client-ip') {
        const fwd = Object.fromEntries(Object.entries(req.headers).filter(([k]) => /forwarded|client-ip|real-ip|connecting-ip|^cf-|^rndr-|^true-/i.test(k)));
        return send(res, 200, { ip, socket: req.socket.remoteAddress, headers: fwd });
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(path);
        if (!m) continue;
        let params: Record<string, string>;
        try {
          params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        } catch {
          throw new HttpError(400, 'malformed URL');
        }
        const writes = req.method !== 'GET' && !READ_ONLY_POSTS.has(path);
        if (!r.open && !admin) {
          const wait = hit(ALL, ip) || (writes ? hit(WRITES, ip) : 0) || (HEAVY_PATHS.has(path) ? hit(HEAVY, ip) : 0);
          if (wait) {
            res.setHeader('retry-after', String(wait));
            return send(res, 429, { error: `Too many requests. Try again in ${wait} s.` });
          }
        }
        let user = null as unknown as AuthUser;
        let ws = null as unknown as Workspace;
        if (!r.open) {
          user = await userFromRequest(req);
          ws = await openWorkspace(await workspaceIdFor(user));
          // Open access: the shared demo is read-only to the public; each visitor's changes go to their own sandbox.
          if (sandboxesEnabled && !admin) {
            const visitor = visitorId(req);
            const sandbox = visitor ? await findSandbox(visitor) : null;
            if (sandbox) {
              ws = await openWorkspace(sandbox);
              touchSandbox(sandbox);
            } else if (writes) {
              if (!visitor) throw new HttpError(403, 'Open the site in a browser to make changes.');
              // Nothing of theirs to reset yet: they are already on the starting data.
              if (path === '/reset') return send(res, 200, { ok: true });
              ws = await openWorkspace(await createSandbox(ws, visitor, ip));
            }
          }
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
      const status = err instanceof AuthError ? 401 : err instanceof HttpError || err instanceof SandboxError ? err.status : 500;
      if (status === 500) console.error(err);
      // Unexpected errors stay in the server log: their messages can name tables, files or code.
      send(res, status, { error: status === 500 ? 'Something went wrong on the server. Try again.' : err instanceof Error ? err.message : 'Request failed' });
    }
  });
}
