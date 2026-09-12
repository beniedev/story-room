// @vitest-environment jsdom

import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeId } from '../src/components/shared/id';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';
import { createSectionMemory } from '../src/sectionMemory';
import * as proseFormatting from '../src/proseFormatting';
import * as contextPlanner from '../src/contextPlan';
import * as textMetrics from '../src/textMetrics';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

const browserCrypto = globalThis.crypto;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const useCryptoWithoutRandomUuid = () => {
  vi.stubGlobal('crypto', {
    getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
  });
};

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const waitForElement = async <T extends Element>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = query();
    if (element) return element;
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error('Timed out waiting for the test element.');
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
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
  useCryptoWithoutRandomUuid();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser IDs without crypto.randomUUID', () => {
  it('uses crypto.getRandomValues to create distinct UUID v4 IDs', () => {
    expect('randomUUID' in globalThis.crypto).toBe(false);
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');

    const first = makeId('section');
    const second = makeId('section');

    expect(first.slice('section-'.length)).toMatch(uuidPattern);
    expect(second.slice('section-'.length)).toMatch(uuidPattern);
    expect(second).not.toBe(first);
  });

  it('creates a Section through the application flow', async () => {
    const book = createExampleBooks()[0]!;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/library') {
        return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      }
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(book);
      if (url === `/api/books/${book.id}` && method === 'PUT') {
        const payload = JSON.parse(String(init?.body)) as { book: unknown };
        return jsonResponse(payload.book);
      }
      throw new Error(`Unexpected test request: ${method} ${url}`);
    }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App />));

    const chapter = book.chapters[0]!;
    const addButton = await waitForElement(() => container.querySelector<HTMLButtonElement>(
      `button[aria-label="在${chapter.title}中新建小节"]`,
    ));
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = await waitForElement(() => container.querySelector<HTMLInputElement>('.inline-new-section input'));
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!valueSetter) throw new Error('HTML input value setter is unavailable.');
    await act(async () => {
      valueSetter.call(input, 'Fallback Section');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const sectionTitles = [...container.querySelectorAll('.section-row strong')]
      .map((element) => element.textContent);
    expect(sectionTitles).toContain('Fallback Section');
    await act(async () => root.unmount());
  });

  it('persists section guidance, sends it in character mode, and keeps it after generation', async () => {
    const book = createExampleBooks()[0]!;
    let savedBook: typeof book | undefined;
    let generationRequest: { authorNote?: string; mode?: string } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/library') {
        return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      }
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(book);
      if (url === `/api/books/${book.id}` && method === 'PUT') {
        const payload = JSON.parse(String(init?.body)) as { book: typeof book };
        savedBook = payload.book;
        return jsonResponse(savedBook);
      }
      if (url === '/api/generate' && method === 'POST') {
        generationRequest = JSON.parse(String(init?.body)) as typeof generationRequest;
        return jsonResponse({ draft: 'Synthetic provider continuation.' });
      }
      throw new Error(`Unexpected test request: ${method} ${url}`);
    }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App />));
    const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
    await act(async () => sectionButton.click());
    await act(async () => container.querySelector<HTMLElement>('.writer-menu-trigger')?.click());
    const characterMode = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('角色模式 · 第一视角'));
    await act(async () => characterMode?.click());

    const note = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#author-note-input'));
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter) throw new Error('HTML textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(note, '让钟声贯穿本节。');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="发送并续写"]')?.click());
    await waitForElement(() => [...container.querySelectorAll('.manuscript-block-copy')]
      .find((element) => element.textContent?.includes('Synthetic provider continuation.')) ?? null);

    expect(generationRequest).toMatchObject({ mode: 'character', authorNote: '让钟声贯穿本节。' });
    expect(savedBook?.chapters.flatMap((chapter) => chapter.sections)
      .find((section) => section.id === book.chapters[0]?.sections[0]?.id)?.note).toBe('让钟声贯穿本节。');
    expect(container.querySelector<HTMLTextAreaElement>('#author-note-input')?.value).toBe('让钟声贯穿本节。');
    await act(async () => root.unmount());
  });

  it('changes actual context only after the confirmed summary selection saves successfully', async () => {
    const book = createExampleBooks()[0]!;
    const content = 'SYNTHETIC_PREVIOUS_PROSE '.repeat(5_000);
    const draft = { synopsis: 'Brief synthetic summary.', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [] };
    book.chapters = [{ id: 'flow-chapter', title: 'Flow chapter', sections: [
      { id: 'flow-source', title: 'Previous section', content, memory: createSectionMemory(draft, content) },
      { id: 'flow-target', title: 'Current section', content: 'Current text.', contextReferences: [
        { sectionId: 'flow-source', mode: 'full', reason: 'manual' },
      ] },
    ] }];
    book.characters = [];
    book.worldRules = [];
    book.canonFacts = [];
    book.summaries = [];
    book.branches = [];
    let persisted = structuredClone(book);
    let saves = 0;
    let rejectSave = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/library') return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(persisted);
      if (url === `/api/books/${book.id}` && method === 'PUT') {
        saves += 1;
        if (rejectSave) return new Response(JSON.stringify({ error: 'Synthetic save failure' }), { status: 503 });
        const payload = JSON.parse(String(init?.body)) as { book: typeof book };
        persisted = payload.book;
        return jsonResponse(persisted);
      }
      throw new Error(`Unexpected test request: ${method} ${url}`);
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      const target = await waitForElement(() => container.querySelectorAll<HTMLButtonElement>('.section-open')[1] ?? null);
      await act(async () => target.click());
      const writerInput = container.querySelector<HTMLTextAreaElement>('#writing-instruction');
      const settingsTrigger = container.querySelector<HTMLButtonElement>('.writer-book-settings-button');
      await act(async () => settingsTrigger?.click());
      const settings = container.querySelector<HTMLDialogElement>('.book-settings-drawer');
      expect(settings?.open).toBe(true);
      expect(container.querySelector('.shelf-content')).toBeNull();
      expect(container.querySelector('#writing-instruction')).toBe(writerInput);
      await act(async () => settings?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 900 })));
      expect(container.querySelector('.book-settings-drawer')).toBeNull();
      expect(container.querySelector('.shelf-content')).toBeNull();
      expect(container.querySelector('#writing-instruction')).toBe(writerInput);
      expect(saves).toBe(0);
      const counter = () => container.querySelector('.writer-context-count')?.textContent;
      const before = counter();
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-context-tools-button')?.click());
      const checkbox = container.querySelector<HTMLInputElement>('.context-reference-checkbox input');
      await act(async () => checkbox?.click());
      expect(saves).toBe(0);
      expect(counter()).toBe(before);
      await act(async () => container.querySelector<HTMLDialogElement>('#context-tools-drawer')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 900 })));
      expect(container.querySelector<HTMLDialogElement>('#context-tools-drawer')?.open).toBe(false);
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-context-tools-button')?.click());
      expect(container.querySelector<HTMLInputElement>('.context-reference-checkbox input')?.checked).toBe(false);
      expect(saves).toBe(0);
      await act(async () => container.querySelector<HTMLInputElement>('.context-reference-checkbox input')?.click());

      const confirm = async () => {
        await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
        await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent?.includes('确认保存并加载'))?.click());
      };
      await confirm();
      expect(saves).toBe(1);
      expect(counter()).toBe(before);
      expect(persisted.chapters[0].sections[1].contextReferences?.[0].mode).toBe('full');
      expect(container.textContent).toContain('Synthetic save failure');
      await act(async () => container.querySelector<HTMLButtonElement>('.confirm-dialog [aria-label="关闭确认"]')?.click());
      rejectSave = false;
      await confirm();
      expect(saves).toBe(2);
      expect(persisted.chapters[0].sections[1].contextReferences?.[0].mode).toBe('summary');
      expect(persisted.chapters[0].sections[0].content).toBe(content);
      expect(counter()).not.toBe(before);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps typing ahead of preview work without reparsing unchanged prose or losing the latest input', async () => {
    const book = createExampleBooks()[0]!;
    const previousContent = 'Synthetic previous text. 合成前文。'.repeat(1000);
    const blocks = Array.from({ length: 100 }, (_, index) => ({
      id: `typing-block-${index}`, kind: 'assistant' as const, content: '合成正文。“继续向前。”'.repeat(10),
    }));
    book.chapters = [{ id: 'typing-chapter', title: 'Typing chapter', sections: [
      { id: 'typing-source', title: 'Previous', content: previousContent, memory: createSectionMemory({
        synopsis: 'A synthetic summary.', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [],
      }, previousContent) },
      { id: 'typing-target', title: 'Current', blocks, content: blocks.map((block) => block.content).join('\n\n'), contextReferences: [
        { sectionId: 'typing-source', mode: 'summary', reason: 'manual' },
      ] },
    ] }];
    let generationRequest: { instruction: string; sectionId: string } | undefined;
    let saves = 0;
    let finishGeneration: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/library') return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && init?.method === 'PUT') {
        saves += 1;
        const payload = JSON.parse(String(init.body)) as { book: unknown };
        return jsonResponse(payload.book);
      }
      if (url === `/api/books/${book.id}`) return jsonResponse(book);
      if (url === '/api/generate') {
        generationRequest = JSON.parse(String(init?.body)) as typeof generationRequest;
        return new Promise<Response>((resolve) => { finishGeneration = resolve; });
      }
      throw new Error(`Unexpected typing test request: ${url}`);
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const commits: Array<{ value: string; pending: boolean }> = [];
    const parse = vi.spyOn(proseFormatting, 'parseProseFormatting');
    try {
      await act(async () => root.render(<Profiler id="typing" onRender={() => {
        commits.push({ value: container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.value ?? '',
          pending: container.querySelector('.writer-context-trigger')?.getAttribute('aria-busy') === 'true' });
      }}><App /></Profiler>));
      const target = await waitForElement(() => container.querySelectorAll<HTMLButtonElement>('.section-open')[1] ?? null);
      await act(async () => target.click());
      parse.mockClear();
      commits.length = 0;
      const input = container.querySelector<HTMLTextAreaElement>('#writing-instruction')!;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      const type = async (value: string, composing = false, caret = value.length) => act(async () => {
        setter.call(input, value);
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
      });
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await type('今天写xiao', true);
      expect(input.value).toBe('今天写xiao');
      await type('今天写小说', true);
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '小说' })));
      await type('今天继续写小说', false, 4);
      expect(input.selectionStart).toBe(4);
      expect(document.activeElement).toBe(input);
      expect(parse).not.toHaveBeenCalled();
      expect(saves).toBe(0);
      expect(commits.some((commit) => commit.value === '今天继续写小说' && commit.pending)).toBe(true);
      expect(commits.at(-1)?.pending).toBe(false);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="发送并续写"]')?.click());
      expect(generationRequest).toMatchObject({ sectionId: 'typing-target', instruction: '今天继续写小说' });
      await type('下一轮输入');
      await act(async () => finishGeneration(jsonResponse({ draft: 'Synthetic continuation.' })));
      expect(input.value).toBe('下一轮输入');
      expect(container.querySelector('.manuscript')?.textContent).toContain('今天继续写小说');
      expect(container.querySelector('.manuscript')?.textContent).toContain('Synthetic continuation.');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps title, manuscript and note edits responsive without losing edits across saves', async () => {
    const book = createExampleBooks()[0]!;
    const content = '合成长正文。“继续向前。”'.repeat(1000);
    const memory = createSectionMemory({ synopsis: 'Synthetic summary.', beats: [], continuityFacts: [],
      characterStateChanges: [], foreshadowingCandidates: [] }, content);
    book.chapters = [{ id: 'editing-chapter', title: 'Editing chapter', sections: [
      { id: 'editing-section', title: 'Editing section', content, memory,
        blocks: [{ id: 'editing-block', kind: 'assistant', content }] },
    ] }];
    const saves: typeof book[] = [];
    let finishFirstSave: (response: Response) => void = () => undefined;
    let failSave = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/library') return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body)) as { book: typeof book };
        const candidate = payload.book;
        saves.push(candidate);
        if (saves.length === 1) return new Promise<Response>((resolve) => { finishFirstSave = resolve; });
        if (failSave) throw new Error('Synthetic save failure');
        return jsonResponse(candidate);
      }
      if (url === `/api/books/${book.id}`) return jsonResponse(book);
      throw new Error(`Unexpected editing test request: ${url}`);
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const words = vi.spyOn(textMetrics, 'countWords');
    const tokens = vi.spyOn(textMetrics, 'estimateTokens');
    const plan = vi.spyOn(contextPlanner, 'buildContextPlan');
    const parse = vi.spyOn(proseFormatting, 'parseProseFormatting');
    const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string, composing = false, caret = value.length) => act(async () => {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
    });
    try {
      await act(async () => root.render(<App />));
      const chapterTitle = container.querySelector<HTMLButtonElement>('.chapter-inline-title .inline-title-display')!;
      await act(async () => chapterTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      const title = container.querySelector<HTMLInputElement>('.chapter-inline-title .inline-title-input')!;
      words.mockClear(); tokens.mockClear();
      await type(title, '标题xiu', true);
      await type(title, '标题修改');
      expect(title.value).toBe('标题修改');
      expect(words).not.toHaveBeenCalled();
      expect(tokens).not.toHaveBeenCalled();
      expect(saves).toHaveLength(0);
      await act(async () => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('.manuscript-block-select')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑所选片段"]')!.click());
      const editor = container.querySelector<HTMLTextAreaElement>('#block-editor-textarea')!;
      editor.focus();
      words.mockClear(); tokens.mockClear(); plan.mockClear(); parse.mockClear();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await type(editor, `  ${content}\n新增zhengwen`, true);
      const edited = `  ${content}\n新增正文  `;
      await type(editor, edited, true);
      await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '正文' })));
      await type(editor, edited, false, 4);
      expect(editor.selectionStart).toBe(4);
      expect(document.activeElement).toBe(editor);
      expect(words).not.toHaveBeenCalled();
      expect(tokens).not.toHaveBeenCalled();
      expect(plan).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(saves).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(saves).toHaveLength(1);
      expect(saves[0]!.chapters[0]!.sections[0]!.blocks![0]!.content).toBe(edited);
      expect(saves[0]!.chapters[0]!.sections[0]!.memory!.status).toBe('stale');
      const newer = `${edited}\n保存过程中继续输入`;
      await type(editor, newer);
      await act(async () => finishFirstSave(jsonResponse(saves[0])));
      expect(editor.value).toBe(newer);
      failSave = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(container.querySelector('[role="status"]')?.textContent).toContain('无法连接');
      expect(editor.value).toBe(newer);
      failSave = false;
      const latest = `${newer}，仍可编辑`;
      await type(editor, latest);
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(saves.at(-1)!.chapters[0]!.sections[0]!.blocks![0]!.content).toBe(latest);
      expect(editor.value).toBe(latest);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="完成编辑并返回正文"]')!.click());
      expect(container.querySelector('.manuscript')?.textContent).toContain('仍可编辑');
      expect(plan).toHaveBeenCalled();
      expect(plan.mock.calls.at(-1)![0].chapters[0]!.sections[0]!.content).toBe(latest.trim());
      const note = container.querySelector<HTMLTextAreaElement>('#author-note-input')!;
      words.mockClear(); parse.mockClear();
      await type(note, '新的小节注释');
      expect(words).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(saves.at(-1)!.chapters[0]!.sections[0]!.note).toBe('新的小节注释');
      expect(saves.at(-1)!.chapters[0]!.sections[0]!.blocks![0]!.content).toBe(latest);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  it('creates a device-runtime Book with compatible IDs', async () => {
    const environment = installFakeDeviceLocks();
    try {
      const created = await deviceLibrary.createBook('Fallback Book');

      expect(created.id).toMatch(new RegExp(`^book-${uuidPattern.source.slice(1, -1)}$`));
      expect(created.chapters[0]?.id).toMatch(new RegExp(`^chapter-${uuidPattern.source.slice(1, -1)}$`));
      expect(created.chapters[0]?.sections[0]?.id)
        .toMatch(new RegExp(`^section-${uuidPattern.source.slice(1, -1)}$`));
      expect((await deviceLibrary.loadBook(created.id)).title).toBe('Fallback Book');
    } finally {
      environment.restore();
    }
  });

  it('keeps local prose, candidates, and input after a host conflict and blocks retry PUTs', async () => {
    const book = createExampleBooks()[0]!;
    const section = book.chapters[0]!.sections[0]!;
    section.blocks = [
      { id: 'conflict-user', kind: 'user', content: '已有用户输入。' },
      {
        id: 'conflict-answer',
        kind: 'assistant',
        content: '旧候选正文。',
        candidates: [
          { id: 'conflict-old', content: '旧候选正文。' },
          { id: 'conflict-new', content: '本地新候选正文。' },
        ],
        adoptedCandidateId: 'conflict-old',
      },
    ];
    section.content = '已有用户输入。\n\n旧候选正文。';
    let putCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/library') return jsonResponse([{ id: book.id, title: book.title, updatedAt: book.updatedAt }]);
      if (url === '/api/storage-location') return jsonResponse({ location: 'synthetic-library' });
      if (url === '/api/providers') return jsonResponse([]);
      if (url === `/api/books/${book.id}` && method === 'GET') return jsonResponse(structuredClone(book));
      if (url === `/api/books/${book.id}` && method === 'PUT') {
        putCount += 1;
        return new Response(JSON.stringify({ error: 'Synthetic revision conflict', code: 'BOOK_CONFLICT' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected test request: ${method} ${url}`);
    }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
      await act(async () => sectionButton.click());
      const instruction = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('#writing-instruction'));
      const instructionSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!instructionSetter) throw new Error('Text area value setter is unavailable.');
      await act(async () => {
        instructionSetter.call(instruction, '冲突后仍要保留的输入。');
        instruction.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择 AI 输出片段"]')?.click());
      const nextCandidate = await waitForElement(() => container.querySelector<HTMLButtonElement>('[aria-label="下一版回答候选"]'));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await act(async () => nextCandidate.click());
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });

      expect(putCount).toBe(1);
      expect(container.querySelector('.manuscript')?.textContent).toContain('本地新候选正文。');
      expect(container.querySelector('.answer-candidate-strip')?.textContent).toContain('2 / 2');
      expect(container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.value)
        .toBe('冲突后仍要保留的输入。');
      expect(container.querySelector('[role="status"]')?.textContent).toContain('其他页面更新');
      const note = container.querySelector<HTMLTextAreaElement>('#author-note-input');
      if (!note) throw new Error('author note input missing');
      const noteSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!noteSetter) throw new Error('Text area value setter is unavailable.');
      await act(async () => {
        noteSetter.call(note, '冲突后继续编辑。');
        note.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(putCount).toBe(1);
      expect(container.querySelector('.manuscript')?.textContent).toContain('本地新候选正文。');
      expect(container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.value)
        .toBe('冲突后仍要保留的输入。');

      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回故事书架"]')?.click());
      expect(container.querySelector<HTMLButtonElement>('[aria-label="重新载入当前书目"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
});
