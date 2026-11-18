process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/server.ts');

const webDir = mkdtempSync(join(tmpdir(), 'elevenroute-web-'));
mkdirSync(join(webDir, 'assets'));
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>ElevenRoute</title>');
writeFileSync(join(webDir, 'assets', 'app-123.js'), 'console.log(1)');
writeFileSync(join(webDir, 'promo.mp4'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));

const server = createApp({ password: 'team-secret-1', webDir });
let base = '';
const auth = { authorization: `Basic ${Buffer.from('team:team-secret-1').toString('base64')}` };
const wrong = { authorization: `Basic ${Buffer.from('team:nope').toString('base64')}` };

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(webDir, { recursive: true, force: true });
});

const tunnel = { 'cf-connecting-ip': '203.0.113.7' };

test('share mode: the public link (tunnel) needs the password, except /health', async () => {
  assert.equal((await fetch(`${base}/health`, { headers: tunnel })).status, 200);
  const anon = await fetch(`${base}/api/config`, { headers: tunnel });
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('www-authenticate') ?? '', /^Basic/);
  assert.equal((await fetch(`${base}/`, { headers: { ...tunnel, accept: 'text/html' } })).status, 401);
  assert.equal((await fetch(`${base}/providers`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 401);
  assert.equal((await fetch(`${base}/api/config`, { headers: { ...tunnel, ...wrong } })).status, 401);
  const ok = await fetch(`${base}/api/config`, { headers: { ...tunnel, ...auth } });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { mode: string }).mode, 'demo');
});

test('share mode: direct connections on the network (Expo Go, same Wi-Fi) need no password', async () => {
  assert.equal((await fetch(`${base}/providers`)).status, 200);
  assert.equal((await fetch(`${base}/`, { headers: { accept: 'text/html' } })).status, 200);

  const strict = createApp({ password: 'team-secret-1', requirePasswordLocally: true });
  await new Promise<void>((r) => strict.listen(0, '127.0.0.1', r));
  const strictBase = `http://127.0.0.1:${(strict.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${strictBase}/providers`)).status, 401);
  assert.equal((await fetch(`${strictBase}/providers`, { headers: auth })).status, 200);
  strict.close();
});

test('share mode: serves the dashboard, its assets and page refreshes; API stays reachable', async () => {
  const page = await fetch(`${base}/`, { headers: { ...auth, accept: 'text/html' } });
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await page.text(), /ElevenRoute/);

  const js = await fetch(`${base}/assets/app-123.js`, { headers: auth });
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  assert.match(js.headers.get('cache-control') ?? '', /immutable/);

  // A browser refresh on /providers gets the app; the phone app's JSON call to /providers still gets data.
  const refresh = await fetch(`${base}/providers`, { headers: { ...auth, accept: 'text/html' } });
  assert.match(await refresh.text(), /<title>ElevenRoute/);
  const data = await fetch(`${base}/providers`, { headers: { ...auth, accept: 'application/json' } });
  assert.ok(Array.isArray(await data.json()));
  const prefixed = await fetch(`${base}/api/providers`, { headers: { ...auth, accept: 'text/html' } });
  assert.ok(Array.isArray(await prefixed.json()));
});

test('share mode: video is served as video/mp4 with byte ranges, so every browser can play and seek it', async () => {
  const full = await fetch(`${base}/promo.mp4`, { headers: auth });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal((await full.arrayBuffer()).byteLength, 1000);

  const part = await fetch(`${base}/promo.mp4`, { headers: { ...auth, range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  const bytes = new Uint8Array(await part.arrayBuffer());
  assert.equal(bytes.length, 100);
  assert.equal(bytes[0], 100);

  const tail = await fetch(`${base}/promo.mp4`, { headers: { ...auth, range: 'bytes=-10' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 990-999/1000');
  assert.equal((await fetch(`${base}/promo.mp4`, { headers: { ...auth, range: 'bytes=5000-' } })).status, 416);

  const again = await fetch(`${base}/promo.mp4`, { headers: { ...auth, 'if-modified-since': full.headers.get('last-modified') ?? '' } });
  assert.equal(again.status, 304);
});

test('share mode: never serves files outside the dashboard folder', async () => {
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%5c..%5cpackage.json']) {
    const res = await fetch(base + p, { headers: auth });
    const body = await res.text();
    assert.ok(!body.includes('"devDependencies"'), `${p} leaked a file`);
  }
});
