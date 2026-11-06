process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const { classify } = await import('../src/classifier.ts');
const { decide, clearPins } = await import('../src/router.ts');
const { Breaker } = await import('../src/breaker.ts');
const { runTurn } = await import('../src/chat.ts');
const { runTests } = await import('../src/evaluation.ts');
const { TEST_CASES } = await import('../src/content.ts');
const { state, resetAll } = await import('../src/store.ts');

type Lang = 'en' | 'es';
const base = (message: string, language: Lang = 'en', customerId = 'default') => ({
  message, language, useCase: 'faq' as const, customerId, requireKeys: false, breaker: new Breaker(),
});

beforeEach(() => {
  resetAll();
  clearPins();
  state.mode = 'demo';
});

// ---- classifier ----
test('every test conversation is classified as its labelled turn type', () => {
  for (const c of TEST_CASES) {
    const r = classify(c.message, c.useCase, state.rules, state.strategy.complexThreshold);
    assert.equal(r.turnType, c.turnType, `${c.id}: score ${r.score} ${JSON.stringify(r.hits)}`);
  }
});

test('confirmations are simple, disputes are complex', () => {
  const th = state.strategy.complexThreshold;
  assert.equal(classify('Yes, that works', 'faq', state.rules, th).turnType, 'simple');
  assert.equal(classify('I want a refund', 'refund', state.rules, th).turnType, 'complex');
  assert.equal(classify('sí, gracias', 'faq', state.rules, th).turnType, 'simple');
});

test('Spanish dispute keywords are detected', () => {
  const r = classify('Quiero un reembolso', 'faq', state.rules, state.strategy.complexThreshold);
  assert.ok(r.hits.some((h) => h.id === 'dispute'));
});

test('only English and Spanish are supported', () => {
  assert.deepEqual(state.languages.map((l) => l.language), ['en', 'es']);
  assert.equal(TEST_CASES.length, 24);
});

test('disabled rules do not fire', () => {
  state.rules.find((r) => r.id === 'dispute')!.enabled = false;
  const r = classify('refund', 'faq', state.rules, 2);
  assert.ok(!r.hits.some((h) => h.id === 'dispute'));
});

// ---- routing ----
test('simple turns go to the cheapest model above the floor', () => {
  const d = decide(base('Yes, that works'));
  assert.equal(d.classification.turnType, 'simple');
  assert.equal(d.ranked[0].id, 'gemini-2.5-flash');
  assert.match(d.reason, /Simple turn → cheapest model with quality ≥ 0.78: Gemini 2.5 Flash/);
});

test('complex turns go to the highest-quality model', () => {
  const d = decide(base(TEST_CASES.find((c) => c.id === 'refund-en-complex')!.message));
  assert.equal(d.ranked[0].id, 'claude-sonnet-5-5');
});

test('Spanish simple turns use the global floor and the cheapest model', () => {
  const d = decide(base('Sí, gracias', 'es'));
  assert.equal(d.floor, 0.78);
  assert.equal(d.ranked[0].id, 'gemini-2.5-flash');
});

test('customer policy filters vendors and regions', () => {
  const initech = decide(base('Yes, that works', 'en', 'initech'));
  assert.ok(initech.ranked.every((m) => m.vendor !== 'google'));
  const acme = decide(base(TEST_CASES[1].message, 'en', 'acme'));
  assert.ok(acme.ranked.every((m) => m.regions.includes('EU')));
  assert.ok(!acme.ranked.some((m) => m.id === 'gemini-2.5-pro'));
});

test('excluded and disabled models are removed', () => {
  state.models.find((m) => m.id === 'gemini-2.5-flash')!.excluded = true;
  state.models.find((m) => m.id === 'gpt-5-mini')!.enabled = false;
  const d = decide(base('Yes, that works'));
  assert.ok(!d.ranked.some((m) => m.id === 'gemini-2.5-flash' || m.id === 'gpt-5-mini'));
});

