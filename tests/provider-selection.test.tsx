// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PROVIDER_PROFILES_STORAGE_KEY, type ProviderProfile } from '../src/providerProfiles';
import type { Book, GenerationRequest, SectionBlock } from '../src/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const profiles: ProviderProfile[] = [
  {
    id: 'provider-primary',
    name: '主要模型',
    kind: 'fake',
    baseUrl: 'https://example.test/primary',
    modelId: 'primary-model',
    maxContext: 128000,
    maxOutput: 8192,
  },
  {
    id: 'provider-draft',
    name: '快速草稿',
    kind: 'fake',
    baseUrl: 'https://example.test/draft',
    modelId: 'draft-model',
    maxContext: 32000,
    maxOutput: 4096,
  },
];

const makeBook = (): Book => {
  const blocks: SectionBlock[] = [{ id: 'existing-answer', kind: 'assistant', content: '已有正文。' }];
  return {
    id: 'provider-selection-book',
    title: '合成方案选择书',
    writingBrief: '',
    characters: [],
    worldRules: [],
    canonFacts: [],
    summaries: [],
    chapters: [{
      id: 'provider-selection-chapter',
      title: '第一章',
      sections: [{
        id: 'provider-selection-section',
        title: '第一节',
        content: blocks.map((block) => block.content).join('\n\n'),
        blocks,
      }],
    }],
    branches: [],
    updatedAt: '2026-09-09T00:00:00.000Z',
  };
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
};

const waitForElement = async <T,>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = query();
    if (found) return found;
    await flushMicrotasks();
  }
  throw new Error('Timed out waiting for the test element.');
};

const renderApp = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => root.unmount());
};

const setSelectValue = async (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Select value setter is unavailable.');
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setTextAreaValue = async (textarea: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Textarea value setter is unavailable.');
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const installHostApi = (book: Book, providerResponses: Array<Promise<Response> | Response>) => {
  let persisted = structuredClone(book);
  const generations: GenerationRequest[] = [];
  let providerRequest = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/library') return jsonResponse([{ id: persisted.id, title: persisted.title, updatedAt: persisted.updatedAt }]);
    if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
    if (url === '/api/providers') {
      const response = providerResponses[providerRequest++] ?? jsonResponse(profiles);
      return response;
    }
    if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(structuredClone(persisted));
    if (url === `/api/books/${book.id}` && method === 'PUT') {
      const candidate = JSON.parse(String(init?.body)) as Book;
      persisted = structuredClone(candidate);
      return jsonResponse(candidate);
    }
    if (url === '/api/generate' && method === 'POST') {
      generations.push(JSON.parse(String(init?.body)) as GenerationRequest);
      return jsonResponse({ draft: '方案选择生成结果。' });
    }
    throw new Error(`Unexpected test request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, generations };
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('host provider selection persistence', () => {
  it('remembers the selected host profile ID across delayed reloads without storing profiles', async () => {
    const storage = localStorage as MemoryStorage;
    storage.setItem('story-native:active-provider-profile', 'provider-primary');
    const firstProfiles = deferred<Response>();
    const secondProfiles = deferred<Response>();
    const apiState = installHostApi(makeBook(), [firstProfiles.promise, secondProfiles.promise]);

    const first = await renderApp();
    expect(storage.getItem(PROVIDER_PROFILES_STORAGE_KEY)).toBeNull();
    firstProfiles.resolve(jsonResponse(profiles));
    const firstSettings = await waitForElement(() => first.container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]'));
    await act(async () => firstSettings.click());
    const firstSelect = await waitForElement(() => first.container.querySelector('#provider-profile-select') as HTMLSelectElement | null);
    await setSelectValue(firstSelect, 'provider-draft');
    await flushMicrotasks();
    expect(storage.getItem('story-native:active-provider-profile')).toBe('provider-draft');
    expect(storage.getItem(PROVIDER_PROFILES_STORAGE_KEY)).toBeNull();
    await unmount(first.root);

    const second = await renderApp();
    expect(storage.getItem('story-native:active-provider-profile')).toBe('provider-draft');
    secondProfiles.resolve(jsonResponse(profiles));
    const secondSettings = await waitForElement(() => second.container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]'));
    await act(async () => secondSettings.click());
    const secondSelect = await waitForElement(() => second.container.querySelector('#provider-profile-select') as HTMLSelectElement | null);
    expect(secondSelect.value).toBe('provider-draft');
    await act(async () => second.container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click());
    const sectionOpen = await waitForElement(() => second.container.querySelector<HTMLButtonElement>('.section-open'));
    await act(async () => sectionOpen.click());
    const instruction = await waitForElement(() => second.container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
    await setTextAreaValue(instruction, '使用已恢复的方案继续。');
    await act(async () => second.container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
    await flushMicrotasks();
    expect(apiState.generations.at(-1)?.providerProfileId).toBe('provider-draft');
    await unmount(second.root);

    expect(apiState.fetchMock.mock.calls.filter(([input]) => String(input) === '/api/providers')).toHaveLength(2);
  });

  it('falls back to the first available profile when the remembered ID was removed', async () => {
    const storage = localStorage as MemoryStorage;
    storage.setItem('story-native:active-provider-profile', 'provider-removed');
    installHostApi(makeBook(), [jsonResponse(profiles)]);
    const rendered = await renderApp();
    const settings = await waitForElement(() => rendered.container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]'));
    await act(async () => settings.click());
    const select = await waitForElement(() => rendered.container.querySelector('#provider-profile-select') as HTMLSelectElement | null);
    expect(select.value).toBe('provider-primary');
    await flushMicrotasks();
    expect(storage.getItem('story-native:active-provider-profile')).toBe('provider-primary');
    expect(storage.getItem(PROVIDER_PROFILES_STORAGE_KEY)).toBeNull();
    await unmount(rendered.root);
  });
});
