import type { ClassifierRule, CustomerPolicy, LanguagePref, ModelInfo, Strategy } from '../../shared/types.ts';

// Demo prices, latencies and quality scores are illustrative simulation settings, not vendor quotes.
const all = ['en', 'es'] as const;

export const seedModels: ModelInfo[] = [
  { id: 'gpt-5', name: 'GPT-5', vendor: 'openai', tier: 'flagship', liveModel: 'gpt-5', regions: ['US', 'EU'], languages: [...all], costIn: 0.00125, costOut: 0.01, latencyMs: 1400, errorRate: 0.01, quality: 0.93, enabled: true, testScore: null, excluded: false },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', vendor: 'openai', tier: 'fast', liveModel: 'gpt-5-mini', regions: ['US', 'EU'], languages: [...all], costIn: 0.00025, costOut: 0.002, latencyMs: 650, errorRate: 0.01, quality: 0.82, enabled: true, testScore: null, excluded: false },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'google', tier: 'flagship', liveModel: 'gemini-2.5-pro', regions: ['US'], languages: [...all], costIn: 0.00125, costOut: 0.01, latencyMs: 1200, errorRate: 0.015, quality: 0.91, enabled: true, testScore: null, excluded: false },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vendor: 'google', tier: 'fast', liveModel: 'gemini-2.5-flash', regions: ['US', 'EU'], languages: [...all], costIn: 0.0002, costOut: 0.001, latencyMs: 450, errorRate: 0.015, quality: 0.81, enabled: true, testScore: null, excluded: false },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vendor: 'anthropic', tier: 'flagship', liveModel: 'claude-sonnet-5-5', regions: ['US', 'EU'], languages: [...all], costIn: 0.003, costOut: 0.015, latencyMs: 1300, errorRate: 0.01, quality: 0.94, enabled: true, testScore: null, excluded: false },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vendor: 'anthropic', tier: 'fast', liveModel: 'claude-haiku-5-5', regions: ['US', 'EU'], languages: [...all], costIn: 0.0008, costOut: 0.004, latencyMs: 600, errorRate: 0.01, quality: 0.85, enabled: true, testScore: null, excluded: false },
];

export const seedPolicies: CustomerPolicy[] = [
  { id: 'default', name: 'Default', allowedVendors: null, region: null, qualityFloor: null, note: 'No restrictions' },
  { id: 'acme', name: 'Acme Health', allowedVendors: null, region: 'EU', qualityFloor: null, note: 'EU-hosted models only' },
  { id: 'globex', name: 'Globex Retail', allowedVendors: null, region: null, qualityFloor: null, note: 'No restrictions' },
  { id: 'initech', name: 'Initech Insurance', allowedVendors: ['openai', 'anthropic'], region: null, qualityFloor: 0.8, note: 'Contract excludes Google' },
];

export const seedLanguages: LanguagePref[] = [
  { language: 'en', qualityFloor: null, vendorOrder: ['anthropic', 'openai', 'google'] },
  { language: 'es', qualityFloor: null, vendorOrder: ['openai', 'google', 'anthropic'] },];

export const seedStrategy: Strategy = {
  simpleQualityFloor: 0.78,
  exclusionFloor: 0.7,
  latencyBudgetMs: 2000,
  complexThreshold: 2,
  sticky: true,
  // On by default: an escalating call moves up to a stronger model (the spec's production recommendation).
  upgradeStickyOnComplex: true,
  breakerFailures: 2,
  breakerWindowS: 30,
  breakerCooldownS: 20,
  alertDropPct: 10,
};

export const seedRules: ClassifierRule[] = [
  { id: 'long', kind: 'long', label: 'Long turn', weight: 2, enabled: true, words: 18 },
  { id: 'short', kind: 'short', label: 'Very short turn', weight: -1, enabled: true, words: 6 },
  { id: 'multistep', kind: 'multistep', label: 'Multi-step (3+ sentences or 2+ questions)', weight: 1, enabled: true },
  {
    id: 'dispute',
    kind: 'keywords',
    label: 'Dispute / refund keywords',
    weight: 2,
    enabled: true,
    phrases: [
      'refund', 'chargeback', 'dispute', 'charged twice', 'money back', 'cancel my', 'complaint', 'unacceptable',
      'reembolso', 'devolución', 'devolver', 'cobro', 'disputa', 'queja', 'cancelar',
    ],
  },
  {
    id: 'confirmation',
    kind: 'confirmation',
    label: 'Confirmation pattern',
    weight: -3,
    enabled: true,
    phrases: [
      'yes', 'yeah', 'that works', 'sounds good', 'ok', 'okay', 'thanks', 'thank you', 'perfect', 'great',
      'sí', 'si', 'gracias', 'vale', 'de acuerdo', 'perfecto', 'claro',
    ],
  },
  { id: 'entity', kind: 'entity', label: 'Order number / booking time', weight: -1, enabled: true },
  { id: 'calltype', kind: 'calltype', label: 'Refund or complaint call', weight: 1, enabled: true, useCases: ['refund', 'complaint'] },
];
