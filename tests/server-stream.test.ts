import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoryServer } from '../server/main';
import { ProviderConnectionError } from '../server/providers';
import type { Book } from '../src/types';

const book: Book = {
  id: 'synthetic-stream-book',
  title: 'Synthetic Stream Book',
  plotOutline: '',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'synthetic-stream-chapter',
    title: 'Synthetic Chapter',
    sections: [{
      id: 'synthetic-stream-section',
      title: 'Synthetic Section',
      content: 'Existing synthetic text.',
    }],
  }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeBody = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  bookId: book.id,
  sectionId: 'synthetic-stream-section',
  providerProfileId: 'synthetic-provider',
  mode: 'author',
  instruction: 'Continue synthetic text.',
  generationKind: 'continue-section',
  stream: true,
  ...overrides,
});

const startServer = async (providerStore: Record<string, unknown>) => {
  const storyStore = { loadBook: vi.fn(async () => book) };
  const server = createStoryServer(storyStore as never, providerStore as never);
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic stream server did not bind.');
  return { server, origin: `http://localhost:${address.port}` };
};

const stopServer = async (server: ReturnType<typeof createStoryServer>) => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local generation NDJSON stream', () => {
  it('writes delta events before the final result and passes stream options to the Provider', async () => {
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async (
        _profileId: string,
        _messages: unknown,
        _signal: AbortSignal,
        options: { stream?: boolean; onDelta?: (delta: string) => void },
      ) => {
        options.onDelta?.('流');
        options.onDelta?.('式');
        return '流式结果';
      }),
    };
    const { server, origin } = await startServer(providerStore);
    try {
      const response = await fetch(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: makeBody(),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/x-ndjson');
      const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
      expect(events).toEqual([
        { type: 'delta', text: '流' },
        { type: 'delta', text: '式' },
        { type: 'result', result: expect.objectContaining({ draft: '流式结果' }) },
      ]);
      expect(providerStore.generate).toHaveBeenCalledWith(
        'synthetic-provider',
        expect.any(Array),
        expect.any(AbortSignal),
        expect.objectContaining({ stream: true, onDelta: expect.any(Function) }),
      );
    } finally {
      await stopServer(server);
    }
  });

  it('keeps validation/provider failures as HTTP errors before the first stream event', async () => {
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async () => {
        throw new ProviderConnectionError('本机 Provider 调用失败。');
      }),
    };
    const { server, origin } = await startServer(providerStore);
    try {
      const response = await fetch(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: makeBody(),
      });
      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({ error: '本机 Provider 调用失败。' });
    } finally {
      await stopServer(server);
    }
  });

  it('emits a safe error event after a stream has already started', async () => {
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async (
        _profileId: string,
        _messages: unknown,
        _signal: AbortSignal,
        options: { onDelta?: (delta: string) => void },
      ) => {
        options.onDelta?.('已发送');
        throw new ProviderConnectionError('本机 Provider 调用失败。');
      }),
    };
    const { server, origin } = await startServer(providerStore);
    try {
      const response = await fetch(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: makeBody(),
      });
      expect(response.status).toBe(200);
      const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
      expect(events).toEqual([
        { type: 'delta', text: '已发送' },
        { type: 'error', error: '本机 Provider 调用失败。' },
      ]);
    } finally {
      await stopServer(server);
    }
  });

  it('propagates client disconnect after a delta to the Provider signal', async () => {
    let resolveStarted: (signal: AbortSignal) => void = () => undefined;
    const providerStarted = new Promise<AbortSignal>((resolve) => {
      resolveStarted = resolve;
    });
    const providerStore = {
      getContextLimits: vi.fn(async () => ({ maxContext: 128_000, maxOutput: 8_192 })),
      generate: vi.fn(async (
        _profileId: string,
        _messages: unknown,
        signal: AbortSignal,
        options: { onDelta?: (delta: string) => void },
      ) => {
        resolveStarted(signal);
        options.onDelta?.('先发送');
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true });
        });
      }),
    };
    const { server, origin } = await startServer(providerStore);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Synthetic stream server did not bind.');
      const request = httpRequest({
        host: 'localhost',
        port: address.port,
        path: '/api/generate',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      request.on('error', () => undefined);
      request.end(makeBody());
      const signal = await providerStarted;
      request.destroy();
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
    } finally {
      await stopServer(server);
    }
  });
});
