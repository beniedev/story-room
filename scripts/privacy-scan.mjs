import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, inflateSync } from 'node:zlib';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const sha256Pattern = /^[a-f0-9]{64}$/;

// Keep this map explicit. A new binary is a release decision, not an automatic discovery.
const binaryAllowlist = new Map([
  ['assets/fonts/LXGWWenKaiLite-Regular.ttf.br', {
    format: 'brotli-font',
    sha256: 'b3eb68cfb287957f43c8752dcac219a144b41306d71b2b46cdf3dbc2f89e126a',
  }],
]);

for (const [file, entry] of binaryAllowlist) {
  if (!sha256Pattern.test(entry.sha256)) throw new Error(`${file}: invalid fixed SHA-256 in allowlist`);
}

const trackedFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'buffer',
}).toString('utf8').split('\0').filter(Boolean);
const trackedFileSet = new Set(trackedFiles.map((file) => file.replaceAll('\\', '/')));
const findings = [];

for (const file of binaryAllowlist.keys()) {
  if (!trackedFileSet.has(file)) findings.push(`${file}: allowlisted binary is missing`);
}

const syntheticNetworkRules = [
  { file: 'README.md', pattern: /(?:0\.0\.0\.0|127\.0\.0\.1|::1)/g },
  { file: 'README.en.md', pattern: /(?:0\.0\.0\.0|127\.0\.0\.1|::1)/g },
  { file: 'SECURITY.md', pattern: /(?:127\.0\.0\.1|::1)/g },
  { file: 'docs/decisions/0001-local-host-web-demo.md', pattern: /(?:127\.0\.0\.1|::1)/g },
  { file: 'server/main.ts', pattern: /(?:127\.0\.0\.0|127\.0\.0\.1|0\.0\.0\.0|::1)/g },
  { file: 'server/providers.ts', pattern: /(?:0\.0\.0\.0|10\.0\.0\.0|100\.64\.0\.0|127\.0\.0\.0|169\.254\.0\.0|172\.16\.0\.0|192\.0\.0\.0|192\.168\.0\.0|198\.18\.0\.0|224\.0\.0\.0|240\.0\.0\.0|169\.254\.169\.254|100\.100\.100\.200|192\.0\.0\.192|fd00:ec2::254|fc00::|fec0::|ff00::|fe80::|::1|::ffff:(?:0\.0\.0\.0|10\.0\.0\.0|100\.64\.0\.0|127\.0\.0\.0|169\.254\.0\.0|172\.16\.0\.0|192\.0\.0\.0|192\.168\.0\.0|198\.18\.0\.0|224\.0\.0\.0|240\.0\.0\.0)|::$)/g },
  { file: 'tests/providers.test.ts', pattern: /(?:127\.0\.0\.1|8\.8\.8\.8|1\.1\.1\.1|192\.168\.1\.10|169\.254\.169\.254|100\.100\.100\.200|192\.0\.0\.192|fd00:ec2::254|fe80::1|fd12::10|::ffff:192\.168\.1\.10|::1)/g },
  { file: 'tests/server-entry.test.ts', pattern: /(?:0\.0\.0\.0|127\.0\.0\.1|::1)/g },
  { file: 'tests/store.test.ts', pattern: /127\.0\.0\.1/g },
  { file: 'scripts/dev.mjs', pattern: /(?:0\.0\.0\.0|127\.0\.0\.1|::1|::)$/g },
  { file: 'vite.config.ts', pattern: /127\.0\.0\.1/g },
];

