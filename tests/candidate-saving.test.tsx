// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import type { Book, SectionBlock } from '../src/types';

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

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const makeBook = (): Book => {
  const blocks: SectionBlock[] = [{
    id: 'answer-block',
    kind: 'assistant',
    content: '采用版本一。',
    candidates: [
      { id: 'candidate-one', content: '采用版本一。' },
      { id: 'candidate-two', content: '准备采用版本二。' },
    ],
    adoptedCandidateId: 'candidate-one',
  }];
  return {
    id: 'synthetic-saving-book',
    title: '合成保存回归书',
    writingBrief: '合成测试设定。',
    characters: [],
    worldRules: [],
    canonFacts: [],
    summaries: [],
    chapters: [{
      id: 'synthetic-saving-chapter',
      title: '合成章节',
      sections: [{
        id: 'synthetic-saving-section',
        title: '合成小节',
        content: '采用版本一。',
        blocks,
      }],
    }],
    branches: [],
    updatedAt: '2026-09-09T00:00:00.000Z',
  };
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
};

const setControlValue = (control: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Textarea value setter is unavailable.');
  setter.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
};

const waitForElement = async <T extends Element>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
  await flushMicrotasks();
  const section = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
  await act(async () => section.click());
  await flushMicrotasks();
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => root.unmount());
};

const installHostApi = ({
  book,
  onSave,
}: {
  book: Book;
  onSave: (candidate: Book) => Promise<Response> | Response;
}) => {
  let persisted = structuredClone(book);
  const saves: Book[] = [];
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
      const candidate = JSON.parse(String(init?.body)) as Book;
      saves.push(structuredClone(candidate));
      const response = await onSave(candidate);
      if (response.ok) persisted = structuredClone(candidate);
      return response;
    }
    throw new Error(`Unexpected test request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, saves, getPersisted: () => structuredClone(persisted) };
};

const selectCandidate = async (container: HTMLElement, direction: 'next' | 'previous') => {
  const blockSelect = await waitForElement(() => container.querySelector<HTMLButtonElement>(
    '[data-block-id="answer-block"] .manuscript-block-select',
  ));
  if (!container.querySelector('button[aria-label="下一版回答候选"], button[aria-label="上一版回答候选"]')) {
    await act(async () => blockSelect.click());
  }
  const candidateButton = await waitForElement(() => container.querySelector<HTMLButtonElement>(
    `button[aria-label="${direction === 'next' ? '下一版' : '上一版'}回答候选"]`,
  ));
  await act(async () => candidateButton.click());
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

describe('candidate saving pending boundaries', () => {
  it('coalesces rapid candidate changes into the latest autosave', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const apiState = installHostApi({
      book,
      onSave: async (candidate) => jsonResponse(candidate),
    });
    const { container, root } = await renderApp();
    try {
      await selectCandidate(container, 'next');
      await selectCandidate(container, 'previous');
      await selectCandidate(container, 'next');
      expect(container.querySelector('.manuscript')?.textContent).toContain('准备采用版本二。');

      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(apiState.saves[0]?.chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '准备采用版本二。',
        adoptedCandidateId: 'candidate-two',
      });
    } finally {
      await unmount(root);
    }
  });

  it('keeps switching and returning available while the first candidate save is pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const savesInFlight: Deferred<Response>[] = [];
    const apiState = installHostApi({
      book,
      onSave: async () => {
        const request = deferred<Response>();
        savesInFlight.push(request);
        return request.promise;
      },
    });
    const { container, root } = await renderApp();
    try {
      await selectCandidate(container, 'next');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(container.querySelector<HTMLButtonElement>('.writer-back-button')?.disabled).toBe(false);

      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '保存等待期间仍可继续输入。'));
      expect(instruction.value).toBe('保存等待期间仍可继续输入。');
      await selectCandidate(container, 'previous');
      expect(container.querySelector('.manuscript')?.textContent).toContain('采用版本一。');
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-back-button')?.click());
      expect(container.querySelector('.shelf-content')).not.toBeNull();

      savesInFlight[0]?.resolve(jsonResponse(apiState.saves[0]));
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(savesInFlight.length).toBeGreaterThanOrEqual(2);
      savesInFlight[1]?.resolve(jsonResponse(apiState.saves[1] ?? apiState.saves[0]));
      await flushMicrotasks();
    } finally {
      for (const request of savesInFlight) request.resolve(jsonResponse(book));
      await unmount(root);
    }
  });

  it('ignores an older candidate response after the user switches again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const savesInFlight: Deferred<Response>[] = [];
    const apiState = installHostApi({
      book,
      onSave: async () => {
        const request = deferred<Response>();
        savesInFlight.push(request);
        return request.promise;
      },
    });
    const { container, root } = await renderApp();
    try {
      await selectCandidate(container, 'next');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(savesInFlight).toHaveLength(1);

      await selectCandidate(container, 'previous');
      expect(container.querySelector('.manuscript')?.textContent).toContain('采用版本一。');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(savesInFlight).toHaveLength(1);

      savesInFlight[0]?.resolve(jsonResponse(apiState.saves[0]));
      await flushMicrotasks();
      expect(container.querySelector('.manuscript')?.textContent).toContain('采用版本一。');
      expect(savesInFlight).toHaveLength(2);
      expect(apiState.saves[1]?.chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '采用版本一。',
        adoptedCandidateId: 'candidate-one',
      });

      savesInFlight[1]?.resolve(jsonResponse(apiState.saves[1]));
      await flushMicrotasks();
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '采用版本一。',
        adoptedCandidateId: 'candidate-one',
      });
    } finally {
      for (const request of savesInFlight) request.resolve(jsonResponse(book));
      await unmount(root);
    }
  });

  it('skips stale autosaves already queued behind the first PUT', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const savesInFlight: Deferred<Response>[] = [];
    const apiState = installHostApi({
      book,
      onSave: async () => {
        const request = deferred<Response>();
        savesInFlight.push(request);
        return request.promise;
      },
    });
    const { container, root } = await renderApp();
    try {
      await selectCandidate(container, 'next');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(apiState.saves[0]?.chapters[0]?.sections[0]?.blocks?.[0]?.adoptedCandidateId)
        .toBe('candidate-two');

      await selectCandidate(container, 'previous');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);

      await selectCandidate(container, 'next');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);

      savesInFlight[0]?.resolve(jsonResponse(apiState.saves[0]));
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(2);
      expect(apiState.saves.map((candidate) =>
        candidate.chapters[0]?.sections[0]?.blocks?.[0]?.adoptedCandidateId))
        .toEqual(['candidate-two', 'candidate-two']);

      savesInFlight[1]?.resolve(jsonResponse(apiState.saves[1]));
      await flushMicrotasks();
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '准备采用版本二。',
        adoptedCandidateId: 'candidate-two',
      });
    } finally {
      for (const request of savesInFlight) request.resolve(jsonResponse(book));
      await unmount(root);
    }
  });

  it('shows a failed candidate save while retaining the selected text and input', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook();
    const apiState = installHostApi({
      book,
      onSave: async () => new Response(JSON.stringify({ error: 'Synthetic save failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const { container, root } = await renderApp();
    try {
      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '失败后仍要保留的输入。'));
      await selectCandidate(container, 'next');
      expect(container.querySelector('.manuscript')?.textContent).toContain('准备采用版本二。');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(1);
      expect(container.querySelector('.writer-status')?.textContent).toContain('Synthetic save failure');
      expect(container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.value).toBe('失败后仍要保留的输入。');
      expect(container.querySelector('.manuscript')?.textContent).toContain('准备采用版本二。');
    } finally {
      await unmount(root);
    }
  });
});
