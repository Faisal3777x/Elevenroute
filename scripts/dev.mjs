// Starts the API and the web dashboard together. Ctrl+C stops both.
//   npm run dev        -> uses .env and web/.env.local as they are (Supabase sign-in if configured), API on :8000
//   npm run dev:local  -> sign-in OFF, local database (api/data/pglite), API on :8001 so it can run next to
//                         `npm run share` / `share:public` on :8000. Nothing touches Supabase.
import { spawn } from 'node:child_process';

const local = process.argv.includes('--local');
const apiPort = local ? '8001' : process.env.PORT || '8000';

// Variables set here win over .env files: Node's loadEnvFile and Vite both keep values already in the environment.
const apiEnv = local ? { PORT: apiPort, SUPABASE_URL: '', DATABASE_URL: '' } : {};
const webEnv = local ? { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_API_URL: `http://localhost:${apiPort}` } : {};

const procs = [
  spawn('npm', ['--prefix', 'api', 'run', 'dev'], { stdio: 'inherit', shell: true, env: { ...process.env, ...apiEnv } }),
  spawn('npm', ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit', shell: true, env: { ...process.env, ...webEnv } }),
];

if (local) {
  setTimeout(() => {
    console.log('\n========================================================');
    console.log('  ElevenRoute LOCAL (no sign-in, local database)');
    console.log('  Website:  http://localhost:5173');
    console.log(`  API:      http://localhost:${apiPort}`);
    console.log('  Edits to web/src show up instantly; API changes restart it.');
    console.log('========================================================\n');
  }, 4000);
}

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