const isAllowedSyntheticNetwork = (file, value) => syntheticNetworkRules.some((rule) => {
  if (rule.file !== file) return false;
  rule.pattern.lastIndex = 0;
  return rule.pattern.test(value);
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

// Binary payloads are mostly opaque, so only match high-signal ASCII markers.
// Do not reject ordinary font version/copyright names; reject local identity and build leakage.
const binaryRules = [
  { name: 'absolute path or username', pattern: /(?:\b[A-Za-z]:[\\/](?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+|\/(?:Users|home|private\/var|var\/folders)\/[A-Za-z0-9._-]+(?:[\/][A-Za-z0-9._-]+)*)/gi },
  { name: 'private email', pattern: /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi },
  { name: 'username field', pattern: /\b(?:user(?:name)?|login|account)\s*[=:]\s*["']?[A-Za-z0-9._-]{2,}["']?/gi },
  { name: 'credential format', pattern: /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|npm_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g },
  { name: 'hosting project identifier', pattern: /["']?project[_-]?id["']?\s*[:=]\s*["'][^"']+["']/gi },
  { name: 'build metadata', pattern: /(?:webpack|vite|rollup|esbuild|parcel):\/\/|(?:sourceMappingURL|webpackChunkName)\s*[=:]|(?:build(?:Path|Dir|Id|Hash|Timestamp|Time|Date)|commit(?:Sha|Hash))\s*[=:]|(?:node_modules|\.git)[\\/]/gi },
];

const isReservedEmailDomain = (domain) => domain === 'example.com' || domain === 'example.org'
  || domain === 'example.net' || domain === 'invalid' || domain === 'test' || domain.endsWith('.test')
  || domain.endsWith('.invalid');

const lineNumber = (text, index) => text.slice(0, index).split('\n').length;

const addTextFindings = (label, text, rules, lineAware = false) => {
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.name === 'private email' && isReservedEmailDomain(match[1].toLowerCase())) continue;
      const location = lineAware ? `:${lineNumber(text, match.index ?? 0)}` : '';
      findings.push(`${label}${location}: ${rule.name}`);
    }
  }
};

const addBinaryFindings = (label, bytes) => addTextFindings(label, bytes.toString('latin1'), binaryRules);

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const icoSignature = Buffer.from('00000100', 'hex');
const sfntSignatures = new Set(['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'typ1']);

const hasPrefix = (bytes, signature) => bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);

const decodeUtf16Be = (bytes) => {
  if (bytes.length % 2 !== 0) return null;
  const swapped = Buffer.allocUnsafe(bytes.length);
  for (let index = 0; index < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped.toString('utf16le');
};

const firstNull = (bytes, start) => {
  const index = bytes.indexOf(0, start);
  return index === -1 ? null : index;
};

const inspectPng = (bytes, label) => {
  if (!hasPrefix(bytes, pngSignature)) {
    findings.push(`${label}: invalid PNG signature`);
    return null;
  }

  let offset = pngSignature.length;
  let sawHeader = false;
  let sawEnd = false;
  let dimensions = null;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      findings.push(`${label}: truncated PNG chunk`);
      break;
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) {
      findings.push(`${label}: PNG chunk exceeds image bounds`);
      break;
    }
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      if (sawHeader || length !== 13) findings.push(`${label}: invalid PNG IHDR`);
      else {
        const width = data.readUInt32BE(0);
        const height = data.readUInt32BE(4);
        if (!width || !height) findings.push(`${label}: PNG has empty dimensions`);
        dimensions = { width, height };
      }
      sawHeader = true;
    }

    if (type === 'tEXt') {
      const keywordEnd = firstNull(data, 0);
      if (keywordEnd === null) findings.push(`${label}: malformed PNG tEXt chunk`);
      else addTextFindings(`${label} tEXt`, data.toString('utf8'), binaryRules);
    } else if (type === 'zTXt') {
      const keywordEnd = firstNull(data, 0);
      if (keywordEnd === null || keywordEnd + 2 > data.length || data[keywordEnd + 1] !== 0) {
        findings.push(`${label}: malformed PNG zTXt chunk`);
      } else {
        try {
          addTextFindings(`${label} zTXt`, Buffer.concat([
            data.subarray(0, keywordEnd),
            Buffer.from([0]),
            inflateSync(data.subarray(keywordEnd + 2)),
          ]).toString('utf8'), binaryRules);
        } catch {
          findings.push(`${label}: PNG zTXt decompression failed`);
        }
      }
    } else if (type === 'iTXt') {
      const keywordEnd = firstNull(data, 0);
      const languageEnd = keywordEnd === null ? null : firstNull(data, keywordEnd + 3);
      const translatedEnd = languageEnd === null ? null : firstNull(data, languageEnd + 1);
      if (keywordEnd === null || keywordEnd + 2 > data.length || languageEnd === null || translatedEnd === null) {
        findings.push(`${label}: malformed PNG iTXt chunk`);
      } else if (data[keywordEnd + 1] !== 0 && data[keywordEnd + 1] !== 1) {
        findings.push(`${label}: unsupported PNG iTXt compression flag`);
      } else if (data[keywordEnd + 2] !== 0) {
        findings.push(`${label}: unsupported PNG iTXt compression method`);
      } else {
        const textStart = translatedEnd + 1;
        try {
          const textBytes = data[keywordEnd + 1] === 1 ? inflateSync(data.subarray(textStart)) : data.subarray(textStart);
          addTextFindings(`${label} iTXt`, Buffer.concat([data.subarray(0, translatedEnd + 1), textBytes]).toString('utf8'), binaryRules);
        } catch {
          findings.push(`${label}: PNG iTXt decompression failed`);
        }
      }
    }

    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0) findings.push(`${label}: invalid PNG IEND`);
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader) findings.push(`${label}: PNG IHDR is missing`);
  if (!sawEnd) findings.push(`${label}: PNG IEND is missing`);
  if (sawEnd && offset !== bytes.length) findings.push(`${label}: bytes follow PNG IEND`);
  return dimensions;
};

const inspectDib = (bytes, label, expectedWidth, expectedHeight) => {
  if (bytes.length < 40) {
    findings.push(`${label}: ICO entry is not a complete DIB image`);
    return;
  }
  const headerSize = bytes.readUInt32LE(0);
  const width = bytes.readInt32LE(4);
  const doubledHeight = bytes.readInt32LE(8);
  if (headerSize < 40 || headerSize > bytes.length || width <= 0 || doubledHeight <= 0 || doubledHeight % 2 !== 0) {
    findings.push(`${label}: invalid ICO DIB header`);
    return;
  }
  const height = doubledHeight / 2;
  if (width !== expectedWidth || height !== expectedHeight) findings.push(`${label}: ICO DIB dimensions do not match directory`);
};

const inspectIco = (bytes, label) => {
  if (bytes.length < 6 || !hasPrefix(bytes, icoSignature) || bytes.readUInt16LE(4) < 1) {
    findings.push(`${label}: invalid ICO header`);
    return;
  }
  const count = bytes.readUInt16LE(4);
  const directoryEnd = 6 + count * 16;
  if (directoryEnd > bytes.length) {
    findings.push(`${label}: ICO directory exceeds file bounds`);
    return;
  }

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = bytes[entryOffset] || 256;
    const height = bytes[entryOffset + 1] || 256;
    const size = bytes.readUInt32LE(entryOffset + 8);
    const imageOffset = bytes.readUInt32LE(entryOffset + 12);
    const entryLabel = `${label} entry ${index + 1}`;
    if (!size || imageOffset < directoryEnd || imageOffset + size > bytes.length) {
      findings.push(`${entryLabel}: image bounds are invalid`);
      continue;
    }
    entries.push({ end: imageOffset + size, height, imageOffset, label: entryLabel, size, width });
  }

  const ranges = [...entries].sort((left, right) => left.imageOffset - right.imageOffset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].imageOffset < ranges[index - 1].end) findings.push(`${label}: ICO image entries overlap`);
  }

  for (const entry of entries) {
    const image = bytes.subarray(entry.imageOffset, entry.imageOffset + entry.size);
    addBinaryFindings(entry.label, image);
    if (hasPrefix(image, pngSignature)) {
      const dimensions = inspectPng(image, entry.label);
      if (dimensions && (dimensions.width !== entry.width || dimensions.height !== entry.height)) {
        findings.push(`${entry.label}: PNG dimensions do not match directory`);
      }
    } else {
      inspectDib(image, entry.label, entry.width, entry.height);
    }
  }
};

