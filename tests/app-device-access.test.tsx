// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleBooks } from '../src/fixtures';
import { deviceLibrary } from '../src/deviceLibrary';
import { DEVICE_WRITER_LOCK_NAME } from '../src/deviceWriterLease';
import type { Book } from '../src/types';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

const apiControls = vi.hoisted(() => ({
  loadPersistedBook: vi.fn(),
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      runtime: 'device' as const,
      ...deviceLibrary,
      loadPersistedBook: apiControls.loadPersistedBook,
      storageLocation: async () => ({ location: 'synthetic-device' }),
      listProviderProfiles: async () => [],
      saveProviderProfile: async (profile: unknown) => profile,
      testProviderProfile: async () => ({ ok: true as const, modelId: 'synthetic-model' }),
    },
  };
});

import App from '../src/App';

type StorageOperation = { kind: 'set' | 'remove' | 'clear'; key?: string };

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  readonly operations: StorageOperation[] = [];

  get length() { return this.values.size; }
  clear() {
    this.operations.push({ kind: 'clear' });
    this.values.clear();
  }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) {
    this.operations.push({ kind: 'remove', key });
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.operations.push({ kind: 'set', key });
    this.values.set(key, value);
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const libraryKey = 'story-native:library';
const bookKey = (bookId: string) => `story-native:book:${bookId}`;
const draftKey = (bookId: string) => `story-native:draft:${bookId}`;

let storage: MemoryStorage;
let environment: ReturnType<typeof installFakeDeviceLocks>;
let mountedRoots: Root[] = [];
const externalReleases: Array<() => Promise<void>> = [];

const seedBooks = (books: Book[]) => {
  storage.setItem(libraryKey, JSON.stringify(books.map((book) => ({
    id: book.id,
    title: book.title,
    updatedAt: book.updatedAt,
  }))));
  books.forEach((book) => storage.setItem(bookKey(book.id), JSON.stringify(book)));
  storage.operations.length = 0;
};

const writeDraftEnvelope = (book: Book, baseUpdatedAt: string | null) => {
  storage.setItem(draftKey(book.id), JSON.stringify({
    schemaVersion: 1,
    book,
    baseUpdatedAt,
    draftEditedAt: new Date().toISOString(),
  }));
};

const targetedOperations = () => storage.operations.filter((operation) => (
  operation.key === libraryKey
  || operation.key?.startsWith('story-native:book:')
  || operation.key?.startsWith('story-native:draft:')
));

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
};

const waitForElement = async <T extends Element>(query: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = query();
    if (found) return found;
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error('Timed out waiting for the test element.');
};

const renderApp = async (strict = false) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(strict ? <StrictMode><App /></StrictMode> : <App />));
  await flushMicrotasks();
  return { container, root };
};

