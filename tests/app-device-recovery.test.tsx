// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleBooks } from '../src/fixtures';
import { deviceLibrary } from '../src/deviceLibrary';

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
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('device storage recovery', () => {
  it('shows a visible conflict and never resurrects a Book deleted in another page', async () => {
    const expected = createExampleBooks()[0]!;
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
      const current = await deviceLibrary.loadBook(expected.id);
      localStorage.removeItem(`story-native:book:${current.id}`);
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: `story-native:book:${current.id}`,
          newValue: null,
        }));
      });
      await act(async () => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
      });

      expect(container.querySelector('[role="status"]')?.textContent).toContain('其他页面更新');
      const reload = container.querySelector<HTMLButtonElement>('[aria-label="重新载入当前书目"]');
      expect(reload).not.toBeNull();
      expect(localStorage.getItem(`story-native:draft:${current.id}`)).not.toBeNull();
      vi.stubGlobal('confirm', vi.fn(() => true));
      await act(async () => {
        reload?.click();
        await Promise.resolve();
      });
      expect(localStorage.getItem(`story-native:draft:${current.id}`)).not.toBeNull();
      await expect(deviceLibrary.saveBook({ ...current, title: '不应复活' }, current.updatedAt))
        .rejects.toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409 });
      expect(localStorage.getItem(`story-native:book:${current.id}`)).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
