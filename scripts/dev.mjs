// Development runner: API server (tsx watch) + Vite dev server with proxy.
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  PORT: process.env.PORT || '8080',
  DATA_DIR: process.env.DATA_DIR || './data',
  NODE_ENV: 'development',
};

const procs = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'src/server/index.ts'], { stdio: 'inherit', shell: true, env }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const p of procs) {
  p.on('exit', (code) => {
    if (code) stop(code);
  });
}
