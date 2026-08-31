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

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
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
  if (!response.ok) throw new Error(body.error
    ?? (response.status === 502 || response.status === 503
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
  generate: (body: GenerationRequest) => request<GenerationResult>('/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
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
