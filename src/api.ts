import type {
  Book,
  BookIndexEntry,
  ContextPlan,
  GenerationRequest,
  GenerationResult,
} from './types';
import { deviceLibrary } from './deviceLibrary';
import {
  defaultProviderProfiles,
  type ProviderProfile,
} from './providerProfiles';

export const HOST_ACCESS_TOKEN_STORAGE_KEY = 'story-native:host-access-token';
export const HOST_ACCESS_TOKEN_ENABLED_STORAGE_KEY = 'story-native:host-access-token-enabled';

export type HostAccessTokenSettings = {
  enabled: boolean;
  token: string;
};

export const readHostAccessTokenSettings = (): HostAccessTokenSettings => {
  try {
    const enabled = typeof localStorage !== 'undefined'
      && localStorage.getItem(HOST_ACCESS_TOKEN_ENABLED_STORAGE_KEY) === '1';
    const token = enabled && typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(HOST_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? ''
      : '';
    return { enabled, token };
  } catch {
    return { enabled: false, token: '' };
  }
};

export const saveHostAccessTokenSettings = (enabled: boolean, token: string): HostAccessTokenSettings => {
  const normalized = enabled ? token.trim() : '';
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(HOST_ACCESS_TOKEN_ENABLED_STORAGE_KEY, '1');
      else localStorage.removeItem(HOST_ACCESS_TOKEN_ENABLED_STORAGE_KEY);
    }
    if (typeof sessionStorage !== 'undefined') {
      if (normalized) sessionStorage.setItem(HOST_ACCESS_TOKEN_STORAGE_KEY, normalized);
      else sessionStorage.removeItem(HOST_ACCESS_TOKEN_STORAGE_KEY);
    }
  } catch {
    throw new Error('当前浏览器无法保存访问密码。');
  }
  return { enabled, token: normalized };
};

const readHostAccessToken = () => {
  return readHostAccessTokenSettings().token;
};

const requestOnce = async (url: string, init: RequestInit | undefined, accessToken: string) => {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(url, { ...init, headers });
};

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const accessToken = readHostAccessToken();
  let response: Response;
  try {
    response = await requestOnce(url, init, accessToken);
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
  if (!response.ok) throw new Error(response.status === 401
    ? '此书库设置了访问密码，请在设置中启用或检查密码。'
    : body.error ?? (response.status === 502 || response.status === 503
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
  contextPlan: (body: GenerationRequest) => request<ContextPlan>('/api/context-plan', {
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
  listProviderProfiles: async () => defaultProviderProfiles.map((profile) => ({ ...profile })),
  saveProviderProfile: async (profile: ProviderProfile) => profile,
  testProviderProfile: testDeviceProvider,
};

export const api = import.meta.env.MODE === 'site'
  ? { runtime: 'device' as const, ...deviceLibrary, ...deviceProviderApi }
  : hostApi;
