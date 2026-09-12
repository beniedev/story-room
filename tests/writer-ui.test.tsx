// @vitest-environment jsdom

import { act, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bookshelf } from '../src/components/Bookshelf';
import { Writer } from '../src/components/Writer';
import { adoptCandidate, editCandidate } from '../src/answerCandidates';
import { blocksAsContent, sectionBlocks } from '../src/components/shared/sectionContent';
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

type ControlledWriterProps = {
  initialBook: Book;
  onCandidateSelect?: (blockId: string, candidateId: string) => void;
} & Partial<Omit<ComponentProps<typeof Writer>,
  'book' | 'section' | 'onSelectCandidate' | 'onSectionBlocksChange' | 'onDeleteSectionBlock'>>;

const ControlledWriter = ({ initialBook, onCandidateSelect, ...overrides }: ControlledWriterProps) => {
  const sectionId = initialBook.chapters[0]!.sections[0]!.id;
  const [book, setBook] = useState(initialBook);

  const updateSection = (current: Book, update: (section: Book['chapters'][number]['sections'][number]) => Book['chapters'][number]['sections'][number]) => ({
    ...current,
    chapters: current.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.map((section) => section.id === sectionId ? update(section) : section),
    })),
  });

  const onSelectCandidate = (blockId: string, candidateId: string) => {
    setBook((current) => updateSection(current, (section) => {
      const blocks = sectionBlocks(section).map((block) => block.id === blockId
        ? adoptCandidate(block, candidateId)
        : block);
      return { ...section, blocks, content: blocksAsContent(blocks) };
    }));
    onCandidateSelect?.(blockId, candidateId);
  };

  const onSectionBlocksChange = (blocks: SectionBlock[]) => {
    setBook((current) => updateSection(current, (section) => {
      const previousBlocks = new Map(sectionBlocks(section).map((block) => [block.id, block]));
      const nextBlocks = blocks.map((block) => {
        const previous = previousBlocks.get(block.id);
        if (block.kind !== 'assistant'
          || !block.adoptedCandidateId
          || !previous
          || previous.content === block.content) return block;
        return editCandidate(block, block.adoptedCandidateId, block.content);
      });
      return { ...section, blocks: nextBlocks, content: blocksAsContent(nextBlocks) };
    }));
  };

  const onDeleteSectionBlock = async (blockId: string) => {
    setBook((current) => updateSection(current, (section) => {
      const blocks = sectionBlocks(section).filter((block) => block.id !== blockId);
      return { ...section, blocks, content: blocksAsContent(blocks) };
    }));
  };

  return (
    <Writer
      {...writerProps(book)}
      {...overrides}
      onSelectCandidate={onSelectCandidate}
      onSectionBlocksChange={onSectionBlocksChange}
      onDeleteSectionBlock={onDeleteSectionBlock}
    />
  );
};

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

