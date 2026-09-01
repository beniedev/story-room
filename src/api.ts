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
    throw new Error('无法连接本地书库服务，请确认故事书架仍在运行。');
  }

  const text = await response.text();
  let body: T & { error?: string };
  try {
    body = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
  } catch {
    throw new Error(response.ok
      ? '本地书库返回了无法读取的数据。'
      : `本地书库请求失败（HTTP ${response.status}）。`);
  }
  if (!response.ok) throw new Error(body.error ?? (response.status === 502 || response.status === 503
      ? '本地书库服务暂时不可用，请确认故事书架仍在运行。'
      : `请求失败（HTTP ${response.status}）。`));
  return body;
};

const hostApi = {
  runtime: 'host' as const,
  listBooks: () => request<BookIndexEntry[]>('/api/library'),
  loadBook: (bookId: string) => request<Book>(`/api/books/${bookId}`),
  createBook: (title: string) => request<Book>('/api/books', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  saveBook: (book: Book) => request<Book>(`/api/books/${book.id}`, {
    method: 'PUT',
    body: JSON.stringify(book),
  }),
  deleteBook: (bookId: string) => request<{ id: string }>(`/api/books/${bookId}`, {
    method: 'DELETE',
  }),
  contextPlan: (body: GenerationRequest) => request<ContextPlanPreview>('/api/context-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  generate: (body: GenerationRequest, signal?: AbortSignal) => request<GenerationResult>('/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  }),
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
  ? { runtime: 'device' as const, ...deviceLibrary, ...deviceProviderApi }
  : hostApi;
