// Numbers and edits that a first-time visitor cross-checks between pages.
process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/server.ts');
const { openWorkspace, workspaceIdFor } = await import('../src/store.ts');
const { LOCAL_USER } = await import('../src/auth.ts');

const server = createApp();
let base = '';
before(async () => {
  const ws = await openWorkspace(await workspaceIdFor(LOCAL_USER));
  for (const m of ws.models) m.latencyMs = 20;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

test('strategy: an empty or out-of-range field is rejected and nothing is half-applied', async () => {
  const before = (await call('GET', '/routing')).json.strategy;
  // A valid change followed by an invalid one: neither may stick.
  const bad = await call('PUT', '/routing/strategy', { simpleQualityFloor: 0.5, latencyBudgetMs: 0 });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Latency budget must be a whole number between 100 and 120000/);
  assert.deepEqual((await call('GET', '/routing')).json.strategy, before);
  assert.equal((await call('PUT', '/routing/strategy', { simpleQualityFloor: 5 })).status, 400);
  assert.equal((await call('PUT', '/routing/strategy', { breakerFailures: 1.5 })).status, 400);
  assert.equal((await call('PUT', '/routing/strategy', { simpleQualityFloor: 0.8 })).status, 200);
  assert.equal((await call('GET', '/routing')).json.strategy.simpleQualityFloor, 0.8);
  await call('PUT', '/routing/strategy', { simpleQualityFloor: before.simpleQualityFloor });
});

test('model edits: empty and impossible values are rejected without changing the model', async () => {
  const id = 'gpt-5-mini';
  const before = (await call('GET', '/providers')).json.find((m: { id: string }) => m.id === id);
  assert.equal((await call('PATCH', `/providers/${id}`, { latencyMs: '' })).status, 400);
  assert.equal((await call('PATCH', `/providers/${id}`, { errorRate: 2 })).status, 400);
  assert.equal((await call('PATCH', `/providers/${id}`, { costIn: 0.0009, quality: 1.4 })).status, 400);
  const after = (await call('GET', '/providers')).json.find((m: { id: string }) => m.id === id);
  assert.equal(after.costIn, before.costIn);
  assert.equal(after.quality, before.quality);
  assert.equal(after.latencyMs, before.latencyMs);
});

test('what-if: no quality change is claimed when no traffic moves', async () => {
  await call('POST', '/chat', { conversation_id: 'w1', message: 'Where is order 55120?', language: 'en', use_case: 'order_status', customer_id: 'default' });
  const ws = await openWorkspace(await workspaceIdFor(LOCAL_USER));
  // A model that served nothing: nothing moves, so there is no quality comparison to show.
  const idle = ws.models.find((m) => m.id === 'gemini-2.5-pro')!;
  const r = (await call('POST', '/whatif/simulate', { fromModel: idle.id, toModel: 'gpt-5-mini', share: 0.5, turnType: 'all', volume: null })).json;
  assert.equal(r.movedTurnsPct, 0);
  assert.equal(r.qualityFrom, null);
  assert.equal(r.qualityTo, null);
  assert.equal(r.delta, 0);
});

test('what-if: the monthly rate is scaled from the logged sample it reports', async () => {
  const r = (await call('POST', '/whatif/simulate', { fromModel: 'gpt-5', toModel: 'gpt-5-mini', share: 0.5, turnType: 'all', volume: null })).json;
  assert.ok(r.loggedConversations >= 1);
  assert.ok(r.windowDays >= 1);
  assert.equal(Math.round(r.monthlyConversations), Math.round((r.loggedConversations / r.windowDays) * 30));
});

test('savings reconcile with total requests: answered + unanswered turns', async () => {
  // Every vendor down: the turn goes to a person and has no model cost.
  for (const v of ['openai', 'google', 'anthropic']) await call('PUT', `/vendors/${v}/state`, { state: 'down' });
  await call('POST', '/chat', { conversation_id: 'h1', message: 'hello?', language: 'en', use_case: 'faq', customer_id: 'default' });
  for (const v of ['openai', 'google', 'anthropic']) await call('PUT', `/vendors/${v}/state`, { state: 'healthy' });
  const o = (await call('GET', '/stats/overview?days=14')).json;
  const s = (await call('GET', '/stats/savings?days=14')).json;
  assert.ok(s.unansweredTurns >= 1);
  assert.equal(s.turns + s.uncoveredTurns + s.unansweredTurns, o.requests);
});

test('reset tests: clears runs, results, alerts and the scores they set, keeps traffic', async () => {
  const turnsBefore = (await call('GET', '/stats/overview?days=14')).json.requests;
  assert.equal((await call('POST', '/tests/run')).status, 200);
  assert.ok((await call('GET', '/tests/runs')).json.length >= 1);
  assert.ok((await call('GET', '/providers')).json.some((m: { testScore: number | null }) => m.testScore !== null));

  const r = await call('POST', '/tests/clear');
  assert.equal(r.status, 200);
  assert.ok(r.json.deletedRuns >= 1);
  assert.deepEqual((await call('GET', '/tests/runs')).json, []);
  assert.deepEqual((await call('GET', '/tests/results')).json, []);
  assert.deepEqual((await call('GET', '/alerts')).json, []);
  for (const m of (await call('GET', '/providers')).json) {
    assert.equal(m.testScore, null, m.id);
    assert.equal(m.excluded, false, m.id);
  }
  // Routing quality falls back to the configured estimate once segment scores are gone.
  const ws = await openWorkspace(await workspaceIdFor(LOCAL_USER));
  assert.deepEqual(ws.segments, {});
  assert.equal((await call('GET', '/stats/overview?days=14')).json.requests, turnsBefore);
});
