import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hostFlag = process.argv.indexOf('--host');
const requestedHost = (hostFlag >= 0 ? process.argv[hostFlag + 1] : '127.0.0.1')?.trim();
const host = requestedHost?.startsWith('[') && requestedHost.endsWith(']')
  ? requestedHost.slice(1, -1)
  : requestedHost;

if (!host || host.startsWith('--')) {
  console.error('Use: npm run dev -- --host <address>');
  process.exit(1);
}

const apiHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env.local'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const env = {
  ...process.env,
  STORY_HOST: host,
  STORY_API_HOST: apiHost,
  VITE_HOST: host,
};

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
