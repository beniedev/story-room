import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, BookConflictError } from '../src/api';
import type { Book } from '../src/types';
import type { ProviderProfile } from '../src/providerProfiles';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('../src/deviceLibrary');
  vi.resetModules();
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

  it.each([
    [400, { error: 'Synthetic invalid input' }, 'Synthetic invalid input', false],
    [404, { error: 'Synthetic missing Book' }, 'Synthetic missing Book', false],
    [409, { error: 'Synthetic stale Book' }, 'Synthetic stale Book', true],
    [400, { error: 'Synthetic conflict', code: 'BOOK_CONFLICT' }, 'Synthetic conflict', true],
  ])('preserves JSON error identity and message for HTTP %s', async (status, body, message, conflict) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

    const error = await api.loadBook('synthetic-book').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', message);
    expect(error instanceof BookConflictError).toBe(conflict);
    if (conflict) expect(error).toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409 });
  });

  it.each([400, 404, 409])('preserves non-JSON failure policy for HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic unreadable payload', { status })));

    const error = await api.loadBook('synthetic-book').catch((value: unknown) => value);
    expect(error instanceof BookConflictError).toBe(status === 409);
    expect(error).toHaveProperty('message', status === 409
      ? '这本 Book 已在其他页面更新，请重新载入后再保存。'
      : `本地书库请求失败（HTTP ${status}）。`);
  });

  it('keeps cancellation identity while translating ordinary connection failures', async () => {
    const failure = new Error('synthetic transport failure');
    vi.stubGlobal('fetch', vi.fn(async () => { throw failure; }));
    await expect(api.listBooks()).rejects.toThrow('无法连接本地书库服务，请确认故事书屋仍在运行。');

    const controller = new AbortController();
    controller.abort();
    await expect(api.generate({
      bookId: 'synthetic-book',
      sectionId: 'synthetic-section',
      mode: 'author',
      instruction: '',
    }, controller.signal)).rejects.toBe(failure);
  });
});

describe('runtime API facade', () => {
  it('selects the device adapter with dynamic repository mocks and can reload the host adapter', async () => {
    const entries = [{ id: 'synthetic-book', title: 'Synthetic', updatedAt: '2026-01-01T00:00:00.000Z' }];
    const listBooks = vi.fn(async () => entries);
    vi.doMock('../src/deviceLibrary', async () => {
      const actual = await vi.importActual<typeof import('../src/deviceLibrary')>('../src/deviceLibrary');
      return { ...actual, deviceLibrary: { ...actual.deviceLibrary, listBooks } };
    });
    vi.stubEnv('MODE', 'site');
    vi.resetModules();

    const device = await import('../src/api');
    expect(device.api.runtime).toBe('device');
    await expect(device.api.listBooks()).resolves.toBe(entries);
    expect(listBooks).toHaveBeenCalledOnce();

    vi.stubEnv('MODE', 'local-build');
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(entries)));
    vi.stubGlobal('fetch', fetchMock);
    const host = await import('../src/api');
    expect(host.api.runtime).toBe('host');
    await expect(host.api.listBooks()).resolves.toEqual(entries);
    expect(fetchMock).toHaveBeenCalledWith('/api/library', expect.any(Object));
    expect(listBooks).toHaveBeenCalledOnce();
  });

  it('uses a temporary device provider key only for the runtime request', async () => {
    const profile: ProviderProfile = {
      id: 'synthetic-provider',
      name: 'Synthetic',
      kind: 'openai-compatible',
      baseUrl: 'https://provider.example.invalid/v1///',
      modelId: 'synthetic-model',
      maxContext: 32000,
      maxOutput: 4096,
    };
    const apiKey = 'synthetic-temporary-key';
    const storage = {
      getItem: vi.fn(() => JSON.stringify([{ ...profile, apiKey }])),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubEnv('MODE', 'site');
    vi.resetModules();
    const { api: device } = await import('../src/api');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: profile.modelId }] })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(device.listProviderProfiles()).resolves.toEqual([profile]);
    await expect(device.saveProviderProfile(profile, apiKey)).resolves.toBe(profile);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(device.testProviderProfile(profile, ` ${apiKey} `)).resolves.toEqual({ ok: true, modelId: profile.modelId });
    expect(fetchMock).toHaveBeenCalledWith('https://provider.example.invalid/v1/models', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(profile).not.toHaveProperty('apiKey');
  });
});
