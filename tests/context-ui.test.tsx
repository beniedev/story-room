// @vitest-environment jsdom

import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextCompositionDrawer } from '../src/components/ContextCompositionDrawer';
import { ContextToolsDrawer } from '../src/components/ContextToolsDrawer';
import { SourceLoadScopePage } from '../src/components/Bookshelf';
import { contextToolDraftKey, type ContextToolDraftSession } from '../src/contextToolDrafts';
import type {
  Book,
  ContextPlan,
  PromptBlock,
  SectionMemoryDraft,
  SectionMemoryProvenance,
} from '../src/types';
import { hashSectionContent } from '../src/sectionMemory';

const memoryDraft: SectionMemoryDraft = {
  synopsis: '上一版摘要',
  beats: ['节拍一'],
  continuityFacts: ['事实一'],
  characterStateChanges: ['状态一'],
  foreshadowingCandidates: ['伏笔一'],
};

const memory = {
  ...memoryDraft,
  sourceContentHash: hashSectionContent('前文一。'),
  status: 'fresh' as const,
  provenance: 'manual' as const,
  updatedAt: '2026-08-31T00:00:00.000Z',
};

const makeBook = (): Book => ({
  id: 'book-ui',
  title: '测试书',
  writingBrief: '克制。',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'chapter-ui',
    title: '第一章',
    sections: [
      { id: 'source-ready', title: '已有 Memory', content: '前文一。', memory },
      { id: 'source-no-memory', title: '无 Memory 前文', content: '前文二。' },
      { id: 'source-blank-selected', title: '已选空白节', content: '', contextReferences: undefined },
      { id: 'source-blank', title: '空白节', content: '' },
      { id: 'target-ui', title: '当前小节', content: '正文。', contextReferences: [
        { sectionId: 'source-ready', mode: 'full', reason: 'manual' },
      ] },
    ],
  }],
  branches: [],
  updatedAt: '2026-08-31T00:00:00.000Z',
});

const makeBlock = (overrides: Partial<PromptBlock>): PromptBlock => ({
  id: 'prompt-item',
  layer: 'manuscript',
  cacheBand: 'dynamic',
  title: '手选前文',
  content: '完整前文',
  bookId: 'book-ui',
  sourceId: 'source-ready',
  reason: '本次加载',
  included: true,
  readOnly: true,
  charCount: 4,
  estimatedTokens: 40,
  messageRole: 'user',
  semanticRole: 'reference-manuscript',
  manualSelection: true,
  ...overrides,
});

const compositionPlan: ContextPlan = {
  bookId: 'book-ui',
  mode: 'author',
  generationKind: 'continue-section',
  target: {
    bookId: 'book-ui', chapterId: 'chapter-ui', chapterIndex: 0, sectionId: 'target-ui', sectionIndex: 4,
  },
  included: [
    makeBlock({ id: 'manual-reference', estimatedTokens: 40 }),
    makeBlock({
      id: 'target', layer: 'manuscript', title: '当前正文', sourceId: 'target-ui', content: '正文。',
      reason: '当前目标', estimatedTokens: 20, semanticRole: 'target', manualSelection: undefined,
    }),
  ],
  excluded: [],
  messages: [
    { role: 'system', content: '系统规则。', blockIds: ['system-id'] },
    { role: 'user', content: 'Provider packet 完整正文。', blockIds: ['manual-reference', 'target'] },
  ],
  estimatedTokens: 100,
  budget: {
    maxContext: 10_000,
    protocolOverhead: 128,
    safetyMargin: 256,
    reservedOutput: 1_000,
    availableInput: 8_616,
    estimatedInput: 100,
    remainingInput: 8_516,
    overflow: false,
    overflowTokens: 0,
    estimateKind: 'approximate',
  },
};

const render = async (node: ReactNode) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root };
};

const unmount = async (root: Root) => {
  await act(async () => root.unmount());
};

const makeToolProps = (book: Book, section = book.chapters[0]!.sections[4]!) => ({
  open: true,
  book,
  section,
  onGenerateMemory: vi.fn(async () => memoryDraft),
  onSaveMemoriesAndLoad: vi.fn(async () => undefined),
  busy: false,
  onCancelGeneration: vi.fn(),
  onClose: vi.fn(),
});

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
    value: (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 0);
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ width: 1, height: 1 }] as unknown as DOMRectList,
  });
});

