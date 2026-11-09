// Open access (sign-in off, DEMO_ONLY=1, as `npm run share` sets it): anyone can use the dashboard, nobody can turn on live mode.
process.env.DB_PATH = ':memory:';
process.env.DEMO_ONLY = '1';
delete process.env.SUPABASE_URL;

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/server.ts');
const { openWorkspace, workspaceIdFor } = await import('../src/store.ts');
const { LOCAL_USER } = await import('../src/auth.ts');

const server = createApp({});
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const tunnel = { 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json' };

test('open access: the public link works without a password or sign-in', async () => {
  const res = await fetch(`${base}/api/config`, { headers: tunnel });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).liveAllowed, false);
});

test('open access: switching to live mode is refused', async () => {
  const res = await fetch(`${base}/mode`, { method: 'POST', headers: tunnel, body: JSON.stringify({ mode: 'live' }) });
  assert.equal(res.status, 403);
  assert.equal((await (await fetch(`${base}/config`)).json()).mode, 'demo');
});

test('open access: a workspace left in live mode drops back to demo on the next request', async () => {
  const ws = await openWorkspace(await workspaceIdFor(LOCAL_USER));
  ws.mode = 'live';
  await ws.save('mode');
  assert.equal((await (await fetch(`${base}/config`)).json()).mode, 'demo');
  assert.equal(ws.mode, 'demo');
});
