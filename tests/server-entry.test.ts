import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoryServer } from '../server/main';
import { createSectionMemory } from '../src/sectionMemory';

const requestWithHost = (
  port: number,
  pathname: string,
  host: string,
  options: { method?: string; origin?: string; body?: string } = {},
) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
  const headers: Record<string, string> = { host };
  if (options.origin) headers.origin = options.origin;
  if (options.body) headers['content-type'] = 'application/json';
  const request = httpRequest({ host: '127.0.0.1', port, path: pathname, method: options.method, headers }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  request.on('error', reject);
  request.end(options.body);
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

  it('preserves the browser Host through the local Vite proxy for same-origin checks', async () => {
    const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain('changeOrigin: false');
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

      const unknownApi = await fetch(`${origin}/api/not-a-route`);
      expect(unknownApi.status).toBe(404);
      expect(unknownApi.headers.get('content-type')).toContain('application/json');
      expect(await unknownApi.text()).not.toContain('Story Bookshelf');
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

  it('passes the structured context messages through the generation route', async () => {
    const book = {
      id: 'book-a',
      title: 'Synthetic Book',
      plotOutline: 'Synthetic outline.',
      writingBrief: 'Synthetic style.',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'chapter-a',
        title: 'Synthetic Chapter',
        sections: [{ id: 'section-a', title: 'Synthetic Section', content: 'Existing text.' }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const storyStore = {
      loadBook: vi.fn(async () => book),
    };
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async (_profileId: string, messages: unknown[]) => {
        expect(messages).toHaveLength(2);
        expect(messages.map((message) => (message as { role: string }).role)).toEqual(['system', 'user']);
        expect(JSON.stringify(messages)).toContain('Existing text.');
        return 'Synthetic generated text.';
      }),
    };
    const server = createStoryServer(storyStore as never, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          sectionId: 'section-a',
          providerProfileId: 'synthetic-provider',
          mode: 'author',
          instruction: 'Continue synthetic text.',
          generationKind: 'continue-section',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ draft: 'Synthetic generated text.' });
      expect(providerStore.getContextLimits).toHaveBeenCalledWith('synthetic-provider');
      expect(providerStore.generate).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('parses provider summary drafts strictly without writing memory', async () => {
    const previousMemory = createSectionMemory({
      synopsis: 'Existing memory',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, 'Existing section text');
    const book = {
      id: 'summary-book',
      title: 'Summary Book',
      plotOutline: 'Should not enter summary input.',
      writingBrief: 'Should not enter summary input.',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [{
        id: 'summary-source',
        title: 'Other summary',
        content: 'Should not enter summary input.',
        includeInPrompt: true,
        sourceSectionIds: [],
      }],
      chapters: [{
        id: 'summary-chapter',
        title: 'Summary Chapter',
        sections: [{
          id: 'summary-section',
          title: 'Summary Section',
          content: 'Only this text is summarized.',
          memory: previousMemory,
        }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const validDraft = JSON.stringify({
      synopsis: 'Synthetic synopsis',
      beats: ['Synthetic beat'],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    });
    const storyStore = {
      loadBook: vi.fn(async () => book),
      saveBook: vi.fn(),
    };
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn()
        .mockResolvedValueOnce(validDraft)
        .mockResolvedValueOnce('{"synopsis":"not enough"}'),
    };
    const server = createStoryServer(storyStore as never, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;
      const body = JSON.stringify({
        bookId: book.id,
        sectionId: 'summary-section',
        providerProfileId: 'synthetic-provider',
        mode: 'author',
        instruction: '',
        generationKind: 'summarize-section',
      });
      const first = await fetch(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ draft: validDraft });
      const messages = providerStore.generate.mock.calls[0]?.[1] as Array<{ role: string; content: string }>;
      expect(messages[1]?.content).toContain('Only this text is summarized.');
      expect(messages[1]?.content).not.toContain('Should not enter summary input.');
      expect(storyStore.saveBook).not.toHaveBeenCalled();

      const second = await fetch(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(second.status).toBe(502);
      expect(await second.text()).toContain('Section memory draft');
      expect(storyStore.saveBook).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('returns a redacted context preview without manuscript, messages, or internal IDs', async () => {
    const book = {
      id: 'preview-book',
      title: 'Synthetic Preview Book',
      plotOutline: 'Private outline that must stay server-side.',
      writingBrief: 'Private writing brief that must stay server-side.',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'preview-chapter',
        title: 'Synthetic Chapter',
        sections: [{ id: 'preview-section', title: 'Synthetic Section', content: 'Private manuscript body.' }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const storyStore = { loadBook: vi.fn(async () => book) };
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
    };
    const server = createStoryServer(storyStore as never, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/context-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          sectionId: 'preview-section',
          providerProfileId: 'synthetic-provider',
          mode: 'author',
          instruction: 'Private instruction that must stay server-side.',
        }),
      });
      expect(response.status).toBe(200);
      const preview = await response.json() as Record<string, unknown>;
      expect(preview).toHaveProperty('included');
      expect(preview).toHaveProperty('excluded');
      expect(preview).not.toHaveProperty('bookId');
      expect(preview).not.toHaveProperty('target');
      expect(preview).not.toHaveProperty('messages');
      const serialized = JSON.stringify(preview);
      expect(serialized).not.toContain('Private manuscript body.');
      expect(serialized).not.toContain('Private outline that must stay server-side.');
      expect(serialized).not.toContain('Private instruction that must stay server-side.');
      for (const key of ['id', 'content', 'source', 'sourceId', 'messageRole', 'blockIds']) {
        expect(serialized).not.toContain(`"${key}"`);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('aborts the Provider when the generation client disconnects', async () => {
    const book = {
      id: 'cancel-book',
      title: 'Synthetic Book',
      plotOutline: '',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'cancel-chapter',
        title: 'Synthetic Chapter',
        sections: [{ id: 'cancel-section', title: 'Synthetic Section', content: 'Existing text.' }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let resolveStarted: (signal: AbortSignal) => void = () => undefined;
    const providerStarted = new Promise<AbortSignal>((resolve) => {
      resolveStarted = resolve;
    });
    const storyStore = { loadBook: vi.fn(async () => book) };
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async (_profileId: string, _messages: unknown[], signal?: AbortSignal) => {
        if (!signal) throw new Error('Generation did not receive an AbortSignal.');
        resolveStarted(signal);
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthetic provider abort')), { once: true });
        });
      }),
    };
    const server = createStoryServer(storyStore as never, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const request = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/generate',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      request.on('error', () => undefined);
      request.end(JSON.stringify({
        bookId: book.id,
        sectionId: 'cancel-section',
        providerProfileId: 'synthetic-provider',
        mode: 'author',
        instruction: 'Continue synthetic text.',
        generationKind: 'continue-section',
      }));

      const providerSignal = await providerStarted;
      request.destroy();
      await vi.waitFor(() => expect(providerSignal.aborted).toBe(true));
      expect(providerStore.generate).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps loopback APIs available through a valid proxy Host', async () => {
    const providerStore = { list: vi.fn(async () => []) };
    const server = createStoryServer(undefined, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;

      const health = await fetch(`${origin}/api/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ ok: true });

      const missing = await fetch(`${origin}/api/providers`);
      expect(missing.status).toBe(200);
      await expect(missing.json()).resolves.toEqual([]);

      const proxiedHost = await requestWithHost(address.port, '/api/health', 'bookshelf.test:8000');
      expect(proxiedHost.status).toBe(200);
      expect(JSON.parse(proxiedHost.body)).toEqual({ ok: true });
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

    const rejected = run({ STORY_HOST: '192.0.2.10' });
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).not.toContain('192.0.2.10');
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
    const server = createStoryServer(undefined, providerStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const origin = `http://127.0.0.1:${address.port}`;
      const request = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ profile: savedProfile }),
      };

      const crossOrigin = await fetch(`${origin}/api/providers`, {
        ...request,
        headers: { ...request.headers, Origin: 'http://untrusted.synthetic' },
      });
      expect(crossOrigin.status).toBe(403);
      expect(providerStore.save).not.toHaveBeenCalled();

      const sameOrigin = await fetch(`${origin}/api/providers`, {
        ...request,
        headers: { ...request.headers, Origin: origin },
      });
      expect(sameOrigin.status).toBe(200);

      const proxiedOrigin = 'http://bookshelf.test:8000';
      const proxiedSameOrigin = await requestWithHost(address.port, '/api/providers', 'bookshelf.test:8000', {
        method: 'POST',
        origin: proxiedOrigin,
        body: request.body,
      });
      expect(proxiedSameOrigin.status).toBe(200);
      expect(providerStore.save).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

});
