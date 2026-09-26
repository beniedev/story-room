import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { readGenerationStream } from '../src/runtime/generationStream';
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
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
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
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(body.locked).toBe(false);
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

  it('decodes a multibyte character split inside its UTF-8 bytes and a split CRLF', async () => {
    const text = '{"type":"delta","text":"苹果"}\r\n{"type":"result","result":{"draft":"苹果","finishReason":"stop"}}';
    const bytes = new TextEncoder().encode(text);
    const characterStart = new TextEncoder().encode(text.slice(0, text.indexOf('苹'))).length;
    const carriageReturn = bytes.indexOf(13);
    const chunks = [bytes.slice(0, characterStart + 1), bytes.slice(characterStart + 1, carriageReturn + 1), bytes.slice(carriageReturn + 1)];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const deltas: string[] = [];

    await expect(api.generate(request, undefined, (delta) => deltas.push(delta))).resolves.toEqual({
      draft: '苹果', finishReason: 'stop',
    });
    expect(deltas).toEqual(['苹果']);
    expect(body.locked).toBe(false);
  });

  it.each([
    ['not-json\n', '本地书库返回了无法读取的流式数据。'],
    ['{"type":"delta","text":5}\n', '本地书库返回了无效的流式片段。'],
    ['{"type":"result","result":{"draft":"partial","sourceSignature":5}}\n', '本地书库返回了无效的生成结果。'],
  ])('cancels and releases a malformed stream without replacing its error', async (text, message) => {
    const cancel = vi.fn(() => { throw new Error('synthetic cleanup failure'); });
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(text)); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));

    await expect(api.generate(request)).rejects.toThrow(message);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('requires a final result even when a response only exposes text', async () => {
    const deltas: string[] = [];
    const response = (text: string) => ({ body: null, text: async () => text }) as Response;

    await expect(readGenerationStream(response('{"type":"delta","text":"partial"}\n'), undefined, (delta) => deltas.push(delta)))
      .rejects.toThrow('本地书库流式响应未正常结束。');
    expect(deltas).toEqual(['partial']);
    await expect(readGenerationStream(response('{"type":"result","result":{"draft":"complete"}}'), undefined, undefined))
      .resolves.toEqual({ draft: 'complete', finishReason: 'unknown' });
  });
});
