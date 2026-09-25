import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import type { GenerationRequest } from '../src/types';

const request: GenerationRequest = {
  bookId: 'synthetic-book',
  sectionId: 'synthetic-section',
  mode: 'author',
  instruction: 'Synthetic continuation.',
  stream: true,
};

const responseFromChunks = (chunks: string[]) => {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host generation stream client', () => {
  it('delivers delta callbacks across UTF-8 and line boundaries and returns only final result', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => responseFromChunks([
      '{"type":"delta","text":"苹',
      '果"}\n{"type":"result","result":{"draft":"苹果","finishReason":"stop","sourceSignature":"synthetic-signature"}}\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];

    await expect(api.generate(request, undefined, (delta) => deltas.push(delta))).resolves.toEqual({
      draft: '苹果',
      finishReason: 'stop',
      sourceSignature: 'synthetic-signature',
    });
    expect(deltas).toEqual(['苹果']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ stream: true });
  });

  it('cancels the response reader after receiving the final result', async () => {
    let canceled = false;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new TextEncoder().encode(
          '{"type":"result","result":{"draft":"完整结果","finishReason":"length"}}\n',
        ));
      },
      cancel() {
        canceled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'application/x-ndjson' },
    })));

    await expect(api.generate(request)).resolves.toEqual({ draft: '完整结果', finishReason: 'length' });
    expect(canceled).toBe(true);
  });

  it('defaults legacy JSON responses without an end reason to unknown', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ draft: '兼容结果。' }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.generate({ ...request, stream: false })).resolves.toEqual({
      draft: '兼容结果。',
      finishReason: 'unknown',
    });
  });

  it('rejects unrecognized finish-reason values in streamed results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromChunks([
      '{"type":"result","result":{"draft":"不可信结果","finishReason":"service-secret-mode"}}\n',
    ])));

    await expect(api.generate(request)).rejects.toThrow('无效的生成结果');
  });

  it('does not resolve a stream that ends before a result event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromChunks([
      '{"type":"delta","text":"部分"}\n',
    ])));

    await expect(api.generate(request)).rejects.toThrow('未正常结束');
  });

  it('propagates client cancellation while reading NDJSON', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() { /* The reader is canceled by the abort handler. */ },
    });
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response(body, {
      headers: { 'content-type': 'application/x-ndjson' },
      });
    }));
    const controller = new AbortController();
    const pending = api.generate(request, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('rejects an already-aborted stream before acquiring the reader lock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromChunks([
      '{"type":"result","result":{"draft":"不应读取"}}\n',
    ])));
    const controller = new AbortController();
    controller.abort();

    await expect(api.generate(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces an error event without exposing a provider payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromChunks([
      '{"type":"error","error":"本机 Provider 调用失败。"}\n',
    ])));

    await expect(api.generate(request)).rejects.toThrow('本机 Provider 调用失败');
    await expect(api.generate(request)).rejects.not.toThrow('provider-secret-error');
  });
});