test('live mode removes vendors without an API key', () => {
  const d = decide({ ...base('Yes, that works'), requireKeys: true });
  assert.equal(d.ranked.length, 0);
});

test('open circuit breaker moves a vendor to the back', () => {
  const breaker = new Breaker();
  breaker.recordFailure('google');
  breaker.recordFailure('google');
  const d = decide({ ...base('Yes, that works'), breaker });
  assert.notEqual(d.ranked[0].vendor, 'google');
  assert.equal(d.ranked[d.ranked.length - 1].vendor, 'google');
});

test('routing overhead stays far under the 20 ms budget', () => {
  const t = performance.now();
  for (let i = 0; i < 1000; i++) decide(base('My order number is 48213'));
  assert.ok((performance.now() - t) / 1000 < 1, 'over 1 ms per decision');
});

// ---- failover ----
const chat = (message: string, conversation_id = crypto.randomUUID()) =>
  ({ conversation_id, message, language: 'en' as const, use_case: 'faq' as const, customer_id: 'default' });

test('an outage fails over to another vendor', async () => {
  for (const m of state.models) m.errorRate = 0;
  const r = await runTurn(chat('Yes, that works'), { virtual: true, breaker: new Breaker(), vendorStates: { openai: 'healthy', google: 'down', anthropic: 'healthy' } });
  assert.equal(r.failover_used, true);
  assert.notEqual(r.provider, 'google');
  assert.match(r.route_reason, /Failover: Gemini 2.5 Flash errored → GPT-5 mini/);
  assert.ok(r.latency_ms < 2000);
});

test('a slow provider fails over at the latency budget', async () => {
  for (const m of state.models) m.errorRate = 0;
  const r = await runTurn(chat('Yes, that works'), { virtual: true, breaker: new Breaker(), vendorStates: { openai: 'healthy', google: 'slow', anthropic: 'healthy' } });
  assert.equal(r.failover_used, true);
  assert.equal(r.trace.attempts[0].error?.includes('timed out'), true);
});

test('all vendors down returns an apology and human handoff', async () => {
  const r = await runTurn(chat('Yes, that works'), { virtual: true, breaker: new Breaker(), vendorStates: { openai: 'down', google: 'down', anthropic: 'down' } });
  assert.equal(r.model_used, null);
  assert.match(r.reply, /connect you/);
});

test('conversations stick to their first model', async () => {
  for (const m of state.models) m.errorRate = 0;
  state.strategy.upgradeStickyOnComplex = false;
  const id = crypto.randomUUID();
  const first = await runTurn(chat('Yes, that works', id), { virtual: true, breaker: new Breaker() });
  const second = await runTurn(chat(TEST_CASES.find((c) => c.id === 'faq-en-complex')!.message, id), { virtual: true, breaker: new Breaker() });
  assert.equal(second.model_used, first.model_used);
  assert.equal(second.trace.sticky, true);
});

test('escalating sticky calls upgrade to a stronger model when enabled', async () => {
  for (const m of state.models) m.errorRate = 0;
  state.strategy.upgradeStickyOnComplex = true;
  const id = crypto.randomUUID();
  const first = await runTurn(chat('Yes, that works', id), { virtual: true, breaker: new Breaker() });
  const second = await runTurn(chat(TEST_CASES.find((c) => c.id === 'faq-en-complex')!.message, id), { virtual: true, breaker: new Breaker() });
  assert.equal(first.model_used, 'gemini-2.5-flash');
  assert.equal(second.model_used, 'claude-sonnet-5-5');
});

// ---- tests ----
test('the suite scores every model on every conversation and excludes weak models', async () => {
  state.models.find((m) => m.id === 'gpt-5-mini')!.quality = 0.4;
  const run = await runTests();
  assert.equal(Object.keys(run.scores).length, 6);
  assert.equal(state.models.find((m) => m.id === 'gpt-5-mini')!.excluded, true);
  assert.equal(state.models.find((m) => m.id === 'claude-sonnet-5-5')!.excluded, false);
});
