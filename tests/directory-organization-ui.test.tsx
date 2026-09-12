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

const clickMenuAction = async (container: HTMLElement, label: string) => {
  const action = [...container.querySelectorAll<HTMLButtonElement>('.directory-object-menu-action')]
    .find((button) => button.textContent?.includes(label));
  if (!action) throw new Error(`Missing directory menu action: ${label}`);
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
  it('keeps object actions together and creates a section only after confirmation', async () => {
    const onAddSection = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onAddSection });
    try {
      await act(async () => container.querySelector<HTMLDetailsElement>('.chapter-object-menu')?.querySelector('summary')?.click());
      const chapterActions = [...container.querySelectorAll<HTMLButtonElement>('.chapter-object-menu .directory-object-menu-action')]
        .map((button) => button.textContent);
      expect(chapterActions).toEqual(expect.arrayContaining(['重命名', '新建小节', '移动到…', '整理顺序', '删除']));
      const sectionActions = [...container.querySelectorAll<HTMLButtonElement>('.section-object-menu .directory-object-menu-action')]
        .map((button) => button.textContent);
      expect(sectionActions).toEqual(expect.arrayContaining(['重命名', '在下方新建小节', '移动到…', '整理顺序', '删除']));

      await clickMenuAction(container, '新建小节');
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

  it('offers click based chapter movement with reference impact and undo', async () => {
    const onMoveDirectoryItem = vi.fn(async () => undefined);
    const onUndoDirectoryMove = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ onMoveDirectoryItem, onUndoDirectoryMove, canUndoDirectoryMove: true });
    try {
      await act(async () => container.querySelector<HTMLDetailsElement>('.chapter-object-menu')?.querySelector('summary')?.click());
      await clickMenuAction(container, '移动到…');
      const dialog = container.querySelector<HTMLDialogElement>('.directory-move-dialog')!;
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain('前文资格');
      const position = dialog.querySelector('select') as unknown as HTMLSelectElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(position, '');
        position.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
      expect(onMoveDirectoryItem).toHaveBeenCalledExactlyOnceWith({ kind: 'chapter', id: 'chapter-one', beforeId: null });
      const undo = container.querySelector<HTMLButtonElement>('.directory-operation-status button');
      expect(undo?.textContent).toContain('撤销');
      await act(async () => undo?.click());
      expect(onUndoDirectoryMove).toHaveBeenCalledExactlyOnceWith();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('opens the same object menu from a row context menu', async () => {
    const { container, root } = await renderBookshelf();
    try {
      const row = container.querySelector<HTMLElement>('[data-directory-section-id="section-one"]')!;
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      await act(async () => row.dispatchEvent(event));
      const menu = row.querySelector('.section-object-menu') as unknown as HTMLDetailsElement;
      expect(event.defaultPrevented).toBe(true);
      expect(menu.open).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('opens the object menu on a touch hold and suppresses the release click', async () => {
    vi.useFakeTimers();
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onOpenSection });
    try {
      const row = container.querySelector<HTMLElement>('[data-directory-section-id="section-one"]')!;
      const sectionOpen = row.querySelector<HTMLButtonElement>('.section-open')!;
      await act(async () => sectionOpen.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 4,
        pointerType: 'touch',
        isPrimary: true,
        clientX: 80,
        clientY: 350,
      })));
      await act(async () => { vi.advanceTimersByTime(520); });
      expect((row.querySelector('.section-object-menu') as unknown as HTMLDetailsElement).open).toBe(true);
      await act(async () => sectionOpen.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 4,
        pointerType: 'touch',
        isPrimary: true,
        clientX: 80,
        clientY: 350,
      })));
      await act(async () => sectionOpen.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      expect(onOpenSection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
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
      const sectionMenu = container.querySelector<HTMLDetailsElement>('.section-object-menu')!;
      await act(async () => sectionMenu.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await clickMenuAction(container, '在下方新建小节');
      const input = container.querySelector<HTMLInputElement>('.new-section-row input')!;
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await setInputValue(input, '候选中的字');
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true })));
      expect(onAddSection).not.toHaveBeenCalled();
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await act(async () => input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(onAddSection).toHaveBeenCalledExactlyOnceWith('chapter-one', '候选中的字', 'section-one');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
