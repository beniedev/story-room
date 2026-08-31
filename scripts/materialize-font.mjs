import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets', 'fonts', 'LXGWWenKaiLite-Regular.ttf.br');
const target = path.join(root, 'public', 'fonts', 'LXGWWenKaiLite-Regular.ttf');

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, brotliDecompressSync(await readFile(source)));
