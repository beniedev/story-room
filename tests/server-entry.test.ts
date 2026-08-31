import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createStoryServer } from '../server/main';

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

  it('serves the local build and API from one port', async () => {
    const staticRoot = await mkdtemp(path.join(tmpdir(), 'story-static-'));
    await writeFile(path.join(staticRoot, 'index.html'), '<main>Story Bookshelf</main>', 'utf8');
    await writeFile(path.join(staticRoot, 'app.css'), 'body { color: purple; }', 'utf8');
    const server = createStoryServer(undefined, undefined, staticRoot);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;

      const [rootResponse, routeResponse, assetResponse, healthResponse] = await Promise.all([
        fetch(`${origin}/`),
        fetch(`${origin}/settings`),
        fetch(`${origin}/app.css`),
        fetch(`${origin}/api/health`),
      ]);

      expect(await rootResponse.text()).toContain('Story Bookshelf');
      expect(await routeResponse.text()).toContain('Story Bookshelf');
      expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await assetResponse.text()).toContain('purple');
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(staticRoot, { recursive: true, force: true });
    }
  });
});
