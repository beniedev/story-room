// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookshelf } from '../src/components/Bookshelf';
import type { Writer } from '../src/components/Writer';
import type { Book } from '../src/types';
import App from '../src/App';

let shelf: ComponentProps<typeof Bookshelf>;
let writer: ComponentProps<typeof Writer>;
vi.mock('../src/components/Writer', () => ({ Writer: (props: ComponentProps<typeof Writer>) => { writer = props; return null; } }));
vi.mock('../src/components/Bookshelf', () => ({ Bookshelf: (props: ComponentProps<typeof Bookshelf>) => {
  shelf = props;
  return null;
} }));

const makeBook = (): Book => ({
  id: 'app-directory-book', title: '合成移动书目', writingBrief: '',
  characters: [], worldRules: [], canonFacts: [], summaries: [], branches: [],
  chapters: [
    { id: 'one', title: '第一章', sections: [
      { id: 'a', title: '第一节', content: '已有正文' },
      { id: 'b', title: '第二节', content: '' },
    ] },
    { id: 'two', title: '第二章', sections: [] },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const json = (value: unknown, status = 200) => Response.json(value, { status });
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); };
let root: Root;
let persisted: Book;
let saves: Book[];
let save: (candidate: Book) => Promise<Response>;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
beforeEach(async () => {
  localStorage.clear();
  persisted = makeBook();
  saves = [];
  save = async (candidate) => json(candidate);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/library') return json([{ id: persisted.id, title: persisted.title, updatedAt: persisted.updatedAt }]);
    if (url === '/api/providers') return json([]);
    if (url === '/api/storage-location') return json({ location: 'synthetic-library' });
    if (url === '/api/books/app-directory-book' && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body));
      const candidate = payload.book as Book;
      expect(payload.expectedUpdatedAt).toBe(persisted.updatedAt);
      saves.push(structuredClone(candidate));
      const response = await save(candidate);
      if (response.ok) persisted = structuredClone(candidate);
      return response;
    }
    if (url === '/api/books/app-directory-book') return json(persisted);
    if (url === '/api/context-plan') return json({ layers: [], budget: {} });
    throw new Error(`Unexpected synthetic request: ${url}`);
  }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
  await flush();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('directory persistence through App', () => {
  it('keeps old order while saving and after failure, then retries and supports undo', async () => {
    let resolve!: (response: Response) => void;
    save = () => new Promise<Response>((complete) => { resolve = complete; });
    let moving!: Promise<void>;
    const move = { kind: 'section' as const, id: 'a', targetChapterId: 'two', beforeId: null };
    await act(async () => {
      moving = shelf.onMoveDirectoryItem(move);
      void moving.catch(() => undefined);
    });
    await flush();
    expect(shelf.directoryBusy).toBe(true);
    expect(shelf.book.chapters[0].sections.map((section) => section.id)).toEqual(['a', 'b']);
    expect(shelf.canUndoDirectoryMove).toBe(false);
    expect(saves).toHaveLength(1);
    await expect(shelf.onMoveDirectoryItem(move)).rejects.toThrow('等待当前目录操作');
    expect(saves).toHaveLength(1);
    await act(async () => { resolve(json({ error: '合成保存失败' }, 500)); await moving.catch(() => undefined); });
    expect(shelf.directoryBusy).toBe(false);
    expect(shelf.book.chapters[0].sections.map((section) => section.id)).toEqual(['a', 'b']);
    expect(shelf.canUndoDirectoryMove).toBe(false);

    save = async (candidate) => json(candidate);
    await act(async () => { await shelf.onMoveDirectoryItem(move); });
    expect(saves).toHaveLength(2);
    expect(shelf.book.chapters[1].sections[0].id).toBe('a');
    expect(shelf.canUndoDirectoryMove).toBe(true);
    await act(async () => { await shelf.onRenameSection('two', 'a', '移动后改名'); });
    await act(async () => { await shelf.onUndoDirectoryMove(); });
    expect(shelf.book.chapters[0].sections[0].title).toBe('移动后改名');
    expect(shelf.book.chapters[0].sections[0].content).toBe('已有正文');
    expect(shelf.canUndoDirectoryMove).toBe(false);
    expect(persisted.chapters[0].sections[0].id).toBe('a');
  });

  it('adds only at the requested position and rejects stale insertion anchors', async () => {
    await act(async () => { await shelf.onAddSection('one', '插入小节', 'a'); });
    expect(shelf.book.chapters[0].sections.map((section) => section.title)).toEqual(['第一节', '插入小节', '第二节']);
    expect(saves).toHaveLength(1);
    await act(async () => { await expect(shelf.onAddSection('one', '不能插入', 'missing')).rejects.toThrow('目标小节'); });
    expect(saves).toHaveLength(1);
  });
  it.each(['success', 'failure'] as const)('preserves edits made during a title PUT on %s and saves them next', async (outcome) => {
    vi.useFakeTimers();
    try {
      let resolve!: (response: Response) => void;
      save = () => new Promise<Response>((r) => { resolve = r; });
      await act(async () => shelf.onOpenSection('a'));
      let renaming!: Promise<unknown>;
      await act(async () => {
        renaming = writer.onSectionTitleChange('New title');
        void renaming.catch(() => undefined);
      });
      await flush();
      expect(writer.busy).toBe(false);
      await act(async () => writer.onAuthorNoteChange('Later note'));
      await act(async () => writer.onSectionBlocksChange([{ id: 'later-block', kind: 'assistant', content: 'Later prose' }]));
      const savedTitle = { ...saves[0], updatedAt: '2026-02-01T00:00:00.000Z' };
      await act(async () => {
        resolve(outcome === 'success' ? json(savedTitle) : json({ error: 'Synthetic failure' }, 500));
        await renaming.catch(() => undefined);
      });
      // These are actual App state/Writer props, not a reimplementation of save logic.
      expect(writer.authorNote).toBe('Later note');
      expect(writer.section?.content).toBe('Later prose');
      expect(writer.section?.title).toBe('New title');
      if (outcome === 'success') persisted = structuredClone(savedTitle);
      save = async (candidate) => json(candidate);
      await act(async () => vi.advanceTimersByTimeAsync(750));
      await flush();
      expect(saves).toHaveLength(2);
      expect(persisted.chapters[0].sections[0].content).toBe('Later prose');
      expect(writer.status).toContain('已自动保存');
    } finally { vi.useRealTimers(); }
  });

});
