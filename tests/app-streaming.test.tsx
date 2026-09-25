// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import type { Book, GenerationRequest, SectionBlock } from '../src/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
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
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const makeBook = (
  blocks: SectionBlock[] = [{ id: 'existing-answer', kind: 'assistant', content: '原来的正文。' }],
  sections?: Book['chapters'][number]['sections'],
): Book => ({
  id: 'synthetic-app-stream-book',
  title: '合成流式回归书',
  writingBrief: '合成测试用写作设定。',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'synthetic-app-stream-chapter',
    title: '合成章节',
    sections: sections ?? [{
      id: 'synthetic-app-stream-section',
      title: '合成小节',
      content: blocks.map((block) => block.content).join('\n\n'),
      blocks,
    }],
  }],
  branches: [],
  updatedAt: '2026-09-09T00:00:00.000Z',
});

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) {
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

const waitFor = async <T,>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = query();
    if (value) return value;
    await flushMicrotasks();
  }
  throw new Error('Timed out waiting for the test state.');
};

const makeNdjsonStream = () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let canceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      canceled = true;
    },
  }), { headers: { 'content-type': 'application/x-ndjson' } });
  const push = (event: unknown) => {
    controller?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
  };
  const close = () => controller?.close();
  return { response, push, close, wasCanceled: () => canceled };
};

const installHostApi = ({
  book,
  onGenerate,
}: {
  book: Book;
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
      const payload = JSON.parse(String(init?.body)) as { book: Book };
      const candidate = payload.book;
      saves.push(structuredClone(candidate));
      persisted = structuredClone(candidate);
      return jsonResponse(candidate);
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

const renderApp = async (book: Book, sectionTitle = '合成小节') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  const sectionButton = await waitFor(() => [...container.querySelectorAll<HTMLButtonElement>('.section-open')]
    .find((button) => button.textContent?.includes(sectionTitle)) ?? null);
  await act(async () => sectionButton.click());
  await flushMicrotasks();
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => root.unmount());
};

const enableStreaming = async (container: HTMLElement) => {
  const settings = await waitFor(() => container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]'));
  await act(async () => settings.click());
  const toggle = await waitFor(() => container.querySelector<HTMLInputElement>('#streaming-output-toggle'));
  if (!toggle.checked) await act(async () => toggle.click());
  expect(toggle.checked).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click());
  await flushMicrotasks();
};

