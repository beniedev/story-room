import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageFile = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'LGPL-2.1',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'Unicode-DFS-2016',
]);

const readPackageMetadata = (name) => {
  const metadataFile = path.join(repoRoot, 'node_modules', ...name.split('/'), 'package.json');
  if (!existsSync(metadataFile)) throw new Error(`${name}: package metadata is missing`);
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  if (metadata.name !== name || typeof metadata.version !== 'string' || !metadata.version) {
    throw new Error(`${name}: package metadata is incomplete`);
  }
  return metadata;
};

const licenseExpression = (metadata) => {
  if (typeof metadata.license === 'string') return metadata.license;
  if (metadata.license && typeof metadata.license.type === 'string') return metadata.license.type;
  if (Array.isArray(metadata.licenses)) {
    const names = metadata.licenses.map((item) => typeof item === 'string' ? item : item?.type).filter(Boolean);
    if (names.length) return names.join(' OR ');
  }
  return '';
};

const allowedExpression = (expression) => {
  const identifiers = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
  return identifiers.length > 0 && identifiers.every((identifier) => (
    allowedLicenses.has(identifier) || identifier === 'OR' || identifier === 'AND' || identifier === 'WITH'
  ));
};

const sections = ['dependencies', 'devDependencies'];
const failures = [];
let checked = 0;
for (const section of sections) {
  for (const name of Object.keys(packageJson[section] ?? {}).sort()) {
    try {
      const metadata = readPackageMetadata(name);
      const expression = licenseExpression(metadata);
      if (!allowedExpression(expression)) throw new Error(`${name}: license metadata is missing or not allowed`);
      checked += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${name}: license check failed`);
    }
  }
}

if (failures.length) {
  console.error('dependency license check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`dependency license check passed (${checked} direct packages)`);
}
