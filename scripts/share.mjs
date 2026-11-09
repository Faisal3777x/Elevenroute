// Shares the web dashboard with your team.
//   npm run share          -> one server on :8000 (dashboard + API), reachable on your network
//   npm run share:public   -> the same, plus a public HTTPS link through a free Cloudflare quick tunnel
// Open to everyone by default. Set SHARE_PASSWORD (env or .env, 8+ characters) to put a password on the
// public link; it reaches the API as ACCESS_PASSWORD and only applies while sign-in is off.
// With sign-in off, every visitor shares one workspace, so the API runs with DEMO_ONLY=1 (live mode locked).
// Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const PORT = Number(process.env.PORT) || 8000;
const isPublic = process.argv.includes('--public');
const password = process.env.SHARE_PASSWORD || '';
if (password && password.length < 8) fail('SHARE_PASSWORD must be at least 8 characters.');
const signIn = Boolean(process.env.SUPABASE_URL);
const gated = Boolean(password) && !signIn;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const portBusy = () =>
  new Promise((done) => {
    const s = net.connect(PORT, '127.0.0.1');
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('error', () => done(false));
  });

if (await portBusy()) {
  fail(`Port ${PORT} is already in use. Close the "ElevenRoute API" window or stop "npm run dev" first (sharing runs its own copy of the API).`);
}

console.log('Building the web dashboard...');
const build = spawnSync('npm', ['--prefix', 'web', 'run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
if (build.status) fail('The dashboard build failed (see above).');

const procs = [];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const api = spawn('npm', ['--prefix', 'api', 'start'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: String(PORT), SERVE_WEB: '1', ACCESS_PASSWORD: password, ...(signIn ? {} : { DEMO_ONLY: '1' }) },
});
procs.push(api);
api.on('exit', (code) => code && fail('The API stopped (see above).'));

// Wait for the server to answer.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
  } catch {}
  if (i > 60) fail('The API did not start within 30 seconds.');
  await new Promise((r) => setTimeout(r, 500));
}

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
  .map((a) => `http://${a.address}:${PORT}`);

let publicUrl = null;
if (isPublic) publicUrl = await startTunnel();

const expoUp = await fetch('http://127.0.0.1:8081/status').then((r) => r.ok, () => false);
const ips = lan.map((u) => new URL(u).hostname);

const line = (label, value) => console.log(`  ${label.padEnd(18)}${value}`);
console.log('\n========================================================');
console.log('  ElevenRoute is shared');
console.log('========================================================');
console.log('  Same Wi-Fi / office network:');
for (const u of lan) line('  Web dashboard:', u);
for (const ip of ips) line('  Expo Go app:', expoUp ? `exp://${ip}:8081` : '(start it: npm run app, then scan the QR code)');
if (publicUrl) {
  console.log(gated ? '\n  Anywhere (needs the password):' : '\n  Anywhere:');
  line('  Public link:', publicUrl);
  if (gated) line('  Password:', `${password}   (username: anything)`);
}
console.log('--------------------------------------------------------');
console.log(signIn ? '  Sign-in: on (each person has their own workspace).' : '  Open access: no sign-in, everyone shares one workspace. Live mode is locked (demo only).');
console.log('  Expo Go: scan the QR code in the Expo window, or open the exp:// link on the phone.');
if (!publicUrl) console.log('  For teammates on other networks, run: npm run share:public');
else console.log('  The public link changes each time you run share:public.');
console.log('  Keep this window open. Ctrl+C stops sharing.\n');

async function startTunnel() {
  const bin = await findCloudflared();
  console.log('Opening a public link with Cloudflare (no account needed)...');
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(tunnel);
  tunnel.on('exit', (code) => console.error(`\nThe public link closed (cloudflared exited with ${code}). Local and network links still work.`));
  return new Promise((done) => {
    const timer = setTimeout(() => {
      console.error('No public link from Cloudflare after 45 seconds. Check your internet connection and try again.');
      done(null);
    }, 45_000);
    const scan = (chunk) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
      if (m) {
        clearTimeout(timer);
        done(m[0]);
      }
    };
    tunnel.stdout.on('data', scan);
    tunnel.stderr.on('data', scan);
  });
}

/** cloudflared on PATH, else tools/cloudflared(.exe), downloading the official release on Windows if needed. */
async function findCloudflared() {
  const onPath = spawnSync('cloudflared', ['--version'], { stdio: 'ignore', shell: true });
  if (onPath.status === 0) return 'cloudflared';
  const exe = join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(exe)) return exe;

  const assets = { 'win32-x64': 'cloudflared-windows-amd64.exe', 'win32-arm64': 'cloudflared-windows-amd64.exe', 'linux-x64': 'cloudflared-linux-amd64', 'linux-arm64': 'cloudflared-linux-arm64' };
  const asset = assets[`${process.platform}-${process.arch}`];
  if (!asset) fail('Install cloudflared first (macOS: brew install cloudflared), then run npm run share:public again.');
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  console.log(`Downloading cloudflared from ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) fail(`Could not download cloudflared (HTTP ${res.status}). Install it manually: winget install --id Cloudflare.cloudflared`);
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== 'win32') chmodSync(exe, 0o755);
  return exe;
}
