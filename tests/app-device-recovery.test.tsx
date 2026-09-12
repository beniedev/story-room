// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleBooks } from '../src/fixtures';
import { deviceLibrary } from '../src/deviceLibrary';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      runtime: 'device' as const,
      ...deviceLibrary,
      storageLocation: async () => ({ location: 'synthetic-device' }),
      listProviderProfiles: async () => [],
      saveProviderProfile: async (profile: unknown) => profile,
      testProviderProfile: async () => ({ ok: true as const, modelId: 'synthetic-model' }),
    },
  };
});

import App from '../src/App';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const bookKey = (bookId: string) => `story-native:book:${bookId}`;
const draftKey = (bookId: string) => `story-native:draft:${bookId}`;
const waitForStorage = async (milliseconds = 800) => {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
  });
};

let lockEnvironment: ReturnType<typeof installFakeDeviceLocks>;

const withDeviceWriter = <T,>(work: () => Promise<T>) => work();

const writeDraftEnvelope = (book: ReturnType<typeof createExampleBooks>[number], baseUpdatedAt: string | null) => {
  sessionStorage.setItem(draftKey(book.id), JSON.stringify({
    schemaVersion: 1,
    book,
    baseUpdatedAt,
    draftEditedAt: new Date().toISOString(),
  }));
};

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
  sessionStorage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  lockEnvironment = installFakeDeviceLocks();
});

afterEach(async () => {
  document.body.innerHTML = '';
  // App unmounts dispose its lease in each test. Give the fake lock callback
  // one turn to observe the release before restoring the global environment.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  lockEnvironment?.restore();
  vi.restoreAllMocks();
});

