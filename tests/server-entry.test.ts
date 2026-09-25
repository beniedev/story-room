import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoryServer } from '../server/main';
import { ProviderStore } from '../server/providers';
import { StoreConflictError, StoryStore } from '../server/store';
import type { ProviderProfile } from '../src/providerProfiles';
import type { Book } from '../src/types';
import { createSectionMemory } from '../src/sectionMemory';
import { formatUrlHost } from '../vite.config';

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

      const [rootResponse, routeResponse, assetResponse, healthResponse, storageResponse] = await Promise.all([
        fetch(`${origin}/`),
        fetch(`${origin}/settings`),
        fetch(`${origin}/app.css`),
        fetch(`${origin}/api/health`),
        fetch(`${origin}/api/storage-location`),
      ]);

      expect(await rootResponse.text()).toContain('Story Bookshelf');
      expect(await routeResponse.text()).toContain('Story Bookshelf');
      expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await assetResponse.text()).toContain('purple');
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });
      await expect(storageResponse.json()).resolves.toEqual({ location: path.resolve('.data') });

      const unknownApi = await fetch(`${origin}/api/not-a-route`);
      expect(unknownApi.status).toBe(404);
      expect(unknownApi.headers.get('content-type')).toContain('application/json');
      expect(await unknownApi.text()).not.toContain('Story Bookshelf');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(staticRoot, { recursive: true, force: true });
    }
  });

  it('saves, renames, and adds sections to a large Book without a fixed body limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'story-large-book-'));
    const storyStore = new StoryStore(root);
    const server = createStoryServer(storyStore);

    try {
      let book = await storyStore.createBook('Synthetic large Book');
      const manuscript = '合成正文。'.repeat(150_000);
      book.chapters[0].sections[0].content = manuscript;
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const url = `http://127.0.0.1:${address.port}/api/books/${book.id}`;
      const saveAndReload = async () => {
        const body = JSON.stringify({ book, expectedUpdatedAt: book.updatedAt });
        expect(Buffer.byteLength(body)).toBeGreaterThan(2_000_000);
        const saved = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body,
        });
        const expected = await saved.json() as Book;
        expect(saved.status).toBe(200);
        const reloaded = await fetch(url);
        expect(reloaded.status).toBe(200);
        book = await reloaded.json() as Book;
        expect(book).toEqual(expected);
        expect(book.chapters[0].sections[0].content).toBe(manuscript);
      };

      book.chapters[0].sections[0].memory = createSectionMemory({
        synopsis: '摘要'.repeat(40_000),
        beats: Array.from({ length: 40 }, () => '节拍'.repeat(1_001)),
        continuityFacts: [],
        characterStateChanges: [],
        foreshadowingCandidates: [],
      }, manuscript);
      await saveAndReload();
      expect(book.chapters[0].sections[0].memory?.beats).toHaveLength(40);
      book.title = 'Renamed large Book';
      book.chapters[0].title = 'Renamed chapter';
      book.chapters[0].sections[0].title = 'Renamed section';
      await saveAndReload();
      expect(book.title).toBe('Renamed large Book');
      expect(book.chapters[0].title).toBe('Renamed chapter');
      expect(book.chapters[0].sections[0].title).toBe('Renamed section');

      book.chapters[0].sections.push({ id: 'new-section', title: 'New section', content: '' });
      await saveAndReload();
      expect(book.chapters[0].sections).toHaveLength(2);
      expect(book.chapters[0].sections[1]).toMatchObject({ id: 'new-section', title: 'New section', content: '' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires an explicit expected Book revision for host saves', async () => {
    const book = {
      id: 'revision-book',
      title: 'Synthetic Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies Book;
    const storyStore = { saveBook: vi.fn() };
    const server = createStoryServer(storyStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/books/${book.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ book }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('expectedUpdatedAt') });
      expect(storyStore.saveBook).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('passes the expected revision to the store and maps conflicts to HTTP 409', async () => {
    const book = {
      id: 'revision-book',
      title: 'Synthetic Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies Book;
    const conflict = new StoreConflictError('Book revision is stale');
    const storyStore = {
      saveBook: vi.fn(async () => { throw conflict; }),
    };
    const server = createStoryServer(storyStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/books/${book.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ book, expectedUpdatedAt: book.updatedAt }),
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: conflict.message, code: 'BOOK_CONFLICT' });
      expect(storyStore.saveBook).toHaveBeenCalledWith(book, { expectedUpdatedAt: book.updatedAt });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('imports a valid Book through the host as a new recovery copy', async () => {
    const book = {
      id: 'backup-book',
      title: 'Synthetic Backup',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies Book;
    const restored = { ...book, id: 'book-restored-copy' };
    const storyStore = { importBook: vi.fn(async () => restored) };
    const server = createStoryServer(storyStore as never);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/books/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ book }),
      });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual(restored);
      expect(storyStore.importBook).toHaveBeenCalledWith(book);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('accepts large author inputs without a fixed request-body cap', async () => {
    const instruction = '合成指导。'.repeat(150_000);
    const storyStore = { createBook: vi.fn(async (title: string) => ({ title })) };
    const server = createStoryServer(storyStore as never);
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: instruction }),
      });
      const result = await response.json() as { title: string };
      expect(response.status).toBe(201);
      expect(result.title).toBe(instruction);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('passes full context to generation even when the estimate exceeds the configured budget', async () => {
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
      getContextLimits: vi.fn(async () => ({ maxContext: 100, maxOutput: 10 })),
      generate: vi.fn(async (_profileId: string, messages: unknown[]) => {
        expect(messages).toHaveLength(2);
        expect(messages.map((message) => (message as { role: string }).role)).toEqual(['system', 'user']);
        expect(JSON.stringify(messages)).toContain('Existing text.');
        return { draft: 'Synthetic generated text.', finishReason: 'stop' };
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
      const generated = await response.json() as { draft: string; sourceSignature?: string };
      expect(generated.draft).toBe('Synthetic generated text.');
      expect(generated.sourceSignature).toMatch(/^[0-9a-f]{16}$/);
      expect(providerStore.getContextLimits).toHaveBeenCalledWith('synthetic-provider');
      expect(providerStore.generate).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('generates with section notes when the provider rejects a trailing assistant turn', async () => {
    const note = 'Skip the journey and write the reunion after arrival.';
    const providerRequests: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
    let rejectRequest = false;
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          messages?: Array<{ role: string; content: string }>;
        };
        providerRequests.push(payload);
        response.setHeader('content-type', 'application/json');
        if (rejectRequest || payload.messages?.at(-1)?.role === 'assistant') {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: { message: 'Unsupported request.' } }));
          return;
        }
        response.end(JSON.stringify({ choices: [{ message: { content: 'Synthetic generated prose.' } }] }));
      });
    });
    const root = await mkdtemp(path.join(tmpdir(), 'story-section-prefill-'));
    const storyStore = new StoryStore(path.join(root, 'books'));
    const providerStore = new ProviderStore(path.join(root, 'providers.json'));
    let server: ReturnType<typeof createStoryServer> | undefined;

    try {
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      const upstreamAddress = upstream.address();
      if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('Fake Provider did not bind a TCP port.');
      const profile: ProviderProfile = {
        id: 'synthetic-provider',
        name: 'Synthetic Provider',
        kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
        modelId: 'synthetic-model',
        maxContext: 128_000,
        maxOutput: 8_192,
      };
      await providerStore.save(profile, 'synthetic-provider-key');
      let book = await storyStore.createBook('Synthetic Book');
      const section = book.chapters[0]?.sections[0];
      if (!section) throw new Error('Synthetic section fixture is missing.');
      section.content = 'Existing synthetic prose.';
      section.note = note;
      book = await storyStore.saveBook(book, { expectedUpdatedAt: book.updatedAt });
      const storyServer = createStoryServer(storyStore, providerStore);
      server = storyServer;
      await new Promise<void>((resolve) => storyServer.listen(0, '127.0.0.1', resolve));
      const address = storyServer.address();
      if (!address || typeof address === 'string') throw new Error('Story server did not bind a TCP port.');
      const generate = () => fetch(`http://127.0.0.1:${address.port}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          sectionId: section.id,
          providerProfileId: profile.id,
          mode: 'author',
          instruction: 'Continue the scene.',
          generationKind: 'continue-section',
        }),
      });

      const response = await generate();
      const responseBody = await response.text();
      expect(response.status).toBe(200);
      expect(JSON.parse(responseBody)).toMatchObject({ draft: 'Synthetic generated prose.' });
      expect(responseBody).not.toContain(note);

      const messages = providerRequests[0]?.messages;
      expect(messages?.map(({ role }) => role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(messages?.[2]).toEqual({ role: 'assistant', content: note });
      expect(messages?.filter(({ content }) => content.includes(note))).toHaveLength(1);

      rejectRequest = true;
      const rejected = await generate();
      expect(rejected.status).toBe(502);
      expect(await rejected.json()).toMatchObject({ error: 'Provider 返回 HTTP 400。' });
      expect(providerRequests).toHaveLength(2);
      expect(providerRequests[1]?.messages).toEqual(messages);
    } finally {
      const storyServer = server;
      if (storyServer?.listening) {
        await new Promise<void>((resolve, reject) => storyServer.close((error) => error ? reject(error) : resolve()));
      }
      if (upstream.listening) {
        await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
      }
      await rm(root, { recursive: true, force: true });
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
        .mockResolvedValueOnce({ draft: validDraft, finishReason: 'stop' })
        .mockResolvedValueOnce({ draft: '{"synopsis":"not enough"}', finishReason: 'stop' }),
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
      const firstBody = await first.json() as { draft: string; sourceSignature?: string };
      expect(firstBody.draft).toBe(validDraft);
      expect(firstBody.sourceSignature).toMatch(/^[0-9a-f]{16}$/);
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

  it('keeps APIs available through configured proxy Hosts', async () => {
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

      const wildcardHost = await requestWithHost(address.port, '/api/health', '0.0.0.0:8000');
      expect(wildcardHost.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('formats IPv6 proxy targets without changing the bind hostname', async () => {
    expect(formatUrlHost('127.0.0.1')).toBe('127.0.0.1');
    expect(formatUrlHost('::1')).toBe('[::1]');
    expect(formatUrlHost('[::1]')).toBe('[::1]');

    const launcher = await readFile(new URL('../scripts/dev.mjs', import.meta.url), 'utf8');
    const serverEntry = await readFile(new URL('../server/main.ts', import.meta.url), 'utf8');
    expect(launcher).toContain('STORY_HOST: host');
    expect(launcher).toContain('STORY_API_HOST: apiHost');
    expect(launcher).toContain("host === '0.0.0.0' ? '127.0.0.1'");
    expect(serverEntry).toContain('server.listen(port, host');
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
