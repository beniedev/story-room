// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeId } from '../src/components/shared/id';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';
import { createSectionMemory } from '../src/sectionMemory';

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
        return jsonResponse(JSON.parse(String(init?.body)) as unknown);
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

    const input = await waitForElement(() => container.querySelector<HTMLInputElement>('#name-dialog-input'));
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
        savedBook = JSON.parse(String(init?.body)) as typeof book;
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
        persisted = JSON.parse(String(init?.body)) as typeof book;
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
      expect(container.querySelector<HTMLInputElement>('.context-reference-checkbox input')?.checked).toBe(true);
      expect(saves).toBe(0);

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

  it('creates a device-runtime Book with compatible IDs', async () => {
    const created = await deviceLibrary.createBook('Fallback Book');

    expect(created.id).toMatch(new RegExp(`^book-${uuidPattern.source.slice(1, -1)}$`));
    expect(created.chapters[0]?.id).toMatch(new RegExp(`^chapter-${uuidPattern.source.slice(1, -1)}$`));
    expect(created.chapters[0]?.sections[0]?.id)
      .toMatch(new RegExp(`^section-${uuidPattern.source.slice(1, -1)}$`));
    expect((await deviceLibrary.loadBook(created.id)).title).toBe('Fallback Book');
  });
});
