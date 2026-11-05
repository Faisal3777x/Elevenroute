// Starts the API and the Expo dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['--prefix', 'api', 'run', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['--prefix', 'app', 'start'], { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
