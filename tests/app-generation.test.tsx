// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import type { Book, GenerationRequest, SectionBlock } from '../src/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
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

const makeBook = (blocks: SectionBlock[], note = ''): Book => ({
  id: 'synthetic-generation-book',
  title: '合成生成回归书',
  writingBrief: '合成测试用写作设定。',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'synthetic-generation-chapter',
    title: '合成章节',
    sections: [{
      id: 'synthetic-generation-section',
      title: '合成小节',
      note,
      blocks,
      content: blocks.map((block) => block.content).join('\n\n'),
    }],
  }],
  branches: [],
  updatedAt: '2026-09-09T00:00:00.000Z',
});

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
};

const setControlValue = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Control value setter is unavailable.');
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

const renderApp = async (book: Book) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  await flushMicrotasks();
  const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
  await act(async () => sectionButton.click());
  await flushMicrotasks();
  return { container, root, book };
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
  onSave?: (candidate: Book) => Promise<Response> | Response;
  onGenerate?: (request: GenerationRequest, signal?: AbortSignal) => Promise<Response> | Response;
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
      const candidate = JSON.parse(String(init?.body)) as Book;
      saves.push(structuredClone(candidate));
      const response = onSave ? await onSave(candidate) : jsonResponse(candidate);
      if (response.ok) persisted = structuredClone(candidate);
      return response;
    }
    if (url === '/api/generate' && method === 'POST') {
      const request = JSON.parse(String(init?.body)) as GenerationRequest;
      generations.push(request);
      return onGenerate
        ? onGenerate(request, init?.signal ?? undefined)
        : jsonResponse({ draft: '合成生成结果。' });
    }
    throw new Error(`Unexpected test request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    saves,
    generations,
    getPersisted: () => structuredClone(persisted),
  };
};

const openBlockEditor = async (container: HTMLElement, blockId: string) => {
  const select = container.querySelector<HTMLButtonElement>(
    `[data-block-id="${blockId}"] .manuscript-block-select`,
  );
  if (!select) throw new Error(`Missing block selector for ${blockId}.`);
  await act(async () => select.click());
  const edit = await waitForElement(() => container.querySelector<HTMLButtonElement>(
    'button[aria-label="编辑所选片段"]',
  ));
  await act(async () => edit.click());
  return waitForElement(() => container.querySelector<HTMLTextAreaElement>('#block-editor-textarea'));
};

const makePromptAnswerBook = (note = '') => makeBook([
  { id: 'prompt-block', kind: 'user', content: '旧的已发送提示。' },
  { id: 'answer-block', kind: 'assistant', content: '原来的回答。' },
], note);

const makeCandidateResponseBook = () => makeBook([
  {
    id: 'earlier-answer-block',
    kind: 'assistant',
    content: '更早的当前回答。',
    candidates: [
      { id: 'earlier-old', content: '更早的旧候选。', sourceSignature: 'sig-earlier-old' },
      { id: 'earlier-current', content: '更早的当前回答。', sourceSignature: 'sig-earlier-current' },
    ],
    adoptedCandidateId: 'earlier-current',
  },
  { id: 'first-prompt', kind: 'user', content: '第一条已发送提示。' },
  {
    id: 'answer-block',
    kind: 'assistant',
    content: '当前候选回答。',
    candidates: [
      { id: 'candidate-old', content: '旧候选回答。', sourceSignature: 'sig-old' },
      { id: 'candidate-current', content: '当前候选回答。', sourceSignature: 'sig-current' },
    ],
    adoptedCandidateId: 'candidate-current',
  },
  { id: 'next-prompt', kind: 'user', content: '下一条已发送提示。' },
]);

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

describe('App generation save and cancellation boundaries', () => {
  it('saves an edited preceding user block before regenerating its unchanged answer block', async () => {
    const book = makePromptAnswerBook();
    const apiState = installHostApi({ book });
    const { container, root } = await renderApp(book);
    try {
      const editor = await openBlockEditor(container, 'prompt-block');
      await act(async () => setControlValue(editor, '新的已发送提示。'));
      await act(async () => container.querySelector<HTMLButtonElement>(
        'button[aria-label="完成编辑并返回正文"]',
      )?.click());

      const answerSelect = container.querySelector<HTMLButtonElement>(
        '[data-block-id="answer-block"] .manuscript-block-select',
      );
      expect(answerSelect).not.toBeNull();
      await act(async () => answerSelect?.click());
      const regenerate = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      ));
      await act(async () => regenerate.click());
      await flushMicrotasks();

      expect(apiState.generations).toHaveLength(1);
      expect(apiState.generations[0]).toMatchObject({
        generationKind: 'regenerate-block',
        targetBlockId: 'answer-block',
      });
      expect(apiState.saves.at(-1)?.chapters[0]?.sections[0]?.blocks).toEqual([
        { id: 'prompt-block', kind: 'user', content: '新的已发送提示。' },
        { id: 'answer-block', kind: 'assistant', content: '原来的回答。' },
      ]);
    } finally {
      await unmount(root);
    }
  });

  it('does not generate from a stale snapshot when material changes during a queued save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makePromptAnswerBook('旧的小节注释。');
    const firstSave = deferred<Response>();
    const generation = deferred<Response>();
    let saveCount = 0;
    const apiState = installHostApi({
      book,
      onSave: async (candidate) => {
        saveCount += 1;
        if (saveCount === 1) return firstSave.promise;
        return jsonResponse(candidate);
      },
      onGenerate: async () => generation.promise,
    });
    const { container, root } = await renderApp(book);
    try {
      const editor = await openBlockEditor(container, 'prompt-block');
      await act(async () => setControlValue(editor, '新的已发送提示。'));
      await act(async () => container.querySelector<HTMLButtonElement>(
        'button[aria-label="完成编辑并返回正文"]',
      )?.click());
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(apiState.saves).toHaveLength(1);

      const answerSelect = container.querySelector<HTMLButtonElement>(
        '[data-block-id="answer-block"] .manuscript-block-select',
      );
      await act(async () => answerSelect?.click());
      const regenerate = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      ));
      const note = container.querySelector<HTMLTextAreaElement>('#author-note-input');
      expect(note).not.toBeNull();

      // The native events share one turn with the regenerate action. This
      // models a material edit arriving before React commits busy=true while
      // the queued autosave is still in flight.
      await act(async () => {
        regenerate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (note) setControlValue(note, '新的小节注释。');
      });
      await flushMicrotasks();
      expect(apiState.generations).toHaveLength(0);

      const firstBody = apiState.saves[0]!;
      firstSave.resolve(jsonResponse(firstBody));
      await flushMicrotasks();

      // A correct implementation either retries with the changed material or
      // aborts before the provider call. It must never send the old note.
      if (apiState.generations.length > 0) {
        expect(apiState.getPersisted().chapters[0]?.sections[0]?.note).toBe('新的小节注释。');
        expect(apiState.saves.some((candidate) =>
          candidate.chapters[0]?.sections[0]?.note === '新的小节注释。')).toBe(true);
        generation.resolve(jsonResponse({ draft: '不应基于旧材料生成。' }));
        await flushMicrotasks();
        expect(container.querySelector('.manuscript')?.textContent).not.toContain('不应基于旧材料生成。');
      } else {
        expect(container.textContent).toMatch(/变化|取消|失败/);
      }
    } finally {
      await unmount(root);
    }
  });

  it('keeps a synchronous double submit to one save and one provider request', async () => {
    const book = makeBook([{ id: 'answer-block', kind: 'assistant', content: '已有正文。' }]);
    const generation = deferred<Response>();
    const apiState = installHostApi({ book, onGenerate: async () => generation.promise });
    const { container, root } = await renderApp(book);
    try {
      const instruction = container.querySelector<HTMLTextAreaElement>('#writing-instruction');
      expect(instruction).not.toBeNull();
      await act(async () => {
        if (instruction) setControlValue(instruction, '继续写下一段。');
      });
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await act(async () => setControlValue(note, '双击提交前的已保存注释。'));
      const send = container.querySelector<HTMLButtonElement>('.writer-send-button');
      expect(send).not.toBeNull();
      await act(async () => {
        send?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        send?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flushMicrotasks();

      expect(apiState.generations).toHaveLength(1);
      expect(apiState.saves).toHaveLength(1);
      generation.resolve(jsonResponse({ draft: '合成单次结果。' }));
      await flushMicrotasks();
    } finally {
      await unmount(root);
    }
  });

  it('makes a new answer current and finalizes only the previous answer after saving the next response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeCandidateResponseBook();
    const apiState = installHostApi({ book, onGenerate: async () => jsonResponse({ draft: '下一条回答。' }) });
    const { container, root } = await renderApp(book);
    try {
      const respond = await waitForElement(() => container.querySelector<HTMLButtonElement>('.respond-to-input-button'));
      await act(async () => respond.click());
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.generations).toHaveLength(1);
      expect(apiState.generations[0]?.generationKind).toBe('respond-to-input');
      const persistedBlocks = apiState.getPersisted().chapters[0]?.sections[0]?.blocks ?? [];
      const previousAnswer = persistedBlocks.find((block) => block.id === 'answer-block');
      expect(previousAnswer).toMatchObject({
        content: '当前候选回答。',
        adoptedCandidateId: 'candidate-current',
        candidates: [{ id: 'candidate-current', content: '当前候选回答。', sourceSignature: 'sig-current' }],
      });
      const earlierAnswer = persistedBlocks.find((block) => block.id === 'earlier-answer-block');
      expect(earlierAnswer?.candidates).toHaveLength(2);
      expect(persistedBlocks.filter((block) => block.content === '下一条已发送提示。')).toHaveLength(1);
      expect(persistedBlocks.some((block) => block.content === '下一条回答。')).toBe(true);
    } finally {
      await unmount(root);
    }
  });

  it('finalizes the immediately previous answer after a nonempty bottom input is saved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeCandidateResponseBook();
    const apiState = installHostApi({ book, onGenerate: async () => jsonResponse({ draft: '底部输入后的回答。' }) });
    const { container, root } = await renderApp(book);
    try {
      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '底部的新输入。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.generations[0]?.generationKind).toBe('continue-section');
      const persistedBlocks = apiState.getPersisted().chapters[0]?.sections[0]?.blocks ?? [];
      expect(persistedBlocks.find((block) => block.id === 'answer-block')?.candidates).toEqual([
        { id: 'candidate-current', content: '当前候选回答。', sourceSignature: 'sig-current' },
      ]);
      expect(persistedBlocks.find((block) => block.id === 'earlier-answer-block')?.candidates).toHaveLength(2);
      expect(persistedBlocks.filter((block) => block.content === '底部的新输入。')).toHaveLength(1);
      expect(persistedBlocks.some((block) => block.content === '底部输入后的回答。')).toBe(true);
    } finally {
      await unmount(root);
    }
  });

  it('keeps the new answer text and previous candidates when the final response save fails', async () => {
    const book = makeCandidateResponseBook();
    let saveCount = 0;
    const apiState = installHostApi({
      book,
      onSave: async (candidate) => {
        saveCount += 1;
        return saveCount === 1
          ? jsonResponse(candidate)
          : new Response(JSON.stringify({ error: 'Synthetic response save failure' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
      },
      onGenerate: async () => jsonResponse({ draft: '保存失败但应留在编辑器里的回答。' }),
    });
    const { container, root } = await renderApp(book);
    try {
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await act(async () => setControlValue(note, '生成前已保存的注释。'));
      const respond = await waitForElement(() => container.querySelector<HTMLButtonElement>('.respond-to-input-button'));
      await act(async () => respond.click());
      await flushMicrotasks();
      expect(apiState.generations).toHaveLength(1);
      expect(container.querySelector('.manuscript')?.textContent).toContain('保存失败但应留在编辑器里的回答。');
      const persistedBlocks = apiState.getPersisted().chapters[0]?.sections[0]?.blocks ?? [];
      expect(persistedBlocks.find((block) => block.id === 'answer-block')?.candidates).toHaveLength(2);
      expect(persistedBlocks.some((block) => block.content === '保存失败但应留在编辑器里的回答。')).toBe(false);
      expect(apiState.saves.length).toBeGreaterThanOrEqual(2);
    } finally {
      await unmount(root);
    }
  });

  it('keeps a bottom-input answer and previous candidates when its final save fails', async () => {
    const book = makeCandidateResponseBook();
    let saveCount = 0;
    const apiState = installHostApi({
      book,
      onSave: async (candidate) => {
        saveCount += 1;
        return saveCount === 1
          ? jsonResponse(candidate)
          : new Response(JSON.stringify({ error: 'Synthetic bottom response save failure' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
      },
      onGenerate: async () => jsonResponse({ draft: '底部保存失败但应留在编辑器里的回答。' }),
    });
    const { container, root } = await renderApp(book);
    try {
      const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await act(async () => setControlValue(note, '底部回答前已保存的注释。'));
      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '底部输入保存失败。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      expect(apiState.generations[0]?.generationKind).toBe('continue-section');
      expect(container.querySelector('.manuscript')?.textContent).toContain('底部保存失败但应留在编辑器里的回答。');
      const persistedBlocks = apiState.getPersisted().chapters[0]?.sections[0]?.blocks ?? [];
      expect(persistedBlocks.find((block) => block.id === 'answer-block')?.candidates).toHaveLength(2);
      expect(persistedBlocks.some((block) => block.content === '底部保存失败但应留在编辑器里的回答。')).toBe(false);
      expect(apiState.saves.length).toBeGreaterThanOrEqual(2);
    } finally {
      await unmount(root);
    }
  });

  it('keeps previous candidates when the next answer is cancelled', async () => {
    const book = makeCandidateResponseBook();
    const apiState = installHostApi({
      book,
      onGenerate: async (_request, signal) => new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    const { container, root } = await renderApp(book);
    try {
      const respond = await waitForElement(() => container.querySelector<HTMLButtonElement>('.respond-to-input-button'));
      await act(async () => respond.click());
      const cancel = await waitForElement(() => container.querySelector<HTMLButtonElement>('.writer-cancel-button'));
      await act(async () => cancel.click());
      await flushMicrotasks();
      expect(apiState.generations).toHaveLength(1);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block')?.candidates)
        .toHaveLength(2);
      expect(container.querySelector('.manuscript')?.textContent).not.toContain('保存失败但应留在编辑器里的回答。');
    } finally {
      await unmount(root);
    }
  });

  it('does not collapse candidates for an empty continue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook([{
      id: 'answer-block',
      kind: 'assistant',
      content: '当前回答。',
      candidates: [
        { id: 'candidate-old', content: '旧候选。' },
        { id: 'candidate-current', content: '当前回答。' },
      ],
      adoptedCandidateId: 'candidate-current',
    }]);
    const apiState = installHostApi({ book, onGenerate: async () => jsonResponse({ draft: '空续写回答。' }) });
    const { container, root } = await renderApp(book);
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.generations[0]?.generationKind).toBe('continue-section');
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block')?.candidates)
        .toHaveLength(2);
    } finally {
      await unmount(root);
    }
  });

  it('does not collapse candidates for an empty regenerate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeBook([{
      id: 'answer-block',
      kind: 'assistant',
      content: '当前回答。',
      candidates: [
        { id: 'candidate-old', content: '旧候选。' },
        { id: 'candidate-current', content: '当前回答。' },
      ],
      adoptedCandidateId: 'candidate-current',
    }]);
    const apiState = installHostApi({ book, onGenerate: async () => jsonResponse({ draft: '重新生成回答。' }) });
    const { container, root } = await renderApp(book);
    try {
      const select = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        '[data-block-id="answer-block"] .manuscript-block-select',
      ));
      await act(async () => select.click());
      const regenerate = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      ));
      await act(async () => regenerate.click());
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.generations[0]?.generationKind).toBe('regenerate-block');
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block')?.candidates)
        .toHaveLength(3);
    } finally {
      await unmount(root);
    }
  });

  it('keeps previous candidates when the next generation fails or cannot be saved', async () => {
    const failedGenerationBook = makeCandidateResponseBook();
    const failedGenerationApi = installHostApi({
      book: failedGenerationBook,
      onGenerate: async () => new Response(JSON.stringify({ error: 'Synthetic generation failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const failedGenerationApp = await renderApp(failedGenerationBook);
    try {
      const instruction = await waitForElement(() => failedGenerationApp.container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '触发失败的下一条回答。'));
      await act(async () => failedGenerationApp.container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      const previousAnswer = failedGenerationApi.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block');
      expect(previousAnswer?.candidates).toHaveLength(2);
      expect(failedGenerationApi.generations).toHaveLength(1);
    } finally {
      await unmount(failedGenerationApp.root);
    }

    const failedSaveBook = makeCandidateResponseBook();
    const failedSaveApi = installHostApi({
      book: failedSaveBook,
      onGenerate: async () => jsonResponse({ draft: '不应保存的下一条回答。' }),
      onSave: async () => new Response(JSON.stringify({ error: 'Synthetic save failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const failedSaveApp = await renderApp(failedSaveBook);
    try {
      const note = await waitForElement(() => failedSaveApp.container.querySelector<HTMLTextAreaElement>('#author-note-input'));
      await act(async () => setControlValue(note, '保存前必须先落盘的注释。'));
      const instruction = await waitForElement(() => failedSaveApp.container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '保存失败的下一条回答。'));
      await act(async () => failedSaveApp.container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await flushMicrotasks();
      const previousAnswer = failedSaveApi.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block');
      expect(previousAnswer?.candidates).toHaveLength(2);
      expect(failedSaveApi.generations).toHaveLength(0);
    } finally {
      await unmount(failedSaveApp.root);
    }
  });

  it('edits the currently selected candidate without restoring the old candidate from a queued save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const book = makeCandidateResponseBook();
    const firstSave = deferred<Response>();
    let saveCount = 0;
    const apiState = installHostApi({
      book,
      onSave: async (candidate) => {
        saveCount += 1;
        if (saveCount === 1) return firstSave.promise;
        return jsonResponse(candidate);
      },
    });
    const { container, root } = await renderApp(book);
    try {
      const answerSelect = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        '[data-block-id="answer-block"] .manuscript-block-select',
      ));
      await act(async () => answerSelect.click());
      const nextCandidate = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="下一版回答候选"]',
      ));
      const previousCandidate = await waitForElement(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="上一版回答候选"]',
      ));
      await act(async () => previousCandidate.click());
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(apiState.saves).toHaveLength(1);
      await act(async () => nextCandidate.click());
      await flushMicrotasks();
      const edit = await waitForElement(() => container.querySelector<HTMLButtonElement>('button[aria-label="编辑所选片段"]'));
      await act(async () => edit.click());
      const editor = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#block-editor-textarea'));
      await act(async () => setControlValue(editor, '编辑后的当前回答。'));
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="完成编辑并返回正文"]')?.click());
      firstSave.resolve(jsonResponse(apiState.saves[0]!));
      await flushMicrotasks();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      await flushMicrotasks();
      expect(apiState.saves).toHaveLength(2);
      const persisted = apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.find((block) => block.id === 'answer-block');
      expect(persisted).toMatchObject({
        content: '编辑后的当前回答。',
        adoptedCandidateId: 'candidate-current',
        candidates: [
          { id: 'candidate-old', content: '旧候选回答。' },
          { id: 'candidate-current', content: '编辑后的当前回答。', sourceSignature: 'sig-current' },
        ],
      });
    } finally {
      await unmount(root);
    }
  });

  it('does not append a result after cancellation or a pre-generation save failure', async () => {
    const book = makeBook([{ id: 'answer-block', kind: 'assistant', content: '已有正文。' }]);
    const apiState = installHostApi({
      book,
      onGenerate: async (_request, signal) => new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    const { container, root } = await renderApp(book);
    let rootUnmounted = false;
    try {
      const instruction = container.querySelector<HTMLTextAreaElement>('#writing-instruction');
      await act(async () => { if (instruction) setControlValue(instruction, '可取消的续写。'); });
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitForElement(() => container.querySelector<HTMLButtonElement>('.writer-cancel-button'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-cancel-button')?.click());
      await flushMicrotasks();
      expect(container.querySelector('.manuscript')?.textContent).not.toContain('合成生成结果。');
      expect(instruction?.value).toBe('可取消的续写。');

      await unmount(root);
      rootUnmounted = true;
      const failingBook = makeBook([{ id: 'answer-block', kind: 'assistant', content: '已有正文。' }]);
      installHostApi({
        book: failingBook,
        onSave: async () => new Response(JSON.stringify({ error: 'Synthetic save failure' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      });
      const second = await renderApp(failingBook);
      try {
        const secondInstruction = second.container.querySelector<HTMLTextAreaElement>('#writing-instruction');
        const secondNote = await waitForElement(() => second.container.querySelector<HTMLTextAreaElement>('#author-note-input'));
        await act(async () => { if (secondNote) setControlValue(secondNote, '取消前保存失败的注释。'); });
        await act(async () => { if (secondInstruction) setControlValue(secondInstruction, '保存失败时的续写。'); });
        await act(async () => second.container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
        await flushMicrotasks();
        expect(second.container.querySelector('.manuscript')?.textContent).not.toContain('合成生成结果。');
        expect(second.container.querySelector('[role="status"]')?.textContent).toContain('Synthetic save failure');
      } finally {
        await unmount(second.root);
      }
      expect(apiState.generations).toHaveLength(1);
    } finally {
      if (!rootUnmounted) await unmount(root);
    }
  });
});