const setControlValue = async (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Control value setter is unavailable.');
  await act(async () => {
    setter.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

describe('writer title editing', () => {
  it('routes inline chapter and section edits to their save callbacks and respects read-only mode', async () => {
    const book = makeBook('book-inline-titles');
    const onChapterTitleChange = vi.fn(async () => undefined);
    const onSectionTitleChange = vi.fn(async () => undefined);
    const props = { ...writerProps(book), onChapterTitleChange, onSectionTitleChange };
    const { container, root } = await render(<Writer {...props} />);
    try {
      expect(container.querySelector('.writer-tool-actions [aria-label="修改小节名称"]')).toBeNull();
      for (const [original, next, callback] of [
        ['第一章', 'Chapter revised', onChapterTitleChange],
        ['第一节', 'Section revised', onSectionTitleChange],
      ] as const) {
        const title = [...container.querySelectorAll<HTMLButtonElement>('.writer-section-title button')]
          .find((button) => button.textContent === original)!;
        await act(async () => title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        const input = container.querySelector<HTMLInputElement>('.writer-section-title input')!;
        expect(input.value).toBe(original);
        await setControlValue(input, next);
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(callback).toHaveBeenCalledExactlyOnceWith(next);
        expect(container.querySelector('.writer-section-title input')).toBeNull();
      }
      await rerender(root, <Writer {...props} canEdit={false} />);
      for (const title of container.querySelectorAll<HTMLButtonElement>('.writer-section-title button')) {
        expect(title.disabled).toBe(true);
        await act(async () => title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      }
      expect(container.querySelector('.writer-section-title input')).toBeNull();
      expect(onChapterTitleChange).toHaveBeenCalledTimes(1);
      expect(onSectionTitleChange).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
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

describe('section writing guidance', () => {
  it('stays available and editable in character mode', async () => {
    const book = makeBook('book-section-guidance');
    const onAuthorNoteChange = vi.fn();
    const { container, root } = await render(
      <Writer
        {...writerProps(book)}
        mode="character"
        selectedCharacterId="character-one"
        authorNote="保持这一节的雨声。"
        onAuthorNoteChange={onAuthorNoteChange}
      />,
    );

    const note = container.querySelector<HTMLTextAreaElement>('#author-note-input');
    expect(note?.value).toBe('保持这一节的雨声。');
    expect(note?.closest('label')?.textContent).toContain('在作者和扮演模式中生效');
    await setControlValue(note!, '让雨声逐渐靠近。');
    expect(onAuthorNoteChange).toHaveBeenCalledWith('让雨声逐渐靠近。');

    await act(async () => root.unmount());
  });
});

describe('answer candidates and end-of-input response', () => {
  it('keeps the pending-input response action disabled for readers', async () => {
    const book = makeBook('book-reader-response', [{ id: 'pending-input', kind: 'user', content: 'Waiting for an answer.' }]);
    const onGenerateForBlock = vi.fn();
    const { container, root } = await render(<Writer {...writerProps(book)} canEdit={false} onGenerateForBlock={onGenerateForBlock} />);
    const button = container.querySelector<HTMLButtonElement>('.respond-to-input-button')!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onGenerateForBlock).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  const candidateBook = makeBook('book-candidates', [{
    id: 'answer-block',
    kind: 'assistant',
    content: '采用的一版',
    candidates: [
      { id: 'candidate-one', content: '采用的一版', sourceSignature: 'source-a' },
      { id: 'candidate-two', content: '正在预览的二版', sourceSignature: 'source-b' },
    ],
    adoptedCandidateId: 'candidate-one',
  }]);

  it('shows a response action only below the final non-empty user block', async () => {
    const onGenerateForBlock = vi.fn();
    const book = makeBook('book-respond', [{ id: 'last-input', kind: 'user', content: '已发送输入' }]);
    const { container, root } = await render(<Writer {...writerProps(book)} instruction="下一轮草稿" onGenerateForBlock={onGenerateForBlock} />);

    const responseButton = container.querySelector<HTMLButtonElement>('.respond-to-input-button');
    expect(responseButton?.textContent).toBe('生成回答');
    await act(async () => responseButton?.click());
    expect(onGenerateForBlock).toHaveBeenCalledWith('last-input');
    expect(container.querySelector<HTMLTextAreaElement>('#writing-instruction')?.value).toBe('下一轮草稿');

    await rerender(root, <Writer {...writerProps(makeBook('book-respond', [
      { id: 'last-input', kind: 'user', content: '已发送输入' },
      { id: 'answer', kind: 'assistant', content: '回答' },
    ]))} onGenerateForBlock={onGenerateForBlock} />);
    expect(container.querySelector('.respond-to-input-button')).toBeNull();
    await act(async () => root.unmount());
  });

  it('selects a candidate with the arrow and updates the current manuscript immediately', async () => {
    const onCandidateSelect = vi.fn();
    const { container, root } = await render(
      <ControlledWriter initialBook={candidateBook} onCandidateSelect={onCandidateSelect} />,
    );
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="下一版回答候选"]');
    expect(next).not.toBeNull();
    await act(async () => next?.click());

    const manuscriptBlock = container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block');
    expect(manuscriptBlock?.textContent).toContain('正在预览的二版');
    expect(manuscriptBlock?.textContent).not.toContain('采用的一版');
    expect(onCandidateSelect).toHaveBeenCalledWith('answer-block', 'candidate-two');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).toContain('2 / 2');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).not.toContain('来源条件已变化');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).not.toContain('source-a');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).not.toContain('source-b');
    await act(async () => root.unmount());
  });

  it('keeps candidate source metadata out of the navigation copy', async () => {
    const { container, root } = await render(<Writer {...writerProps(candidateBook)} />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    const strip = container.querySelector('.answer-candidate-strip');
    expect(strip?.textContent).toContain('1 / 2');
    expect(strip?.textContent).not.toContain('来源条件已变化');
    expect(strip?.textContent).not.toContain('source-a');
    expect(strip?.textContent).not.toContain('source-b');
    await act(async () => root.unmount());
  });

  it('edits and deletes the current manuscript block through parent state', async () => {
    const { container, root } = await render(<ControlledWriter initialBook={candidateBook} />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="编辑所选片段"]')?.click());
    const editor = container.querySelector<HTMLTextAreaElement>('#block-editor-textarea');
    expect(editor?.value).toBe('采用的一版');
    await setControlValue(editor!, '编辑后的当前正文');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="完成编辑并返回正文"]')?.click());
    expect(container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.textContent)
      .toContain('编辑后的当前正文');

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="删除所选片段"]')?.click());
    expect(container.querySelector('.confirm-dialog')?.textContent).toContain('删除当前回答候选');
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('删除整段（含全部候选）'))?.click());
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-block-id="answer-block"]')).toBeNull();
    expect(container.querySelector('.empty-manuscript')?.textContent).toContain('本节还没有正文');
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
      onRenameSection: vi.fn(async () => undefined),
      onMoveDirectoryItem: vi.fn(async () => undefined),
      onUndoDirectoryMove: vi.fn(async () => undefined),
      canUndoDirectoryMove: false,
      directoryBusy: false,
      onDeleteSelection: vi.fn(async () => undefined),
      onDeleteSources: vi.fn(async () => undefined),
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

  it('keeps setting edits temporary until each save-and-load confirmation succeeds', async () => {
    const scenarios = [
      {
        open: '写作风格指导',
        openByAria: false,
        control: '.guide-editor-field textarea',
        saveLabel: '保存并加载写作风格指导',
        value: '新的全局指引',
        read: (changed: Book) => changed.writingBrief,
      },
      {
        open: '剧情大纲',
        openByAria: false,
        control: '.guide-editor-field textarea',
        saveLabel: '保存并加载剧情大纲',
        value: '新的剧情大纲',
        read: (changed: Book) => changed.plotOutline,
      },
      {
        open: '打开角色卡：角色一',
        openByAria: true,
        control: '.source-editor-fields textarea',
        saveLabel: '保存并加载角色卡',
        value: '新的角色设定',
        read: (changed: Book) => changed.characters[0]?.content,
      },
      {
        open: '打开世界观设定：设定一',
        openByAria: true,
        control: '.source-editor-fields textarea',
        saveLabel: '保存并加载世界观设定',
        value: '新的世界观设定',
        read: (changed: Book) => changed.worldRules[0]?.content,
      },
    ];

    for (const scenario of scenarios) {
      const book = makeBook(`book-save-${scenario.value}`);
      const changes: Array<(current: Book) => Book> = [];
      const onBookChange = vi.fn(async (recipe: (current: Book) => Book) => { changes.push(recipe); });
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
        onBookChange,
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
      };
      const { container, root } = await render(<Bookshelf {...props} />);
      const openButton = scenario.openByAria
        ? container.querySelector<HTMLButtonElement>(`button[aria-label="${scenario.open}"]`)
        : [...container.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent?.includes(scenario.open));
      await act(async () => openButton?.click());

      const control = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(scenario.control);
      if (!control) throw new Error(`Missing editor control for ${scenario.open}.`);
      await setControlValue(control, scenario.value);
      expect(onBookChange).not.toHaveBeenCalled();

      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${scenario.saveLabel}"]`)?.click());
      expect(onBookChange).not.toHaveBeenCalled();
      const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认保存并加载'));
      await act(async () => confirm?.click());

      expect(onBookChange).toHaveBeenCalledTimes(1);
      expect(scenario.read(changes[0]!(book))).toBe(scenario.value);
      expect(container.querySelector('[data-phase="success"]')?.textContent).toContain('保存并加载成功');
      await act(async () => root.unmount());
    }
  });
});
