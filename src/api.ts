import type {
  Book,
  BookIndexEntry,
  ContextPlan,
  GenerationRequest,
  GenerationResult,
} from './types';
import { deviceLibrary } from './deviceLibrary';

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? '请求失败。');
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
};

export const api = import.meta.env.MODE === 'site'
  ? { runtime: 'device' as const, ...deviceLibrary }
  : hostApi;
