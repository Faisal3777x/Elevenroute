// Types shared by the ElevenRoute API (api/) and the app (app/).
// Import with `import type` only, so neither runtime ever loads this file.

export type Vendor = 'openai' | 'google' | 'anthropic';
/** English only. The language stays part of every request, policy and quality segment so more can be added later. */
export type Language = 'en';
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
  /** Tokens billed for the turn (0 when no model answered). */
  tokens_in: number;
  tokens_out: number;
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

// ---- ElevenAgent: a stateful agent that sits above the router ----
export type AgentScenarioId = 'refund' | 'insurance' | 'appointment';
/** Business systems the agent reads and writes. In this build both connectors are simulated. */
export type AgentSystem = 'salesforce' | 'sap';
/** active: still working · done: goal met · declined: customer said no · handoff: passed to a person. */
export type AgentStatus = 'active' | 'done' | 'declined' | 'handoff';

/** One thing the agent must know before it can act. */
export interface AgentSlot {
  id: string;
  label: string;
  value: string | null;
  /** Turn in which the customer supplied it. */
  turn: number | null;
}

export interface AgentToolInfo {
  id: string;
  system: AgentSystem;
  operation: string;
  /** Writes change a record, so they wait for the customer's confirmation. */
  write: boolean;
  /** Slots that must be filled first. */
  needs: string[];
}

export interface AgentToolCall extends AgentToolInfo {
  turn: number;
  result: Record<string, string>;
}

export interface AgentScenario {
  id: AgentScenarioId;
  useCase: UseCase;
  title: string;
  goal: string;
  slots: { id: string; label: string }[];
  tools: AgentToolInfo[];
  /** Customer lines that walk the conversation to its goal, per language. */
  script: Record<Language, string[]>;
  /** The slot each script line supplies, in the same order. */
  scriptFills: string[];
}

/** Conversation state held by the agent, not by any model. */
export interface AgentSession {
  id: string;
  scenario: AgentScenarioId;
  language: Language;
  customerId: string;
  status: AgentStatus;
  turns: number;
  /** Slot the agent is waiting for; null once the conversation is closed. */
  awaiting: string | null;
  slots: AgentSlot[];
  calls: AgentToolCall[];
  /** Model that answered each turn, in order (null: no model answered). */
  models: (string | null)[];
  costUsd: number;
  /** The same tokens priced on the customer's best allowed model for each turn (the one-model baseline). */
  baselineUsd: number;
  latencyMs: number;
  /** Tokens of conversation so far; resent to the model as context on the next turn. */
  transcriptTokens: number;
}

export interface AgentTurnRequest {
  session_id: string;
  scenario: AgentScenarioId;
  language: Language;
  customer_id: string;
  message: string;
}

export interface AgentTurnResponse {
  reply: string;
  session: AgentSession;
  /** Slot ids filled by this turn. */
  filled: string[];
  /** Tool calls made in this turn. */
  calls: AgentToolCall[];
  /** Context tokens (earlier turns plus state) sent with this turn. */
  contextTokens: number;
  /** What this turn's tokens would cost on the best allowed model; null when no model answered. */
  baseline: { modelId: string; costUsd: number } | null;
  /** The router's decision and result for this turn. */
  route: ChatResponse;
}

/** GET /me: who is signed in and which workspace their data lives in. */
export interface MeResponse {
  user: { id: string; email: string | null };
  workspace: { id: string; name: string };
  /** 'off' when the API runs without Supabase (local development). */
  auth: 'supabase' | 'off';
  database: 'supabase' | 'local';
}
