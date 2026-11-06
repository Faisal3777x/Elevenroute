import type { ChatRequest, ChatResponse, CustomerPolicy, PreviewResponse } from '../../../shared/types';
import type { RouteRun } from '../components/RoutingVisualiser';

const customerName = (policies: CustomerPolicy[] | undefined, id: string) => policies?.find((p) => p.id === id)?.name ?? id;

/** Visualiser run from a real /chat response. */
export function runFromChat(req: ChatRequest, res: ChatResponse, policies?: CustomerPolicy[]): RouteRun {
  return {
    kind: 'chat',
    message: req.message,
    language: req.language,
    customer: customerName(policies, req.customer_id),
    trace: res.trace,
    reason: res.route_reason,
    turnType: res.turn_type,
    reply: res.reply,
    modelUsed: res.model_used,
    costUsd: res.cost_usd,
    latencyMs: res.latency_ms,
    failover: res.failover_used,
  };
}

/** Visualiser run from a /route/preview dry run (no model call). */
export function runFromPreview(req: Omit<ChatRequest, 'conversation_id'>, res: PreviewResponse, policies?: CustomerPolicy[]): RouteRun {
  return {
    kind: 'preview',
    message: req.message,
    language: req.language,
    customer: customerName(policies, req.customer_id),
    trace: res.trace,
    reason: res.route_reason,
    turnType: res.turn_type,
  };
}
