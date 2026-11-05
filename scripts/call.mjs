// Tiny CLI for the API: node scripts/call.mjs POST /traffic/generate
const [method = 'GET', path = '/health'] = process.argv.slice(2);
const base = process.env.API_URL ?? 'http://localhost:8000';

try {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  console.log(JSON.stringify(await res.json(), null, 2));
  process.exitCode = res.ok ? 0 : 1;
} catch {
  console.error(`Can't reach the API at ${base}. Start it with: npm run api`);
  process.exitCode = 1;
}
