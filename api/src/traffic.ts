import type { Language, UseCase, Vendor, VendorState } from '../../shared/types.ts';
import { Breaker } from './breaker.ts';
import { runTurn, TURN_COLUMNS } from './chat.ts';
import { CONTENT, FOLLOW_UPS, USE_CASES } from './content.ts';
import { db, insertMany } from './db.ts';
import type { Workspace } from './store.ts';

const DAY = 86_400_000;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
function weighted<T>(entries: [T, number][]): T {
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries[entries.length - 1][0];
}

// Business-hours pattern: weight per hour of day.
const HOURS: [number, number][] = Array.from({ length: 24 }, (_, h) => [h, h >= 9 && h <= 17 ? 10 : h >= 7 && h <= 20 ? 4 : 0.6]);

interface Incident {
  vendor: Vendor;
  state: VendorState;
  start: number;
  end: number;
}

/** Two replayed incidents so failover history shows up. */
function incidents(now: number): Incident[] {
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  return [
    { vendor: 'google', state: 'down', start: at(9, 10), end: at(9, 13) },
    { vendor: 'openai', state: 'slow', start: at(3, 14), end: at(3, 16) },
  ];
}

/**
 * Sends synthetic multi-turn calls through the real router. Always uses the simulated
 * providers on a virtual clock, so it never spends API credit and finishes in about a second.
 */
export async function generateTraffic(ws: Workspace, count = 500): Promise<{ conversations: number; turns: number }> {
  const status = ws.traffic;
  if (status.running) throw new Error('Traffic generation is already running');
  Object.assign(status, { running: true, done: 0, total: count });
  const now = Date.now();
  const incs = incidents(now);
  const breaker = new Breaker(() => ws.strategy);
  const rows: unknown[][] = [];
  const tag = now.toString(36);

  const starts = Array.from({ length: count }, () => {
    const d = new Date(now - Math.floor(Math.random() * 14) * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    d.setHours(weighted(HOURS.map(([h, w]) => [h, weekend ? w * 0.35 : w])), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
    return Math.min(d.getTime(), now - 60_000);
  }).sort((a, b) => a - b);

  let turns = 0;
  try {
    for (let i = 0; i < count; i++) {
      const language = weighted<Language>([['en', 6], ['es', 4]]);
      const useCase: UseCase = pick(USE_CASES);
      const customer = 'default';
      const entry = CONTENT[useCase].langs[language];
      const first = Math.random() < 0.5 ? entry.simple : entry.complex;
      const messages = [first];
      const extra = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < extra; k++) messages.push(Math.random() < 0.25 ? (first === entry.simple ? entry.complex : entry.simple) : pick(FOLLOW_UPS[language]));

      for (let k = 0; k < messages.length; k++) {
        const ts = starts[i] + k * 40_000;
        const vendorStates: Record<Vendor, VendorState> = { openai: 'healthy', google: 'healthy', anthropic: 'healthy' };
        for (const inc of incs) if (ts >= inc.start && ts <= inc.end) vendorStates[inc.vendor] = inc.state;
        await runTurn(
          ws,
          { conversation_id: `syn-${tag}-${i}`, message: messages[k], language, use_case: useCase, customer_id: customer },
          { simulated: true, virtual: true, breaker, now: ts, vendorStates, synthetic: true, log: rows },
        );
        turns++;
      }
      status.done = i + 1;
    }
    // One transaction, a few multi-row statements: fast even against a hosted database.
    await db.tx((q) => insertMany(q, 'turns', TURN_COLUMNS, rows));
  } finally {
    status.running = false;
  }
  return { conversations: count, turns };
}

/**
 * Deletes the workspace's logged turns (synthetic and Playground) and forgets sticky conversations.
 * Models, routing rules, policies and test results are kept.
 */
export async function clearTraffic(ws: Workspace): Promise<{ deletedTurns: number }> {
  if (ws.traffic.running) throw new Error('Traffic generation is running; try again when it finishes');
  const rows = await db.query('delete from turns where workspace_id = $1 returning 1', [ws.id]);
  ws.pins.clear();
  Object.assign(ws.traffic, { done: 0, total: 0 });
  return { deletedTurns: rows.length };
}

export async function trafficStatus(ws: Workspace) {
  const row = await db.one<{ turns: number; conversations: number }>(
    'select count(*)::int as turns, count(distinct conversation_id)::int as conversations from turns where workspace_id = $1 and synthetic',
    [ws.id],
  );
  return { ...ws.traffic, ...row! };
}
