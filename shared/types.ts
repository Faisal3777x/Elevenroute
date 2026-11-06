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
  monthlyConversations: number;
  currentMonthly: number;
  projectedMonthly: number;
  delta: number;
  movedTurnsPct: number;
  blockedPct: number;
  qualityFrom: number;
  qualityTo: number;
  loggedTurns: number;
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
}
