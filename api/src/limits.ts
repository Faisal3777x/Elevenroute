// Per-client request limits, so one address can't flood the API, fill the database or slow it for everyone.
// Fixed one-window counters in memory (one API process, as everywhere in this app).
import type { IncomingMessage } from 'node:http';

/**
 * The caller's address. Behind Render and Cloudflare (and the share tunnel) Cloudflare sets cf-connecting-ip and
 * overwrites any value a client sends; otherwise the rightmost x-forwarded-for entry (added by the nearest proxy, not
 * the client) or the socket address.
 */
export function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last || req.socket.remoteAddress || 'unknown';
}

export interface Limit {
  name: string;
  max: number;
  windowMs: number;
}

const MIN = 60_000;
// Limits are per address, and everyone on one Wi-Fi (a classroom, an office) shares an address. One visitor on the
// landing page makes about 64 calls a minute (its live demos), so these leave room for ~40 people behind one address
// while still stopping a script that floods the server.
/** Any API call. */
export const ALL: Limit = { name: 'all', max: Number(process.env.RATE_LIMIT_PER_MIN) || 3000, windowMs: MIN };
/** Anything that changes data (chat turns, agent turns, edits). */
export const WRITES: Limit = { name: 'writes', max: 600, windowMs: MIN };
/** Heavy jobs: generating traffic, running the test suite, resets. */
export const HEAVY: Limit = { name: 'heavy', max: 60, windowMs: 10 * MIN };

const counters = new Map<string, { n: number; reset: number }>();

/** Counts one hit; returns the seconds to wait when over the limit, else 0. */
export function hit(limit: Limit, ip: string, now = Date.now()): number {
  const key = `${limit.name}|${ip}`;
  let c = counters.get(key);
  if (!c || c.reset <= now) {
    if (counters.size > 100_000) prune(now);
    c = { n: 0, reset: now + limit.windowMs };
    counters.set(key, c);
  }
  c.n++;
  return c.n > limit.max ? Math.ceil((c.reset - now) / 1000) : 0;
}

function prune(now: number): void {
  for (const [k, c] of counters) if (c.reset <= now) counters.delete(k);
  if (counters.size > 100_000) counters.clear();
}

/** Clears every counter (tests). */
export function resetLimits(): void {
  counters.clear();
}
