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
  saveBook: vi.fn(),
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      runtime: 'device' as const,
      ...deviceLibrary,
      loadPersistedBook: apiControls.loadPersistedBook,
      saveBook: apiControls.saveBook,
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
  sessionStorage.clear();
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  environment = installFakeDeviceLocks();
  apiControls.loadPersistedBook.mockReset();
  apiControls.loadPersistedBook.mockImplementation((bookId: string) => deviceLibrary.loadPersistedBook(bookId));
  apiControls.saveBook.mockReset();
  apiControls.saveBook.mockImplementation(deviceLibrary.saveBook);
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

describe('device pages coordinate writes without editor ownership', () => {
  it.each(['section', 'chapter', 'last-section'])('returns to the directory after external deletion of the current %s', async (kind) => {
    const [book] = firstTwoBooks();
    if (kind === 'last-section') book.chapters[0]!.sections = book.chapters[0]!.sections.slice(0, 1);
    seedBooks([book]);
    const { container } = await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
    expect(container.querySelector('.writer-page')).not.toBeNull();
    const updated = structuredClone(book);
    if (kind === 'chapter') updated.chapters.shift();
    else updated.chapters[0]!.sections.shift();
    const saved = await deviceLibrary.saveBook(updated, book.updatedAt);
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: bookKey(book.id), newValue: JSON.stringify(saved) })));
    expect(container.querySelector('.book-selector-card')).not.toBeNull();
    expect(container.textContent).toContain('这个小节已在另一页删除');
    expect(container.querySelector('.writer-page')).toBeNull();
  });

  it.each(['title', 'instruction', 'composition'])('protects uncommitted %s input before replacing a deleted section', async (kind) => {
    const [book] = firstTwoBooks();
    seedBooks([book]);
    const { container } = await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
    let control: HTMLInputElement | HTMLTextAreaElement;
    if (kind === 'title') {
      await act(async () => container.querySelector<HTMLButtonElement>('.writer-heading .inline-title-display')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })));
      control = container.querySelector<HTMLInputElement>('.inline-title-input')!;
      await setControlValue(control, '尚未提交的标题');
    } else {
      control = container.querySelector<HTMLTextAreaElement>('#writing-instruction')!;
      await act(async () => {
        if (kind === 'composition') control.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(control, '尚未发送的输入');
        if (kind !== 'composition') control.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const value = control.value;
    const updated = structuredClone(book);
    updated.chapters[0]!.sections.shift();
    const saved = await deviceLibrary.saveBook(updated, book.updatedAt);
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: bookKey(book.id), newValue: JSON.stringify(saved) })));
    expect(control.isConnected).toBe(true);
    expect(control.value).toBe(value);
    expect(container.querySelector('.writer-page')).not.toBeNull();
    expect(container.textContent).toContain('当前本地内容仍保留');
  });

  it('does not let a late successful save own a reloaded session of the same Book', async () => {
    const [book] = firstTwoBooks();
    seedBooks([book]);
    const response = deferred<void>();
    let written: Book | undefined;
    apiControls.saveBook.mockImplementationOnce(async (candidate: Book, expected: string) => {
      written = await deviceLibrary.saveBook(candidate, expected);
      await response.promise;
      return written;
    });
    const { container } = await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.writer-heading .inline-title-display')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })));
    const input = container.querySelector<HTMLInputElement>('.inline-title-input')!;
    await setControlValue(input, '已写入的新标题');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flushMicrotasks();
    expect(written).toBeDefined();
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: bookKey(book.id), newValue: JSON.stringify(written) })));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回故事书架"]')!.click());
    vi.stubGlobal('confirm', () => true);
    const reload = container.querySelector<HTMLButtonElement>('[aria-label="重新载入当前书目"]')!;
    await act(async () => reload.click());
    await flushMicrotasks();
    expect(container.querySelector('.book-selector-card')).not.toBeNull();
    await act(async () => response.resolve());
    await flushMicrotasks();
    expect(container.querySelector('.book-selector-card')).not.toBeNull();
    expect(container.textContent).not.toContain('当前本地内容仍保留');
    expect(sessionStorage.getItem(draftKey(book.id))).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
    expect(container.querySelector('.writer-heading')?.textContent).toContain('已写入的新标题');
  });

  it('keeps saved Books readable and exportable when coordination fails', async () => {
    seedBooks(firstTwoBooks());
    environment.locks.rejectNext();
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));
    expect(container.textContent).toContain('Web Locks failure');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="导出当前书目"]')?.disabled).toBe(false);
    expect(container.querySelector('.device-access-banner')).toBeNull();
  });

  it('opens two editable pages, including StrictMode, and never holds an idle library lock', async () => {
    seedBooks(firstTwoBooks());
    const one = await renderApp(true);
    const two = await renderApp();
    for (const { container } of [one, two]) {
      await waitForElement(() => container.querySelector('.book-selector-card'));
      expect(container.querySelector('.device-access-banner')).toBeNull();
      expect(container.textContent).not.toContain('尝试成为编辑页');
      expect(container.querySelector<HTMLButtonElement>('.section-open')?.disabled).toBe(false);
    }
    expect(environment.locks.isHeld(DEVICE_WRITER_LOCK_NAME)).toBe(false);
    expect(environment.locks.requests.every(({ options }) => !options.ifAvailable)).toBe(true);
  });

  it('refreshes a clean open Book after another page saves it without asking for editing rights', async () => {
    const [book] = firstTwoBooks();
    seedBooks([book]);
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));
    const saved = await deviceLibrary.saveBook({ ...book, title: 'Updated elsewhere' }, book.updatedAt);
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: bookKey(book.id), newValue: JSON.stringify(saved),
    })));
    expect(container.textContent).toContain('Updated elsewhere');
    expect(container.textContent).not.toContain('当前本地内容仍保留');
    expect(container.querySelector('.device-access-banner')).toBeNull();
  });

  it('keeps export free of Book and draft writes', async () => {
    seedBooks(firstTwoBooks());
    const { container } = await renderApp();
    await waitForElement(() => container.querySelector('.book-selector-card'));
    storage.operations.length = 0;
    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出当前书目"]');
    expect(exportButton).not.toBeNull();
    await act(async () => exportButton!.click());
    expect(storage.operations.filter(({ key }) => key?.startsWith('story-native:book:') || key?.startsWith('story-native:draft:'))).toEqual([]);
  });

  it('does not block updates to a clean Book because another Book has an unsent draft', async () => {
    const [first, second] = firstTwoBooks();
    seedBooks([first, second]);
    const { container } = await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
    const input = container.querySelector<HTMLTextAreaElement>('#writing-instruction')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '只属于第一本书的草稿');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回故事书架"]')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.book-list button')].find((button) => button.textContent?.includes(second.title))!.click());
    await flushMicrotasks();
    const saved = await deviceLibrary.saveBook({ ...second, title: '另一书目的外部更新' }, second.updatedAt);
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: bookKey(second.id), newValue: JSON.stringify(saved) })));
    expect(container.querySelector('.book-selector-card')?.textContent).toContain(saved.title);
    expect(container.textContent).not.toContain('当前本地内容仍保留');
  });
});
