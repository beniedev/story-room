// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useBookSession } from '../src/application/useBookSession';
import type { BookSessionTransition } from '../src/application/bookSessionTypes';
import type { Book } from '../src/types';

const book: Book = { id: 'session-book', title: 'Synthetic session book', writingBrief: '', characters: [], worldRules: [], canonFacts: [], summaries: [], chapters: [], branches: [], updatedAt: '2026-01-01T00:00:00.000Z' };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const settle = async () => { for (let index = 0; index < 8; index += 1) await act(async () => { await Promise.resolve(); }); };
const mountSession = async () => {
  let current!: ReturnType<typeof useBookSession<null>>;
  const transitions: BookSessionTransition[] = [];
  function Probe() {
    current = useBookSession({ bootstrap: { load: async () => null, apply: vi.fn() }, onStatus: vi.fn(), onTransition: (transition) => transitions.push(transition), isBusy: () => false, hasLocalEditorDraft: () => false });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await settle();
  return { root, getCurrent: () => current, transitions };
};

beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

describe('Book session command boundary', () => {
  it('updates the snapshot immediately while distinguishing ordinary revision changes from Book session identity', async () => {
    let completeSave!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/library') return response([book]);
      if (String(input) === `/api/books/${book.id}` && init?.method === 'PUT') return new Promise<Response>((resolve) => { completeSave = resolve; });
      if (String(input) === `/api/books/${book.id}`) return response(book);
      throw new Error(`Unexpected session test request: ${String(input)}`);
    }));
    const { root, getCurrent } = await mountSession();
    try {
      const command = getCurrent();
      const token = command.captureToken();
      await act(async () => {
        command.changeBook((current) => ({ ...current, title: 'Synthetic immediate edit' }));
        expect(command.getSnapshot().book?.title).toBe('Synthetic immediate edit');
        expect(command.isCurrent(token)).toBe(true);
        expect(command.isCurrent(token, { revision: token.revision })).toBe(false);
      });
      const candidate = { ...getCurrent().getSnapshot().book!, title: 'Synthetic explicit snapshot' };
      expect(() => getCurrent().saveEditedSnapshot({ ...candidate, id: 'wrong-session-book' })).toThrow('保存期间正文已变化');
      expect(command.getSnapshot().book?.id).toBe(book.id);
      let save!: Promise<Book>;
      await act(async () => {
        save = getCurrent().saveEditedSnapshot(candidate);
        expect(command.getSnapshot().book?.title).toBe(candidate.title);
      });
      await settle();
      await act(async () => { completeSave(response(candidate)); await save; });
      const savedToken = getCurrent().captureToken();
      expect(getCurrent().isCurrent(savedToken, { revision: savedToken.revision })).toBe(true);
      await act(async () => { await getCurrent().reloadBook(book.id); });
      expect(command.isCurrent(savedToken)).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });

  it('invalidates a pending target load on unmount before it can alter the Book snapshot or notify activation', async () => {
    let completeLoad!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/library') return response([book]);
      if (String(input) === '/api/books/late-session-book') return new Promise<Response>((resolve) => { completeLoad = resolve; });
      if (String(input) === `/api/books/${book.id}`) return response(book);
      throw new Error(`Unexpected session test request: ${String(input)}`);
    }));
    const { root, getCurrent, transitions } = await mountSession();
    const command = getCurrent();
    let load!: Promise<boolean>;
    await act(async () => { load = command.openBook('late-session-book'); });
    await act(async () => root.unmount());
    completeLoad(response({ ...book, id: 'late-session-book', title: 'Late synthetic book' }));
    expect(await load).toBe(false);
    expect(command.getSnapshot().book?.id).toBe(book.id);
    expect(transitions.some((transition) => transition.kind === 'activated' && transition.book.id === 'late-session-book')).toBe(false);
  });
});
