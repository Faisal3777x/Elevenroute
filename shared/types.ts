// Types shared by the ElevenRoute API (api/) and the app (app/).
// Import with `import type` only, so neither runtime ever loads this file.

export type Vendor = 'openai' | 'google' | 'anthropic';
export type Language = 'en' | 'es';
export type UseCase = 'appointment' | 'refund' | 'order_status' | 'insurance' | 'complaint' | 'faq';
export type TurnType = 'simple' | 'complex';
export type VendorState = 'healthy' | 'down' | 'slow';
export type Mode = 'demo' | 'live';
export type Region = 'US' | 'EU';

export interface ModelInfo {
  id: string;
  name: string;
  vendor: Vendor;
  tier: 'flagship' | 'fast';
  /** Model name sent to the vendor API in live mode. */
  liveModel: string;
  regions: Region[];
  languages: Language[];
  /** USD per 1k input / output tokens. */
  costIn: number;
  costOut: number;
  /** Simulated provider behaviour (demo mode). */
  latencyMs: number;
  errorRate: number;
  quality: number;
  enabled: boolean;
  /** Latest test-suite score (0–1), null before the first run. */
  testScore: number | null;
  /** Removed from routing because the latest test score is under the floor. */
  excluded: boolean;
}

export interface CustomerPolicy {
  id: string;
  name: string;
  /** null = every vendor allowed. */
  allowedVendors: Vendor[] | null;
  /** null = any region. */
  region: Region | null;
  qualityFloor: number | null;
  note: string;
}

export interface LanguagePref {
  language: Language;
  qualityFloor: number | null;
  /** Tie-break order when two models rank equally. */
  vendorOrder: Vendor[];
}

export interface Strategy {
  simpleQualityFloor: number;
  exclusionFloor: number;
  latencyBudgetMs: number;
  complexThreshold: number;
  sticky: boolean;
  upgradeStickyOnComplex: boolean;
  /** A simple turn in a conversation pinned to a pricier model moves to the cheapest model above the floor. */
  downgradeStickyOnSimple: boolean;
  breakerFailures: number;
  breakerWindowS: number;
  breakerCooldownS: number;
  alertDropPct: number;
}

export type RuleKind = 'long' | 'short' | 'multistep' | 'keywords' | 'confirmation' | 'entity' | 'calltype';

export interface ClassifierRule {
  id: string;
  kind: RuleKind;
  label: string;
  weight: number;
  enabled: boolean;
  /** Word threshold for long / short rules. */
  words?: number;
  /** Phrases for keywords / confirmation rules. */
  phrases?: string[];
  /** Call types for the calltype rule. */
  useCases?: UseCase[];
}

export interface RoutingConfig {
  strategy: Strategy;
  rules: ClassifierRule[];
  policies: CustomerPolicy[];
  languages: LanguagePref[];
}

export interface RuleHit {
  id: string;
  label: string;
  weight: number;
}

export interface Classification {
  turnType: TurnType;
  score: number;
  hits: RuleHit[];
}

export interface Candidate {
  modelId: string;
  name: string;
  vendor: Vendor;
  eligible: boolean;
  /** Why the model was filtered out, or a note on its rank. */
  note: string;
  quality: number;
  /** Blended USD per 1k tokens. */
  cost: number;
  rank: number | null;
}

export interface Attempt {
  modelId: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface RouteTrace {
  classification: Classification;
  policy: string;
  qualityFloor: number;
  candidates: Candidate[];
  attempts: Attempt[];
  sticky: boolean;
  overheadMs: number;
}

export interface ChatRequest {
  conversation_id: string;
  message: string;
  language: Language;
  use_case: UseCase;
  customer_id: string;
}

export interface ChatResponse {
  reply: string;
  model_used: string | null;
  provider: Vendor | null;
  latency_ms: number;
  cost_usd: number;
  route_reason: string;
  failover_used: boolean;
  turn_type: TurnType;
  trace: RouteTrace;
}

export interface PreviewResponse {
  turn_type: TurnType;
  route_reason: string;
  ranked: string[];
  trace: RouteTrace;
}

export interface VendorStatus {
  vendor: Vendor;
  state: VendorState;
  breakerOpen: boolean;
  hasKey: boolean;
}

export interface Overview {
  requests: number;
  conversations: number;
  totalCost: number;
  costPerConversation: number;
  failovers: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p95OverheadMs: number;
  days: string[];
  /** Cost per day per model id, aligned with `days`. */
  costByModel: { modelId: string; values: number[] }[];
  share: { modelId: string; simple: number; complex: number }[];
  failoverDaily: number[];
  /** Turns per day, aligned with `days`. */
  requestsDaily: number[];
  /** Average turn latency per day (ms), aligned with `days`; 0 when no turns. */
  latencyDaily: number[];
  recentFailovers: { ts: number; from: string; to: string | null; reason: string; language: Language }[];
}

export interface WhatIfRequest {
  fromModel: string;
  toModel: string;
  share: number;
  turnType: TurnType | 'all';
  /** Conversations per month; null = logged rate. */
  volume: number | null;
}

export interface WhatIfResult {
  /** Monthly cost per model before and after the move. */
  allocation: { modelId: string; current: number; projected: number }[];
  /** Average measured latency (ms) of turns each model served without failover; null if never measured. */
  latencyFrom: number | null;
  latencyTo: number | null;
  monthlyConversations: number;
  currentMonthly: number;
  projectedMonthly: number;
  delta: number;
  movedTurnsPct: number;
  blockedPct: number;
  /** Average quality of the moved turns before and after; null when nothing moves. */
  qualityFrom: number | null;
  qualityTo: number | null;
  loggedTurns: number;
  /** The logged sample the monthly projection is scaled from. */
  loggedConversations: number;
  windowDays: number;
}

/** Routed spend vs the same tokens on each customer's best allowed model. */
export interface Savings {
  days: number;
  turns: number;
  /** Turns with no eligible baseline model (excluded from both sides). */
  uncoveredTurns: number;
  /** Turns no model answered (handed to a person): no model cost, so not part of the comparison. */
  unansweredTurns: number;
  actualCost: number;
  baselineCost: number;
  savings: number;
  savingsPct: number;
  baselineModels: { modelId: string; turns: number }[];
}

export interface TestCase {
  id: string;
  useCase: UseCase;
  language: Language;
  turnType: TurnType;
  message: string;
  expected: string;
}

export interface TestResult {
  runId: number;
  modelId: string;
  caseId: string;
  useCase: UseCase;
  language: Language;
  turnType: TurnType;
  completed: boolean;
  accuracy: number;
  tone: number;
  latencyMs: number;
  score: number;
  reply: string;
}

export interface TestRun {
  id: number;
  ts: number;
  mode: Mode;
  scores: Record<string, number>;
}

export interface Alert {
  id: number;
  ts: number;
  modelId: string;
  message: string;
}

export interface AppConfig {
  mode: Mode;
  keys: Record<Vendor, boolean>;
  /** Whether this user may switch to live mode (LIVE_MODE_EMAILS on the API). */
  liveAllowed?: boolean;
}

/** GET /me: who is signed in and which workspace their data lives in. */
export interface MeResponse {
  user: { id: string; email: string | null };
  workspace: { id: string; name: string };
  /** 'off' when the API runs without Supabase (local development). */
  auth: 'supabase' | 'off';
  database: 'supabase' | 'local';
}
