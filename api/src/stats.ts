import type { Language, Overview, Savings, TurnType, WhatIfRequest, WhatIfResult } from '../../shared/types.ts';
import { db } from './db.ts';
import { costOf } from './providers.ts';
import { policyBlock, policyFor } from './router.ts';
import type { Workspace } from './store.ts';

const DAY = 86_400_000;
const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function p95(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

export async function overview(ws: Workspace, days = 14): Promise<Overview> {
  const now = Date.now();
  const since = now - days * DAY;
  const dayList = Array.from({ length: days }, (_, i) => dayKey(now - (days - 1 - i) * DAY));
  const dayIndex = new Map(dayList.map((d, i) => [d, i]));

  const rows = await db.query<{ ts: number; conversation_id: string; model_id: string | null; turn_type: TurnType; cost: number; latency_ms: number; overhead_ms: number; failover: boolean }>(
    'select ts, conversation_id, model_id, turn_type, cost, latency_ms, overhead_ms, failover from turns where workspace_id = $1 and ts >= $2',
    [ws.id, since],
  );

  const convs = new Set<string>();
  const costByModel = new Map<string, number[]>();
  const share = new Map<string, { simple: number; complex: number }>();
  const failoverDaily = new Array(days).fill(0) as number[];
  const requestsDaily = new Array(days).fill(0) as number[];
  const latencySumDaily = new Array(days).fill(0) as number[];
  let totalCost = 0;
  let failovers = 0;
  let latencySum = 0;

  for (const r of rows) {
    convs.add(r.conversation_id);
    totalCost += r.cost;
    latencySum += r.latency_ms;
    const di = dayIndex.get(dayKey(r.ts));
    if (di !== undefined) {
      requestsDaily[di]++;
      latencySumDaily[di] += r.latency_ms;
    }
    if (r.failover) {
      failovers++;
      if (di !== undefined) failoverDaily[di]++;
    }
    if (!r.model_id) continue;
    if (di !== undefined) {
      if (!costByModel.has(r.model_id)) costByModel.set(r.model_id, new Array(days).fill(0));
      costByModel.get(r.model_id)![di] += r.cost;
    }
    const s = share.get(r.model_id) ?? { simple: 0, complex: 0 };
    s[r.turn_type]++;
    share.set(r.model_id, s);
  }

  const recent = await db.query<{ ts: number; failover_from: string; model_id: string | null; failover_reason: string; language: Language }>(
    'select ts, failover_from, model_id, failover_reason, language from turns where workspace_id = $1 and failover order by ts desc limit 25',
    [ws.id],
  );

  return {
    requests: rows.length,
    conversations: convs.size,
    totalCost,
    costPerConversation: convs.size ? totalCost / convs.size : 0,
    failovers,
    avgLatencyMs: rows.length ? latencySum / rows.length : 0,
    p95LatencyMs: p95(rows.map((r) => r.latency_ms)),
    p95OverheadMs: p95(rows.map((r) => r.overhead_ms)),
    days: dayList,
    costByModel: [...costByModel].map(([modelId, values]) => ({ modelId, values })),
    share: [...share].map(([modelId, s]) => ({ modelId, ...s })),
    failoverDaily,
    requestsDaily,
    latencyDaily: latencySumDaily.map((s, i) => (requestsDaily[i] ? s / requestsDaily[i] : 0)),
    recentFailovers: recent.map((r) => ({ ts: r.ts, from: r.failover_from, to: r.model_id, reason: r.failover_reason, language: r.language })),
  };
}

interface Bucket {
  customer_id: string;
  model_id: string;
  turn_type: TurnType;
  language: Language;
  n: number;
  tin: number;
  tout: number;
}

async function loggedWindow(ws: Workspace) {
  const w = (await db.one<{ lo: number | null; hi: number | null; convs: number }>(
    'select min(ts) as lo, max(ts) as hi, count(distinct conversation_id)::int as convs from turns where workspace_id = $1',
    [ws.id],
  ))!;
  // Whole days from the first logged turn until now, so the rate matches what the Overview counts.
  const days = w.lo ? Math.max(1, Math.ceil((Date.now() - w.lo) / DAY)) : 1;
  return { days, convs: w.convs, monthly: (w.convs / days) * 30 };
}

/** Logged turns grouped by customer, model, turn type and language (token sums for re-pricing). */
function buckets(ws: Workspace, since = 0): Promise<Bucket[]> {
  return db.query<Bucket>(
    `select customer_id, model_id, turn_type, language, count(*)::int as n, sum(tokens_in)::float8 as tin, sum(tokens_out)::float8 as tout
     from turns where workspace_id = $1 and model_id is not null and ts >= $2
     group by customer_id, model_id, turn_type, language`,
    [ws.id, since],
  );
}

/** Logged tokens by model, turn type and customer, priced at today's prices per month. */
export async function whatIfBaseline(ws: Workspace) {
  const win = await loggedWindow(ws);
  const scale = win.convs ? win.monthly / win.convs : 0;
  const byModel = new Map<string, { turns: number; monthlyCost: number }>();
  for (const b of await buckets(ws)) {
    const m = ws.getModel(b.model_id);
    if (!m) continue;
    const e = byModel.get(b.model_id) ?? { turns: 0, monthlyCost: 0 };
    e.turns += b.n;
    e.monthlyCost += costOf(m, b.tin, b.tout) * scale;
    byModel.set(b.model_id, e);
  }
  return { monthlyConversations: win.monthly, models: [...byModel].map(([modelId, v]) => ({ modelId, ...v })) };
}

export async function whatIf(ws: Workspace, req: WhatIfRequest): Promise<WhatIfResult> {
  const win = await loggedWindow(ws);
  const from = ws.getModel(req.fromModel);
  const to = ws.getModel(req.toModel);
  const monthlyConversations = req.volume ?? win.monthly;
  const scale = win.convs ? monthlyConversations / win.convs : 0;
  const share = Math.min(1, Math.max(0, req.share));

  let current = 0;
  let projected = 0;
  let totalTurns = 0;
  let candidateTurns = 0;
  let blockedTurns = 0;
  let movedTurns = 0;
  let qFrom = 0;
  let qTo = 0;
  const alloc = new Map<string, { current: number; projected: number }>();
  const add = (id: string, key: 'current' | 'projected', v: number) => {
    const e = alloc.get(id) ?? { current: 0, projected: 0 };
    e[key] += v;
    alloc.set(id, e);
  };

  for (const b of await buckets(ws)) {
    const m = ws.getModel(b.model_id);
    if (!m) continue;
    const cost = costOf(m, b.tin, b.tout);
    current += cost;
    add(m.id, 'current', cost);
    totalTurns += b.n;
    const matches = from && to && b.model_id === from.id && (req.turnType === 'all' || b.turn_type === req.turnType);
    if (!matches) {
      projected += cost;
      add(m.id, 'projected', cost);
      continue;
    }
    candidateTurns += b.n;
    if (policyBlock(to, policyFor(ws, b.customer_id))) {
      blockedTurns += b.n;
      projected += cost;
      add(m.id, 'projected', cost);
      continue;
    }
    const moved = b.n * share;
    movedTurns += moved;
    const movedCost = costOf(to, b.tin * share, b.tout * share);
    projected += cost * (1 - share) + movedCost;
    add(m.id, 'projected', cost * (1 - share));
    add(to.id, 'projected', movedCost);
    const seg = `${b.language}:${b.turn_type}`;
    qFrom += ws.effectiveQuality(from, seg) * moved;
    qTo += ws.effectiveQuality(to, seg) * moved;
  }

  // Measured latency: average of logged turns each model served without a failover.
  const latencyOf = async (id: string | undefined) => {
    if (!id) return null;
    const typeFilter = req.turnType === 'all' ? '' : ' and turn_type = $3';
    const args = req.turnType === 'all' ? [ws.id, id] : [ws.id, id, req.turnType];
    const r = await db.one<{ v: number | null; n: number }>(
      `select avg(latency_ms)::float8 as v, count(*)::int as n from turns where workspace_id = $1 and model_id = $2 and not failover${typeFilter}`,
      args,
    );
    return r?.n ? r.v : null;
  };

  return {
    allocation: [...alloc].map(([modelId, v]) => ({ modelId, current: v.current * scale, projected: v.projected * scale })),
    latencyFrom: await latencyOf(from?.id),
    latencyTo: await latencyOf(to?.id),
    monthlyConversations,
    currentMonthly: current * scale,
    projectedMonthly: projected * scale,
    delta: (projected - current) * scale,
    movedTurnsPct: totalTurns ? (movedTurns / totalTurns) * 100 : 0,
    blockedPct: candidateTurns ? (blockedTurns / candidateTurns) * 100 : 0,
    qualityFrom: movedTurns ? qFrom / movedTurns : null,
    qualityTo: movedTurns ? qTo / movedTurns : null,
    loggedTurns: totalTurns,
    loggedConversations: win.convs,
    windowDays: win.days,
  };
}

/**
 * Estimated savings vs a single-model baseline: the same logged tokens priced on the
 * highest-quality model each customer's policy allows for that language. Both sides use
 * current catalogue prices, so the comparison is like for like.
 */
export async function savings(ws: Workspace, days = 14): Promise<Savings> {
  const since = Date.now() - days * DAY;
  const rows = await buckets(ws, since);

  // "Best" uses the same per-language, per-turn-type quality the router ranks complex turns by,
  // so the baseline and the routed choice are judged on the same scale.
  const bestFor = (customerId: string, language: Language, turnType: TurnType) => {
    const policy = policyFor(ws, customerId);
    const seg = `${language}:${turnType}`;
    return ws.models
      .filter((m) => m.enabled && !m.excluded && m.languages.includes(language) && !policyBlock(m, policy))
      .sort((a, b) => ws.effectiveQuality(b, seg) - ws.effectiveQuality(a, seg))[0];
  };

  let actual = 0;
  let baseline = 0;
  let turns = 0;
  let uncovered = 0;
  const baselineModels = new Map<string, number>();
  for (const b of rows) {
    const m = ws.getModel(b.model_id);
    const best = bestFor(b.customer_id, b.language, b.turn_type);
    if (!m || !best) {
      uncovered += b.n;
      continue;
    }
    turns += b.n;
    actual += costOf(m, b.tin, b.tout);
    baseline += costOf(best, b.tin, b.tout);
    baselineModels.set(best.id, (baselineModels.get(best.id) ?? 0) + b.n);
  }

  const unanswered = (await db.one<{ n: number }>(
    'select count(*)::int as n from turns where workspace_id = $1 and model_id is null and ts >= $2',
    [ws.id, since],
  ))!.n;

  return {
    days,
    turns,
    uncoveredTurns: uncovered,
    unansweredTurns: unanswered,
    actualCost: actual,
    baselineCost: baseline,
    savings: baseline - actual,
    savingsPct: baseline > 0 ? ((baseline - actual) / baseline) * 100 : 0,
    baselineModels: [...baselineModels].map(([modelId, n]) => ({ modelId, turns: n })),
  };
}
