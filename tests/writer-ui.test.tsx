// @vitest-environment jsdom

import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bookshelf } from '../src/components/Bookshelf';
import { Writer } from '../src/components/Writer';
import { buildContextPlan } from '../src/contextPlan';
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

  it('keeps candidate preview in the manuscript position and separates adoption', async () => {
    const onAdoptCandidate = vi.fn(async () => undefined);
    const { container, root } = await render(<Writer {...writerProps(candidateBook)} onAdoptCandidate={onAdoptCandidate} />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="下一版回答候选"]');
    expect(next).not.toBeNull();
    await act(async () => next?.click());

    const manuscriptBlock = container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block');
    expect(manuscriptBlock?.textContent).toContain('正在预览的二版');
    expect(manuscriptBlock?.textContent).not.toContain('采用的一版');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="编辑所选片段"]')?.disabled).toBe(true);
    expect(container.querySelector('.answer-candidate-strip')?.textContent).toContain('2 / 2');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).toContain('来源条件已变化');
    expect(container.querySelector('.answer-candidate-strip')?.textContent).not.toContain('正在预览的二版');

    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-adopt')?.click());
    expect(onAdoptCandidate).toHaveBeenCalledWith('answer-block', 'candidate-two');
    await act(async () => root.unmount());
  });

  it('marks a candidate stale when the current preceding material changes', async () => {
    const sourceBook = makeBook('book-source-status', [
      { id: 'source-input', kind: 'user', content: '原来的前文' },
      {
        id: 'answer-block',
        kind: 'assistant',
        content: '采用的一版',
        candidates: [
          { id: 'candidate-one', content: '采用的一版' },
          { id: 'candidate-two', content: '备选回答' },
        ],
        adoptedCandidateId: 'candidate-one',
      },
    ]);
    const sourceSignature = buildContextPlan(sourceBook, {
      sectionId: 'section-one',
      mode: 'author',
      instruction: '',
      generationKind: 'regenerate-block',
      targetBlockId: 'answer-block',
    }).sourceSignature;
    const initialBook = makeBook('book-source-status', [
      { id: 'source-input', kind: 'user', content: '原来的前文' },
      {
        id: 'answer-block',
        kind: 'assistant',
        content: '采用的一版',
        candidates: [
          { id: 'candidate-one', content: '采用的一版', sourceSignature },
          { id: 'candidate-two', content: '备选回答', sourceSignature },
        ],
        adoptedCandidateId: 'candidate-one',
      },
    ]);
    const { container, root } = await render(<Writer {...writerProps(initialBook)} />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    expect(container.querySelector('.answer-candidate-strip')?.textContent).not.toContain('来源条件已变化');

    const changedBook = makeBook('book-source-status', [
      { id: 'source-input', kind: 'user', content: '已经改过的前文' },
      ...initialBook.chapters[0]!.sections[0]!.blocks!.slice(1),
    ]);
    await rerender(root, <Writer {...writerProps(changedBook)} />);
    expect(container.querySelector('.answer-candidate-strip')?.textContent).toContain('来源条件已变化');
    await act(async () => root.unmount());
  });

  it('reports adoption failure and leaves the old adopted version recoverable', async () => {
    const onAdoptCandidate = vi.fn(async () => { throw new Error('保存失败'); });
    const { container, root } = await render(<Writer {...writerProps(candidateBook)} onAdoptCandidate={onAdoptCandidate} />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="下一版回答候选"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-adopt')?.click());
    expect(container.querySelector('.answer-candidate-error')?.textContent).toContain('保存失败');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="上一版回答候选"]')?.click());
    expect(container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.textContent).toContain('采用的一版');
    await act(async () => root.unmount());
  });

  it('edits and deletes an unadopted candidate through explicit callbacks', async () => {
    const onEditCandidate = vi.fn(async () => undefined);
    const onDeleteCandidate = vi.fn(async () => undefined);
    const { container, root } = await render(<Writer
      {...writerProps(candidateBook)}
      onEditCandidate={onEditCandidate}
      onDeleteCandidate={onDeleteCandidate}
    />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="下一版回答候选"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-edit')?.click());
    const editor = container.querySelector<HTMLTextAreaElement>('.answer-candidate-editor textarea');
    expect(editor?.value).toBe('正在预览的二版');
    await setControlValue(editor!, '编辑后的二版');
    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-editor-actions .primary-action')?.click());
    expect(onEditCandidate).toHaveBeenCalledWith('answer-block', 'candidate-two', '编辑后的二版');

    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-delete')?.click());
    expect(container.querySelector('.confirm-dialog')?.textContent).toContain('未采用候选');
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('删除这一版候选'))?.click());
    expect(onDeleteCandidate).toHaveBeenCalledWith('answer-block', 'candidate-two');
    await act(async () => root.unmount());
  });

  it('keeps an unsaved candidate edit in place until it is saved or cancelled', async () => {
    const onEditCandidate = vi.fn(async () => undefined);
    const { container, root } = await render(<Writer
      {...writerProps(candidateBook)}
      onEditCandidate={onEditCandidate}
    />);
    await act(async () => container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="下一版回答候选"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-edit')?.click());
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="上一版回答候选"]')?.disabled).toBe(true);

    const instruction = container.querySelector<HTMLTextAreaElement>('#writing-instruction')!;
    await act(async () => instruction.focus());
    expect(container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.textContent)
      .toContain('正在预览的二版');
    expect(container.querySelector('.answer-candidate-editor')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('.answer-candidate-editor-actions .quiet-action')?.click());
    await act(async () => { instruction.blur(); instruction.focus(); });
    expect(container.querySelector('.answer-candidate-strip')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-block-id="answer-block"] .manuscript-block')?.textContent)
      .toContain('采用的一版');
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
