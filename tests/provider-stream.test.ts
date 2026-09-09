import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderCancelledError,
  ProviderConnectionError,
  ProviderStore,
} from '../server/providers.ts';
import type { PromptMessage } from '../src/types.ts';
import type { ProviderProfile } from '../src/providerProfiles.ts';

const mockedLookup = vi.hoisted(() => vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]));
vi.mock('node:dns/promises', () => ({ lookup: mockedLookup }));

const temporaryRoots: string[] = [];

const profile: ProviderProfile = {
  id: 'synthetic-provider',
  name: 'Synthetic Provider',
  kind: 'openai-compatible',
  baseUrl: 'https://provider.example.test/v1',
  modelId: 'synthetic-model',
  maxContext: 128_000,
  maxOutput: 8_192,
};

const messages: PromptMessage[] = [{
  role: 'user',
  content: 'Synthetic request.',
  blockIds: [],
}];

const makeStore = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'story-provider-stream-'));
  temporaryRoots.push(root);
  const store = new ProviderStore(path.join(root, 'providers.json'));
  await store.save(profile, 'synthetic-provider-key');
  return store;
};

const responseFromChunks = (chunks: Uint8Array[], contentType = 'text/event-stream') => {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': contentType } });
};

const utf8Chunks = (text: string, splitAt: number[] = []) => {
  const bytes = new TextEncoder().encode(text);
  const cuts = [0, ...splitAt.filter((cut) => cut > 0 && cut < bytes.length), bytes.length]
    .sort((left, right) => left - right);
  return cuts.slice(0, -1).map((start, index) => bytes.slice(start, cuts[index + 1]));
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OpenAI-compatible provider streaming', () => {
  it('sends stream=true and decodes UTF-8, multiline data, choice zero, finish, and usage frames', async () => {
    const sse = [
      'data: {"choices":[{"index":1,"delta":{"content":"错误候选"}},{"index":0,\n',
      'data: "delta":{"content":"苹"}}]}\r\n\r\n',
      'data: {"choices":[{"index":0,"delta":{"content":"果"}},{"index":1,"delta":{"content":"不应出现"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":null},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"total_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const chunks = utf8Chunks(sse, [1, 2, 17, 31, 47]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFromChunks(chunks));
    const store = await makeStore();
    const deltas: string[] = [];

    await expect(store.generate(profile.id, messages, undefined, {
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    })).resolves.toBe('苹果');

    expect(deltas).toEqual(['苹', '果']);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ stream: true });
    expect(new Headers(request?.headers).get('accept')).toContain('text/event-stream');
  });

  it('accepts a provider JSON fallback once when stream is ignored', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '一次兼容结果' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    const store = await makeStore();
    const deltas: string[] = [];

    await expect(store.generate(profile.id, messages, undefined, {
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    })).resolves.toBe('一次兼容结果');

    expect(deltas).toEqual(['一次兼容结果']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects truncated and provider-error streams without exposing raw provider text', async () => {
    const store = await makeStore();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(responseFromChunks(utf8Chunks(
      'data: {"choices":[{"index":0,"delta":{"content":"未完成"}}]}\n\n',
    )));
    await expect(store.generate(profile.id, messages, undefined, { stream: true }))
      .rejects.toThrow('未正常结束');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(responseFromChunks(utf8Chunks(
      'data: {"error":{"message":"provider-secret-error"}}\n\n',
    )));
    try {
      await store.generate(profile.id, messages, undefined, { stream: true });
      throw new Error('Expected provider stream error.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConnectionError);
      expect((error as Error).message).toContain('流式响应无效');
      expect((error as Error).message).not.toContain('provider-secret-error');
    }
  });

  it('accepts finish_reason as an explicit terminal event and rejects non-string terminals', async () => {
    const store = await makeStore();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(responseFromChunks(utf8Chunks(
      'data: {"choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
    )));
    await expect(store.generate(profile.id, messages, undefined, { stream: true })).resolves.toBe('完成');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(responseFromChunks(utf8Chunks(
      'data: {"choices":[{"index":0,"delta":{"content":"半成"},"finish_reason":{"value":"stop"}}]}\n\n',
    )));
    await expect(store.generate(profile.id, messages, undefined, { stream: true }))
      .rejects.toThrow('未正常结束');
  });

  it('cancels an upstream body after receiving [DONE]', async () => {
    let canceled = false;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"index":0,"delta":{"content":"结束"}}]}\n\n'
            + 'data: [DONE]\n\n',
        ));
      },
      cancel() {
        canceled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const store = await makeStore();

    await expect(store.generate(profile.id, messages, undefined, { stream: true })).resolves.toBe('结束');
    expect(canceled).toBe(true);
  });

  it('propagates cancellation and cancels the provider response reader', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const store = await makeStore();
    const controller = new AbortController();
    const pending = store.generate(profile.id, messages, controller.signal, { stream: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(cancelled).toBe(true);
  });

  it('keeps non-stream calls on the existing JSON path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '非流式结果' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    const store = await makeStore();

    await expect(store.generate(profile.id, messages)).resolves.toBe('非流式结果');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('stream');
  });
});
