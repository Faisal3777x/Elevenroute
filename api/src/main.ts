import { existsSync } from 'node:fs';

// Load .env from the repo root or api/ before anything reads process.env.
for (const file of ['../.env', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { createApp } = await import('./server.ts');
const { state } = await import('./store.ts');

const port = Number(process.env.PORT) || 8000;
const host = process.env.HOST ?? '0.0.0.0';

createApp().listen(port, host, () => {
  console.log(`ElevenRoute API on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (${state.mode} mode)`);
});
