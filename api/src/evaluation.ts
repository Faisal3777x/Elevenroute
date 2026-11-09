import type { Alert, ModelInfo, TestCase, TestResult, TestRun } from '../../shared/types.ts';
import { TEST_CASES } from './content.ts';
import { db, insertMany } from './db.ts';
import { liveCall, systemPrompt } from './providers.ts';
import { hasKey, type Workspace } from './store.ts';

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
  const penalty = (c.turnType === 'complex' ? (m.tier === 'fast' ? 0.07 : 0.02) : 0) + (c.language === 'es' && m.tier === 'fast' ? 0.01 : 0);
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

export async function runTests(ws: Workspace): Promise<TestRun> {
  const mode = ws.mode;
  const models = ws.models.filter((m) => m.enabled && (mode === 'demo' || hasKey(m.vendor)));
  const judge = [...ws.models].filter((m) => hasKey(m.vendor)).sort((a, b) => b.quality - a.quality)[0];
  if (mode === 'live' && !judge) throw new Error('Live mode needs at least one API key to run tests');

  const jobs = models.flatMap((m) => TEST_CASES.map((c) => async () => ({ m, c, j: mode === 'demo' ? simulatedJudge(m, c) : await liveJudge(m, c, judge) })));
  const judged = await pool(jobs, mode === 'demo' ? 64 : 6);

  const prev = await db.one<{ scores: Record<string, number> }>('select scores from test_runs where workspace_id = $1 order by id desc limit 1', [ws.id]);
  const prevScores = prev?.scores ?? {};
  const ts = Date.now();

  const scores: Record<string, number> = {};
  const segments: Record<string, Record<string, number[]>> = {};
  for (const { m, c, j } of judged) {
    const s = caseScore(j);
    ((segments[m.id] ??= {})[`${c.language}:${c.turnType}`] ??= []).push(s);
  }
  for (const m of models) scores[m.id] = avg(Object.values(segments[m.id] ?? {}).flat());

  // Decide new exclusions and alerts first, then write everything in one transaction.
  const alerts: unknown[][] = [];
  const { alertDropPct, exclusionFloor } = ws.strategy;
  const updates = models.map((m) => {
    const score = scores[m.id];
    const before = prevScores[m.id];
    if (before && (before - score) / before > alertDropPct / 100) {
      alerts.push([ws.id, ts, m.id, `${m.name} score dropped ${(((before - score) / before) * 100).toFixed(0)}% (${before.toFixed(2)} → ${score.toFixed(2)})`]);
    }
    const excluded = score < exclusionFloor;
    if (excluded && !m.excluded) alerts.push([ws.id, ts, m.id, `${m.name} excluded from routing: score ${score.toFixed(2)} < ${exclusionFloor}`]);
    if (!excluded && m.excluded) alerts.push([ws.id, ts, m.id, `${m.name} restored to routing: score ${score.toFixed(2)}`]);
    return { m, score, excluded, segs: Object.fromEntries(Object.entries(segments[m.id] ?? {}).map(([k, v]) => [k, avg(v)])) };
  });

  const runId = await db.tx(async (q) => {
    const id = (await q.one<{ id: number }>('insert into test_runs (workspace_id, ts, mode, scores) values ($1, $2, $3, $4::jsonb) returning id', [ws.id, ts, mode, JSON.stringify(scores)]))!.id;
    await insertMany(
      q,
      'test_results',
      ['run_id', 'workspace_id', 'model_id', 'case_id', 'use_case', 'language', 'turn_type', 'completed', 'accuracy', 'tone', 'latency_ms', 'score', 'reply'],
      judged.map(({ m, c, j }) => [id, ws.id, m.id, c.id, c.useCase, c.language, c.turnType, j.completed, j.accuracy, j.tone, j.latencyMs, caseScore(j), j.reply]),
    );
    if (alerts.length) await insertMany(q, 'alerts', ['workspace_id', 'ts', 'model_id', 'message'], alerts);
    return id;
  });

  for (const u of updates) {
    u.m.testScore = u.score;
    u.m.excluded = u.excluded;
    ws.segments[u.m.id] = u.segs;
  }
  await ws.save('models', 'segments');
  return { id: runId, ts, mode, scores };
}

export async function listRuns(ws: Workspace): Promise<TestRun[]> {
  return db.query<TestRun>('select id, ts, mode, scores from test_runs where workspace_id = $1 order by id desc limit 20', [ws.id]);
}

export async function listResults(ws: Workspace, runId?: number): Promise<TestResult[]> {
  const id = runId ?? (await db.one<{ id: number | null }>('select max(id) as id from test_runs where workspace_id = $1', [ws.id]))?.id;
  if (!id) return [];
  // workspace_id in the filter so a run id from another workspace returns nothing.
  return db.query<TestResult>(
    `select run_id as "runId", model_id as "modelId", case_id as "caseId", use_case as "useCase", language,
            turn_type as "turnType", completed, accuracy, tone, latency_ms as "latencyMs", score, reply
     from test_results where run_id = $1 and workspace_id = $2`,
    [id, ws.id],
  );
}

/**
 * Deletes every test run (its results cascade) and quality alert, and undoes what runs set: models go back to
 * their configured quality, segment scores are cleared, and no model stays excluded by a test.
 * Traffic, routing rules, policies and model settings are kept.
 */
export async function clearTests(ws: Workspace): Promise<{ deletedRuns: number }> {
  const deleted = await db.tx(async (q) => {
    const runs = await q.query('delete from test_runs where workspace_id = $1 returning 1', [ws.id]);
    await q.query('delete from alerts where workspace_id = $1', [ws.id]);
    return runs.length;
  });
  for (const m of ws.models) {
    m.testScore = null;
    m.excluded = false;
  }
  ws.segments = {};
  await ws.save('models', 'segments');
  return { deletedRuns: deleted };
}

export async function listAlerts(ws: Workspace): Promise<Alert[]> {
  return db.query<Alert>('select id, ts, model_id as "modelId", message from alerts where workspace_id = $1 order by id desc limit 50', [ws.id]);
}
