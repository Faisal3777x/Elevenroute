import type { Attempt, ChatRequest, ChatResponse, ModelInfo, Vendor, VendorState } from '../../shared/types.ts';
import type { Breaker } from './breaker.ts';
import { APOLOGY } from './content.ts';
import { db } from './db.ts';
import { callModel, costOf, ProviderError } from './providers.ts';
import { decide, pin } from './router.ts';
import type { Workspace } from './store.ts';

export interface TurnOptions {
  /** Force simulated providers (synthetic traffic never spends API credit). */
  simulated?: boolean;
  virtual?: boolean;
  breaker?: Breaker;
  now?: number;
  vendorStates?: Record<Vendor, VendorState>;
  synthetic?: boolean;
  /** false: don't log. An array: collect the row for a batched insert (synthetic traffic). Default: insert now. */
  log?: boolean | unknown[][];
}

export const TURN_COLUMNS = [
  'workspace_id', 'ts', 'conversation_id', 'customer_id', 'language', 'use_case', 'turn_type', 'model_id', 'vendor',
  'tokens_in', 'tokens_out', 'cost', 'latency_ms', 'overhead_ms', 'failover', 'failover_from', 'failover_reason', 'synthetic',
];
const INSERT_TURN = `insert into turns (${TURN_COLUMNS.join(', ')}) values (${TURN_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`;

/** /chat pipeline: decide → call with failover → log → pin the conversation. */
export async function runTurn(ws: Workspace, req: ChatRequest, opts: TurnOptions = {}): Promise<ChatResponse> {
  const breaker = opts.breaker ?? ws.breaker;
  const now = opts.now ?? Date.now();
  const vendorStates = opts.vendorStates ?? ws.vendorStates;
  const simulated = opts.simulated ?? ws.mode === 'demo';
  const budgetMs = ws.strategy.latencyBudgetMs;

  const t0 = performance.now();
  const decision = decide(ws, {
    message: req.message,
    language: req.language,
    useCase: req.use_case,
    customerId: req.customer_id,
    conversationId: req.conversation_id,
    requireKeys: !simulated,
    breaker,
    now,
  });
  let overheadMs = performance.now() - t0;
  const turnType = decision.classification.turnType;

  const attempts: Attempt[] = [];
  const failed: { model: ModelInfo; timeout: boolean }[] = [];
  const failedVendors = new Set<Vendor>();
  let served: { model: ModelInfo; reply: string; tokensIn: number; tokensOut: number } | null = null;

  const queue = [...decision.ranked];
  while (queue.length && !served) {
    // Next ranked model, skipping vendors that just failed while another vendor is still available.
    const idx = queue.findIndex((m) => !failedVendors.has(m.vendor));
    const model = queue.splice(Math.max(idx, 0), 1)[0];
    try {
      const res = await callModel(
        { model, message: req.message, useCase: req.use_case, language: req.language, turnType, budgetMs, vendorState: vendorStates[model.vendor], simulated, virtual: opts.virtual ?? false },
        simulated ? 'demo' : 'live',
      );
      attempts.push({ modelId: model.id, ok: true, latencyMs: res.latencyMs });
      breaker.recordSuccess(model.vendor);
      served = { model, reply: res.reply, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
    } catch (err) {
      const latencyMs = err instanceof ProviderError ? err.latencyMs : 0;
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ modelId: model.id, ok: false, latencyMs, error: message });
      breaker.recordFailure(model.vendor, now);
      failedVendors.add(model.vendor);
      failed.push({ model, timeout: message.includes('timed out') });
    }
  }

  const t1 = performance.now();
  const latencyMs = attempts.reduce((s, a) => s + a.latencyMs, 0);
  const cost = served ? costOf(served.model, served.tokensIn, served.tokensOut) : 0;
  let reason = decision.reason;
  if (failed.length) {
    const chain = failed.map((f) => `${f.model.name} ${f.timeout ? 'timed out' : 'errored'}`).join(' → ');
    reason += ` · Failover: ${chain} → ${served ? served.model.name : 'human handoff'}`;
  }
  if (served && ws.strategy.sticky) pin(ws, req.conversation_id, served.model.id);
  overheadMs += performance.now() - t1;

  const log = opts.log ?? true;
  if (log) {
    const row = [
      ws.id, now, req.conversation_id, req.customer_id, req.language, req.use_case, turnType,
      served?.model.id ?? null, served?.model.vendor ?? null, served?.tokensIn ?? 0, served?.tokensOut ?? 0,
      cost, latencyMs, overheadMs, failed.length > 0, failed[0]?.model.id ?? null,
      failed.length ? (failed[0].timeout ? 'timeout' : 'error') : null, opts.synthetic ?? false,
    ];
    if (Array.isArray(log)) log.push(row);
    else await db.query(INSERT_TURN, row);
  }

  return {
    reply: served?.reply ?? APOLOGY[req.language],
    model_used: served?.model.id ?? null,
    provider: served?.model.vendor ?? null,
    latency_ms: Math.round(latencyMs),
    cost_usd: cost,
    route_reason: reason,
    failover_used: failed.length > 0,
    turn_type: turnType,
    trace: {
      classification: decision.classification,
      policy: `${decision.policy.name}: ${decision.policy.note}`,
      qualityFloor: decision.floor,
      candidates: decision.candidates,
      attempts,
      sticky: decision.sticky,
      overheadMs,
    },
  };
}
