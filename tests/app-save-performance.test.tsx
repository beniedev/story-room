// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
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
  reject: (error: unknown) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const makeBook = (): Book => {
  const blocks: SectionBlock[] = [{ id: 'existing-answer', kind: 'assistant', content: '已有正文。' }];
  return {
    id: 'app-save-performance-book',
    title: '合成保存回归书',
    writingBrief: '',
    characters: [],
    worldRules: [],
    canonFacts: [],
    summaries: [],
    chapters: [{
      id: 'app-save-performance-chapter',
      title: '合成章节',
      sections: [{
        id: 'app-save-performance-section',
        title: '合成小节',
        content: '已有正文。',
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

const waitForElement = async <T extends Element>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = query();
    if (found) return found;
    await flushMicrotasks();
  }
  throw new Error('Timed out waiting for the test element.');
};

const setTextAreaValue = async (textarea: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Textarea value setter is unavailable.');
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const renderApp = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  await flushMicrotasks();
  const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
  await act(async () => sectionButton.click());
  await flushMicrotasks();
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => root.unmount());
};

const installHostApi = ({
  book,
  onSave,
  onGenerate,
}: {
  book: Book;
  onSave?: (candidate: Book, index: number) => Promise<Response> | Response;
  onGenerate?: (request: GenerationRequest) => Promise<Response> | Response;
}) => {
  let persisted = structuredClone(book);
  const saves: Book[] = [];
  const generations: GenerationRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/library') {
      return jsonResponse([{ id: persisted.id, title: persisted.title, updatedAt: persisted.updatedAt }]);
    }
    if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
    if (url === '/api/providers') return jsonResponse([]);
    if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(structuredClone(persisted));
    if (url === `/api/books/${book.id}` && method === 'PUT') {
      const payload = JSON.parse(String(init?.body)) as { book: Book };
      const candidate = payload.book;
      const index = saves.push(structuredClone(candidate)) - 1;
      const response = onSave ? await onSave(candidate, index) : jsonResponse(candidate);
      if (response.ok) persisted = structuredClone(candidate);
      return response;
    }
    if (url === '/api/generate' && method === 'POST') {
      const request = JSON.parse(String(init?.body)) as GenerationRequest;
      generations.push(request);
      return onGenerate ? onGenerate(request) : jsonResponse({ draft: '合成生成结果。' });
    }
    throw new Error(`Unexpected test request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, saves, generations, getPersisted: () => structuredClone(persisted) };
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
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App save deduplication before generation', () => {
  it('generates from a clean loaded Book without an extra pre-generation PUT', async () => {
    const apiState = installHostApi({ book: makeBook() });
    const { container, root } = await renderApp();
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();

      expect(apiState.saves).toHaveLength(0);
      expect(apiState.generations).toHaveLength(1);
    } finally {
      await unmount(root);
    }
  });

  it('reuses an autosave already in flight and waits for it before generation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const firstSave = deferred<Response>();
    const generation = deferred<Response>();
    const book = makeBook();
    const apiState = installHostApi({
      book,
      onSave: (candidate, index) => index === 0 ? firstSave.promise : jsonResponse(candidate),
      onGenerate: () => generation.promise,
    });
    const { container, root } = await renderApp();
    try {
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await setTextAreaValue(note, '保存前注释。');
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);

      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await setTextAreaValue(instruction, '继续写这一节。');
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(apiState.generations).toHaveLength(0);

      firstSave.resolve(jsonResponse(apiState.saves[0]));
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(apiState.generations).toHaveLength(1);
      expect(apiState.generations[0]).toMatchObject({ instruction: '继续写这一节。', authorNote: '保存前注释。' });
      generation.resolve(jsonResponse({ draft: '合成在途保存后的回答。' }));
      await flushMicrotasks();
    } finally {
      await unmount(root);
    }
  });

  it('does not pre-save again after an unchanged autosave has succeeded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const generation = deferred<Response>();
    const apiState = installHostApi({ book, onGenerate: () => generation.promise });
    const { container, root } = await renderApp();
    try {
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await setTextAreaValue(note, '已保存注释。');
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);

      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await setTextAreaValue(instruction, '继续写下一段。');
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(apiState.generations).toHaveLength(1);
      generation.resolve(jsonResponse({ draft: '合成已保存正文后的回答。' }));
      await flushMicrotasks();
    } finally {
      await unmount(root);
    }
  });

  it('keeps input after a failed save and retries the same material before generation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const retrySave = deferred<Response>();
    const book = makeBook();
    const apiState = installHostApi({
      book,
      onSave: (candidate, index) => index === 0
        ? new Response(JSON.stringify({ error: 'Synthetic save failure' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        : index === 1 ? retrySave.promise : jsonResponse(candidate),
    });
    const { container, root } = await renderApp();
    try {
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await setTextAreaValue(note, '失败后仍要保留的注释。');
      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await setTextAreaValue(instruction, '失败后仍要保留的输入。');
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      await flushMicrotasks();

      expect(apiState.saves).toHaveLength(1);
      expect(container.textContent).toContain('Synthetic save failure');
      expect(note.value).toBe('失败后仍要保留的注释。');
      expect(instruction.value).toBe('失败后仍要保留的输入。');

      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(2);
      expect(apiState.saves[1]?.chapters[0]?.sections[0]?.note).toBe('失败后仍要保留的注释。');
      expect(apiState.generations).toHaveLength(0);
      expect(instruction.value).toBe('失败后仍要保留的输入。');

      retrySave.resolve(jsonResponse(apiState.saves[1]));
      await flushMicrotasks();
      expect(apiState.generations).toHaveLength(1);
      expect(apiState.generations[0]?.instruction).toBe('失败后仍要保留的输入。');
    } finally {
      await unmount(root);
    }
  });
});