const selectBlock = async (container: HTMLElement, blockId: string) => {
  const selector = await waitFor(() => container.querySelector<HTMLButtonElement>(
    `[data-block-id="${blockId}"] .manuscript-block-select`,
  ));
  await act(async () => selector.click());
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
  let frameId = 0;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = ++frameId;
      queueMicrotask(() => callback(0));
      return id;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (_id: number) => undefined,
  });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App streaming generation boundaries', () => {
  it('defaults streaming off and remembers the setting across remounts', async () => {
    const book = makeBook();
    installHostApi({ book });
    const first = await renderApp(book);
    try {
      const firstToggle = await waitFor(() => first.container.querySelector<HTMLInputElement>('#streaming-output-toggle'));
      expect(firstToggle.checked).toBe(false);
      await act(async () => firstToggle.click());
      expect(firstToggle.checked).toBe(true);
      expect(localStorage.getItem('story-native:streaming-output')).toBe('true');
    } finally {
      await unmount(first.root);
    }

    const second = await renderApp(book);
    try {
      const secondToggle = await waitFor(() => second.container.querySelector<HTMLInputElement>('#streaming-output-toggle'));
      expect(secondToggle.checked).toBe(true);
    } finally {
      await unmount(second.root);
    }
  });

  it('shows deltas as temporary text and persists only the final result', async () => {
    const book = makeBook();
    const stream = makeNdjsonStream();
    const apiState = installHostApi({ book, onGenerate: async () => stream.response });
    const { container, root } = await renderApp(book);
    try {
      await enableStreaming(container);
      const instruction = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '新的流式输入。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitFor(() => apiState.generations[0] ?? null);
      expect(apiState.generations[0]).toMatchObject({ stream: true, generationKind: 'continue-section' });

      await act(async () => stream.push({ type: 'delta', text: '半段草稿。' }));
      await flushMicrotasks();
      expect(container.querySelector('.streaming-draft-text')?.textContent).toContain('半段草稿。');
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.some((block) =>
        block.content.includes('半段草稿。'))).toBe(false);
      expect(apiState.saves.some((candidate) => JSON.stringify(candidate).includes('半段草稿。'))).toBe(false);

      await act(async () => {
        stream.push({
          type: 'result',
          result: { draft: '完整流式结果。', sourceSignature: 'synthetic-stream-signature' },
        });
        stream.close();
      });
      await flushMicrotasks();
      await waitFor(() => apiState.getPersisted().chapters[0]?.sections[0]?.blocks
        ?.find((block) => block.content === '完整流式结果。') ?? null);
      expect(container.querySelector('.writer-status')?.textContent).toContain('未提供明确的结束原因');
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant',
          content: '完整流式结果。',
          adoptedCandidateId: expect.any(String),
        }),
      ]));
      expect(container.querySelector('.streaming-draft-block')).toBeNull();
    } finally {
      await unmount(root);
    }
  });

  it('keeps the provider final draft after a length-limited stream without applying it', async () => {
    const book = makeBook();
    const stream = makeNdjsonStream();
    const apiState = installHostApi({ book, onGenerate: async () => stream.response });
    const { container, root } = await renderApp(book);
    try {
      await enableStreaming(container);
      const instruction = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '合成截断流式请求。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitFor(() => apiState.generations[0] ?? null);
      await act(async () => stream.push({ type: 'delta', text: '较早的流式增量。' }));
      await flushMicrotasks();

      await act(async () => {
        stream.push({
          type: 'result',
          result: { draft: '服务最终返回的部分草稿。', finishReason: 'length' },
        });
        stream.close();
      });
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="failed"]'));

      expect(container.querySelector('.streaming-draft-text')?.textContent).toBe('服务最终返回的部分草稿。');
      expect(container.querySelector('.streaming-draft-block')?.textContent).toContain('输出长度上限');
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('复制临时草稿')))
        .toBe(true);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks).toEqual([
        { id: 'existing-answer', kind: 'assistant', content: '原来的正文。' },
      ]);
      expect(apiState.saves.some((candidate) => JSON.stringify(candidate).includes('服务最终返回的部分草稿。')))
        .toBe(false);
    } finally {
      await unmount(root);
    }
  });

  it('keeps the original answer and exposes a copyable partial draft after cancellation', async () => {
    const book = makeBook([{
      id: 'regen-answer',
      kind: 'assistant',
      content: '原始回答正文。',
      candidates: [
        { id: 'old-candidate', content: '旧候选。' },
        { id: 'current-candidate', content: '原始回答正文。' },
      ],
      adoptedCandidateId: 'current-candidate',
    }]);
    localStorage.setItem('story-native:streaming-output', 'true');
    const firstStream = makeNdjsonStream();
    const retryStream = makeNdjsonStream();
    let generationCount = 0;
    const apiState = installHostApi({
      book,
      onGenerate: async () => {
        const stream = generationCount === 0 ? firstStream : retryStream;
        generationCount += 1;
        return stream.response;
      },
    });
    const { container, root } = await renderApp(book);
    let restoreAnimationFrame: (() => void) | undefined;
    try {
      await selectBlock(container, 'regen-answer');
      await act(async () => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      )?.click());
      await waitFor(() => apiState.generations[0] ?? null);
      const defaultRequestAnimationFrame = window.requestAnimationFrame;
      const defaultCancelAnimationFrame = window.cancelAnimationFrame;
      const pendingFrames = new Map<number, FrameRequestCallback>();
      let nextFrameId = 10_000;
      const controlledRequestAnimationFrame = (callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        pendingFrames.set(id, callback);
        return id;
      };
      const controlledCancelAnimationFrame = (id: number) => {
        pendingFrames.delete(id);
      };
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: controlledRequestAnimationFrame,
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        writable: true,
        value: controlledCancelAnimationFrame,
      });
      restoreAnimationFrame = () => {
        Object.defineProperty(window, 'requestAnimationFrame', {
          configurable: true,
          writable: true,
          value: defaultRequestAnimationFrame,
        });
        Object.defineProperty(window, 'cancelAnimationFrame', {
          configurable: true,
          writable: true,
          value: defaultCancelAnimationFrame,
        });
      };
      const flushOneFrame = async () => {
        const next = pendingFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
        if (!next) throw new Error('Expected a pending streaming animation frame.');
        pendingFrames.delete(next[0]);
        await act(async () => next[1](0));
        await flushMicrotasks();
      };
      await act(async () => firstStream.push({ type: 'delta', text: '未完成替代草稿。' }));
      await flushMicrotasks();
      expect(pendingFrames.size).toBe(1);
      await flushOneFrame();
      expect(container.querySelector('.streaming-draft-text')?.textContent).toContain('未完成替代草稿。');
      expect(container.querySelector('[data-block-id="regen-answer"] .manuscript-block')?.textContent)
        .toContain('原始回答正文。');
      expect(container.querySelector('[data-block-id="regen-answer"] .manuscript-block')?.textContent)
        .not.toContain('未完成替代草稿。');

      await act(async () => firstStream.push({ type: 'delta', text: '取消前排队尾段。' }));
      await flushMicrotasks();
      expect(pendingFrames.size).toBe(1);
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-cancel-button')?.click());
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="stopped"]'));
      expect(pendingFrames.size).toBe(0);
      expect(container.querySelector('button')?.textContent).toBeDefined();
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('复制临时草稿')))
        .toBe(true);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '原始回答正文。',
        adoptedCandidateId: 'current-candidate',
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'old-candidate' }),
          expect.objectContaining({ id: 'current-candidate' }),
        ]),
      });

      const regenerate = await waitFor(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      ));
      await act(async () => regenerate.click());
      await waitFor(() => apiState.generations[1] ?? null);
      await act(async () => retryStream.push({ type: 'delta', text: '快速重试首段。' }));
      await flushMicrotasks();
      expect(pendingFrames.size).toBe(1);
      await flushOneFrame();
      expect(container.querySelector('.streaming-draft-text')?.textContent).toContain('快速重试首段。');
      expect(container.querySelector('[data-block-id="regen-answer"] .manuscript-block')?.textContent)
        .toContain('原始回答正文。');
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-cancel-button')?.click());
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="stopped"]'));

      const editButton = await waitFor(() => container.querySelector<HTMLButtonElement>('button[aria-label="编辑所选片段"]'));
      await act(async () => editButton.click());
      const editor = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#block-editor-textarea'));
      expect(editor.value).toBe('原始回答正文。');
    } finally {
      restoreAnimationFrame?.();
      await unmount(root);
    }
  });

  it('keeps the original answer and partial draft visible after a stream error', async () => {
    const book = makeBook();
    localStorage.setItem('story-native:streaming-output', 'true');
    const stream = makeNdjsonStream();
    const apiState = installHostApi({ book, onGenerate: async () => stream.response });
    const { container, root } = await renderApp(book);
    try {
      const instruction = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '会失败的流式输入。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitFor(() => apiState.generations[0] ?? null);
      await act(async () => stream.push({ type: 'delta', text: '失败前的可复制草稿。' }));
      await flushMicrotasks();
      await act(async () => stream.push({ type: 'error', error: '本机 Provider 调用失败。' }));
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="failed"]'));
      expect(container.querySelector('.streaming-draft-text')?.textContent).toContain('失败前的可复制草稿。');
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('复制临时草稿')))
        .toBe(true);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks).toEqual([
        { id: 'existing-answer', kind: 'assistant', content: '原来的正文。' },
      ]);
    } finally {
      await unmount(root);
    }
  });

  it('uses ordinary JSON with streaming disabled and does not render a temporary draft', async () => {
    const book = makeBook();
    const response = deferred<Response>();
    const apiState = installHostApi({ book, onGenerate: async () => response.promise });
    const { container, root } = await renderApp(book);
    try {
      const instruction = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '普通 JSON 输入。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitFor(() => apiState.generations[0] ?? null);
      expect(apiState.generations[0]?.stream).toBe(false);
      expect(container.querySelector('.streaming-draft-block')).toBeNull();
      response.resolve(jsonResponse({ draft: '普通 JSON 结果。' }));
      await flushMicrotasks();
      await waitFor(() => apiState.getPersisted().chapters[0]?.sections[0]?.blocks
        ?.find((block) => block.content === '普通 JSON 结果。') ?? null);
      expect(container.querySelector('.streaming-draft-block')).toBeNull();
    } finally {
      await unmount(root);
    }
  });

  it('keeps a copyable length-limited JSON draft without saving it', async () => {
    const book = makeBook();
    const apiState = installHostApi({
      book,
      onGenerate: async () => jsonResponse({ draft: 'JSON 部分草稿。', finishReason: 'length' }),
    });
    const { container, root } = await renderApp(book);
    try {
      const instruction = await waitFor(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      await act(async () => setControlValue(instruction, '合成截断 JSON 请求。'));
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-send-button')?.click());
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="failed"]'));

      expect(apiState.generations[0]?.stream).toBe(false);
      expect(container.querySelector('.streaming-draft-text')?.textContent).toBe('JSON 部分草稿。');
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('复制临时草稿')))
        .toBe(true);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks).toEqual([
        { id: 'existing-answer', kind: 'assistant', content: '原来的正文。' },
      ]);
      expect(apiState.saves.some((candidate) => JSON.stringify(candidate).includes('JSON 部分草稿。')))
        .toBe(false);
    } finally {
      await unmount(root);
    }
  });

  it('does not replace an existing answer when the service explicitly refuses regeneration', async () => {
    const book = makeBook([{
      id: 'refusal-answer',
      kind: 'assistant',
      content: '已采用的回答。',
      candidates: [
        { id: 'refusal-old', content: '旧候选。' },
        { id: 'refusal-current', content: '已采用的回答。' },
      ],
      adoptedCandidateId: 'refusal-current',
    }]);
    const apiState = installHostApi({
      book,
      onGenerate: async () => jsonResponse({ draft: '服务拒绝前返回的片段。', finishReason: 'refusal' }),
    });
    const { container, root } = await renderApp(book);
    try {
      await selectBlock(container, 'refusal-answer');
      await act(async () => container.querySelector<HTMLButtonElement>(
        'button[aria-label="再生成一版：重新生成所选 AI 输出"]',
      )?.click());
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="failed"]'));

      expect(container.querySelector('[data-block-id="refusal-answer"] .manuscript-block')?.textContent)
        .toContain('已采用的回答。');
      expect(container.querySelector('.streaming-draft-text')?.textContent).toBe('服务拒绝前返回的片段。');
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.blocks?.[0]).toMatchObject({
        content: '已采用的回答。',
        adoptedCandidateId: 'refusal-current',
        candidates: [
          { id: 'refusal-old', content: '旧候选。' },
          { id: 'refusal-current', content: '已采用的回答。' },
        ],
      });
    } finally {
      await unmount(root);
    }
  });

  it('keeps summary generation non-streaming even when streaming output is enabled', async () => {
    const sections = [
      {
        id: 'prior-section',
        title: '前文小节',
        content: '前文正文内容。',
      },
      {
        id: 'current-section',
        title: '当前小节',
        content: '当前正文内容。',
      },
    ];
    const book = makeBook([], sections);
    localStorage.setItem('story-native:streaming-output', 'true');
    const summaryDraft = JSON.stringify({
      synopsis: '合成梗概。',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    });
    const apiState = installHostApi({
      book,
      onGenerate: async () => jsonResponse({ draft: summaryDraft }),
    });
    const { container, root } = await renderApp(book, '当前小节');
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="选择前文"]')?.click());
      const disclose = await waitFor(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开前文小节梗概"]'));
      await act(async () => disclose.click());
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="生成该节梗概"]')?.click());
      const confirm = await waitFor(() => [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认生成')) ?? null);
      await act(async () => confirm.click());
      await waitFor(() => apiState.generations[0] ?? null);
      expect(apiState.generations[0]).toMatchObject({ generationKind: 'summarize-section', stream: false });
      expect(container.querySelector('.streaming-draft-block')).toBeNull();
    } finally {
      await unmount(root);
    }
  });

  it('keeps a truncated summary as a copyable JSON draft on the visible section without saving Memory', async () => {
    const sections = [
      {
        id: 'summary-source-section',
        title: '前文小节',
        content: '前文正文内容。',
      },
      {
        id: 'summary-visible-section',
        title: '当前小节',
        content: '当前正文内容。',
      },
    ];
    const book = makeBook([], sections);
    const partialJson = '{"synopsis":"未完成的合成梗概';
    const apiState = installHostApi({
      book,
      onGenerate: async () => jsonResponse({ draft: partialJson, finishReason: 'length' }),
    });
    const { container, root } = await renderApp(book, '当前小节');
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="选择前文"]')?.click());
      const disclose = await waitFor(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开前文小节梗概"]'));
      await act(async () => disclose.click());
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="生成该节梗概"]')?.click());
      const confirm = await waitFor(() => [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认生成')) ?? null);
      await act(async () => confirm.click());
      await waitFor(() => container.querySelector('.streaming-draft-block[data-streaming-status="failed"]'));

      expect(apiState.generations[0]).toMatchObject({
        sectionId: 'summary-source-section',
        generationKind: 'summarize-section',
        stream: false,
      });
      expect(container.querySelector('.streaming-draft-block')?.textContent).toContain('梗概 JSON 草稿，未保存');
      expect(container.querySelector('.streaming-draft-block')?.textContent).toContain('「前文小节」的梗概');
      expect(container.querySelector('.streaming-draft-text')?.textContent).toBe(partialJson);
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('复制临时草稿')))
        .toBe(true);
      expect(apiState.getPersisted().chapters[0]?.sections[0]?.memory).toBeUndefined();
      expect(apiState.saves.every((candidate) => candidate.chapters[0]?.sections[0]?.memory === undefined))
        .toBe(true);
    } finally {
      await unmount(root);
    }
  });
});
