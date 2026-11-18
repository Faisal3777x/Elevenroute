process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import type { AgentScenarioId, AgentTurnResponse, Language } from '../../shared/types.ts';

const { agentScenarios, agentTurn } = await import('../src/agent.ts');
const { createApp } = await import('../src/server.ts');
const { openWorkspace, workspaceIdFor } = await import('../src/store.ts');
const { db } = await import('../src/db.ts');

let ws: Awaited<ReturnType<typeof openWorkspace>>;
let n = 0;

beforeEach(async () => {
  ws = await openWorkspace(await workspaceIdFor({ id: crypto.randomUUID(), email: 'agent@example.com' }));
  // Quick and deterministic: no simulated wait worth noticing, no random provider errors.
  for (const m of ws.models) Object.assign(m, { latencyMs: 5, errorRate: 0 });
});

const say = (session_id: string, message: string, scenario: AgentScenarioId = 'refund', language: Language = 'en') =>
  agentTurn(ws, { session_id, scenario, language, customer_id: 'default', message });
const fresh = () => `s${++n}`;
const slot = (r: AgentTurnResponse, id: string) => r.session.slots.find((s) => s.id === id)!.value;

test('the scripted refund call reaches its goal and keeps state across turns and models', async () => {
  const id = fresh();
  const [first, second, third] = agentScenarios().find((s) => s.id === 'refund')!.script.en;

  const a = await say(id, first);
  assert.equal(a.route.turn_type, 'complex');
  assert.deepEqual(a.filled, ['issue']);
  assert.equal(a.session.awaiting, 'order');
  assert.equal(a.calls.length, 0);

  const b = await say(id, second);
  assert.equal(b.route.turn_type, 'simple');
  assert.equal(slot(b, 'issue'), 'Duplicate charge', 'what the customer said in turn 1 is still known in turn 2');
  assert.equal(slot(b, 'order'), '48213');
  assert.deepEqual(b.calls.map((c) => c.id), ['sf.case.lookup', 'sap.payments.list']);
  assert.equal(b.session.awaiting, 'confirm');
  assert.notEqual(b.route.model_used, a.route.model_used, 'the simple turn moved to a cheaper model');
  assert.ok(b.contextTokens > a.contextTokens, 'later turns carry the conversation so far as context');

  const c = await say(id, third);
  assert.equal(c.session.status, 'done');
  assert.deepEqual(c.calls.map((x) => x.id), ['sap.refund.post', 'sf.case.close']);
  assert.ok(c.calls.every((x) => x.write));
  assert.match(c.reply, /RF-48213/);
  assert.equal(c.session.turns, 3);
  assert.equal(c.session.models.length, 3);
  assert.ok(c.session.costUsd > 0);
});

test('every scripted conversation reaches its goal with simple and complex turns', async () => {
  for (const sc of agentScenarios()) {
    for (const language of ['en'] as const) {
      const id = fresh();
      const types = new Set<string>();
      let last: AgentTurnResponse | undefined;
      for (const line of sc.script[language]) {
        last = await say(id, line, sc.id, language);
        types.add(last.route.turn_type);
      }
      assert.equal(last!.session.status, 'done', `${sc.id}/${language}`);
      assert.ok(last!.session.slots.every((s) => s.value !== null), `${sc.id}/${language}: every slot filled`);
      assert.equal(last!.session.calls.length, sc.tools.length, `${sc.id}/${language}: every tool ran once`);
      assert.deepEqual([...types].sort(), ['complex', 'simple'], `${sc.id}/${language}: the script shows both routes`);
    }
  }
});

test('details given early are used at once, and a "yes" before any proposal changes nothing', async () => {
  const r = await say(fresh(), 'Yes please, I was charged twice on order 48213.');
  assert.equal(slot(r, 'order'), '48213');
  assert.equal(slot(r, 'issue'), 'Duplicate charge');
  assert.equal(slot(r, 'confirm'), null);
  assert.equal(r.session.awaiting, 'confirm');
  assert.ok(r.calls.length > 0 && r.calls.every((c) => !c.write), 'only reads ran');
});

test('nothing is written when the customer declines', async () => {
  const id = fresh();
  await say(id, 'I was charged twice on order 48213.');
  const r = await say(id, 'No, leave it for now.');
  assert.equal(r.session.status, 'declined');
  assert.ok(r.session.calls.every((c) => !c.write));
});

