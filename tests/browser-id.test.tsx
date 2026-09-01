// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeId } from '../src/components/shared/id';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';

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

  it('creates a device-runtime Book with compatible IDs', async () => {
    const created = await deviceLibrary.createBook('Fallback Book');

    expect(created.id).toMatch(new RegExp(`^book-${uuidPattern.source.slice(1, -1)}$`));
    expect(created.chapters[0]?.id).toMatch(new RegExp(`^chapter-${uuidPattern.source.slice(1, -1)}$`));
    expect(created.chapters[0]?.sections[0]?.id)
      .toMatch(new RegExp(`^section-${uuidPattern.source.slice(1, -1)}$`));
    expect((await deviceLibrary.loadBook(created.id)).title).toBe('Fallback Book');
  });
});
