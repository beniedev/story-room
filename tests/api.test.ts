import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, BookConflictError } from '../src/api';
import type { Book } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host API errors', () => {
  it('explains an unavailable local library instead of exposing a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));

    await expect(api.listBooks()).rejects.toThrow('本地书库服务暂时不可用');
  });

  it('exposes a typed conflict error for stale Book saves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Book revision is stale',
      code: 'BOOK_CONFLICT',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));
    const book = { id: 'api-book', title: 'Synthetic', updatedAt: '2026-01-01T00:00:00.000Z' } as Book;

    const error = await api.saveBook(book, book.updatedAt).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BookConflictError);
    expect(error).toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409, message: 'Book revision is stale' });
  });

  it('sends the frozen save envelope and exposes the import-copy API', async () => {
    const saved = { id: 'api-book', title: 'Synthetic', updatedAt: '2026-01-01T00:00:01.000Z' } as Book;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(saved), {
      status: init?.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const book = { id: 'api-book', title: 'Synthetic', updatedAt: '2026-01-01T00:00:00.000Z' } as Book;

    await api.saveBook(book, 'server-baseline');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      book,
      expectedUpdatedAt: 'server-baseline',
    });

    await api.importBook(book);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/books/import');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ book });
  });
});
