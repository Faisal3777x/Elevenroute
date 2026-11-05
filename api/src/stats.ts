import type { Overview, TurnType, WhatIfRequest, WhatIfResult } from '../../shared/types.ts';
import { db } from './db.ts';
import { costOf } from './providers.ts';
import { policyBlock, policyFor } from './router.ts';
import { effectiveQuality, getModel } from './store.ts';

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

export function overview(days = 14): Overview {
  const now = Date.now();
  const since = now - days * DAY;
  const dayList = Array.from({ length: days }, (_, i) => dayKey(now - (days - 1 - i) * DAY));
  const dayIndex = new Map(dayList.map((d, i) => [d, i]));

  const rows = db
    .prepare('SELECT ts, conversation_id, model_id, turn_type, cost, latency_ms, overhead_ms, failover FROM turns WHERE ts >= ?')
    .all(since) as { ts: number; conversation_id: string; model_id: string | null; turn_type: TurnType; cost: number; latency_ms: number; overhead_ms: number; failover: number }[];

  const convs = new Set<string>();
  const costByModel = new Map<string, number[]>();
  const share = new Map<string, { simple: number; complex: number }>();
  const failoverDaily = new Array(days).fill(0) as number[];
  let totalCost = 0;
  let failovers = 0;
  let latencySum = 0;

  for (const r of rows) {
    convs.add(r.conversation_id);
    totalCost += r.cost;
    latencySum += r.latency_ms;
    const di = dayIndex.get(dayKey(r.ts));
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

  const recent = db
    .prepare('SELECT ts, failover_from, model_id, failover_reason, language FROM turns WHERE failover = 1 ORDER BY ts DESC LIMIT 25')
    .all() as { ts: number; failover_from: string; model_id: string | null; failover_reason: string; language: 'en' | 'es' | 'ar' }[];

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
    recentFailovers: recent.map((r) => ({ ts: r.ts, from: r.failover_from, to: r.model_id, reason: r.failover_reason, language: r.language })),
  };
}

interface Bucket {
  customer_id: string;
  model_id: string;
  turn_type: TurnType;
  language: 'en' | 'es' | 'ar';
  n: number;
  tin: number;
  tout: number;
}

function loggedWindow() {
  const w = db.prepare('SELECT MIN(ts) AS lo, MAX(ts) AS hi, COUNT(DISTINCT conversation_id) AS convs FROM turns').get() as { lo: number | null; hi: number | null; convs: number };
  const days = w.lo && w.hi ? Math.max(1, (w.hi - w.lo) / DAY) : 1;
  return { days, convs: w.convs, monthly: (w.convs / days) * 30 };
}

function buckets(): Bucket[] {
  return db
    .prepare(`SELECT customer_id, model_id, turn_type, language, COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout
      FROM turns WHERE model_id IS NOT NULL GROUP BY customer_id, model_id, turn_type, language`)
    .all() as unknown as Bucket[];
}

/** Logged tokens by model, turn type and customer, priced at today's prices per month. */
export function whatIfBaseline() {
  const win = loggedWindow();
  const scale = win.convs ? win.monthly / win.convs : 0;
  const byModel = new Map<string, { turns: number; monthlyCost: number }>();
  for (const b of buckets()) {
    const m = getModel(b.model_id);
    if (!m) continue;
    const e = byModel.get(b.model_id) ?? { turns: 0, monthlyCost: 0 };
    e.turns += b.n;
    e.monthlyCost += costOf(m, b.tin, b.tout) * scale;
    byModel.set(b.model_id, e);
  }
  return { monthlyConversations: win.monthly, models: [...byModel].map(([modelId, v]) => ({ modelId, ...v })) };
}

export function whatIf(req: WhatIfRequest): WhatIfResult {
  const win = loggedWindow();
  const from = getModel(req.fromModel);
  const to = getModel(req.toModel);
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

  for (const b of buckets()) {
    const m = getModel(b.model_id);
    if (!m) continue;
    const cost = costOf(m, b.tin, b.tout);
    current += cost;
    totalTurns += b.n;
    const matches = from && to && b.model_id === from.id && (req.turnType === 'all' || b.turn_type === req.turnType);
    if (!matches) {
      projected += cost;
      continue;
    }
    candidateTurns += b.n;
    if (policyBlock(to, policyFor(b.customer_id))) {
      blockedTurns += b.n;
      projected += cost;
      continue;
    }
    const moved = b.n * share;
    movedTurns += moved;
    projected += cost * (1 - share) + costOf(to, b.tin * share, b.tout * share);
    const seg = `${b.language}:${b.turn_type}`;
    qFrom += effectiveQuality(from, seg) * moved;
    qTo += effectiveQuality(to, seg) * moved;
  }

  return {
    monthlyConversations,
    currentMonthly: current * scale,
    projectedMonthly: projected * scale,
    delta: (projected - current) * scale,
    movedTurnsPct: totalTurns ? (movedTurns / totalTurns) * 100 : 0,
    blockedPct: candidateTurns ? (blockedTurns / candidateTurns) * 100 : 0,
    qualityFrom: movedTurns ? qFrom / movedTurns : from ? effectiveQuality(from) : 0,
    qualityTo: movedTurns ? qTo / movedTurns : to ? effectiveQuality(to) : 0,
    loggedTurns: totalTurns,
  };
}
