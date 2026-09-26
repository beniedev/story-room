// @vitest-environment jsdom

import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bookshelf } from '../src/components/Bookshelf';
import type { Book } from '../src/types';

const makeBook = (): Book => ({
  id: 'book-inline-directory',
  title: '测试书',
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

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable.');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

describe('bookshelf dialog and settings boundaries', () => {
  it('retains the rename draft through parent updates and failed saves, then restores menu focus', async () => {
    vi.useFakeTimers();
    let rejectSave: (error: Error) => void = () => undefined;
    const onBookChange = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const { book, props, container, root } = await renderBookshelf({ onBookChange });
    try {
      const trigger = container.querySelector<HTMLElement>('.book-actions-trigger')!;
      await act(async () => trigger.focus());
      await act(async () => container.querySelector<HTMLButtonElement>('.book-menu-action')!.click());
      const dialog = container.querySelector<HTMLDialogElement>('.name-dialog')!;
      const input = dialog.querySelector<HTMLInputElement>('input')!;
      expect(dialog.open).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(book.title.length);
      await setInputValue(input, '未保存的新书名');
      await act(async () => root.render(<Bookshelf {...props} book={{ ...book, title: '外部更新的书名' }} />));
      expect(input.value).toBe('未保存的新书名');
      await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(dialog.getAttribute('aria-busy')).toBe('true');
      await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
      expect(dialog.open).toBe(true);
      await act(async () => rejectSave(new Error('synthetic rename failure')));
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('synthetic rename failure');
      await act(async () => dialog.querySelector<HTMLButtonElement>('.dialog-operation-status button')!.click());
      expect(dialog.querySelector<HTMLInputElement>('input')?.value).toBe('未保存的新书名');
      onBookChange.mockImplementation(async () => undefined);
      await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(dialog.textContent).toContain('保存成功');
      expect(dialog.open).toBe(true);
      await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
      expect(dialog.open).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps selected directory IDs after a failed deletion and clears selection only after success', async () => {
    const onDeleteSelection = vi.fn(async (): Promise<void> => { throw new Error('synthetic delete failure'); });
    const { container, root } = await renderBookshelf({ onDeleteSelection });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="整理目录"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择小节第一节"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除所选章节或小节"]')!.click());
      const dialog = container.querySelector<HTMLDialogElement>('.confirm-dialog')!;
      await act(async () => dialog.querySelector<HTMLButtonElement>('.danger-action')!.click());
      expect(onDeleteSelection).toHaveBeenCalledWith({ chapterIds: new Set(), sectionIds: new Set(['section-one']) });
      expect(dialog.open).toBe(true);
      expect(container.querySelector('[aria-label="取消选择小节第一节"]')).not.toBeNull();
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('synthetic delete failure');
      await act(async () => dialog.querySelector<HTMLButtonElement>('.dialog-operation-status button')!.click());
      onDeleteSelection.mockImplementation(async () => undefined);
      await act(async () => dialog.querySelector<HTMLButtonElement>('.danger-action')!.click());
      expect(dialog.textContent).toContain('删除成功');
      expect(container.querySelector('[aria-label="整理目录"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="删除所选章节或小节"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a guidance draft during prop updates and recreates it from persisted values after navigation closes', async () => {
    const book = { ...makeBook(), writingBrief: '已保存风格' };
    const onBookChange = vi.fn(async () => { throw new Error('synthetic settings failure'); });
    const { props, container, root } = await renderBookshelf({ book, onBookChange });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开本书设定"]')!.click());
      const drawer = container.querySelector<HTMLDialogElement>('.book-settings-drawer')!;
      await act(async () => drawer.querySelector<HTMLButtonElement>('.guide-link-row')!.click());
      const input = drawer.querySelector<HTMLTextAreaElement>('.guide-editor-field textarea')!;
      await act(async () => {
        input.value = '本地未保存风格';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const updatedBook = { ...book, writingBrief: '外部保存风格' };
      await act(async () => root.render(<Bookshelf {...props} book={updatedBook} />));
      expect(drawer.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('本地未保存风格');
      expect(onBookChange).not.toHaveBeenCalled();
      await act(async () => drawer.querySelector<HTMLButtonElement>('[aria-label="保存并加载写作风格指导"]')!.click());
      const inner = drawer.querySelector<HTMLDialogElement>('.confirm-dialog')!;
      await act(async () => inner.querySelector<HTMLButtonElement>('.primary-action')!.click());
      expect(inner.querySelector('[role="alert"]')?.textContent).toContain('synthetic settings failure');
      expect(drawer.open).toBe(true);
      await act(async () => inner.dispatchEvent(new Event('cancel', { cancelable: true })));
      expect(inner.open).toBe(false);
      expect(drawer.open).toBe(true);
      expect(drawer.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('本地未保存风格');
      await act(async () => drawer.querySelector<HTMLButtonElement>('[aria-label="关闭本书设定"]')!.click());
      expect(drawer.querySelector('.guide-editor-page')).toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开本书设定"]')!.click());
      await act(async () => drawer.querySelector<HTMLButtonElement>('.guide-link-row')!.click());
      expect(drawer.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('外部保存风格');
      await act(async () => drawer.querySelector<HTMLButtonElement>('[aria-label="返回本书设定"]')!.click());
      await act(async () => drawer.querySelectorAll<HTMLButtonElement>('.guide-link-row')[1]!.click());
      expect(drawer.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('resets directory and source selection when the book changes while keeping a read-only drawer navigable', async () => {
    const book = makeBook();
    book.characters = [{ id: 'character-one', title: '角色一', name: '角色一', role: '', content: '', includeInPrompt: true }];
    const { props, container, root } = await renderBookshelf({ book });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="整理目录"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择小节第一节"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开本书设定"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择角色卡"]')!.click());
      const next = { ...makeBook(), id: 'book-other', title: '另一本合成书' };
      await act(async () => root.render(<Bookshelf {...props} book={next} canEdit={false} />));
      expect(container.querySelector('[aria-label="完成整理目录"]')).toBeNull();
      expect(container.querySelector('[aria-label="退出角色卡选择"]')).toBeNull();
      expect(container.querySelector<HTMLButtonElement>('[aria-label="新建角色卡"]')?.disabled).toBe(true);
      await act(async () => container.querySelector<HTMLButtonElement>('.guide-link-row')!.click());
      expect(container.querySelector<HTMLTextAreaElement>('.guide-editor-field textarea')?.readOnly).toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[aria-label="保存并加载写作风格指导"]')?.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps inline creation through prop refresh and clears the draft on a book switch', async () => {
    const { book, props, container, root } = await renderBookshelf();
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="在第一章中新建小节"]')!.click());
      const input = container.querySelector<HTMLInputElement>('.inline-new-section input')!;
      await setInputValue(input, '未保存小节');
      await act(async () => root.render(<Bookshelf {...props} book={{ ...book, title: '更新的合成书' }} />));
      expect(container.querySelector<HTMLInputElement>('.inline-new-section input')?.value).toBe('未保存小节');
      await act(async () => root.render(<Bookshelf {...props} book={{ ...makeBook(), id: 'book-other' }} />));
      expect(container.querySelector('.inline-new-section')).toBeNull();
      expect(props.onAddSection).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bookshelf directory title interactions', () => {
  it('opens a title once after the local window, but opens the rest of the row immediately', async () => {
    vi.useFakeTimers();
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onOpenSection });
    try {
      const details = container.querySelector<HTMLDetailsElement>('.chapter-card details')!;
      const chapterTitle = container.querySelector<HTMLButtonElement>('.chapter-inline-title .inline-title-display')!;
      const sectionTitle = container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!;

      await act(async () => sectionTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      expect(onOpenSection).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(onOpenSection).toHaveBeenCalledExactlyOnceWith('section-one');
      onOpenSection.mockClear();
      expect(details.open).toBe(true);

      await act(async () => chapterTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
      expect(details.open).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(details.open).toBe(false);

      const sectionOpen = container.querySelector<HTMLButtonElement>('.section-open')!;
      await act(async () => sectionOpen.click());
      expect(onOpenSection).toHaveBeenCalledExactlyOnceWith('section-one');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renames chapters and sections in place without changing their IDs', async () => {
    const book = makeBook();
    const onRenameChapter = vi.fn(async () => undefined);
    const onRenameSection = vi.fn(async () => undefined);
    const { container, root } = await renderBookshelf({ book, onRenameChapter, onRenameSection });
    try {
      const chapterTitle = container.querySelector<HTMLButtonElement>('.chapter-inline-title .inline-title-display')!;
      await act(async () => {
        chapterTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
        chapterTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
      });
      const chapterInput = container.querySelector<HTMLInputElement>('.chapter-inline-title .inline-title-input')!;
      await setInputValue(chapterInput, '重命名章节');
      await act(async () => chapterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(onRenameChapter).toHaveBeenCalledExactlyOnceWith('chapter-one', '重命名章节');
      expect(book.chapters[0]!.id).toBe('chapter-one');

      const sectionTitle = container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!;
      await act(async () => {
        sectionTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
        sectionTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
      });
      const sectionInput = container.querySelector<HTMLInputElement>('.section-inline-title .inline-title-input')!;
      await setInputValue(sectionInput, '重命名小节');
      await act(async () => sectionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(onRenameSection).toHaveBeenCalledExactlyOnceWith('chapter-one', 'section-one', '重命名小节');
      expect(book.chapters[0]!.sections[0]!.id).toBe('section-one');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps selection mode as whole-row selection and blocks title editing', async () => {
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onOpenSection });
    try {
      const selectionToggle = container.querySelector<HTMLButtonElement>('button[aria-label="整理目录"]')!;
      const deleteButton = () => container.querySelector<HTMLButtonElement>('[aria-label="删除所选章节或小节"]');
      expect(deleteButton()).toBeNull();
      await act(async () => selectionToggle.click());
      expect(deleteButton()?.disabled).toBe(true);
      expect(container.querySelector('.chapter-inline-title')).toBeNull();
      expect(container.querySelector('.section-inline-title')).toBeNull();

      const sectionOpen = container.querySelector<HTMLButtonElement>('.section-open')!;
      await act(async () => sectionOpen.click());
      expect(onOpenSection).not.toHaveBeenCalled();
      expect(sectionOpen.getAttribute('role')).toBe('checkbox');
      expect(sectionOpen.getAttribute('aria-checked')).toBe('true');
      expect(deleteButton()?.disabled).toBe(false);
      await act(async () => sectionOpen.click());
      expect(deleteButton()?.disabled).toBe(true);
      await act(async () => selectionToggle.click());
      expect(deleteButton()).toBeNull();
      expect(selectionToggle.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps the reader read-only while allowing section opening', async () => {
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ canEdit: false, onOpenSection });
    try {
      const chapterTitle = container.querySelector<HTMLButtonElement>('.chapter-inline-title .inline-title-display')!;
      const sectionTitle = container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!;
      expect(chapterTitle.disabled).toBe(true);
      expect(sectionTitle.disabled).toBe(true);
      await act(async () => chapterTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      await act(async () => sectionTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(container.querySelector('.inline-title-input')).toBeNull();

      await act(async () => container.querySelector<HTMLButtonElement>('.section-open')!.click());
      expect(onOpenSection).toHaveBeenCalledExactlyOnceWith('section-one');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps the failed title input available for retry', async () => {
    const onRenameSection = vi.fn(async () => { throw new Error('synthetic failure'); });
    const { container, root } = await renderBookshelf({ onRenameSection });
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })));
      const input = container.querySelector<HTMLInputElement>('.section-inline-title .inline-title-input')!;
      await setInputValue(input, '待重试标题');
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector<HTMLInputElement>('.section-inline-title .inline-title-input')?.value).toBe('待重试标题');
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
