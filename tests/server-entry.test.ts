import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoryServer } from '../server/main';
import { api, HOST_ACCESS_TOKEN_STORAGE_KEY } from '../src/api';

const requestWithHost = (port: number, pathname: string, host: string) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
  const request = httpRequest({ host: '127.0.0.1', port, path: pathname, headers: { host } }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  request.on('error', reject);
  request.end();
});

describe('local server entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it('accepts a body just below 1 MB and rejects a larger body clearly', async () => {
    const storyStore = {
      saveBook: vi.fn(async (book: unknown) => book),
    };
    const server = createStoryServer(storyStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;
      const nearLimit = JSON.stringify({ id: 'body-limit-book', filler: 'x'.repeat(999_000) });
      const accepted = await fetch(`${origin}/api/books/body-limit-book`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: nearLimit,
      });
      expect(accepted.status).toBe(200);
      await accepted.text();
      expect(storyStore.saveBook).toHaveBeenCalledOnce();

      const overLimit = JSON.stringify({ id: 'body-limit-book', filler: 'x'.repeat(1_000_000) });
      const rejected = await fetch(`${origin}/api/books/body-limit-book`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: overLimit,
      });
      expect(rejected.status).toBe(413);
      expect(await rejected.text()).toContain('1 MB');
      expect(storyStore.saveBook).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps loopback health public and protects other APIs with the configured token', async () => {
    const server = createStoryServer(undefined, undefined, undefined, {
      accessToken: 'synthetic-access-token',
      allowedHosts: ['127.0.0.1'],
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;

      const health = await fetch(`${origin}/api/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ ok: true });

      const missing = await fetch(`${origin}/api/providers`);
      expect(missing.status).toBe(401);
      expect(await missing.text()).not.toContain('synthetic-access-token');

      const wrong = await fetch(`${origin}/api/providers`, {
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(wrong.status).toBe(401);

      const correct = await fetch(`${origin}/api/providers`, {
        headers: { authorization: 'Bearer synthetic-access-token' },
      });
      expect(correct.status).toBe(200);
      expect(await correct.text()).not.toContain('synthetic-access-token');

      const untrustedHost = await requestWithHost(address.port, '/api/health', 'untrusted.synthetic');
      expect(untrustedHost.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects non-loopback entry configuration before listen', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const run = (variables: Record<string, string>) => spawnSync(process.execPath, ['server/main.ts'], {
      cwd: root,
      env: { ...process.env, STORY_API_PORT: '0', ...variables },
      encoding: 'utf8',
      timeout: 3000,
    });

    const missingToken = run({
      STORY_HOST: '192.0.2.10',
      STORY_ACCESS_TOKEN: '',
      STORY_ALLOWED_HOSTS: '192.0.2.10',
    });
    expect(missingToken.status).not.toBe(0);
    expect(`${missingToken.stdout}${missingToken.stderr}`).not.toContain('192.0.2.10');

    const missingTrustedHost = run({
      STORY_HOST: '192.0.2.10',
      STORY_ACCESS_TOKEN: 'synthetic-entry-token',
      STORY_ALLOWED_HOSTS: '',
    });
    expect(missingTrustedHost.status).not.toBe(0);
    expect(`${missingTrustedHost.stdout}${missingTrustedHost.stderr}`).not.toContain('synthetic-entry-token');
  });

  it('requires same-origin for state-changing requests', async () => {
    const savedProfile = {
      id: 'synthetic-provider',
      name: 'Synthetic Provider',
      kind: 'fake' as const,
      baseUrl: 'https://provider.synthetic/v1',
      modelId: 'synthetic-model',
      maxContext: 1024,
      maxOutput: 128,
    };
    const providerStore = {
      save: vi.fn(async () => savedProfile),
    };
    const server = createStoryServer(undefined, providerStore as never, undefined, {
      accessToken: 'synthetic-origin-token',
      allowedHosts: ['127.0.0.1'],
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;
      const request = {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic-origin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ profile: savedProfile }),
      };

      const crossOrigin = await fetch(`${origin}/api/providers`, {
        ...request,
        headers: { ...request.headers, Origin: 'http://untrusted.synthetic' },
      });
      expect(crossOrigin.status).toBe(403);
      expect(await crossOrigin.text()).not.toContain('synthetic-origin-token');
      expect(providerStore.save).not.toHaveBeenCalled();

      const sameOrigin = await fetch(`${origin}/api/providers`, {
        ...request,
        headers: { ...request.headers, Origin: origin },
      });
      expect(sameOrigin.status).toBe(200);
      expect(providerStore.save).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('sends the session token and retries a 401 only once after prompting', async () => {
    const stored = new Map([[HOST_ACCESS_TOKEN_STORAGE_KEY, 'stale-session-token']]);
    const prompt = vi.fn(() => 'fresh-session-token');
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    vi.stubGlobal('window', { prompt });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '需要访问凭据。' }), { status: 401 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listBooks()).resolves.toEqual([]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(stored.get(HOST_ACCESS_TOKEN_STORAGE_KEY)).toBe('fresh-session-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe('Bearer stale-session-token');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization'))
      .toBe('Bearer fresh-session-token');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/library');
  });
});
