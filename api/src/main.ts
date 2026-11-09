import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env from the repo root or api/ before anything reads process.env.
for (const file of ['../.env', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { createApp } = await import('./server.ts');
const { backend } = await import('./db.ts');
const { authEnabled } = await import('./auth.ts');

const port = Number(process.env.PORT) || 8000;
const host = process.env.HOST ?? '0.0.0.0';
const password = process.env.ACCESS_PASSWORD || undefined;

// SERVE_WEB=1 serves the built dashboard (web/dist) from this server, as `npm run share` does.
const webDir = process.env.SERVE_WEB ? resolve(import.meta.dirname, '../../web/dist') : undefined;
if (webDir && !existsSync(resolve(webDir, 'index.html'))) {
  console.error('SERVE_WEB is set but web/dist is missing. Build it first: npm --prefix web run build');
  process.exit(1);
}

const requirePasswordLocally = process.env.REQUIRE_PASSWORD_LOCALLY === '1';

createApp({ password, requirePasswordLocally, webDir }).listen(port, host, () => {
  const where = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  const guard = password && !authEnabled ? (requirePasswordLocally ? ', password required' : ', password required on the public link') : '';
  console.log(`ElevenRoute API on ${where}${guard}`);
  console.log(`  Database: ${backend === 'supabase' ? 'Supabase Postgres (DATABASE_URL)' : 'local embedded Postgres in api/data/pglite'}`);
  console.log(`  Sign-in: ${authEnabled ? 'Supabase Auth (SUPABASE_URL)' : 'OFF - every request acts as one local user. Set SUPABASE_URL to require sign-in.'}`);
  if (webDir) console.log(`Web dashboard on ${where}`);
});
