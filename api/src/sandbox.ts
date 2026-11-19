// Private sandboxes for open-access hosting (sign-in off and DEMO_ONLY=1, as on the public site).
//
// Without sign-in every visitor would share one workspace, so anyone could reset or edit it for everybody. Instead the
// shared demo is read-only to the public, and a visitor's first change copies it into a sandbox of their own, keyed by
// a random visitor id their browser keeps (x-visitor-id). Their edits, resets and traffic then touch only that copy.
// Idle sandboxes are deleted after SANDBOX_TTL_HOURS; their count and creation rate are capped so nobody can fill the
// database. Only a request carrying ADMIN_TOKEN can change the shared demo itself.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { authEnabled, demoOnly } from './auth.ts';
import { TURN_COLUMNS } from './chat.ts';
import { db } from './db.ts';
import { forgetWorkspace, type Workspace } from './store.ts';

/** Sandboxes apply only with sign-in off and DEMO_ONLY set: with sign-in on, everyone already has their own workspace. */
export const sandboxesEnabled = !authEnabled && demoOnly;

const HOUR = 3_600_000;
const TTL_MS = (Number(process.env.SANDBOX_TTL_HOURS) || 48) * HOUR;
const MAX_SANDBOXES = Number(process.env.MAX_SANDBOXES) || 300;
// Per address, and a classroom shares one: room for a class, while MAX_SANDBOXES bounds the total.
const PER_IP_PER_DAY = Number(process.env.SANDBOXES_PER_IP_PER_DAY) || 40;

export class SandboxError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// A version-4 UUID, as the dashboard makes one: 122 random bits, so one visitor can't guess another's id.
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function visitorId(req: IncomingMessage): string | null {
  const v = req.headers['x-visitor-id'];
  return typeof v === 'string' && VISITOR_ID.test(v.toLowerCase()) ? v.toLowerCase() : null;
}

const sha = (s: string) => createHash('sha256').update(s).digest();

/** True when the request carries the server's ADMIN_TOKEN (compared in constant time). Admins edit the shared demo. */
export function isAdmin(req: IncomingMessage): boolean {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers['x-admin-token'];
  if (!token || token.length < 32 || typeof given !== 'string') return false;
  return timingSafeEqual(sha(given), sha(token));
}

// visitor id → sandbox workspace id, or null when the visitor has none (cached so reads don't query every time).
const sandboxOf = new Map<string, string | null>();

export async function findSandbox(visitor: string): Promise<string | null> {
  if (sandboxOf.has(visitor)) return sandboxOf.get(visitor)!;
  const row = await db.one<{ id: string }>(
    `select w.id from workspace_members m join workspaces w on w.id = m.workspace_id
     where m.user_id = $1 and w.sandbox_of is not null limit 1`,
    [visitor],
  );
  const id = row?.id ?? null;
  if (sandboxOf.size > 20_000) sandboxOf.clear();
  sandboxOf.set(visitor, id);
  return id;
}

// Sandboxes created per IP today (in memory; the window restarts with the process, which is fine for a cap).
const createdBy = new Map<string, { n: number; until: number }>();

/** Copies the shared demo (settings, traffic, test runs and alerts) into a new sandbox owned by this visitor. */
export async function createSandbox(base: Workspace, visitor: string, ip: string): Promise<string> {
  const now = Date.now();
  const mine = createdBy.get(ip);
  if (mine && mine.until > now && mine.n >= PER_IP_PER_DAY) {
    throw new SandboxError(429, 'Too many new sessions from your network today. Try again tomorrow.');
  }
  const { n } = (await db.one<{ n: number }>('select count(*)::int as n from workspaces where sandbox_of is not null'))!;
  if (n >= MAX_SANDBOXES) throw new SandboxError(503, 'The demo is very busy right now, so changes are paused. Try again later.');

  const cols = TURN_COLUMNS.filter((c) => c !== 'workspace_id').join(', ');
  const id = await db.tx(async (q) => {
    const ws = (await q.one<{ id: string }>(
      "insert into workspaces (name, sandbox_of) values ('Visitor sandbox', $1) returning id",
      [base.id],
    ))!.id;
    await q.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [ws, visitor]);
    await q.query('insert into workspace_settings (workspace_id, key, value) select $1, key, value from workspace_settings where workspace_id = $2', [ws, base.id]);
    await q.query(`insert into turns (workspace_id, ${cols}) select $1, ${cols} from turns where workspace_id = $2`, [ws, base.id]);
    const runs = await q.query<{ id: number }>('select id from test_runs where workspace_id = $1 order by id', [base.id]);
    for (const r of runs) {
      const copy = (await q.one<{ id: number }>(
        'insert into test_runs (workspace_id, ts, mode, scores) select $1, ts, mode, scores from test_runs where id = $2 returning id',
        [ws, r.id],
      ))!.id;
      await q.query(
        `insert into test_results (run_id, workspace_id, model_id, case_id, use_case, language, turn_type, completed, accuracy, tone, latency_ms, score, reply)
         select $1, $2, model_id, case_id, use_case, language, turn_type, completed, accuracy, tone, latency_ms, score, reply
         from test_results where run_id = $3`,
        [copy, ws, r.id],
      );
    }
    await q.query('insert into alerts (workspace_id, ts, model_id, message) select $1, ts, model_id, message from alerts where workspace_id = $2', [ws, base.id]);
    return ws;
  });
  createdBy.set(ip, mine && mine.until > now ? { n: mine.n + 1, until: mine.until } : { n: 1, until: now + 24 * HOUR });
  if (createdBy.size > 50_000) createdBy.clear();
  sandboxOf.set(visitor, id);
  return id;
}

/** Deletes a visitor's sandbox (their "Reset everything"): they are back on the shared demo. */
export async function deleteSandbox(ws: Workspace): Promise<void> {
  await db.query('delete from workspaces where id = $1 and sandbox_of is not null', [ws.id]);
  forget([ws.id]);
}

// last_seen_at is written at most every 10 minutes per sandbox, so reads don't turn into writes.
const touched = new Map<string, number>();
export function touchSandbox(id: string): void {
  const now = Date.now();
  if ((touched.get(id) ?? 0) > now - 10 * 60_000) return;
  touched.set(id, now);
  db.query('update workspaces set last_seen_at = now() where id = $1', [id]).catch((err) => console.error('sandbox touch failed', err));
}

function forget(ids: string[]): void {
  const gone = new Set(ids);
  for (const id of ids) {
    forgetWorkspace(id);
    touched.delete(id);
  }
  for (const [visitor, id] of sandboxOf) if (id && gone.has(id)) sandboxOf.set(visitor, null);
}

/** Deletes sandboxes idle for longer than the TTL. Returns how many went. */
export async function cleanupSandboxes(ttlMs = TTL_MS): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `delete from workspaces where sandbox_of is not null and last_seen_at < now() - ($1::float8 * interval '1 millisecond') returning id`,
    [ttlMs],
  );
  forget(rows.map((r) => r.id));
  return rows.length;
}

/** Runs the cleanup now and every hour (unref'd, so it never keeps the process alive). */
export function startSandboxCleanup(): void {
  const run = () => cleanupSandboxes().then((n) => n && console.log(`Deleted ${n} idle visitor sandbox(es)`)).catch((err) => console.error('sandbox cleanup failed', err));
  void run();
  setInterval(run, HOUR).unref();
}