const setControlValue = async (control: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable.');
  await act(async () => {
    setter.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const holdExternalWriter = () => {
  const gate = deferred<void>();
  const request = environment.locks.request(
    DEVICE_WRITER_LOCK_NAME,
    { mode: 'exclusive' },
    () => gate.promise,
  );
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      gate.resolve(undefined);
    }
    await request;
  };
  externalReleases.push(release);
  return release;
};

const firstTwoBooks = () => {
  const [first, second] = createExampleBooks();
  if (!first || !second) throw new Error('example books missing');
  return [structuredClone(first), structuredClone(second)] as [Book, Book];
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
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  environment = installFakeDeviceLocks();
  apiControls.loadPersistedBook.mockReset();
  apiControls.loadPersistedBook.mockImplementation((bookId: string) => deviceLibrary.loadPersistedBook(bookId));
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  for (const release of externalReleases.splice(0)) {
    await release().catch(() => undefined);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  environment?.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('device access and reader regressions', () => {
  it.each([
    ['unsupported Web Locks', () => {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    }],
    ['insecure context', () => {
      Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    }],
    ['Web Locks rejection', () => {
      environment.locks.rejectNext();
    }],
  ])('reads persisted content without draft or Book writes when %s', async (_label, configure) => {
    const [book] = firstTwoBooks();
    if (!book) throw new Error('fixture book missing');
    seedBooks([book]);
    const draft = { ...book, title: '不应被只读启动读取的草稿' };
    writeDraftEnvelope(draft, book.updatedAt);
    storage.operations.length = 0;
    configure();

    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));

    expect(container.querySelector('.device-access-banner')?.textContent).toContain('只读');
    expect(container.querySelector('.book-selector-card strong')?.textContent).toBe(book.title);
    expect(container.textContent).not.toContain(draft.title);
    expect(targetedOperations()).toEqual([]);
    expect(storage.getItem(draftKey(book.id))).not.toBeNull();
  });

  it('keeps reader editing controls disabled and exports without storage writes', async () => {
    const [book] = firstTwoBooks();
    if (!book) throw new Error('fixture book missing');
    const section = book.chapters[0]?.sections[0];
    const candidateBlock = section?.blocks?.find((block) => block.kind === 'assistant');
    if (!section || !candidateBlock) throw new Error('candidate fixture missing');
    candidateBlock.candidates = [
      { id: 'reader-candidate-old', content: candidateBlock.content, sourceSignature: 'reader-old' },
      { id: 'reader-candidate-current', content: candidateBlock.content, sourceSignature: 'reader-current' },
    ];
    candidateBlock.adoptedCandidateId = 'reader-candidate-current';
    seedBooks([book]);
    const releaseExternal = holdExternalWriter();
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));

    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出当前书目"]');
    expect(exportButton?.disabled).toBe(false);
    const createButton = container.querySelector<HTMLButtonElement>('[aria-label="新建书目"]');
    const importButton = container.querySelector<HTMLButtonElement>('[aria-label="导入 JSON 备份"]');
    expect(createButton?.disabled).toBe(true);
    expect(importButton?.disabled).toBe(true);

    storage.operations.length = 0;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => exportButton?.click());
    const jsonOption = await waitForElement(() => [...container.querySelectorAll<HTMLButtonElement>('.export-option')]
      .find((candidate) => candidate.textContent?.includes('JSON 完整备份')) ?? null);
    await act(async () => jsonOption.click());

    expect(click).toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(targetedOperations()).toEqual([]);

    const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
    await act(async () => sectionButton.click());
    await waitForElement(() => container.querySelector('#writing-instruction'));
    expect(container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.writer-send-button')?.disabled).toBe(true);
    expect(container.querySelector('.manuscript-block-select')).toBeNull();
    expect(container.querySelector('.answer-candidate-strip')).toBeNull();
    await releaseExternal();
  });

  it('preserves a non-first reader book and scroll snapshot across occupied retry and takeover', async () => {
    const [first, second] = firstTwoBooks();
    const releaseExternal = holdExternalWriter();
    seedBooks([first, second]);
    const recoveryDraft = { ...second, title: '第二本接管后的恢复草稿' };
    writeDraftEnvelope(recoveryDraft, second.updatedAt);
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));

    await act(async () => container.querySelector<HTMLDetailsElement>('.book-library-drawer')?.querySelector('summary')?.click());
    const secondBookButton = await waitForElement(() => [...container.querySelectorAll<HTMLButtonElement>('.book-list button')]
      .find((candidate) => candidate.textContent?.includes(second.title)) ?? null);
    await act(async () => secondBookButton.click());
    await waitForElement(() => container.querySelector('.book-selector-card strong'));
    expect(container.querySelector('.book-selector-card strong')?.textContent).toBe(second.title);

    const sectionButton = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
    await act(async () => sectionButton.click());
    const manuscript = await waitForElement(() => container.querySelector<HTMLElement>('.manuscript-wrap'));
    manuscript.scrollTop = 137;
    await act(async () => manuscript.dispatchEvent(new Event('scroll')));

    const takeover = await waitForElement(() => container.querySelector<HTMLButtonElement>('.device-access-banner .primary-action'));
    await act(async () => takeover.click());
    await waitForElement(() => [...container.querySelectorAll('[role="status"]')]
      .find((candidate) => candidate.textContent?.includes('另一个编辑页仍在使用书库')) ?? null);
    expect(container.querySelector('.writer-section-title')?.textContent).toContain(second.chapters[0]?.sections[0]?.title ?? '');
    expect(manuscript.scrollTop).toBe(137);

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回故事书架"]')?.click());
    await waitForElement(() => container.querySelector('.book-selector-card strong'));
    expect(container.querySelector('.book-selector-card strong')?.textContent).toBe(second.title);

    await releaseExternal();
    const retry = await waitForElement(() => container.querySelector<HTMLButtonElement>('.device-access-banner .primary-action'));
    await act(async () => retry.click());
    await waitForElement(() => {
      const banner = container.querySelector('.device-access-banner');
      const title = container.querySelector('.book-selector-card strong');
      return !banner && title?.textContent === recoveryDraft.title ? title : null;
    });
    const reopenedSection = await waitForElement(() => container.querySelector<HTMLButtonElement>('.section-open'));
    await act(async () => reopenedSection.click());
    const reopenedManuscript = await waitForElement(() => container.querySelector<HTMLElement>('.manuscript-wrap'));
    expect(reopenedManuscript.scrollTop).toBe(137);
  });

  it('ignores a slow reader load after StrictMode takeover starts a fresh writer load', async () => {
    const [first, second] = firstTwoBooks();
    seedBooks([first, second]);
    const releaseExternal = holdExternalWriter();
    const slowSecondLoad = deferred<Book>();
    apiControls.loadPersistedBook.mockImplementation((bookId: string) => (
      bookId === second.id ? slowSecondLoad.promise : deviceLibrary.loadPersistedBook(bookId)
    ));

    const { container } = await renderApp(true);
    await waitForElement(() => container.querySelector('.book-selector-card'));
    await act(async () => container.querySelector<HTMLDetailsElement>('.book-library-drawer')?.querySelector('summary')?.click());
    const secondBookButton = await waitForElement(() => [...container.querySelectorAll<HTMLButtonElement>('.book-list button')]
      .find((candidate) => candidate.textContent?.includes(second.title)) ?? null);
    await act(async () => secondBookButton.click());
    await waitForElement(() => apiControls.loadPersistedBook.mock.calls
      .some(([bookId]) => bookId === second.id) ? container.querySelector('.status-line') : null);

    await releaseExternal();
    const takeover = await waitForElement(() => container.querySelector<HTMLButtonElement>('.device-access-banner .primary-action'));
    await act(async () => takeover.click());
    await waitForElement(() => {
      const title = container.querySelector('.book-selector-card strong');
      return !container.querySelector('.device-access-banner') && title?.textContent === first.title ? title : null;
    });

    slowSecondLoad.resolve(second);
    await flushMicrotasks();
    expect(container.querySelector('.book-selector-card strong')?.textContent).toBe(first.title);
  });

  it.each([
    ['an existing book', true],
    ['an empty library', false],
  ])('takes over after the current book is deleted and selects %s', async (_label, keepBook) => {
    const [first, second] = firstTwoBooks();
    const books = keepBook ? [first, second] : [first];
    seedBooks(books);
    const releaseExternal = holdExternalWriter();
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));

    storage.removeItem(bookKey(first.id));
    storage.setItem(libraryKey, JSON.stringify(keepBook ? [second].map((book) => ({
      id: book.id,
      title: book.title,
      updatedAt: book.updatedAt,
    })) : []));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: bookKey(first.id), newValue: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: libraryKey, newValue: storage.getItem(libraryKey) }));
    });
    await waitForElement(() => [...container.querySelectorAll('[role="status"]')]
      .find((candidate) => candidate.textContent?.includes('其他页面删除')) ?? null);

    await releaseExternal();
    const takeover = await waitForElement(() => container.querySelector<HTMLButtonElement>('.device-access-banner .primary-action'));
    await act(async () => takeover.click());
    if (keepBook) {
      await waitForElement(() => {
        const banner = container.querySelector('.device-access-banner');
        const title = container.querySelector('.book-selector-card strong');
        return !banner && title?.textContent === second.title ? title : null;
      });
    } else {
      const emptyState = await waitForElement(() => container.querySelector('.empty-library-state'));
      expect(emptyState.textContent).toContain('书库还是空的');
      const create = emptyState.querySelector<HTMLButtonElement>('.primary-action');
      await act(async () => create?.click());
      const titleInput = await waitForElement(() => container.querySelector<HTMLInputElement>('dialog input'));
      await setControlValue(titleInput, '接管后新建书目');
      await act(async () => container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.click());
      await waitForElement(() => container.querySelector('.book-selector-card strong'));
      expect(container.querySelector('.book-selector-card strong')?.textContent).toBe('接管后新建书目');

      await act(async () => container.querySelector<HTMLDetailsElement>('.book-actions-menu')?.querySelector('summary')?.click());
      const deleteButton = await waitForElement(() => [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.includes('删除书目')) ?? null);
      await act(async () => deleteButton.click());
      const confirmDelete = await waitForElement(() => container
        .querySelector<HTMLDialogElement>('dialog[aria-labelledby="confirm-dialog-title"]')
        ?.querySelector<HTMLButtonElement>('.danger-action') ?? null);
      await act(async () => confirmDelete.click());
      await waitForElement(() => container.querySelector('.empty-library-state'));

      const importInput = await waitForElement(() => container.querySelector<HTMLInputElement>(
        'input[type="file"][aria-label="导入 JSON 备份"]',
      ));
      const backup = new File([JSON.stringify(first)], 'synthetic-book.json', { type: 'application/json' });
      Object.defineProperty(importInput, 'files', { configurable: true, value: [backup] });
      await act(async () => importInput.dispatchEvent(new Event('change', { bubbles: true })));
      await waitForElement(() => container.querySelector('.book-selector-card strong'));
      expect(container.querySelector('.book-selector-card strong')?.textContent).toBe(first.title);
    }
  });
});
