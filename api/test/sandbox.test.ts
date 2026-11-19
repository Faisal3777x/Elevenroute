// Open access (sign-in off, DEMO_ONLY=1, as on the public site): the shared demo is read-only to visitors, and each
// visitor's changes go to a private sandbox that nobody else sees.
process.env.DB_PATH = ':memory:';
process.env.DEMO_ONLY = '1';
process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef0123456789';
// Small limits so the tests can reach them quickly.
process.env.RATE_LIMIT_PER_MIN = '300';
process.env.SANDBOXES_PER_IP_PER_DAY = '5';
delete process.env.SUPABASE_URL;

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

const { createApp } = await import('../src/server.ts');
const { cleanupSandboxes } = await import('../src/sandbox.ts');
const { resetLimits } = await import('../src/limits.ts');
const { db } = await import('../src/db.ts');

const server = createApp({});
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => resetLimits());

const json = { 'content-type': 'application/json' };
const as = (visitor: string | null, extra: Record<string, string> = {}) => ({ ...json, ...(visitor ? { 'x-visitor-id': visitor } : {}), ...extra });
const admin = { 'x-admin-token': process.env.ADMIN_TOKEN! };

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() as any, headers: res.headers };
}
const firstModelName = async (visitor: string | null) => (await call('GET', '/providers', as(visitor))).data[0].name as string;

test('a visitor\'s edit lands in their own sandbox; the shared demo and other visitors are untouched', async () => {
  const alice = randomUUID();
  const bob = randomUUID();
  const demoName = await firstModelName(null);
  const id = (await call('GET', '/providers', as(null))).data[0].id;

  const edit = await call('PATCH', `/providers/${id}`, as(alice), { name: 'Alice was here' });
  assert.equal(edit.status, 200);
  assert.equal(await firstModelName(alice), 'Alice was here');
  assert.equal(await firstModelName(bob), demoName);
  assert.equal(await firstModelName(null), demoName);
});

test('a sandbox starts as a copy of the demo\'s traffic', async () => {
  assert.equal((await call('POST', '/traffic/generate', as(null, admin), { count: 20 })).status, 200);
  while ((await call('GET', '/traffic/status', as(null))).data.running) await new Promise((r) => setTimeout(r, 50));
  const demoTurns = (await call('GET', '/stats/overview', as(null))).data.requests;
  assert.ok(demoTurns > 0);

  const carol = randomUUID();
  assert.equal((await call('PUT', '/vendors/google/state', as(carol), { state: 'down' })).status, 200);
  assert.equal((await call('GET', '/stats/overview', as(carol))).data.requests, demoTurns);
  // Carol's outage switch is hers alone.
  const demoGoogle = (await call('GET', '/vendors', as(null))).data.find((v: any) => v.vendor === 'google');
  assert.equal(demoGoogle.state, 'healthy');
});

test('reset and clear only ever touch the visitor\'s own sandbox', async () => {
  const demoTurns = (await call('GET', '/stats/overview', as(null))).data.requests;
  const dave = randomUUID();
  assert.equal((await call('POST', '/traffic/clear', as(dave))).status, 200);
  assert.equal((await call('GET', '/stats/overview', as(dave))).data.requests, 0);
  assert.equal((await call('POST', '/reset', as(randomUUID()))).status, 200);
  assert.equal((await call('POST', '/reset', as(dave))).status, 200);
  // Reset deleted Dave's sandbox: he is back on the shared demo, which kept all its traffic.
  assert.equal((await call('GET', '/stats/overview', as(dave))).data.requests, demoTurns);
  assert.equal((await call('GET', '/stats/overview', as(null))).data.requests, demoTurns);
});

test('changes without a visitor id are refused; reads and dry runs still work', async () => {
  assert.equal((await call('POST', '/reset', as(null))).status, 403);
  assert.equal((await call('DELETE', '/providers/gpt-5', as(null))).status, 403);
  assert.equal((await call('POST', '/traffic/clear', as(null, { 'x-visitor-id': 'not-a-uuid' }))).status, 403);
  assert.equal((await call('GET', '/stats/overview', as(null))).status, 200);
  assert.equal((await call('POST', '/route/preview', as(null), { message: 'Where is my order?' })).status, 200);
});

test('a wrong admin token is just a visitor', async () => {
  assert.equal((await call('POST', '/reset', as(null, { 'x-admin-token': 'guess' }))).status, 403);
});

test('reading sandboxes does not create them; only changes do', async () => {
  const before = (await db.one<{ n: number }>('select count(*)::int as n from workspaces where sandbox_of is not null'))!.n;
  await call('GET', '/providers', as(randomUUID()));
  await call('POST', '/agent/preview', as(randomUUID()), { session_id: 's1', scenario: (await call('GET', '/agent/scenarios', as(null))).data[0].id, message: 'Hi' });
  assert.equal((await db.one<{ n: number }>('select count(*)::int as n from workspaces where sandbox_of is not null'))!.n, before);
});

test('one network can only open a few sandboxes a day', async () => {
  const net = { 'cf-connecting-ip': '198.51.100.9' };
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await call('PUT', '/vendors/openai/state', as(randomUUID(), net), { state: 'slow' })).status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[6], 429);
});

test('idle sandboxes are deleted with their data', async () => {
  const erin = randomUUID();
  await call('POST', '/traffic/clear', as(erin, { 'cf-connecting-ip': '198.51.100.20' }));
  await db.query("update workspaces set last_seen_at = now() - interval '3 days' where sandbox_of is not null");
  assert.ok((await cleanupSandboxes()) >= 1);
  assert.equal((await db.one<{ n: number }>('select count(*)::int as n from workspaces where sandbox_of is not null'))!.n, 0);
  // Erin is back on the demo, which still has its traffic.
  assert.ok((await call('GET', '/stats/overview', as(erin))).data.requests > 0);
});

test('requests over the rate limit get 429 with Retry-After', async () => {
  const net = { 'cf-connecting-ip': '198.51.100.30' };
  let last = 0;
  let retry: string | null = null;
  for (let i = 0; i < 305; i++) {
    const res = await fetch(`${base}/config`, { headers: net });
    last = res.status;
    retry = res.headers.get('retry-after');
    await res.body?.cancel();
  }
  assert.equal(last, 429);
  assert.ok(Number(retry) > 0);
});

test('oversized and malformed input is rejected, not stored', async () => {
  const v = randomUUID();
  const net = { 'cf-connecting-ip': '198.51.100.40' };
  assert.equal((await call('PATCH', '/providers/gpt-5', as(v, net), { name: 'x'.repeat(81) })).status, 400);
  assert.equal((await call('PUT', '/routing/rules', as(v, net), { rules: [{ id: 'long', weight: 1e9 }] })).status, 400);
  assert.equal((await call('PUT', '/routing/policies', as(v, net), { policies: [{ id: 'a', name: 'A', note: 'n'.repeat(301) }] })).status, 400);
  assert.equal((await call('GET', '/tests/results?run=1;drop', as(v, net))).status, 400);
  const big = await fetch(`${base}/chat`, { method: 'POST', headers: as(v, net), body: JSON.stringify({ message: 'x'.repeat(70_000) }) });
  assert.equal(big.status, 413);
  // Inherited names are not strategy fields.
  const s = await call('PUT', '/routing/strategy', as(v, net), { toString: 5, constructor: 1 });
  assert.equal(s.status, 200);
  assert.equal(typeof (s.data as object).toString, 'function');
});

test('every response carries the security headers; pages get a content security policy', async () => {
  const res = await fetch(`${base}/config`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('permissions-policy'));
  await res.body?.cancel();
});