const inspectFont = (bytes, label) => {
  const signature = bytes.subarray(0, 4).toString('latin1');
  if (!sfntSignatures.has(signature) || bytes.length < 12) {
    findings.push(`${label}: decompressed payload is not an sfnt font`);
    return;
  }
  const tableCount = bytes.readUInt16BE(4);
  const directoryEnd = 12 + tableCount * 16;
  if (directoryEnd > bytes.length) {
    findings.push(`${label}: sfnt table directory exceeds font bounds`);
    return;
  }

  let nameTable = null;
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    const tag = bytes.toString('ascii', recordOffset, recordOffset + 4);
    const tableOffset = bytes.readUInt32BE(recordOffset + 8);
    const tableLength = bytes.readUInt32BE(recordOffset + 12);
    if (tableOffset + tableLength > bytes.length) findings.push(`${label}: sfnt table exceeds font bounds`);
    if (tag === 'name') nameTable = { length: tableLength, offset: tableOffset };
  }
  if (!nameTable || nameTable.length < 6 || nameTable.offset + nameTable.length > bytes.length) {
    findings.push(`${label}: font name table is missing or malformed`);
    return;
  }

  const table = bytes.subarray(nameTable.offset, nameTable.offset + nameTable.length);
  const recordCount = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const recordsEnd = 6 + recordCount * 12;
  if (recordsEnd > table.length || stringOffset < recordsEnd || stringOffset > table.length) {
    findings.push(`${label}: font name records are malformed`);
    return;
  }

  const names = [];
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = 6 + index * 12;
    const platform = table.readUInt16BE(recordOffset);
    const nameId = table.readUInt16BE(recordOffset + 6);
    const length = table.readUInt16BE(recordOffset + 8);
    const valueOffset = table.readUInt16BE(recordOffset + 10);
    const valueEnd = stringOffset + valueOffset + length;
    if (valueEnd > table.length) {
      findings.push(`${label}: font name value exceeds table bounds`);
      continue;
    }
    const rawValue = table.subarray(stringOffset + valueOffset, valueEnd);
    const value = platform === 0 || platform === 3 ? decodeUtf16Be(rawValue) : rawValue.toString('latin1');
    if (value === null) {
      findings.push(`${label}: odd-length UTF-16 font name value`);
      continue;
    }
    names.push({ nameId, value });
    addTextFindings(`${label} name ${nameId}`, value, binaryRules);
  }

  if (!names.some((name) => name.nameId === 1 && name.value === 'LXGW WenKai Lite')) {
    findings.push(`${label}: expected family name is missing`);
  }
  if (!names.some((name) => name.nameId === 2 && name.value === 'Regular')) {
    findings.push(`${label}: expected subfamily name is missing`);
  }
};

