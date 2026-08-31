import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host API errors', () => {
  it('explains an unavailable local library instead of exposing a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));

    await expect(api.listBooks()).rejects.toThrow('本地书库服务暂时不可用');
  });
});
