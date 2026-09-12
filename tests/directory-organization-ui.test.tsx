// @vitest-environment jsdom

import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bookshelf } from '../src/components/Bookshelf';
import type { Book } from '../src/types';

const makeBook = (): Book => ({
  id: 'book-directory-organization',
  title: '目录整理测试书',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [
    {
      id: 'chapter-one',
      title: '第一章',
      sections: [
        { id: 'section-one', title: '第一节', content: '第一节正文' },
        { id: 'section-two', title: '第二节', content: '第二节正文' },
      ],
    },
    {
      id: 'chapter-two',
      title: '第二章',
      sections: [
        {
          id: 'section-three',
          title: '第三节',
          content: '第三节正文',
          contextReferences: [{ sectionId: 'section-one', mode: 'summary', reason: 'manual' }],
        },
      ],
    },
  ],
  branches: [],
  updatedAt: '2026-09-11T00:00:00.000Z',
});

const renderBookshelf = async (overrides: Partial<ComponentProps<typeof Bookshelf>> = {}) => {
  const book = overrides.book ?? makeBook();
  const props: ComponentProps<typeof Bookshelf> = {
    book,
    library: [{ id: book.id, title: book.title, updatedAt: book.updatedAt }],
    selectedSectionId: 'section-one',
    openNewBookRequest: 0,
    onNewBookOpened: vi.fn(),
    openBookSettingsRequest: 0,
    onBookSettingsOpened: vi.fn(),
    onBookSettingsClose: vi.fn(),
    onOpenBook: vi.fn(),
    onOpenSection: vi.fn(),
    onCreateBook: vi.fn(async () => undefined),
    onDeleteBook: vi.fn(async () => undefined),
    onBookChange: vi.fn(async () => undefined),
    onAddCharacter: vi.fn(async () => undefined),
    onAddWorldRule: vi.fn(async () => undefined),
    onAddChapter: vi.fn(async () => undefined),
    onAddSection: vi.fn(async () => undefined),
    onRenameChapter: vi.fn(async () => undefined),
    onRenameSection: vi.fn(async () => undefined),
    onMoveDirectoryItem: vi.fn(async () => undefined),
    onUndoDirectoryMove: vi.fn(async () => undefined),
    canUndoDirectoryMove: false,
    directoryBusy: false,
    onDeleteSelection: vi.fn(async () => undefined),
    onDeleteSources: vi.fn(async () => undefined),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Bookshelf {...props} />));
  return { book, props, container, root };
};

