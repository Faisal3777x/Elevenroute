import type { Alert, ModelInfo, TestCase, TestResult, TestRun } from '../../shared/types.ts';
import { TEST_CASES } from './content.ts';
import { db, transaction } from './db.ts';
import { liveCall, systemPrompt } from './providers.ts';
import { hasKey, save, state } from './store.ts';

interface Judged {
  reply: string;
  completed: boolean;
  accuracy: number;
  tone: number;
  latencyMs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const noise = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~N(0, 0.33), bounded

/** Demo judge: scores come from the model's simulated quality setting plus noise. */
function simulatedJudge(m: ModelInfo, c: TestCase): Judged {
  const penalty = (c.turnType === 'complex' ? (m.tier === 'fast' ? 0.07 : 0.02) : 0) + (c.language === 'ar' && m.tier === 'fast' ? 0.03 : 0);
  const q = m.quality - penalty;
  return {
    reply: '(simulated reply)',
    completed: Math.random() < clamp(q + 0.12, 0, 0.99),
    accuracy: clamp(q * 5 + noise() * 0.5, 0, 5),
    tone: clamp((q + 0.03) * 5 + noise() * 0.4, 0, 5),
    latencyMs: m.latencyMs * (0.7 + Math.random() * 0.6),
  };
}

/** Live judge: the strongest model with a key grades each reply. */
async function liveJudge(m: ModelInfo, c: TestCase, judge: ModelInfo): Promise<Judged> {
  const started = performance.now();
  let reply = '';
  try {
    reply = (await liveCall(m, systemPrompt(c.useCase, c.language), c.message, 30_000)).reply;
  } catch (err) {
    return { reply: `error: ${(err as Error).message}`, completed: false, accuracy: 0, tone: 0, latencyMs: performance.now() - started };
  }
  const latencyMs = performance.now() - started;
  const prompt = `Grade this customer-service reply.\nCustomer: ${c.message}\nExpected outcome: ${c.expected}\nReply: ${reply}\n\nAnswer with JSON only: {"completed": boolean, "accuracy": 0-5, "tone": 0-5}`;
  try {
    const out = (await liveCall(judge, 'You are a strict QA grader. Output JSON only.', prompt, 30_000)).reply;
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { completed?: boolean; accuracy?: number; tone?: number };
    return { reply, completed: Boolean(j.completed), accuracy: clamp(Number(j.accuracy) || 0, 0, 5), tone: clamp(Number(j.tone) || 0, 0, 5), latencyMs };
  } catch {
    return { reply, completed: false, accuracy: 0, tone: 0, latencyMs };
  }
}

async function pool<T>(items: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await items[i]();
      }
    }),
  );
  return out;
}

export const caseScore = (r: Pick<Judged, 'accuracy' | 'tone' | 'completed'>) => ((r.accuracy + r.tone) / 10) * (r.completed ? 1 : 0.6);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function runTests(): Promise<TestRun> {
  const mode = state.mode;
  const models = state.models.filter((m) => m.enabled && (mode === 'demo' || hasKey(m.vendor)));
  const judge = [...state.models].filter((m) => hasKey(m.vendor)).sort((a, b) => b.quality - a.quality)[0];
  if (mode === 'live' && !judge) throw new Error('Live mode needs at least one API key to run tests');

  const jobs = models.flatMap((m) => TEST_CASES.map((c) => async () => ({ m, c, j: mode === 'demo' ? simulatedJudge(m, c) : await liveJudge(m, c, judge) })));
  const judged = await pool(jobs, mode === 'demo' ? 64 : 6);

  const prev = db.prepare('SELECT scores FROM test_runs ORDER BY id DESC LIMIT 1').get() as { scores: string } | undefined;
  const prevScores: Record<string, number> = prev ? JSON.parse(prev.scores) : {};
  const ts = Date.now();

  const scores: Record<string, number> = {};
  const segments: Record<string, Record<string, number[]>> = {};
  for (const { m, c, j } of judged) {
    const s = caseScore(j);
    ((segments[m.id] ??= {})[`${c.language}:${c.turnType}`] ??= []).push(s);
  }
  for (const m of models) scores[m.id] = avg(Object.values(segments[m.id] ?? {}).flat());

  return transaction(() => {
    const runId = Number(db.prepare('INSERT INTO test_runs (ts, mode, scores) VALUES (?, ?, ?)').run(ts, mode, JSON.stringify(scores)).lastInsertRowid);
    const ins = db.prepare('INSERT INTO test_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const { m, c, j } of judged) {
      ins.run(runId, m.id, c.id, c.useCase, c.language, c.turnType, j.completed ? 1 : 0, j.accuracy, j.tone, j.latencyMs, caseScore(j), j.reply);
    }

    const alert = db.prepare('INSERT INTO alerts (ts, model_id, message) VALUES (?, ?, ?)');
    const { alertDropPct, exclusionFloor } = state.strategy;
    for (const m of models) {
      const score = scores[m.id];
      const before = prevScores[m.id];
      if (before && (before - score) / before > alertDropPct / 100) {
        alert.run(ts, m.id, `${m.name} score dropped ${(((before - score) / before) * 100).toFixed(0)}% (${before.toFixed(2)} → ${score.toFixed(2)})`);
      }
      const wasExcluded = m.excluded;
      m.testScore = score;
      m.excluded = score < exclusionFloor;
      if (m.excluded && !wasExcluded) alert.run(ts, m.id, `${m.name} excluded from routing: score ${score.toFixed(2)} < ${exclusionFloor}`);
      if (!m.excluded && wasExcluded) alert.run(ts, m.id, `${m.name} restored to routing: score ${score.toFixed(2)}`);
      state.segments[m.id] = Object.fromEntries(Object.entries(segments[m.id] ?? {}).map(([k, v]) => [k, avg(v)]));
    }
    save('models');
    save('segments');
    return { id: runId, ts, mode, scores };
  });
}

export function listRuns(): TestRun[] {
  return (db.prepare('SELECT * FROM test_runs ORDER BY id DESC LIMIT 20').all() as { id: number; ts: number; mode: 'demo' | 'live'; scores: string }[]).map((r) => ({
    ...r,
    scores: JSON.parse(r.scores),
  }));
}

export function listResults(runId?: number): TestResult[] {
  const id = runId ?? (db.prepare('SELECT MAX(id) AS id FROM test_runs').get() as { id: number | null }).id;
  if (!id) return [];
  return (db.prepare('SELECT * FROM test_results WHERE run_id = ?').all(id) as Record<string, any>[]).map((r) => ({
    runId: r.run_id,
    modelId: r.model_id,
    caseId: r.case_id,
    useCase: r.use_case,
    language: r.language,
    turnType: r.turn_type,
    completed: r.completed === 1,
    accuracy: r.accuracy,
    tone: r.tone,
    latencyMs: r.latency_ms,
    score: r.score,
    reply: r.reply,
  }));
}

export function listAlerts(): Alert[] {
  return (db.prepare('SELECT id, ts, model_id, message FROM alerts ORDER BY id DESC LIMIT 50').all() as Record<string, any>[]).map((r) => ({
    id: r.id,
    ts: r.ts,
    modelId: r.model_id,
    message: r.message,
  }));
}
