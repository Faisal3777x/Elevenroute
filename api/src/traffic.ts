import type { Language, UseCase, Vendor, VendorState } from '../../shared/types.ts';
import { Breaker } from './breaker.ts';
import { runTurn } from './chat.ts';
import { CONTENT, FOLLOW_UPS, USE_CASES } from './content.ts';
import { db } from './db.ts';

const DAY = 86_400_000;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
function weighted<T>(entries: [T, number][]): T {
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries[entries.length - 1][0];
}

// Business-hours pattern: weight per hour of day.
const HOURS: [number, number][] = Array.from({ length: 24 }, (_, h) => [h, h >= 9 && h <= 17 ? 10 : h >= 7 && h <= 20 ? 4 : 0.6]);

export const status = { running: false, done: 0, total: 0 };

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
export async function generateTraffic(count = 500): Promise<{ conversations: number; turns: number }> {
  if (status.running) throw new Error('Traffic generation is already running');
  Object.assign(status, { running: true, done: 0, total: count });
  const now = Date.now();
  const incs = incidents(now);
  const breaker = new Breaker();
  const tag = now.toString(36);

  const starts = Array.from({ length: count }, () => {
    const d = new Date(now - Math.floor(Math.random() * 14) * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    d.setHours(weighted(HOURS.map(([h, w]) => [h, weekend ? w * 0.35 : w])), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
    return Math.min(d.getTime(), now - 60_000);
  }).sort((a, b) => a - b);

  let turns = 0;
  db.exec('BEGIN');
  try {
    for (let i = 0; i < count; i++) {
      const language = weighted<Language>([['en', 6], ['es', 4]]);
      const useCase: UseCase = pick(USE_CASES);
      const customer = weighted([['default', 4], ['acme', 2], ['globex', 2.5], ['initech', 1.5]]);
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
          { conversation_id: `syn-${tag}-${i}`, message: messages[k], language, use_case: useCase, customer_id: customer },
          { simulated: true, virtual: true, breaker, now: ts, vendorStates, synthetic: true },
        );
        turns++;
      }
      status.done = i + 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    status.running = false;
  }
  return { conversations: count, turns };
}

export function trafficStatus() {
  const row = db.prepare('SELECT COUNT(*) AS turns, COUNT(DISTINCT conversation_id) AS conversations FROM turns WHERE synthetic = 1').get() as { turns: number; conversations: number };
  return { ...status, ...row };
}