test('an unclear answer is asked again without losing state', async () => {
  const id = fresh();
  await say(id, 'I was charged twice.');
  const r = await say(id, 'It was last week I think.');
  assert.equal(r.session.awaiting, 'order');
  assert.equal(slot(r, 'issue'), 'Duplicate charge');
  assert.match(r.reply, /^Sorry, I didn't catch that/);
});

test('a vendor outage mid-conversation fails over and the agent carries on', async () => {
  const id = fresh();
  const a = await say(id, 'I was charged twice on order 48213.');
  const vendor = a.route.provider!;
  ws.vendorStates[vendor] = 'down';
  const b = await say(id, 'Yes, go ahead, thanks.');
  assert.equal(b.session.status, 'done');
  assert.notEqual(b.route.provider, vendor);
  assert.equal(slot(b, 'order'), '48213');
});

test('when no model can answer, a person takes over with the state intact', async () => {
  const id = fresh();
  await say(id, 'I was charged twice.');
  ws.vendorStates = { openai: 'down', google: 'down', anthropic: 'down' };
  const r = await say(id, 'My order number is 48213.');
  assert.equal(r.route.model_used, null);
  assert.equal(r.session.status, 'handoff');
  assert.equal(slot(r, 'order'), '48213');
  assert.equal(slot(r, 'issue'), 'Duplicate charge');
});

test('asking for a person hands off', async () => {
  const r = await say(fresh(), 'Can I speak to a real person?');
  assert.equal(r.session.status, 'handoff');
});

test('agent turns are logged in the turns table like any routed turn', async () => {
  const id = fresh();
  await say(id, 'I was charged twice on order 48213.');
  const row = await db.one<{ n: number }>('select count(*)::int as n from turns where workspace_id = $1 and conversation_id = $2', [ws.id, id]);
  assert.equal(row!.n, 1);
});

test('each call is compared with the same tokens on the best allowed model', async () => {
  const id = fresh();
  const [first, second] = agentScenarios().find((s) => s.id === 'refund')!.script.en;
  const a = await say(id, first);
  // A complex turn already goes to the best model, so routing saves nothing on it.
  assert.equal(a.baseline!.modelId, a.route.model_used);
  assert.ok(Math.abs(a.baseline!.costUsd - a.route.cost_usd) < 1e-12);
  const b = await say(id, second);
  assert.ok(b.baseline!.costUsd > b.route.cost_usd, 'the simple turn cost less than it would on the best model');
  assert.ok(Math.abs(b.session.baselineUsd - (a.baseline!.costUsd + b.baseline!.costUsd)) < 1e-12);
  assert.ok(b.session.baselineUsd > b.session.costUsd);
});

test('"no problem, go ahead" is a yes', async () => {
  const id = fresh();
  await say(id, 'I was charged twice on order 48213.');
  const r = await say(id, 'No problem, go ahead.');
  assert.equal(r.session.status, 'done');
});

test('a dry run plays the same loop without logging, waiting or touching the breaker', async () => {
  for (const m of ws.models) m.latencyMs = 1500; // would take seconds if the run really waited
  ws.vendorStates.anthropic = 'down';
  const id = fresh();
  const started = performance.now();
  let last: AgentTurnResponse | undefined;
  for (const line of agentScenarios().find((s) => s.id === 'refund')!.script.en) {
    last = await agentTurn(ws, { session_id: id, scenario: 'refund', language: 'en', customer_id: 'default', message: line }, { dry: true });
  }
  assert.ok(performance.now() - started < 1000);
  assert.equal(last!.session.status, 'done');
  assert.ok(last!.session.latencyMs > 1000, 'latency is still computed');
  assert.ok(!ws.breaker.isOpen('anthropic'), "the dry run's failures stay off the workspace breaker");
  assert.equal(ws.agentSessions.has(id), false, 'a finished dry run is dropped');
  const row = await db.one<{ n: number }>('select count(*)::int as n from turns where workspace_id = $1 and conversation_id = $2', [ws.id, id]);
  assert.equal(row!.n, 0);
});

// ---- over HTTP ----
const server = createApp();
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

test('the agent endpoints validate input and refuse a finished conversation', async () => {
  const scenarios = await call('GET', '/agent/scenarios');
  assert.equal(scenarios.status, 200);
  assert.deepEqual(scenarios.json.map((s: { id: string }) => s.id), ['refund', 'insurance', 'appointment']);

  assert.equal((await call('POST', '/agent/turn', { session_id: 'h1', scenario: 'nope', message: 'hi' })).status, 400);
  assert.equal((await call('POST', '/agent/turn', { session_id: 'h1', scenario: 'refund', message: '' })).status, 400);

  const turn = { session_id: 'h2', scenario: 'refund', language: 'en', customer_id: 'default' };
  assert.equal((await call('POST', '/agent/turn', { ...turn, message: 'Can I speak to a real person?' })).status, 200);
  assert.equal((await call('POST', '/agent/turn', { ...turn, message: 'Hello?' })).status, 409);
  assert.equal((await call('POST', '/agent/turn', { ...turn, session_id: 'h3', message: 'I was charged twice.' })).status, 200);
  assert.equal((await call('POST', '/agent/turn', { ...turn, session_id: 'h3', scenario: 'insurance', message: 'Hello' })).status, 400);
});
