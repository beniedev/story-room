import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hostFlag = process.argv.indexOf('--host');
const host = hostFlag >= 0 ? process.argv[hostFlag + 1] : '127.0.0.1';

if (!host || host.startsWith('--')) {
  console.error('Use: npm run dev -- --host <private-address>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  STORY_HOST: host,
  STORY_API_HOST: host,
  VITE_HOST: host,
};

if (host !== '127.0.0.1' && host !== 'localhost') {
  console.warn('Development mode: do not expose this server to the public internet.');
}

const children = [
  spawn(process.execPath, ['--watch', path.join(root, 'server', 'main.ts')], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host], { cwd: root, env, stdio: 'inherit' }),
];

let closing = false;
const close = (code = 0) => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
};

for (const child of children) {
  child.on('exit', (code) => {
    if (!closing && code && code !== 0) close(code);
  });
}

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
