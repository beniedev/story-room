import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('local server entry', () => {
  it('loads its runtime dependency graph directly in Node', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      "import('./server/main.ts')",
    ], { cwd: root, encoding: 'utf8' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
