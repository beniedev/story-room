import type { Book, BookIndexEntry, ContextPlanPreview, GenerationRequest } from '../types';
import type { ProviderProfile } from '../providerProfiles';
import { request } from './hostRequest';
import { parseGenerationResult, streamRequest } from './generationStream';

export const hostApi = {
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
  generate: async (body: GenerationRequest, signal?: AbortSignal, onDelta?: (delta: string) => void) => (
    body.stream
      ? streamRequest(body, signal, onDelta)
      : parseGenerationResult(await request<unknown>('/api/generate', {
          method: 'POST',
          body: JSON.stringify(body),
          signal,
        }))
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
