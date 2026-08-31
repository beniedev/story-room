import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');

const trackedFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'buffer',
}).toString('utf8').split('\0').filter(Boolean);

const binaryAllowlist = new Set([
  'assets/fonts/LXGWWenKaiLite-Regular.ttf.br',
  'public/icons/apple-icon-57x57.png',
  'public/icons/apple-icon-72x72.png',
  'public/icons/apple-icon-114x114.png',
  'public/icons/apple-icon-144x144.png',
  'public/icons/apple-icon-192x192.png',
  'public/icons/apple-icon-512x512.png',
  'public/icons/favicon.ico',
]);

const syntheticNetworkRules = [
  { file: 'README.md', pattern: /127\.0\.0\.1/g },
  { file: 'server/main.ts', pattern: /(?:127\.0\.0\.0|127\.0\.0\.1|0\.0\.0\.0|::1)/g },
  { file: 'server/providers.ts', pattern: /(?:0\.0\.0\.0|10\.0\.0\.0|100\.64\.0\.0|127\.0\.0\.0|169\.254\.0\.0|172\.16\.0\.0|192\.0\.0\.0|192\.168\.0\.0|198\.18\.0\.0|224\.0\.0\.0|240\.0\.0\.0|169\.254\.169\.254|100\.100\.100\.200|192\.0\.0\.192|fd00:ec2::254|fc00::|fec0::|ff00::|fe80::|::1|::ffff:(?:0\.0\.0\.0|10\.0\.0\.0|100\.64\.0\.0|127\.0\.0\.0|169\.254\.0\.0|172\.16\.0\.0|192\.0\.0\.0|192\.168\.0\.0|198\.18\.0\.0|224\.0\.0\.0|240\.0\.0\.0)|::$)/g },
  { file: 'tests/providers.test.ts', pattern: /(?:127\.0\.0\.1|8\.8\.8\.8|1\.1\.1\.1|192\.168\.1\.10|169\.254\.169\.254|100\.100\.100\.200|192\.0\.0\.192|fd00:ec2::254|fe80::1|fd12::10|::ffff:192\.168\.1\.10|::1)/g },
  { file: 'tests/server-entry.test.ts', pattern: /127\.0\.0\.1/g },
  { file: 'tests/store.test.ts', pattern: /127\.0\.0\.1/g },
  { file: 'scripts/dev.mjs', pattern: /127\.0\.0\.1/g },
  { file: 'vite.config.ts', pattern: /127\.0\.0\.1/g },
];

const isAllowedSyntheticNetwork = (file, value) => syntheticNetworkRules.some((rule) => {
  if (rule.file !== file) return false;
  rule.pattern.lastIndex = 0;
  return [...value.matchAll(rule.pattern)].length > 0;
});

const isSensitiveIpv4 = (value) => {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 168 || (second === 0 && octets[2] === 0)))
    || (first === 198 && (second === 18 || second === 19)) || first >= 224;
};

const sensitiveIpv6Addresses = new BlockList();
for (const [address, prefix] of [['fc00::', 7], ['fec0::', 10], ['fe80::', 10], ['ff00::', 8]]) {
  sensitiveIpv6Addresses.addSubnet(address, prefix, 'ipv6');
}
sensitiveIpv6Addresses.addAddress('::', 'ipv6');
sensitiveIpv6Addresses.addAddress('::1', 'ipv6');

const isSensitiveIpv6 = (value) => {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) !== 6) return false;
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return sensitiveIpv6Addresses.check(normalized, 'ipv6') || Boolean(mapped && isSensitiveIpv4(mapped[1]));
};

for (const [address, expected] of [['fd00::1', true], ['fe80::1', true], ['::1', true], ['2001:db8::1', false]]) {
  if (isSensitiveIpv6(address) !== expected) throw new Error('privacy scanner IPv6 self-check failed');
}

const textRules = [
  { name: 'personal absolute path', pattern: /(?:\b[A-Za-z]:[\\/](?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+|\/(?:Users|home|private\/var|var\/folders)[\/])/gi },
  { name: 'private email', pattern: /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi },
  { name: 'credential format', pattern: /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g },
  { name: 'hosting project identifier', pattern: /["']?project[_-]?id["']?\s*[:=]\s*["'][^"']+["']/gi },
];

const binaryPathRules = [
  /(?:\b[A-Za-z]:[\\/](?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+|\/(?:Users|home|private\/var|var\/folders)[\/])/gi,
  /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/g,
];

const isReservedEmailDomain = (domain) => domain === 'example.com' || domain === 'example.org'
  || domain === 'example.net' || domain === 'invalid' || domain === 'test' || domain.endsWith('.test')
  || domain.endsWith('.invalid');

const lineNumber = (text, index) => text.slice(0, index).split('\n').length;
const findings = [];

for (const rawFile of trackedFiles) {
  const relativeFile = rawFile.replaceAll('\\', '/');
  const absoluteFile = path.resolve(repoRoot, relativeFile);
  const relativeCheck = path.relative(repoRoot, absoluteFile);
  if (!relativeFile || relativeCheck === '..' || relativeCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCheck)) {
    findings.push(`${relativeFile}: path escapes repository root`);
    continue;
  }
  let fileStat;
  try {
    fileStat = lstatSync(absoluteFile);
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    findings.push(`${relativeFile}: could not inspect file`);
    continue;
  }
  if (fileStat.isSymbolicLink()) {
    findings.push(`${relativeFile}: symlink is not allowed`);
    continue;
  }
  if (!fileStat.isFile()) {
    findings.push(`${relativeFile}: non-regular file is not allowed`);
    continue;
  }

  const bytes = readFileSync(absoluteFile);
  const isBinary = bytes.includes(0) || /\.(?:br|png|ico|ttf|woff2?)$/i.test(relativeFile);
  if (isBinary) {
    if (!binaryAllowlist.has(relativeFile)) findings.push(`${relativeFile}: binary path is not allowlisted`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(hash)) findings.push(`${relativeFile}: binary hash could not be computed`);
    const raw = bytes.toString('latin1');
    for (const pattern of binaryPathRules) {
      pattern.lastIndex = 0;
      if (pattern.test(raw)) findings.push(`${relativeFile}: suspicious path or credential bytes`);
    }
    continue;
  }

  // The scanner's own signatures are policy code, not project data.
  if (relativeFile === 'scripts/privacy-scan.mjs') continue;
  const text = bytes.toString('utf8');
  for (const rule of textRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.name === 'private email' && isReservedEmailDomain(match[1].toLowerCase())) continue;
      findings.push(`${relativeFile}:${lineNumber(text, match.index ?? 0)}: ${rule.name}`);
    }
  }

  const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  for (const match of text.matchAll(ipv4Pattern)) {
    if (!isSensitiveIpv4(match[0])) continue;
    if (isAllowedSyntheticNetwork(relativeFile, match[0])) continue;
    findings.push(`${relativeFile}:${lineNumber(text, match.index ?? 0)}: private or metadata IPv4`);
  }
  const ipv6Pattern = /(?<![A-Za-z0-9])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f:.]*(?![A-Za-z0-9])/gi;
  for (const match of text.matchAll(ipv6Pattern)) {
    if (match[0] === '::') continue;
    if (!isSensitiveIpv6(match[0])) continue;
    if (isAllowedSyntheticNetwork(relativeFile, match[0])) continue;
    findings.push(`${relativeFile}:${lineNumber(text, match.index ?? 0)}: private or metadata IPv6`);
  }
}

if (findings.length) {
  console.error('privacy scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`privacy scan passed (${trackedFiles.length} current files checked)`);
}
