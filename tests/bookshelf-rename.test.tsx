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
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bookshelf directory title interactions', () => {
  it('keeps title clicks local while opening a section from the rest of its row', async () => {
    const onOpenSection = vi.fn();
    const { container, root } = await renderBookshelf({ onOpenSection });
    try {
      const details = container.querySelector<HTMLDetailsElement>('.chapter-card details')!;
      const chapterTitle = container.querySelector<HTMLButtonElement>('.chapter-inline-title .inline-title-display')!;
      const sectionTitle = container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!;

      await act(async () => chapterTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      await act(async () => sectionTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      expect(onOpenSection).not.toHaveBeenCalled();
      expect(details.open).toBe(true);

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
      await act(async () => chapterTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      const chapterInput = container.querySelector<HTMLInputElement>('.chapter-inline-title .inline-title-input')!;
      await setInputValue(chapterInput, '重命名章节');
      await act(async () => chapterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(onRenameChapter).toHaveBeenCalledExactlyOnceWith('chapter-one', '重命名章节');
      expect(book.chapters[0]!.id).toBe('chapter-one');

      const sectionTitle = container.querySelector<HTMLButtonElement>('.section-inline-title .inline-title-display')!;
      await act(async () => sectionTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
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
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
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
