// @vitest-environment jsdom

import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bookshelf } from '../src/components/Bookshelf';
import { Writer } from '../src/components/Writer';
import type { Book, SectionBlock } from '../src/types';

const makeBook = (id: string, blocks: SectionBlock[] = []): Book => ({
  id,
  title: '测试书',
  writingBrief: '',
  characters: [{
    id: 'character-one', title: '角色一', name: '角色一', role: '引路人', content: '', includeInPrompt: true,
  }],
  worldRules: [{ id: 'world-one', title: '设定一', content: '', includeInPrompt: true }],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'chapter-one',
    title: '第一章',
    sections: [{ id: 'section-one', title: '第一节', content: blocks.map((block) => block.content).join('\n\n'), blocks }],
  }],
  branches: [],
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const writerProps = (book: Book): ComponentProps<typeof Writer> => ({
  book,
  section: book.chapters[0]!.sections[0],
  chapterTitle: '第一章',
  mode: 'author',
  selectedCharacterId: '',
  instruction: '',
  authorNote: '',
  busy: false,
  status: '',
  generationState: 'idle',
  contextPlan: null,
  contextPlanError: '',
  contextCompositionOpen: false,
  contextToolsOpen: false,
  providerName: 'Fake',
  modelId: 'fake-model',
  onBack: vi.fn(),
  onOpenBookSettings: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenContextComposition: vi.fn(),
  onOpenContextTools: vi.fn(),
  onCancelGeneration: vi.fn(),
  onModeChange: vi.fn(),
  onCharacterChange: vi.fn(),
  onInstructionChange: vi.fn(),
  onAuthorNoteChange: vi.fn(),
  onSectionBlocksChange: vi.fn(),
  onDeleteSectionBlock: vi.fn(async () => undefined),
  onRegenerateBlock: vi.fn(),
  onSectionTitleChange: vi.fn(async () => undefined),
  onGenerate: vi.fn(),
});

const render = async (node: ReactNode) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root };
};

const rerender = async (root: Root, node: ReactNode) => {
  await act(async () => root.render(node));
};

const setScrollGeometry = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
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
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('writer scroll interactions', () => {
  it('aligns the newly submitted user block to the top after generation completes', async () => {
    const initialBlocks: SectionBlock[] = [
      { id: 'old-user', kind: 'user', content: '旧输入' },
      { id: 'old-assistant', kind: 'assistant', content: '旧续写' },
    ];
    const initialBook = makeBook('book-align', initialBlocks);
    const { container, root } = await render(<Writer {...writerProps(initialBook)} />);
    const manuscript = container.querySelector<HTMLElement>('.manuscript-wrap')!;
    setScrollGeometry(manuscript, 700, 300);
    manuscript.scrollTop = 400;

    const rect = (top: number) => ({
      x: 0, y: top, top, right: 100, bottom: top + 20, left: 0, width: 100, height: 20,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('manuscript-wrap')) return rect(100);
      if (this.dataset.blockId === 'new-user') return rect(230);
      return rect(0);
    });

    await rerender(root, <Writer {...writerProps(initialBook)} generationState="generating" />);
    const completedBook = makeBook('book-align', [
      ...initialBlocks,
      { id: 'new-user', kind: 'user', content: '本轮输入' },
      { id: 'new-assistant', kind: 'assistant', content: 'Provider 续写' },
    ]);
    await rerender(root, <Writer {...writerProps(completedBook)} generationState="idle" />);

    expect(manuscript.scrollTop).toBe(530);
    expect(Number.parseFloat(container.querySelector<HTMLElement>('.manuscript-tail-space')?.style.height ?? '0')).toBeGreaterThan(0);
    await act(async () => root.unmount());
  });

  it('restores the section position after leaving and offers a jump to the bottom', async () => {
    const book = makeBook('book-restore', [{ id: 'block-one', kind: 'assistant', content: '长正文' }]);
    const { container, root } = await render(<Writer {...writerProps(book)} />);
    let manuscript = container.querySelector<HTMLElement>('.manuscript-wrap')!;
    setScrollGeometry(manuscript, 1_000, 300);
    manuscript.scrollTop = 260;
    await act(async () => manuscript.dispatchEvent(new Event('scroll', { bubbles: true })));

    expect(container.querySelector('button[aria-label="跳到正文末尾"]')).not.toBeNull();
    await rerender(root, <div>其他页面</div>);
    await rerender(root, <Writer {...writerProps(book)} />);

    manuscript = container.querySelector<HTMLElement>('.manuscript-wrap')!;
    expect(manuscript.scrollTop).toBe(260);
    setScrollGeometry(manuscript, 1_000, 300);
    await act(async () => manuscript.dispatchEvent(new Event('scroll', { bubbles: true })));
    const bottomButton = container.querySelector<HTMLButtonElement>('button[aria-label="跳到正文末尾"]')!;
    await act(async () => bottomButton.click());

    expect(manuscript.scrollTop).toBe(700);
    expect(container.querySelector('button[aria-label="跳到正文末尾"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

describe('source selection visuals', () => {
  it('reuses the square directory checkbox for character and world selections', async () => {
    const book = makeBook('book-source-selection');
    const props: ComponentProps<typeof Bookshelf> = {
      book,
      library: [{ id: book.id, title: book.title, updatedAt: book.updatedAt }],
      selectedSectionId: 'section-one',
      openNewBookRequest: 0,
      onNewBookOpened: vi.fn(),
      openBookSettingsRequest: 1,
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
      onDeleteSelection: vi.fn(async () => undefined),
      onDeleteSources: vi.fn(async () => undefined),
      onPlotOutlineChange: vi.fn(),
      onWritingBriefChange: vi.fn(),
      onCharacterChange: vi.fn(),
      onWorldRuleChange: vi.fn(),
    };
    const { container, root } = await render(<Bookshelf {...props} />);

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="选择角色卡"]')!.click());
    const characterRow = container.querySelector<HTMLButtonElement>('button[aria-label="选择角色卡：角色一"]')!;
    expect(characterRow.querySelector('.directory-selection-checkbox')?.getAttribute('data-state')).toBe('unchecked');
    await act(async () => characterRow.click());
    expect(characterRow.querySelector('.directory-selection-checkbox')?.getAttribute('data-state')).toBe('checked');

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="退出角色卡选择"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="选择世界观设定"]')!.click());
    const worldRow = container.querySelector<HTMLButtonElement>('button[aria-label="选择世界观设定：设定一"]')!;
    expect(worldRow.querySelector('.directory-selection-checkbox')?.getAttribute('data-state')).toBe('unchecked');
    await act(async () => worldRow.click());
    expect(worldRow.querySelector('.directory-selection-checkbox')?.getAttribute('data-state')).toBe('checked');

    await act(async () => root.unmount());
  });
});
