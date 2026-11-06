process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/server.ts');
const { state } = await import('../src/store.ts');

const server = createApp();
let base = '';

before(async () => {
  state.mode = 'demo';
  for (const m of state.models) m.latencyMs = 20; // keep end-to-end calls quick
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

test('POST /chat returns model, cost, latency and reason', async () => {
  const { status, json } = await call('POST', '/chat', { conversation_id: 'c1', message: 'Where is order 55120?', language: 'en', use_case: 'order_status', customer_id: 'default' });
  assert.equal(status, 200);
  for (const k of ['reply', 'model_used', 'provider', 'latency_ms', 'cost_usd', 'route_reason', 'failover_used', 'trace']) assert.ok(k in json, k);
});

test('POST /chat validates input', async () => {
  const { status } = await call('POST', '/chat', { message: '', language: 'fr' });
  assert.equal(status, 400);
});

test('outage switch, preview, traffic, stats and what-if work end to end', async () => {
  assert.equal((await call('PUT', '/vendors/google/state', { state: 'down' })).status, 200);
  const preview = await call('POST', '/route/preview', { message: 'Yes, that works', language: 'en', use_case: 'faq' });
  assert.equal(preview.json.turn_type, 'simple');
  await call('PUT', '/vendors/google/state', { state: 'healthy' });

  const traffic = await call('POST', '/traffic/generate', { count: 60 });
  assert.equal(traffic.status, 200);
  const stats = await call('GET', '/stats/overview');
  assert.ok(stats.json.requests >= 60);
  assert.ok(stats.json.totalCost > 0);

  const sim = await call('POST', '/whatif/simulate', { fromModel: 'claude-sonnet-5-5', toModel: 'gemini-2.5-flash', share: 0.5, turnType: 'all', volume: 100000 });
  assert.equal(sim.status, 200);
  assert.ok(sim.json.projectedMonthly < sim.json.currentMonthly);
  // The per-model allocation adds up to the totals.
  const sum = (k: 'current' | 'projected') => sim.json.allocation.reduce((s: number, a: any) => s + a[k], 0);
  assert.ok(Math.abs(sum('current') - sim.json.currentMonthly) < 1e-6);
  assert.ok(Math.abs(sum('projected') - sim.json.projectedMonthly) < 1e-6);
  assert.ok(sim.json.latencyFrom > 0);

  assert.equal(stats.json.requestsDaily.reduce((a: number, b: number) => a + b, 0), stats.json.requests);

  const sav = await call('GET', '/stats/savings');
  assert.equal(sav.status, 200);
  assert.ok(sav.json.turns > 0);
  assert.ok(sav.json.baselineCost >= sav.json.actualCost, 'routing should not cost more than always using the best model');
  assert.ok(Math.abs(sav.json.savings - (sav.json.baselineCost - sav.json.actualCost)) < 1e-9);
});

test('POST /traffic/clear removes logged traffic but keeps settings and test results', async () => {
  await call('PUT', '/routing/strategy', { latencyBudgetMs: 2500 });
  await call('POST', '/tests/run');
  await call('POST', '/traffic/generate', { count: 20 });
  assert.ok((await call('GET', '/stats/overview')).json.requests > 0);

  const cleared = await call('POST', '/traffic/clear');
  assert.equal(cleared.status, 200);
  assert.ok(cleared.json.deletedTurns > 0);

  assert.equal((await call('GET', '/stats/overview')).json.requests, 0);
  assert.equal((await call('GET', '/traffic/status')).json.turns, 0);
  assert.equal((await call('GET', '/routing')).json.strategy.latencyBudgetMs, 2500);
  assert.ok((await call('GET', '/tests/runs')).json.length > 0);
});

test('config never exposes API keys', async () => {
  process.env.OPENAI_API_KEY = 'sk-secret-test';
  const { json } = await call('GET', '/config');
  assert.equal(json.keys.openai, true);
  assert.ok(!JSON.stringify(json).includes('sk-secret-test'));
  delete process.env.OPENAI_API_KEY;
});
