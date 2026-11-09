// Sign-in and workspace isolation, with Supabase-style tokens signed by a test secret (legacy HS256 path).
process.env.DB_PATH = ':memory:';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.LIVE_MODE_EMAILS = 'admin@example.com';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { SignJWT } from 'jose';

const { createApp } = await import('../src/server.ts');

const server = createApp();
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const key = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
async function token(sub: string, email: string, opts: { exp?: string; issuer?: string; secret?: Uint8Array } = {}) {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuer(opts.issuer ?? `${process.env.SUPABASE_URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.secret ?? key);
}

const call = async (method: string, path: string, jwt?: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
};

const alice = { id: crypto.randomUUID(), email: 'alice@example.com' };
const bob = { id: crypto.randomUUID(), email: 'bob@example.com' };

test('requests without a valid session are rejected; /health stays open', async () => {
  assert.equal((await call('GET', '/health')).status, 200);
  assert.equal((await call('GET', '/providers')).status, 401);
  assert.equal((await call('GET', '/providers', 'not-a-jwt')).status, 401);
  assert.equal((await call('GET', '/providers', await token(alice.id, alice.email, { secret: new TextEncoder().encode('some-other-secret-value-0000000000') }))).status, 401, 'forged signature');
  assert.equal((await call('GET', '/providers', await token(alice.id, alice.email, { exp: '-1m' }))).status, 401, 'expired');
  assert.equal((await call('GET', '/providers', await token(alice.id, alice.email, { issuer: 'https://evil.example.com/auth/v1' }))).status, 401, 'wrong issuer');
});

test('each user gets a personal workspace and only sees their own data', async () => {
  const a = await token(alice.id, alice.email);
  const b = await token(bob.id, bob.email);

  const meA = await call('GET', '/me', a);
  const meB = await call('GET', '/me', b);
  assert.equal(meA.status, 200);
  assert.equal(meA.json.user.email, alice.email);
  assert.equal(meA.json.auth, 'supabase');
  assert.notEqual(meA.json.workspace.id, meB.json.workspace.id);
  assert.equal((await call('GET', '/me', a)).json.workspace.id, meA.json.workspace.id, 'stable across requests');

  // Alice's traffic, settings and tests stay in Alice's workspace.
  await call('POST', '/traffic/generate', a, { count: 15 });
  await call('PUT', '/routing/strategy', a, { latencyBudgetMs: 3100 });
  await call('PATCH', '/providers/gpt-5-mini', a, { enabled: false });
  await call('POST', '/tests/run', a);
  await call('PUT', '/vendors/google/state', a, { state: 'down' });

  assert.ok((await call('GET', '/stats/overview', a)).json.requests > 0);
  assert.equal((await call('GET', '/stats/overview', b)).json.requests, 0);
  assert.equal((await call('GET', '/routing', b)).json.strategy.latencyBudgetMs, 2000);
  assert.equal((await call('GET', '/providers', b)).json.find((m: any) => m.id === 'gpt-5-mini').enabled, true);
  assert.equal((await call('GET', '/tests/runs', b)).json.length, 0);
  assert.equal((await call('GET', '/vendors', b)).json.find((v: any) => v.vendor === 'google').state, 'healthy');

  // A run id from Alice's workspace returns nothing for Bob.
  const runId = (await call('GET', '/tests/runs', a)).json[0].id;
  assert.ok((await call('GET', `/tests/results?run=${runId}`, a)).json.length > 0);
  assert.equal((await call('GET', `/tests/results?run=${runId}`, b)).json.length, 0);

  // Bob clearing or resetting doesn't touch Alice.
  await call('POST', '/traffic/clear', b);
  await call('POST', '/reset', b);
  assert.ok((await call('GET', '/stats/overview', a)).json.requests > 0);
  assert.equal((await call('GET', '/routing', a)).json.strategy.latencyBudgetMs, 3100);
});

test('live mode is limited to LIVE_MODE_EMAILS', async () => {
  const b = await token(bob.id, bob.email);
  assert.equal((await call('GET', '/config', b)).json.liveAllowed, false);
  assert.equal((await call('POST', '/mode', b, { mode: 'live' })).status, 403);
  const admin = await token(crypto.randomUUID(), 'admin@example.com');
  assert.equal((await call('GET', '/config', admin)).json.liveAllowed, true);
  assert.equal((await call('POST', '/mode', admin, { mode: 'live' })).status, 200);
});
