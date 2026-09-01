// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextCompositionDrawer } from '../src/components/ContextCompositionDrawer';
import { ContextToolsDrawer } from '../src/components/ContextToolsDrawer';
import type {
  Book,
  ContextPlan,
  PromptBlock,
  SectionMemoryDraft,
} from '../src/types';
import type { SectionReferenceMode } from '../src/contextReferences';
import { setReferenceMode } from '../src/contextReferences';
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
        { sectionId: 'source-ready', mode: 'summary', reason: 'manual' },
        { sectionId: 'source-blank-selected', mode: 'both', reason: 'manual' },
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
  prompt: 'system: 系统规则。\n\nuser: Provider packet 完整正文。',
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
  onContextReferenceChange: vi.fn<(sourceSectionId: string, mode: SectionReferenceMode) => void>(),
  onContextReferencesChange: vi.fn<(references: Book['chapters'][number]['sections'][number]['contextReferences']) => void>(),
  onGenerateMemory: vi.fn(async () => memoryDraft),
  onSaveMemoryAndLoad: vi.fn(async () => undefined),
  onDeleteMemory: vi.fn(async () => undefined),
  onRollbackMemory: vi.fn(async () => undefined),
  onClearPreviousMemory: vi.fn(async () => undefined),
  busy: false,
  onCancelGeneration: vi.fn(),
  onClose: vi.fn(),
});

const ModeHarness = ({ initialBook }: { initialBook: Book }) => {
  const [book, setBook] = useState(initialBook);
  const section = book.chapters[0]!.sections[4]!;
  const props = makeToolProps(book, section);
  return (
    <ContextToolsDrawer
      {...props}
      onContextReferenceChange={(sourceSectionId, mode) => {
        setBook((current) => ({
          ...current,
          chapters: current.chapters.map((chapter) => ({
            ...chapter,
            sections: chapter.sections.map((item) => item.id === section.id
              ? { ...item, contextReferences: setReferenceMode(item.contextReferences, sourceSectionId, mode) }
              : item),
          })),
        }));
      }}
    />
  );
};

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
  document.body.innerHTML = '';
});

