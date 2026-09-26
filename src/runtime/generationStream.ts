import { isGenerationFinishReason } from '../types';
import type { GenerationRequest, GenerationResult } from '../types';
import { requestOnce } from './hostRequest';

const parseGenerationStreamLine = (
  line: string,
  onDelta: ((delta: string) => void) | undefined,
): GenerationResult | undefined => {
  if (!line.trim()) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error('本地书库返回了无法读取的流式数据。');
  }
  if (!event || typeof event !== 'object') throw new Error('本地书库返回了无效的流式事件。');
  const record = event as Record<string, unknown>;
  if (record.type === 'delta') {
    if (typeof record.text !== 'string') throw new Error('本地书库返回了无效的流式片段。');
    onDelta?.(record.text);
    return undefined;
  }
  if (record.type === 'error') {
    throw new Error(typeof record.error === 'string' && record.error
      ? record.error
      : '本地书库流式生成失败。');
  }
  if (record.type !== 'result' || !record.result || typeof record.result !== 'object') {
    throw new Error('本地书库返回了无效的流式事件。');
  }
  return parseGenerationResult(record.result);
};

export const parseGenerationResult = (value: unknown): GenerationResult => {
  if (!value || typeof value !== 'object') throw new Error('本地书库返回了无效的生成结果。');
  const result = value as Record<string, unknown>;
  if (typeof result.draft !== 'string') throw new Error('本地书库返回了无效的生成结果。');
  if (result.sourceSignature !== undefined && typeof result.sourceSignature !== 'string') {
    throw new Error('本地书库返回了无效的生成结果。');
  }
  if (result.finishReason !== undefined && !isGenerationFinishReason(result.finishReason)) {
    throw new Error('本地书库返回了无效的生成结果。');
  }
  return {
    draft: result.draft,
    finishReason: isGenerationFinishReason(result.finishReason) ? result.finishReason : 'unknown',
    ...(result.sourceSignature === undefined ? {} : { sourceSignature: result.sourceSignature }),
  };
};

export const readGenerationStream = async (
  response: Response,
  signal: AbortSignal | undefined,
  onDelta: ((delta: string) => void) | undefined,
): Promise<GenerationResult> => {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    let result: GenerationResult | undefined;
    for (const line of text.split(/[\r\n]+/)) {
      const parsed = parseGenerationStreamLine(line, onDelta);
      if (parsed) {
        result = parsed;
        break;
      }
    }
    if (!result) throw new Error('本地书库流式响应未正常结束。');
    return result;
  }

  if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GenerationResult | undefined;
  let completed = false;
  let cancelledByAbort = false;

  const consumeText = (text: string) => {
    buffer += text;
    while (true) {
      const lineEnd = buffer.search(/[\r\n]/);
      if (lineEnd < 0) return;
      const first = buffer[lineEnd];
      if (first === '\r' && lineEnd + 1 === buffer.length) return;
      const lineLength = first === '\r' && buffer[lineEnd + 1] === '\n' ? 2 : 1;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + lineLength);
      const parsed = parseGenerationStreamLine(line, onDelta);
      if (parsed) {
        result = parsed;
        return;
      }
    }
  };

  const abortReader = () => {
    cancelledByAbort = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abortReader, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
    while (!result) {
      if (signal?.aborted || cancelledByAbort) throw new DOMException('生成已取消。', 'AbortError');
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        if (signal?.aborted || cancelledByAbort) throw new DOMException('生成已取消。', 'AbortError');
        throw error;
      }
      if (read.done) break;
      consumeText(decoder.decode(read.value, { stream: true }));
    }
    if (signal?.aborted || cancelledByAbort) throw new DOMException('生成已取消。', 'AbortError');
    if (!result) {
      consumeText(decoder.decode());
      if (buffer.endsWith('\r')) {
        const line = buffer.slice(0, -1);
        buffer = '';
        const parsed = parseGenerationStreamLine(line, onDelta);
        if (parsed) result = parsed;
      } else if (buffer) {
        result = parseGenerationStreamLine(buffer, onDelta);
        buffer = '';
      }
    }
    if (!result) throw new Error('本地书库流式响应未正常结束。');
    completed = true;
    return result;
  } finally {
    signal?.removeEventListener('abort', abortReader);
    if (result || !completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

export const streamRequest = async (
  body: GenerationRequest,
  signal: AbortSignal | undefined,
  onDelta: ((delta: string) => void) | undefined,
): Promise<GenerationResult> => {
  let response: Response;
  try {
    response = await requestOnce('/api/generate', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new Error('无法连接本地书库服务，请确认故事书屋仍在运行。');
  }
  if (!response.ok) {
    const text = await response.text();
    let errorMessage: string | undefined;
    try {
      const payload = JSON.parse(text) as { error?: unknown };
      errorMessage = typeof payload.error === 'string' ? payload.error : undefined;
    } catch {
      // Keep the local error generic when a failed response is not JSON.
    }
    throw new Error(errorMessage ?? (response.status === 502 || response.status === 503
      ? '本地书库服务暂时不可用，请确认故事书屋仍在运行。'
      : `请求失败（HTTP ${response.status}）。`));
  }
  return readGenerationStream(response, signal, onDelta);
};
