import type {
  Book,
  BookIndexEntry,
  ContextPlanPreview,
  GenerationRequest,
  GenerationResult,
} from './types';
import { deviceLibrary } from './deviceLibrary';
import {
  isValidProviderLimit,
  MAX_PROVIDER_CONTEXT_TOKENS,
  MAX_PROVIDER_OUTPUT_TOKENS,
  PROVIDER_PROFILES_STORAGE_KEY,
  readProviderProfiles,
  type ProviderProfile,
} from './providerProfiles';

export class BookConflictError extends Error {
  readonly code = 'BOOK_CONFLICT' as const;
  readonly statusCode = 409 as const;

  constructor(message = '这本 Book 已在其他页面更新，请重新载入后再保存。') {
    super(message);
    this.name = 'BookConflictError';
  }
}

const requestOnce = async (url: string, init: RequestInit | undefined) => {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  return fetch(url, { ...init, headers });
};

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await requestOnce(url, init);
  } catch (error) {
    if (init?.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    throw new Error('无法连接本地书库服务，请确认故事书屋仍在运行。');
  }

  const text = await response.text();
  let body: T & { error?: string; code?: unknown };
  try {
    body = text ? JSON.parse(text) as T & { error?: string; code?: unknown } : {} as T & { error?: string; code?: unknown };
  } catch {
    if (!response.ok && response.status === 409) throw new BookConflictError();
    throw new Error(response.ok
      ? '本地书库返回了无法读取的数据。'
      : `本地书库请求失败（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = body.error ?? (response.status === 502 || response.status === 503
      ? '本地书库服务暂时不可用，请确认故事书屋仍在运行。'
      : `请求失败（HTTP ${response.status}）。`);
    if (response.status === 409 || body.code === 'BOOK_CONFLICT') throw new BookConflictError(message);
    throw new Error(message);
  }
  return body;
};

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
  const result = record.result as Record<string, unknown>;
  if (typeof result.draft !== 'string') throw new Error('本地书库返回了无效的生成结果。');
  if (result.sourceSignature !== undefined && typeof result.sourceSignature !== 'string') {
    throw new Error('本地书库返回了无效的生成结果。');
  }
  return {
    draft: result.draft,
    ...(result.sourceSignature === undefined ? {} : { sourceSignature: result.sourceSignature }),
  };
};

const readGenerationStream = async (
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

const streamRequest = async (
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

const hostApi = {
  runtime: 'host' as const,
  listBooks: () => request<BookIndexEntry[]>('/api/library'),
  storageLocation: () => request<{ location: string }>('/api/storage-location'),
  loadBook: (bookId: string) => request<Book>(`/api/books/${bookId}`),
  createBook: (title: string) => request<Book>('/api/books', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  saveBook: (book: Book, expectedUpdatedAt: string) => request<Book>(`/api/books/${book.id}`, {
    method: 'PUT',
    body: JSON.stringify({ book, expectedUpdatedAt }),
  }),
  importBook: (book: Book) => request<Book>('/api/books/import', {
    method: 'POST',
    body: JSON.stringify({ book }),
  }),
  deleteBook: (bookId: string) => request<{ id: string }>(`/api/books/${bookId}`, {
    method: 'DELETE',
  }),
  contextPlan: (body: GenerationRequest) => request<ContextPlanPreview>('/api/context-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  generate: (body: GenerationRequest, signal?: AbortSignal, onDelta?: (delta: string) => void) => (
    body.stream
      ? streamRequest(body, signal, onDelta)
      : request<GenerationResult>('/api/generate', {
          method: 'POST',
          body: JSON.stringify(body),
          signal,
        })
  ),
  listProviderProfiles: () => request<ProviderProfile[]>('/api/providers'),
  saveProviderProfile: (profile: ProviderProfile, apiKey?: string) => request<ProviderProfile>('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ profile, apiKey }),
  }),
  testProviderProfile: (profile: ProviderProfile, apiKey?: string) => request<{ ok: true; modelId: string }>('/api/provider-test', {
    method: 'POST',
    body: JSON.stringify({ profile, apiKey }),
  }),
};

const testDeviceProvider = async (profile: ProviderProfile, apiKey?: string) => {
  if (!isValidProviderLimit(profile.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
    || !isValidProviderLimit(profile.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)) {
    throw new Error('上下文与输出上限必须是合理的正整数。');
  }
  if (profile.kind === 'fake') return { ok: true as const, modelId: profile.modelId };
  if (!apiKey?.trim()) throw new Error('请填写 API Key。');
  const response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? '连接失败：API Key 无效或没有权限。'
    : `连接失败：服务返回 HTTP ${response.status}。`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  const ids = Array.isArray(payload.data)
    ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length && !ids.includes(profile.modelId)) throw new Error('连接成功，但模型列表中没有这个模型 ID。');
  return { ok: true as const, modelId: profile.modelId };
};

const deviceProviderApi = {
  listProviderProfiles: async () => readProviderProfiles(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PROVIDER_PROFILES_STORAGE_KEY),
  ),
  saveProviderProfile: async (profile: ProviderProfile) => {
    if (!isValidProviderLimit(profile.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
      || !isValidProviderLimit(profile.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)) {
      throw new Error('上下文与输出上限必须是合理的正整数。');
    }
    return profile;
  },
  testProviderProfile: testDeviceProvider,
};

export const api = import.meta.env.MODE === 'site'
  ? {
      runtime: 'device' as const,
      ...deviceLibrary,
      ...deviceProviderApi,
      storageLocation: async () => ({ location: `浏览器本地存储（${window.location.origin}）` }),
    }
  : hostApi;
