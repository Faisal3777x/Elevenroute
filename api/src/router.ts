import type { Candidate, Classification, CustomerPolicy, Language, ModelInfo, UseCase, Vendor } from '../../shared/types.ts';
import { Breaker } from './breaker.ts';
import { classify } from './classifier.ts';
import { blendedCost, effectiveQuality, hasKey, state } from './store.ts';

export interface DecideInput {
  message: string;
  language: Language;
  useCase: UseCase;
  customerId: string;
  conversationId?: string;
  /** Filter out vendors without an API key (live mode). */
  requireKeys: boolean;
  breaker: Breaker;
  now?: number;
}

export interface Decision {
  classification: Classification;
  policy: CustomerPolicy;
  floor: number;
  ranked: ModelInfo[];
  candidates: Candidate[];
  sticky: boolean;
  reason: string;
}

// Sticky routing: conversation id → model id. Bounded so memory stays flat.
const pins = new Map<string, string>();
const MAX_PINS = 20_000;

export function pin(conversationId: string, modelId: string): void {
  if (pins.size >= MAX_PINS) pins.delete(pins.keys().next().value as string);
  pins.set(conversationId, modelId);
}

export function clearPins(): void {
  pins.clear();
}

export const fmtCost = (c: number) => `$${c.toFixed(5)}/1k`;

export function policyFor(customerId: string): CustomerPolicy {
  return state.policies.find((p) => p.id === customerId) ?? state.policies.find((p) => p.id === 'default') ?? state.policies[0];
}

/** Why a model can't serve this customer, or null when it can. */
export function policyBlock(m: ModelInfo, policy: CustomerPolicy): string | null {
  if (policy.allowedVendors && !policy.allowedVendors.includes(m.vendor)) return `${policy.name} policy excludes ${m.vendor}`;
  if (policy.region && !m.regions.includes(policy.region)) return `not hosted in ${policy.region}`;
  return null;
}

export function decide(input: DecideInput): Decision {
  const { strategy, rules, languages } = state;
  const now = input.now ?? Date.now();
  const classification = classify(input.message, input.useCase, rules, strategy.complexThreshold);
  const turnType = classification.turnType;
  const policy = policyFor(input.customerId);
  const lang = languages.find((l) => l.language === input.language);
  const floor = Math.max(strategy.simpleQualityFloor, lang?.qualityFloor ?? 0, policy.qualityFloor ?? 0);
  const vendorRank = (v: Vendor) => {
    const i = lang?.vendorOrder.indexOf(v) ?? -1;
    return i < 0 ? 9 : i;
  };
  const segment = `${input.language}:${turnType}`;

  const candidates: Candidate[] = [];
  const eligible: { m: ModelInfo; q: number; c: number }[] = [];
  for (const m of state.models) {
    const q = effectiveQuality(m, segment);
    const c = blendedCost(m);
    let note: string | null = null;
    if (!m.enabled) note = 'disabled';
    else if (m.excluded) note = `excluded: test score ${m.testScore?.toFixed(2)} < ${strategy.exclusionFloor}`;
    else if (!m.languages.includes(input.language)) note = `no ${input.language} support`;
    else if (input.requireKeys && !hasKey(m.vendor)) note = 'no API key';
    else note = policyBlock(m, policy);
    candidates.push({ modelId: m.id, name: m.name, vendor: m.vendor, eligible: note === null, note: note ?? '', quality: q, cost: c, rank: null });
    if (note === null) eligible.push({ m, q, c });
  }

  let ordered: typeof eligible;
  if (turnType === 'simple') {
    const above = eligible.filter((e) => e.q >= floor).sort((a, b) => a.c - b.c || vendorRank(a.m.vendor) - vendorRank(b.m.vendor) || b.q - a.q);
    const below = eligible.filter((e) => e.q < floor).sort((a, b) => b.q - a.q);
    for (const e of below) setNote(candidates, e.m.id, `below quality floor ${floor.toFixed(2)}`);
    ordered = [...above, ...below];
  } else {
    ordered = [...eligible].sort((a, b) => b.q - a.q || vendorRank(a.m.vendor) - vendorRank(b.m.vendor) || a.c - b.c);
  }

  // Sticky: keep the conversation on its first model while it is still allowed.
  let sticky = false;
  const pinned = input.conversationId && strategy.sticky ? pins.get(input.conversationId) : undefined;
  if (pinned) {
    const idx = ordered.findIndex((e) => e.m.id === pinned);
    const upgrade = turnType === 'complex' && strategy.upgradeStickyOnComplex && idx > 0 && ordered[0].q > ordered[idx].q;
    if (idx > 0 && !upgrade) {
      ordered.unshift(...ordered.splice(idx, 1));
      sticky = true;
    } else if (idx === 0) sticky = true;
  }

  // Circuit breaker: vendors that just failed go to the back of the queue.
  const open = ordered.filter((e) => input.breaker.isOpen(e.m.vendor, now));
  if (open.length) {
    ordered = [...ordered.filter((e) => !input.breaker.isOpen(e.m.vendor, now)), ...open];
    for (const e of open) setNote(candidates, e.m.id, 'circuit breaker open: moved to back');
  }

  ordered.forEach((e, i) => {
    const cand = candidates.find((c) => c.modelId === e.m.id);
    if (cand) cand.rank = i + 1;
  });

  const top = ordered[0];
  let reason: string;
  if (!top) reason = `No eligible model for ${policy.name} (${input.language})`;
  else if (sticky) reason = `Sticky conversation → stays on ${top.m.name}`;
  else if (turnType === 'simple')
    reason = `Simple turn → cheapest model with quality ≥ ${floor.toFixed(2)}: ${top.m.name} (${fmtCost(top.c)}, quality ${top.q.toFixed(2)})`;
  else reason = `Complex turn → highest-quality model: ${top.m.name} (quality ${top.q.toFixed(2)}, ${fmtCost(top.c)})`;

  return { classification, policy, floor, ranked: ordered.map((e) => e.m), candidates, sticky, reason };
}

function setNote(cands: Candidate[], id: string, note: string): void {
  const c = cands.find((x) => x.modelId === id);
  if (c) c.note = note;
}