describe('context drawers real interactions', () => {
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

  it('supports finite modes, excludes blank sections from the count, and keeps them visible', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await flushAnimation();
    const selects = [...container.querySelectorAll('select')] as HTMLSelectElement[];
    expect(selects).toHaveLength(4);
    expect(container.textContent).toContain('已选 1/2 小节');
    expect(container.textContent).toContain('尚无正文');
    expect(container.textContent).toContain('摘要预览：尚无摘要');

    const noMemorySummary = [...selects[1]!.options].find((option) => option.value === 'summary');
    expect(noMemorySummary?.disabled).toBe(true);
    expect(selects[3]?.disabled).toBe(true);
    expect([...selects[0]!.options].map((option) => option.value)).toEqual(['none', 'full', 'summary', 'both']);

    await act(async () => {
      selects[1]!.value = 'full';
      selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(props.onContextReferenceChange).toHaveBeenCalledWith('source-no-memory', 'full');
    await unmount(root);
  });

  it('keeps a selected control value through every finite mode transition', async () => {
    const book = makeBook();
    book.chapters[0]!.sections[4]!.contextReferences = undefined;
    const { container, root } = await render(<ModeHarness initialBook={book} />);
    await flushAnimation();
    const label = '设置已有 Memory的前文模式';
    for (const mode of ['none', 'full', 'summary', 'both', 'none'] as const) {
      const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
      expect(select).toBeTruthy();
      await act(async () => {
        select!.value = mode;
        select!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect((container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null)?.value).toBe(mode);
    }
    await unmount(root);
  });

  it('keeps stale Memory visible and disables its summary modes', async () => {
    const book = makeBook();
    book.chapters[0]!.sections[0]!.memory = { ...memory, status: 'stale' };
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    await flushAnimation();
    const row = container.querySelector('[data-reference-mode="summary"]');
    const select = row?.querySelector('select') as HTMLSelectElement | null;
    expect(row?.textContent).toContain('Memory 已过期');
    expect([...select!.options].filter((option) => option.value === 'summary' || option.value === 'both')
      .every((option) => option.disabled)).toBe(true);
    await unmount(root);
  });

  it('selects only unset nonblank rows and clear-all sees invalid blank references', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const selectAll = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('全部'));
    const clearAll = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('清空全部'));
    expect(selectAll?.hasAttribute('disabled')).toBe(false);
    expect(clearAll?.hasAttribute('disabled')).toBe(false);

    await act(async () => clearAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(props.onContextReferencesChange).toHaveBeenCalledWith(undefined);
    await act(async () => selectAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const selected = props.onContextReferencesChange.mock.calls.at(-1)?.[0];
    expect(selected).toEqual(expect.arrayContaining([
      { sectionId: 'source-ready', mode: 'summary', reason: 'manual' },
      { sectionId: 'source-blank-selected', mode: 'both', reason: 'manual' },
      { sectionId: 'source-no-memory', mode: 'full', reason: 'manual' },
    ]));
    expect(selected).not.toEqual(expect.arrayContaining([{ sectionId: 'source-blank', mode: 'full', reason: 'manual' }]));
    await unmount(root);
  });

  it('opens a five-field Memory child view, exposes previous content, and restores focus', async () => {
    const book = makeBook();
    book.chapters[0]!.sections[0]!.previousMemory = { ...memory, synopsis: '更旧摘要' };
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const row = container.querySelector<HTMLButtonElement>('[aria-label="编辑已有 Memory Memory"]');
    expect(row).toBeTruthy();
    row?.focus();
    await act(async () => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();

    expect(container.textContent).toContain('上一版本：有');
    expect(container.textContent).toContain('更旧摘要');
    expect(container.querySelectorAll('fieldset.context-memory-array')).toHaveLength(4);
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.textContent).toContain('删除当前 Memory');
    expect(container.textContent).toContain('回滚上一版本');
    expect(document.activeElement?.classList.contains('context-memory-back')).toBe(true);

    const back = container.querySelector<HTMLButtonElement>('.context-memory-back');
    await act(async () => back?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('编辑已有 Memory Memory');
    await unmount(root);
  });

  it('keeps generated Memory as a draft until confirmation, then saves only after confirmation', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const row = container.querySelector<HTMLButtonElement>('[aria-label="编辑无 Memory 前文 Memory"]');
    await act(async () => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    const generate = container.querySelector<HTMLButtonElement>('.context-summary-generate');
    await act(async () => generate?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认生成'));
    expect(confirm).toBeTruthy();
    await act(async () => confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(memoryDraft.synopsis);
    expect([...container.querySelectorAll<HTMLInputElement>('.context-memory-array-row input')]
      .map((input) => input.value)).toEqual(['节拍一', '事实一', '状态一', '伏笔一']);
    expect(props.onSaveMemoryAndLoad).not.toHaveBeenCalled();

    const save = container.querySelector<HTMLButtonElement>('.context-summary-save');
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const saveConfirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认保存并加载'));
    await act(async () => saveConfirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAnimation();
    expect(props.onSaveMemoryAndLoad).toHaveBeenCalledWith('source-no-memory', memoryDraft, 'model-confirmed');
    await unmount(root);
  });

  it('closes only the nested Memory confirmation on Escape and restores its trigger', async () => {
    const book = makeBook();
    const props = makeToolProps(book);
    const { container, root } = await render(<ContextToolsDrawer {...props} />);
    const row = container.querySelector<HTMLButtonElement>('[aria-label="编辑无 Memory 前文 Memory"]');
    await act(async () => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
    await act(async () => dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })));
    expect(props.onClose).toHaveBeenCalled();
    props.onClose.mockClear();
    await act(async () => dialog?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })));
    expect(props.onClose).toHaveBeenCalledOnce();
    await unmount(root);
  });
});