const binaryExtensions = /\.(?:7z|avif|bin|bmp|br|class|dll|dmg|exe|gif|gz|ico|jpe?g|mp[34]|ogg|pdf|png|tar|tiff?|wasm|webm|webp|woff2?|zip)$/i;
const binarySignatures = [
  pngSignature,
  icoSignature,
  Buffer.from('ffd8ff', 'hex'),
  Buffer.from('47494638', 'hex'),
  Buffer.from('52494646', 'hex'),
  Buffer.from('504b0304', 'hex'),
  Buffer.from('25504446', 'hex'),
  Buffer.from('7f454c46', 'hex'),
  Buffer.from('4d5a', 'hex'),
  Buffer.from('0061736d', 'hex'),
];

const isBinary = (bytes, relativeFile) => {
  if (binaryExtensions.test(relativeFile) || binarySignatures.some((signature) => hasPrefix(bytes, signature))) return true;
  if (bytes.includes(0)) return true;
  for (const byte of bytes) {
    if ((byte >= 1 && byte <= 8) || (byte >= 11 && byte <= 12) || (byte >= 14 && byte <= 31) || byte === 127) return true;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
};

const inspectAllowedBinary = (relativeFile, bytes, entry) => {
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== entry.sha256) findings.push(`${relativeFile}: SHA-256 mismatch (expected fixed allowlist hash)`);
  addBinaryFindings(relativeFile, bytes);
  if (entry.format === 'png') inspectPng(bytes, relativeFile);
  else if (entry.format === 'ico') inspectIco(bytes, relativeFile);
  else if (entry.format === 'brotli-font') {
    try {
      const decompressed = brotliDecompressSync(bytes);
      addBinaryFindings(`${relativeFile} (decompressed)`, decompressed);
      inspectFont(decompressed, `${relativeFile} (decompressed)`);
    } catch {
      findings.push(`${relativeFile}: Brotli font decompression failed`);
    }
  }
};

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
    if (error?.code === 'ENOENT') {
      if (binaryAllowlist.has(relativeFile)) findings.push(`${relativeFile}: allowlisted binary is missing`);
      continue;
    }
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
  if (isBinary(bytes, relativeFile)) {
    const allowlistEntry = binaryAllowlist.get(relativeFile);
    if (!allowlistEntry) {
      findings.push(`${relativeFile}: binary path is not allowlisted; add an explicit hash and notice before use`);
      continue;
    }
    inspectAllowedBinary(relativeFile, bytes, allowlistEntry);
    continue;
  }

  // The scanner's own signatures are policy code, not project data.
  if (relativeFile === 'scripts/privacy-scan.mjs') continue;
  const text = bytes.toString('utf8');
  addTextFindings(relativeFile, text, textRules, true);

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
  console.log(`privacy scan passed (${trackedFiles.length} current files checked; ${binaryAllowlist.size} fixed binary hashes verified)`);
}