const clickDirectoryAction = async (container: HTMLElement, label: string) => {
  const action = [...container.querySelectorAll<HTMLButtonElement>('.directory-object-action')]
    .find((button) => button.title === label);
  if (!action) throw new Error(`Missing directory action: ${label}`);
  await act(async () => action.click());
};

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Input value setter is unavailable.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const dispatchPointer = async (
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  options: { pointerId?: number; clientX?: number; clientY?: number } = {},
) => {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: options.pointerId ?? 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: options.clientX ?? 10,
      clientY: options.clientY ?? 10,
    }));
  });
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('directory organization UI', () => {
  it('exposes direct actions and creates a section only after confirmation', async () => {
    const onAddSection = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onAddSection });
    try {
      const chapterActions = [...container.querySelector('.chapter-object-actions')!.querySelectorAll<HTMLButtonElement>('button')]
        .map((button) => button.title);
      expect(chapterActions).toEqual(['新建小节']);
      expect(container.querySelector('.section-object-actions')).toBeNull();

      await clickDirectoryAction(container, '新建小节');
      const input = container.querySelector<HTMLInputElement>('.new-section-row input');
      expect(input).not.toBeNull();
      expect(onAddSection).not.toHaveBeenCalled();
      await setInputValue(input!, '确认后的新节');
      await act(async () => input!.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(onAddSection).toHaveBeenCalledExactlyOnceWith('chapter-one', '确认后的新节', 'section-two');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('moves chapters by their handle with reference impact and undo, without a toolbar move button', async () => {
    const onMoveDirectoryItem = vi.fn(async () => undefined);
    const onUndoDirectoryMove = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onMoveDirectoryItem, onUndoDirectoryMove, canUndoDirectoryMove: true });
    const originalElementFromPoint = document.elementFromPoint;
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="整理目录"]')?.click());
      expect(container.querySelector('[aria-label="移动所选章节或小节"]')).toBeNull();
      const targetChapter = container.querySelector('[data-directory-chapter-id="chapter-two"]');
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => targetChapter });
      const handle = container.querySelector('.chapter-drag-handle')!;
      await dispatchPointer(handle, 'pointerdown');
      await dispatchPointer(handle, 'pointermove', { clientY: 80 });
      await dispatchPointer(handle, 'pointerup', { clientY: 80 });
      expect(onMoveDirectoryItem).toHaveBeenCalledExactlyOnceWith({ kind: 'chapter', id: 'chapter-one', beforeId: null });
      expect(container.querySelector('.directory-operation-status')?.textContent).toContain('前文资格');
      const undo = container.querySelector<HTMLButtonElement>('.directory-operation-status button');
      expect(undo?.textContent).toContain('撤销');
      await act(async () => undo?.click());
      expect(onUndoDirectoryMove).toHaveBeenCalledExactlyOnceWith();
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
      await act(async () => root.unmount());
    }
  });

  it('leaves the row context menu to the browser', async () => {
    const { container, root } = await renderBookshelf();
    try {
      const row = container.querySelector<HTMLElement>('[data-directory-section-id="section-one"]')!;
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      await act(async () => row.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps action clicks separate from section opening and chapter disclosure', async () => {
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onOpenSection });
    try {
      const chapter = container.querySelector<HTMLDetailsElement>('.chapter-card > details')!;
      await act(async () => { chapter.open = false; });
      await act(async () => chapter.querySelector('.inline-title-display')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })));
      expect(chapter.open).toBe(false);
      expect(chapter.querySelector('.inline-title-input')).not.toBeNull();
      expect(onOpenSection).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each([
    ['.chapter-card summary', ['chapter-one'], ['section-one', 'section-two']],
    ['.section-open', [], ['section-one']],
  ] as const)('confirms toolbar deletion for %s before deleting', async (selector, chapterIds, sectionIds) => {
    const onDeleteSelection = vi.fn(async () => undefined);
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onDeleteSelection, onOpenSection });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="整理目录"]')?.click());
      await act(async () => container.querySelector<HTMLElement>(selector)?.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除所选章节或小节"]')?.click());
      expect(onDeleteSelection).not.toHaveBeenCalled();
      expect(onOpenSection).not.toHaveBeenCalled();
      const dialog = container.querySelector<HTMLDialogElement>('.confirm-dialog')!;
      expect(dialog.open).toBe(true);
      await act(async () => dialog.querySelector<HTMLButtonElement>('.danger-action')?.click());
      expect(onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
        chapterIds: new Set(chapterIds),
        sectionIds: new Set(sectionIds),
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a recent move undoable after a fresh bookshelf mount and retries undo in the same direction', async () => {
    const onUndoDirectoryMove = vi.fn(async () => { throw new Error('undo unavailable'); });
    const onMoveDirectoryItem = vi.fn(async () => undefined);
    const firstMount = await renderBookshelf({ onUndoDirectoryMove, onMoveDirectoryItem, canUndoDirectoryMove: true });
    await act(async () => firstMount.root.unmount());
    const { container, root } = await renderBookshelf({ onUndoDirectoryMove, onMoveDirectoryItem, canUndoDirectoryMove: true });
    try {
      const undo = container.querySelector<HTMLButtonElement>('.directory-operation-status button')!;
      expect(undo.textContent).toContain('撤销');
      await act(async () => undo.click());
      await act(async () => { await Promise.resolve(); });
      const retry = container.querySelector<HTMLButtonElement>('.directory-operation-status button')!;
      expect(retry.textContent).toContain('重试撤销');
      await act(async () => retry.click());
      await act(async () => { await Promise.resolve(); });
      expect(onUndoDirectoryMove).toHaveBeenCalledTimes(2);
      expect(onMoveDirectoryItem).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reuses selection mode for tri-state organization and commits a real drag once', async () => {
    const onMoveDirectoryItem = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onMoveDirectoryItem });
    const originalElementFromPoint = document.elementFromPoint;
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="整理目录"]')?.click());
      expect(container.querySelectorAll('.directory-drag-handle')).toHaveLength(5);
      const chapterSummary = container.querySelector<HTMLDetailsElement>('.chapter-card summary')!;
      await act(async () => chapterSummary.click());
      expect(chapterSummary.getAttribute('aria-checked')).toBe('true');

      const targetChapter = container.querySelector<HTMLElement>('[data-directory-chapter-id="chapter-two"]')!;
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => targetChapter });
      const sectionHandle = container.querySelector<HTMLButtonElement>('.section-drag-handle')!;
      await dispatchPointer(sectionHandle, 'pointerdown', { pointerId: 8, clientX: 20, clientY: 20 });
      await dispatchPointer(sectionHandle, 'pointermove', { pointerId: 8, clientX: 40, clientY: 80 });
      await dispatchPointer(sectionHandle, 'pointerup', { pointerId: 8, clientX: 40, clientY: 80 });
      expect(onMoveDirectoryItem).toHaveBeenCalledExactlyOnceWith({ kind: 'section', id: 'section-one', targetChapterId: 'chapter-two', beforeId: null });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
      await act(async () => root.unmount());
    }
  });

  it('does not submit a composing new-section candidate on Enter', async () => {
    const onAddSection = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onAddSection });
    try {
      await clickDirectoryAction(container, '新建小节');
      const input = container.querySelector<HTMLInputElement>('.new-section-row input')!;
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await setInputValue(input, '候选中的字');
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true })));
      expect(onAddSection).not.toHaveBeenCalled();
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await act(async () => input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(onAddSection).toHaveBeenCalledExactlyOnceWith('chapter-one', '候选中的字', 'section-two');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(['character', 'world'] as const)('reorders %s sources through the book save recipe and keeps selection separate', async (kind) => {
    const book = makeBook();
    book.characters = ['a', 'b', 'c'].map((id) => ({ id: `character-${id}`, name: id, title: id, role: '角色', content: id, includeInPrompt: true }));
    book.worldRules = ['a', 'b', 'c'].map((id) => ({ id: `world-${id}`, title: id, content: id, includeInPrompt: true }));
    const onBookChange = vi.fn(async (_recipe: (current: Book) => Book) => undefined);
    const { container, root } = await renderBookshelf({ book, onBookChange, openBookSettingsRequest: 1 });
    const originalElementFromPoint = document.elementFromPoint;
    const label = kind === 'character' ? '角色卡' : '世界观设定';
    try {
      expect(container.querySelectorAll('.source-drag-handle')).toHaveLength(0);
      await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="选择${label}"]`)!.click());
      const row = container.querySelector<HTMLElement>(`[data-source-id="${kind}-a"]`)!;
      const handle = row.querySelector<HTMLButtonElement>('.source-drag-handle')!;
      await act(async () => row.querySelector<HTMLButtonElement>('.source-open-row')!.click());
      const target = container.querySelector(`[data-source-id="${kind}-c"]`)!;
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
      await dispatchPointer(handle, 'pointerdown');
      await dispatchPointer(handle, 'pointermove', { clientY: 80 });
      await dispatchPointer(handle, 'pointerup', { clientY: 80 });
      expect(onBookChange).toHaveBeenCalledTimes(1);
      const recipe = onBookChange.mock.calls[0]![0];
      const latest = { ...book, title: '另一次编辑后的书名' };
      const saved = recipe(latest);
      const key = kind === 'character' ? 'characters' : 'worldRules';
      expect(saved[key].map((item) => item.id)).toEqual([`${kind}-b`, `${kind}-c`, `${kind}-a`]);
      expect(saved[key][2]).toBe(book[key][0]);
      expect(saved.title).toBe(latest.title);
      expect(saved[kind === 'character' ? 'worldRules' : 'characters']).toBe(book[kind === 'character' ? 'worldRules' : 'characters']);
      expect(saved.chapters).toBe(book.chapters);
      expect(() => recipe({ ...book, id: 'another-book' })).toThrow('书籍已切换');
      expect(row.querySelector('.source-open-row')?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="退出${label}选择"]`)!.click());
      expect(container.querySelectorAll('.source-drag-handle')).toHaveLength(0);
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
      await act(async () => root.unmount());
    }
  });

  it('cancels source drags, rejects cross-list drops, and reports failed saves before a keyboard retry', async () => {
    const book = makeBook();
    book.characters = ['a', 'b'].map((id) => ({ id, name: id, title: id, role: '', content: '', includeInPrompt: true }));
    book.worldRules = [{ id: 'world', title: '设定', content: '', includeInPrompt: true }];
    const onBookChange = vi.fn(async () => undefined).mockRejectedValueOnce(new Error('测试保存失败'));
    const { container, root } = await renderBookshelf({ book, onBookChange, openBookSettingsRequest: 1 });
    const originalElementFromPoint = document.elementFromPoint;
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择角色卡"]')!.click());
      const handle = container.querySelector<HTMLButtonElement>('.source-drag-handle')!;
      let target = container.querySelector('[data-source-id="b"]');
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
      await dispatchPointer(handle, 'pointerdown');
      await dispatchPointer(handle, 'pointermove', { clientY: 80 });
      await dispatchPointer(handle, 'pointercancel', { clientY: 80 });
      expect(onBookChange).not.toHaveBeenCalled();
      target = container.querySelector('[data-source-id="world"]');
      await dispatchPointer(handle, 'pointerdown');
      await dispatchPointer(handle, 'pointermove', { clientY: 80 });
      await dispatchPointer(handle, 'pointerup', { clientY: 80 });
      expect(onBookChange).not.toHaveBeenCalled();
      target = container.querySelector('[data-source-id="b"]');
      await dispatchPointer(handle, 'pointerdown');
      await dispatchPointer(handle, 'pointermove', { clientY: 80 });
      await dispatchPointer(handle, 'pointerup', { clientY: 80 });
      expect(container.querySelector('.source-move-error')?.textContent).toContain('测试保存失败');
      expect(handle.disabled).toBe(false);
      await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })));
      expect(onBookChange).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.source-move-error')).toBeNull();
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
      await act(async () => root.unmount());
    }
  });
});