const flushAnimation = async () => {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('context drawers real interactions', () => {
  it('lets readers expand persisted summaries without changing their selection or content', async () => {
    const props = makeToolProps(makeBook());
    const { container, root } = await render(<ContextToolsDrawer {...props} canEdit={false} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]')!;
    const checkbox = disclosure.closest('.context-reference-row')!.querySelector<HTMLInputElement>('input')!;
    expect(checkbox.disabled).toBe(true);
    await act(async () => disclosure.click());
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    const summary = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(summary.value).toBe(memoryDraft.synopsis);
    expect(summary.readOnly).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.context-summary-save')!.disabled).toBe(true);
    expect(props.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    expect(props.onGenerateMemory).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('renders compact prompt statistics without raw Provider or excluded-content disclosures', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { container, root } = await render(
      <ContextCompositionDrawer open plan={compositionPlan} error="" onClose={vi.fn()} />,
    );

    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).toContain('本轮上下文概览');
    expect(container.textContent).toContain('内容占比');
    expect(container.textContent).toContain('总量约 100 tokens');
    expect(container.textContent).toContain('消息封装与目标提醒');
    expect(container.textContent).toContain('包含 JSON 包装与消息结构');
    expect(container.textContent).toContain('约 40 tokens');
    expect(container.textContent).not.toContain('实际消息估算−');

    expect(container.textContent).not.toContain('实际发送（Provider 输入）');
    expect(container.textContent).not.toContain('未带入或受限内容');
    expect(container.textContent).not.toContain('Provider packet 完整正文。');
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(container.textContent).not.toContain('manual-reference');
    await unmount(root);
  });

  it('shows the largest manual context item when the overview is over budget', async () => {
    const { container, root } = await render(
      <ContextCompositionDrawer
        open
        plan={{ ...compositionPlan, budget: { ...compositionPlan.budget, overflow: true, overflowTokens: 9 } }}
        error=""
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('占用较大的手选前文：手选前文（约 40 tokens）');
    await unmount(root);
  });

  it('restores the checkbox and disclosure layout without a mode control', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await flushAnimation();

    expect(container.textContent).toContain('待确认 1/2 小节');
    expect(container.textContent).toContain('当前设置仍含 1 节全文引用');
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('清空全部');
    expect(container.querySelectorAll('.context-reference-checkbox')).toHaveLength(4);
    const globalSave = container.querySelector<HTMLButtonElement>('.source-load-tab > .context-summary-save');
    expect(globalSave?.disabled).toBe(false);

    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    const row = disclosure?.closest('.context-reference-row');
    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(container.querySelector('.context-load-unsaved')).toBeNull();
    await act(async () => checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(checkbox?.checked).toBe(false);
    expect(row?.querySelector('.context-load-unsaved')?.textContent).toBe('此加载修改尚未保存');
    expect(props.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')).toBeNull();

    await act(async () => disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(memoryDraft.synopsis);
    expect(globalSave?.disabled).toBe(false);
    expect(disclosure?.getAttribute('aria-expanded')).toBe('true');
    expect(checkbox?.checked).toBe(false);
    await act(async () => checkbox?.click());
    expect(container.querySelector('.context-load-unsaved')).toBeNull();
    await act(async () => globalSave?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const saveConfirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => saveConfirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(props.onSaveMemoriesAndLoad).toHaveBeenCalledWith([{
      sourceSectionId: 'source-ready',
      draft: memoryDraft,
      provenance: 'manual',
    }]);
    await unmount(root);
  });

  it('selects all nonblank previous sections and leaves blank rows disabled', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const selectAll = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('全选'));
    const blankDisclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开空白节梗概"]');
    const blankCheckbox = blankDisclosure?.closest('.context-reference-row')
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(blankCheckbox?.disabled).toBe(true);

    await act(async () => selectAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('待确认 2/2 小节');
    expect(props.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    expect(container.textContent).toContain('请先填写或生成梗概，或取消勾选；不会加载原文。');
    expect(props.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('restores unsaved edits after closing and clears their hint after successful save', async () => {
    const book = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    const props = { ...makeToolProps(book), sessionDrafts };
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => disclosure?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter || !textarea) throw new Error('Textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(textarea, '会话内修改的梗概');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const key = contextToolDraftKey(book.id, 'target-ui');
    expect(sessionDrafts.get(key)?.hasChanges).toBe(true);

    await act(async () => root.render(<ContextToolsDrawer {...props} open={false} />));
    await act(async () => root.render(<ContextToolsDrawer {...props} open />));
    const reopenedDisclosure = container.querySelector<HTMLButtonElement>('[aria-label="收起已有 Memory梗概"]');
    expect(reopenedDisclosure).toBeTruthy();
    expect(container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready')?.value)
      .toBe('会话内修改的梗概');
    expect(container.textContent).not.toContain('放弃本次修改');
    expect(container.querySelector('.context-load-unsaved')?.textContent).toBe('此加载修改尚未保存');

    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => confirm?.click());
    expect(sessionDrafts.has(key)).toBe(false);
    expect(container.querySelector('.context-load-unsaved')).toBeNull();
    expect(props.onSaveMemoriesAndLoad).toHaveBeenCalledWith([{
      sourceSectionId: 'source-ready',
      draft: { ...memoryDraft, synopsis: '会话内修改的梗概' },
      provenance: 'manual',
    }]);
    await unmount(root);
  });

  it('keeps a late generation in its original target session after switching sections', async () => {
    const book = makeBook();
    const switchedBook: Book = {
      ...book,
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === 'target-ui'
          ? { ...item, id: 'target-other', title: '另一个当前小节', contextReferences: [] }
          : item),
      })),
    };
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    let resolveGeneration!: (draft: SectionMemoryDraft) => void;
    const props = {
      ...makeToolProps(book),
      sessionDrafts,
      onGenerateMemory: vi.fn(() => new Promise<SectionMemoryDraft>((resolve) => {
        resolveGeneration = resolve;
      })),
    };
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    await act(async () => disclosure?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-generate')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    await act(async () => confirm?.click());
    await act(async () => root.render(
      <ContextToolsDrawer
        {...props}
        open={false}
        book={switchedBook}
        section={switchedBook.chapters[0]!.sections[4]!}
      />,
    ));
    await act(async () => root.render(
      <ContextToolsDrawer
        {...props}
        open
        book={switchedBook}
        section={switchedBook.chapters[0]!.sections[4]!}
      />,
    ));

    await act(async () => {
      resolveGeneration(memoryDraft);
      await Promise.resolve();
    });
    const oldKey = contextToolDraftKey(book.id, 'target-ui');
    expect(sessionDrafts.get(oldKey)?.generatedDrafts['source-no-memory']).toEqual(memoryDraft);
    expect(container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-no-memory')).toBeNull();
    await unmount(root);
  });

  it('does not recreate a removed target session when its generation resolves late', async () => {
    const book = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    let resolveGeneration!: (draft: SectionMemoryDraft) => void;
    const props = {
      ...makeToolProps(book),
      sessionDrafts,
      onGenerateMemory: vi.fn(() => new Promise<SectionMemoryDraft>((resolve) => {
        resolveGeneration = resolve;
      })),
    };
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-generate')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    await act(async () => confirm?.click());
    const key = contextToolDraftKey(book.id, 'target-ui');
    // App removes the target's draft and unmounts its drawer when the target is deleted.
    sessionDrafts.delete(key);
    await unmount(root);
    expect(sessionDrafts.has(key)).toBe(false);

    await act(async () => {
      resolveGeneration(memoryDraft);
      await Promise.resolve();
    });
    expect(sessionDrafts.has(key)).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-no-memory')).toBeNull();
  });

  it('drops source ids that no longer exist and keeps read-only expansion out of pending drafts', async () => {
    const book = makeBook();
    const key = contextToolDraftKey(book.id, 'target-ui');
    const sessionDrafts = new Map<string, ContextToolDraftSession>([[key, {
      bookId: book.id,
      sectionId: 'target-ui',
      hasChanges: true,
      selectedSectionIds: ['source-ready', 'deleted-source'],
      expandedSectionIds: ['deleted-source'],
      memoryDrafts: { 'deleted-source': memoryDraft },
      generatedDrafts: { 'deleted-source': memoryDraft },
      summaryErrors: { 'deleted-source': '旧错误' },
    }]]);
    const bookWithoutSource: Book = {
      ...book,
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.filter((item) => item.id !== 'deleted-source'),
      })),
    };
    const props = { ...makeToolProps(bookWithoutSource), sessionDrafts };
    const { container, root } = await render(<ContextToolsDrawer {...props} canEdit={false} />);
    expect(sessionDrafts.has(key)).toBe(false);
    expect(container.textContent).not.toContain('旧错误');
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => disclosure?.click());
    expect(sessionDrafts.has(key)).toBe(false);
    await unmount(root);
  });

  it('keeps edited summaries and errors after a failed save', async () => {
    const book = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    const props = {
      ...makeToolProps(book),
      sessionDrafts,
      onSaveMemoriesAndLoad: vi.fn(async () => { throw new Error('书目暂时无法保存'); }),
    };
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => disclosure?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter || !textarea) throw new Error('Textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(textarea, '保存失败后仍保留');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('梗概保存并加载失败');
    expect(container.querySelector('.context-load-unsaved')?.textContent).toBe('此加载修改尚未保存');
    expect(sessionDrafts.get(contextToolDraftKey(book.id, 'target-ui'))?.hasChanges).toBe(true);

    await act(async () => root.render(<ContextToolsDrawer {...props} open={false} />));
    await act(async () => root.render(<ContextToolsDrawer {...props} open />));
    const reopened = container.querySelector<HTMLButtonElement>('[aria-label="收起已有 Memory梗概"]');
    expect(reopened).toBeTruthy();
    expect(container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready')?.value)
      .toBe('保存失败后仍保留');
    expect(container.querySelector('.context-load-unsaved')).not.toBeNull();
    await unmount(root);
  });

  it('does not revive a deleted session when an unedited save rejects after unmount', async () => {
    const book = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    let rejectSave!: (error: Error) => void;
    const props = {
      ...makeToolProps(book),
      sessionDrafts,
      onSaveMemoriesAndLoad: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      })),
    };
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });

    const key = contextToolDraftKey(book.id, 'target-ui');
    expect(sessionDrafts.has(key)).toBe(true);
    sessionDrafts.delete(key);
    await unmount(root);
    await act(async () => {
      rejectSave(new Error('保存已取消'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sessionDrafts.has(key)).toBe(false);
  });

  it('shows selected current-or-later references and reports explicit retention choices', async () => {
    const baseBook = makeBook();
    const baseChapter = baseBook.chapters[0]!;
    const futureSection = { id: 'future-reference', title: '未来引用', content: '未来正文。' };
    const targetSection = {
      ...baseChapter.sections[4]!,
      contextReferences: [
        { sectionId: 'source-ready', mode: 'full' as const, reason: 'manual' as const },
        { sectionId: 'future-reference', mode: 'summary' as const, reason: 'manual' as const },
      ],
    };
    const book: Book = {
      ...baseBook,
      chapters: [{
        ...baseChapter,
        sections: [...baseChapter.sections.slice(0, 4), targetSection, futureSection],
      }],
    };
    const props = makeToolProps(book, targetSection);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const futureDisclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开未来引用梗概"]');
    const futureCheckbox = futureDisclosure?.closest('.context-reference-row')
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(container.textContent).toContain('位于当前小节或之后，暂不加载');
    expect(futureCheckbox?.checked).toBe(true);
    expect(futureCheckbox?.disabled).toBe(false);

    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    expect(container.textContent).toContain('仍保留 1 条位于当前小节或之后的既有引用，但暂不进入上下文。');
    const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '取消');
    await act(async () => cancel?.click());
    await act(async () => futureCheckbox?.click());
    expect(futureCheckbox?.checked).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => confirm?.click());
    expect(props.onSaveMemoriesAndLoad).toHaveBeenCalledWith([{
      sourceSectionId: 'source-ready',
      draft: memoryDraft,
      provenance: 'manual',
    }], []);
    await unmount(root);
  });

  it('keeps the save confirmation through optimistic parent updates and clears only the saved session', async () => {
    const initialBook = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    let resolveSave!: () => void;
    const saveFinished = new Promise<void>((resolve) => { resolveSave = resolve; });
    let setCurrentBook: ((next: Book) => void) | undefined;
    const onGenerateMemory = vi.fn(async () => memoryDraft);
    const onClose = vi.fn();
    const onCancelGeneration = vi.fn();
    const onSaveMemoriesAndLoad = vi.fn(async (entries: Array<{
      sourceSectionId: string;
      draft: SectionMemoryDraft;
      provenance: SectionMemoryProvenance;
    }>) => {
      const nextReferences = entries.map((entry) => ({
        sourceSectionId: entry.sourceSectionId,
        mode: 'summary' as const,
        reason: 'manual' as const,
      }));
      setCurrentBook?.({
        ...initialBook,
        chapters: initialBook.chapters.map((chapter) => ({
          ...chapter,
          sections: chapter.sections.map((item) => item.id === 'target-ui'
            ? { ...item, contextReferences: nextReferences.map((reference) => ({
                sectionId: reference.sourceSectionId,
                mode: reference.mode,
                reason: reference.reason,
              })) }
            : item),
        })),
      });
      await saveFinished;
    });
    function Harness() {
      const [currentBook, updateBook] = useState(initialBook);
      setCurrentBook = updateBook;
      return (
        <ContextToolsDrawer
          open
          book={currentBook}
          section={currentBook.chapters[0]!.sections[4]!}
          onGenerateMemory={onGenerateMemory}
          onSaveMemoriesAndLoad={onSaveMemoriesAndLoad}
          busy={false}
          onCancelGeneration={onCancelGeneration}
          onClose={onClose}
          sessionDrafts={sessionDrafts}
        />
      );
    }

    const { container, root } = await render(<Harness />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => disclosure?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter || !textarea) throw new Error('Textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(textarea, '父级保存中的梗概');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const noMemoryDisclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    const noMemoryCheckbox = noMemoryDisclosure?.closest('.context-reference-row')
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => noMemoryCheckbox?.click());
    await act(async () => noMemoryDisclosure?.click());
    const noMemoryTextarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-no-memory');
    if (!noMemoryTextarea) throw new Error('No-memory textarea is unavailable.');
    await act(async () => {
      valueSetter.call(noMemoryTextarea, '新增选择的梗概');
      noMemoryTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => confirm?.click());
    expect(onSaveMemoriesAndLoad).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLDialogElement>('.confirm-dialog')?.textContent)
      .toContain('正在保存并加载梗概…');

    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLDialogElement>('.confirm-dialog')?.textContent)
      .toContain('梗概保存并加载成功');
    expect(sessionDrafts.has(contextToolDraftKey(initialBook.id, 'target-ui'))).toBe(false);
    const savedNoMemoryRow = [...container.querySelectorAll<HTMLElement>('.context-reference-row')]
      .find((row) => row.textContent?.includes('无 Memory 前文'));
    expect(savedNoMemoryRow?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await unmount(root);
  });

  it('does not clear a newer same-target edit when an older save resolves', async () => {
    const initialBook = makeBook();
    const sessionDrafts = new Map<string, ContextToolDraftSession>();
    let resolveSave!: () => void;
    const saveFinished = new Promise<void>((resolve) => { resolveSave = resolve; });
    let setCurrentBook: ((next: Book) => void) | undefined;
    const onSaveMemoriesAndLoad = vi.fn(async (entries: Array<{
      sourceSectionId: string;
      draft: SectionMemoryDraft;
      provenance: SectionMemoryProvenance;
    }>) => {
      setCurrentBook?.({
        ...initialBook,
        chapters: initialBook.chapters.map((chapter) => ({
          ...chapter,
          sections: chapter.sections.map((item) => item.id === 'target-ui'
            ? { ...item, contextReferences: entries.map((entry) => ({
                sectionId: entry.sourceSectionId,
                mode: 'summary' as const,
                reason: 'manual' as const,
              })) }
            : item),
        })),
      });
      await saveFinished;
    });
    function Harness() {
      const [currentBook, updateBook] = useState(initialBook);
      setCurrentBook = updateBook;
      return (
        <ContextToolsDrawer
          open
          book={currentBook}
          section={currentBook.chapters[0]!.sections[4]!}
          onGenerateMemory={vi.fn(async () => memoryDraft)}
          onSaveMemoriesAndLoad={onSaveMemoriesAndLoad}
          busy={false}
          onCancelGeneration={vi.fn()}
          onClose={vi.fn()}
          sessionDrafts={sessionDrafts}
        />
      );
    }

    const { container, root } = await render(<Harness />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => disclosure?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter || !textarea) throw new Error('Textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(textarea, '首次保存的内容');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.context-summary-save')?.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => confirm?.click());
    await act(async () => {
      valueSetter.call(textarea, '后续编辑必须保留');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sessionDrafts.get(contextToolDraftKey(initialBook.id, 'target-ui'))?.hasChanges).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready')?.value)
      .toBe('后续编辑必须保留');
    await unmount(root);
  });

  it('keeps Provider feedback visible, dismisses it on click, then globally saves all edited drafts', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    let resolveGeneration!: (draft: SectionMemoryDraft) => void;
    props.onGenerateMemory = vi.fn(() => new Promise<SectionMemoryDraft>((resolve) => {
      resolveGeneration = resolve;
    }));
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await act(async () => container.querySelector<HTMLButtonElement>('.source-scope-all')?.click());
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    await act(async () => disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    const generate = container.querySelector<HTMLButtonElement>('.context-summary-generate');
    await act(async () => generate?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    expect(confirm).toBeTruthy();
    await act(async () => confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const outer = container.querySelector<HTMLDialogElement>('#context-tools-drawer');
    const inner = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    expect(inner?.open).toBe(true);
    expect(inner?.textContent).toContain('正在生成梗概…');

    await act(async () => {
      resolveGeneration(memoryDraft);
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(memoryDraft.synopsis);
    const success = container.querySelector<HTMLElement>('.dialog-operation-status[data-phase="success"]');
    expect(success?.textContent).toContain('已生成梗概');
    expect(success?.tagName).toBe('DIV');
    expect(container.querySelector('.context-memory-array-row')).toBeNull();
    expect(props.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(inner?.open).toBe(false);
    expect(outer?.open).toBe(true);

    const readyDisclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开已有 Memory梗概"]');
    await act(async () => readyDisclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const readyTextarea = container.querySelector<HTMLTextAreaElement>('#context-summary-textarea-source-ready');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!valueSetter || !readyTextarea) throw new Error('Textarea value setter is unavailable.');
    await act(async () => {
      valueSetter.call(readyTextarea, '作者改写梗概');
      readyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const save = container.querySelector<HTMLButtonElement>('.source-load-tab > .context-summary-save');
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const saveConfirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => saveConfirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    expect(props.onSaveMemoriesAndLoad).toHaveBeenCalledWith([
      {
        sourceSectionId: 'source-ready',
        draft: { ...memoryDraft, synopsis: '作者改写梗概' },
        provenance: 'manual',
      },
      {
        sourceSectionId: 'source-no-memory',
        draft: memoryDraft,
        provenance: 'model-confirmed',
      },
    ]);
    expect(inner?.open).toBe(true);
    expect(inner?.textContent).toContain('梗概保存并加载成功');
    await unmount(root);
  });

  it('automatically dismisses generated-summary success after five seconds', async () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    await act(async () => disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const generate = container.querySelector<HTMLButtonElement>('.context-summary-generate');
    await act(async () => generate?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const inner = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    expect(inner?.textContent).toContain('已生成梗概');
    const autoDismiss = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0];
    expect(autoDismiss).toBeTypeOf('function');
    await act(async () => {
      if (typeof autoDismiss === 'function') autoDismiss();
    });
    expect(inner?.open).toBe(false);
    expect(container.querySelector<HTMLDialogElement>('#context-tools-drawer')?.open).toBe(true);
    await unmount(root);
  });

  it('keeps generation failures in the confirmation dialog until the user returns', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    props.onGenerateMemory = vi.fn(async () => { throw new Error('Provider 暂时不可用'); });
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    await act(async () => disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const generate = container.querySelector<HTMLButtonElement>('.context-summary-generate');
    await act(async () => generate?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('生成梗概失败');
    expect(dialog?.textContent).toContain('Provider 暂时不可用');
    expect(dialog?.querySelector('[role="alert"]')).toBeTruthy();
    await unmount(root);
  });

  it('keeps character and world loading scopes temporary until the rightmost confirmation succeeds', async () => {
    const book = makeBook();
    const onConfirm = vi.fn(async () => undefined);
    const { container, root } = await render(
      <SourceLoadScopePage
        sourceId="character-ui"
        title="加载角色卡"
        bookTitle={book.title}
        enabled
        chapters={book.chapters}
        loadedSectionIds={['source-ready']}
        onConfirm={onConfirm}
      />,
    );
    await flushAnimation();
    const master = container.querySelector<HTMLInputElement>('.source-load-toggle input');
    const selectAll = container.querySelector<HTMLButtonElement>('.source-scope-all');
    expect(master?.checked).toBe(false);
    expect(master?.indeterminate).toBe(true);
    expect(selectAll?.textContent).toBe('全选');

    await act(async () => selectAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('.source-load-toggle input')?.checked).toBe(true);
    const cancelAll = container.querySelector<HTMLButtonElement>('.source-scope-all');
    expect(cancelAll?.textContent).toBe('取消全选');
    await act(async () => cancelAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector<HTMLInputElement>('.source-load-toggle input')?.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('.source-load-toggle input')?.indeterminate).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => container.querySelector<HTMLButtonElement>('.source-scope-all')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirmTrigger = container.querySelector<HTMLButtonElement>('[aria-label="确认载入角色卡"]');
    await act(async () => confirmTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const dialog = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('取消或返回不会更改已保存范围');
    expect(onConfirm).not.toHaveBeenCalled();

    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认载入'));
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledWith({ includeInPrompt: true, loadedSectionIds: undefined });
    expect(dialog?.textContent).toContain('角色卡加载范围保存成功');
    await unmount(root);
  });

  it('keeps a failed source loading confirmation open with the draft selection intact', async () => {
    const book = makeBook();
    const onConfirm = vi.fn(async () => { throw new Error('书目暂时无法保存'); });
    const { container, root } = await render(
      <SourceLoadScopePage
        sourceId="world-ui"
        title="加载世界观设定"
        bookTitle={book.title}
        enabled={false}
        chapters={book.chapters}
        loadedSectionIds={[]}
        onConfirm={onConfirm}
      />,
    );

    await act(async () => container.querySelector<HTMLButtonElement>('.source-scope-all')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="确认载入世界观设定"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认载入'));
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('世界观设定加载范围保存失败');
    expect(dialog?.textContent).toContain('书目暂时无法保存');
    expect(container.querySelector<HTMLInputElement>('.source-load-toggle input')?.checked).toBe(true);
    await unmount(root);
  });

  it('closes only the nested synopsis confirmation on Escape and restores its trigger', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="展开无 Memory 前文梗概"]');
    await act(async () => disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    const generate = container.querySelector<HTMLButtonElement>('.context-summary-generate');
    generate?.focus();
    await act(async () => generate?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const outer = container.querySelector<HTMLDialogElement>('#context-tools-drawer');
    const inner = container.querySelector<HTMLDialogElement>('.confirm-dialog');
    const close = inner?.querySelector<HTMLButtonElement>('[aria-label="关闭确认"]');
    expect(outer?.open).toBe(true);
    expect(inner?.open).toBe(true);

    await act(async () => close?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    })));
    await flushAnimation();
    expect(inner?.open).toBe(false);
    expect(outer?.open).toBe(true);
    expect(document.activeElement).toBe(generate);
    expect(props.onClose).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('uses native dialog cancellation and keeps the overview trigger outside focus management', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await flushAnimation();
    const dialog = container.querySelector<HTMLDialogElement>('#context-tools-drawer');
    expect(dialog?.open).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭前文选择');
    vi.spyOn(dialog!, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 512, top: 0, bottom: 800 } as DOMRect);
    await act(async () => dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 })));
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 200 })));
    expect(props.onClose).toHaveBeenCalledOnce();
    props.onClose.mockClear();
    await act(async () => dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })));
    expect(props.onClose).toHaveBeenCalled();
    props.onClose.mockClear();
    await act(async () => dialog?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })));
    expect(props.onClose).toHaveBeenCalledOnce();
    await unmount(root);
  });
});
