import { spawn } from 'node:child_process';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hostFlag = process.argv.indexOf('--host');
const host = (hostFlag >= 0 ? process.argv[hostFlag + 1] : '127.0.0.1')?.trim();

const loopbackHosts = new BlockList();
loopbackHosts.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackHosts.addAddress('::1', 'ipv6');
loopbackHosts.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

const isLoopbackHost = (value) => {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') return true;
  const version = isIP(hostname);
  return version === 4
    ? loopbackHosts.check(hostname, 'ipv4')
    : version === 6 && loopbackHosts.check(hostname, 'ipv6');
};

if (!host || host.startsWith('--')) {
  console.error('Use: npm run dev -- --host 127.0.0.1');
  process.exit(1);
}

if (!isLoopbackHost(host)) {
  console.error('Story host only supports local loopback addresses.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env.local'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const env = {
  ...process.env,
  STORY_HOST: host,
  STORY_API_HOST: host,
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
