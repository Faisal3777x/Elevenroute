// Starts the API and the web dashboard together. Ctrl+C stops both.
// For the phone app (QR code), run `npm run app` in a second terminal.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['--prefix', 'api', 'run', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