describe('device storage recovery', () => {
  it('shows a visible conflict and never resurrects a Book deleted in another page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      await waitForElement(() => container.querySelector('.book-selector-card'));
      // Let the initial openBook render commit its storage listener before simulating another page.
      await act(async () => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
      // Initial selection follows the stored index, not fixture construction order.
      const [selected] = await deviceLibrary.listPersistedBooks();
      if (!selected) throw new Error('fixture book missing');
      const current = await deviceLibrary.loadBook(selected.id);
      localStorage.removeItem(bookKey(current.id));
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: bookKey(current.id),
          newValue: null,
        }));
      });
      await waitForStorage();

      expect(container.querySelector('.status-line[role="status"]')?.textContent).toContain('其他页面更新');
      const reload = container.querySelector<HTMLButtonElement>('[aria-label="重新载入当前书目"]');
      expect(reload).not.toBeNull();
      expect(sessionStorage.getItem(draftKey(current.id))).not.toBeNull();
      vi.stubGlobal('confirm', vi.fn(() => true));
      await act(async () => {
        reload?.click();
        await Promise.resolve();
      });
      expect(sessionStorage.getItem(draftKey(current.id))).not.toBeNull();
      await expect(deviceLibrary.saveBook({ ...current, title: '不应复活' }, current.updatedAt))
        .rejects.toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409 });
      expect(localStorage.getItem(bookKey(current.id))).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('recovers and autosaves a draft whose base matches the current Book', async () => {
    const stored = await withDeviceWriter(async () => {
      const [current] = await deviceLibrary.listBooks();
      if (!current) throw new Error('fixture book missing');
      return deviceLibrary.loadBook(current.id);
    });
    const draft = {
      ...stored,
      title: '同基线本地草稿',
      updatedAt: new Date(Date.parse(stored.updatedAt) + 1).toISOString(),
    };
    writeDraftEnvelope(draft, stored.updatedAt);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      await waitForElement(() => container.querySelector('.book-selector-card'));
      await waitForStorage();

      await expect(deviceLibrary.loadBook(stored.id)).resolves.toMatchObject({ title: '同基线本地草稿' });
      expect(sessionStorage.getItem(draftKey(stored.id))).toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent).not.toContain('其他页面更新');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps an old-base draft visible and blocks autosave after remount', async () => {
    const expected = createExampleBooks()[0]!;
    const baseline = await withDeviceWriter(async () => {
      const current = (await deviceLibrary.listBooks()).find((entry) => entry.id === expected.id);
      if (!current) throw new Error('fixture book missing');
      return deviceLibrary.loadBook(current.id);
    });

    const firstContainer = document.createElement('div');
    document.body.appendChild(firstContainer);
    const firstRoot = createRoot(firstContainer);
    await act(async () => firstRoot.render(<App />));
    await waitForElement(() => firstContainer.querySelector('.book-selector-card'));
    await act(async () => firstRoot.unmount());

    const remote = await withDeviceWriter(() =>
      deviceLibrary.saveBook({ ...baseline, title: '另一页的新版本' }, baseline.updatedAt));
    const staleDraft = {
      ...baseline,
      title: '旧基线本地草稿',
      updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString(),
    };
    writeDraftEnvelope(staleDraft, baseline.updatedAt);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      await waitForElement(() => container.querySelector('.book-selector-card'));
      await waitForStorage();

      await expect(deviceLibrary.loadBook(baseline.id)).resolves.toMatchObject({ title: '另一页的新版本' });
      const preservedDraft = JSON.parse(sessionStorage.getItem(draftKey(baseline.id)) ?? 'null') as {
        book?: { title?: string };
        baseUpdatedAt?: string | null;
      };
      expect(preservedDraft.book?.title).toBe('旧基线本地草稿');
      expect(preservedDraft.baseUpdatedAt).toBe(baseline.updatedAt);
      expect(container.textContent).toContain('旧基线本地草稿');
      expect(container.querySelector('[role="status"]')?.textContent).toContain('其他页面更新');
      const reload = container.querySelector<HTMLButtonElement>('[aria-label="重新载入当前书目"]');
      expect(reload).not.toBeNull();

      vi.stubGlobal('confirm', vi.fn(() => true));
      await act(async () => {
        reload?.click();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
      expect(sessionStorage.getItem(draftKey(baseline.id))).toBeNull();
      await expect(deviceLibrary.loadBook(baseline.id)).resolves.toMatchObject({ title: '另一页的新版本' });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('migrates a legacy raw draft as unknown-base content without overwriting the current Book', async () => {
    const expected = createExampleBooks()[0]!;
    const baseline = await withDeviceWriter(async () => {
      const current = (await deviceLibrary.listBooks()).find((entry) => entry.id === expected.id);
      if (!current) throw new Error('fixture book missing');
      return deviceLibrary.loadBook(current.id);
    });
    const remote = await withDeviceWriter(() =>
      deviceLibrary.saveBook({ ...baseline, title: '当前持久版本' }, baseline.updatedAt));
    const legacyDraft = {
      ...baseline,
      title: '旧格式草稿',
      updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString(),
    };
    localStorage.setItem(draftKey(baseline.id), JSON.stringify(legacyDraft));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      await waitForElement(() => container.querySelector('.book-selector-card'));
      await waitForStorage();

      await expect(deviceLibrary.loadBook(baseline.id)).resolves.toMatchObject({ title: '当前持久版本' });
      const migrated = JSON.parse(sessionStorage.getItem(draftKey(baseline.id)) ?? 'null') as {
        schemaVersion?: number;
        book?: { title?: string };
        baseUpdatedAt?: string | null;
      };
      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.book?.title).toBe('旧格式草稿');
      expect(migrated.baseUpdatedAt).toBeNull();
      expect(container.textContent).toContain('旧格式草稿');
      expect(container.querySelector('[role="status"]')?.textContent).toContain('其他页面更新');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('preserves a stale next-book draft when deleting the current Book', async () => {
    const { currentEntry, nextEntry, nextBaseline } = await withDeviceWriter(async () => {
      const entries = await deviceLibrary.listBooks();
      const currentEntry = entries[0];
      const nextEntry = entries[1];
      if (!currentEntry || !nextEntry) throw new Error('fixture books missing');
      return {
        currentEntry,
        nextEntry,
        nextBaseline: await deviceLibrary.loadBook(nextEntry.id),
      };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      await waitForElement(() => container.querySelector('.book-selector-card'));

      const remote = await deviceLibrary.saveBook({ ...nextBaseline, title: '下一本的持久新版本' }, nextBaseline.updatedAt);
      const staleDraft = {
        ...nextBaseline,
        title: '下一本的旧基线草稿',
        updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString(),
      };
      writeDraftEnvelope(staleDraft, nextBaseline.updatedAt);

      await act(async () => {
        container.querySelector<HTMLDetailsElement>('.book-actions-menu')?.querySelector('summary')?.click();
      });
      const deleteButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.includes('删除书目'));
      expect(deleteButton).not.toBeUndefined();
      await act(async () => deleteButton?.click());
      const confirmButton = await waitForElement(() => container
        .querySelector<HTMLDialogElement>('dialog[aria-labelledby="confirm-dialog-title"]')
        ?.querySelector<HTMLButtonElement>('.danger-action') ?? null);
      await act(async () => confirmButton.click());
      await waitForStorage();

      await expect(deviceLibrary.loadBook(nextEntry.id)).resolves.toMatchObject({ title: '下一本的持久新版本' });
      const preservedDraft = JSON.parse(sessionStorage.getItem(draftKey(nextEntry.id)) ?? 'null') as {
        book?: { title?: string };
        baseUpdatedAt?: string | null;
      };
      expect(preservedDraft.book?.title).toBe('下一本的旧基线草稿');
      expect(preservedDraft.baseUpdatedAt).toBe(nextBaseline.updatedAt);
      expect(container.textContent).toContain('下一本的旧基线草稿');
      expect(container.querySelector('.status-line[role="status"]')?.textContent).toContain('其他页面更新');
      expect(container.querySelector('[aria-label="重新载入当前书目"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
