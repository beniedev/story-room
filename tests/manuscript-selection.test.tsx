// @vitest-environment jsdom

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Writer } from '../src/components/Writer';
import type { Book, SectionBlock } from '../src/types';

const makeBook = (blocks: SectionBlock[]): Book => ({
  id: 'selection-book',
  title: '测试书',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'selection-chapter',
    title: '第一章',
    sections: [{
      id: 'selection-section',
      title: '第一节',
      content: blocks.map((block) => block.content).join('\n\n'),
      blocks,
    }],
  }],
  branches: [],
  updatedAt: '2026-09-11T00:00:00.000Z',
});

const writerProps = (book: Book, overrides: Partial<ComponentProps<typeof Writer>> = {}): ComponentProps<typeof Writer> => ({
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
  ...overrides,
});

const blocks = (): SectionBlock[] => [
  { id: 'first-block', kind: 'user', content: '第一块正文，保留原生选词。' },
  { id: 'second-block', kind: 'assistant', content: '第二块正文。' },
];

const mountedRoots: Root[] = [];

const mount = async (overrides: Partial<ComponentProps<typeof Writer>> = {}) => {
  const book = makeBook(blocks());
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(<Writer {...writerProps(book, overrides)} />));
  return container;
};

const dispatchPointer = async (
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  {
    pointerId = 1,
    pointerType = 'mouse',
    isPrimary = true,
    clientX = 10,
    clientY = 10,
    timeStamp,
  }: {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    clientX?: number;
    clientY?: number;
    timeStamp: number;
  },
) => {
  await act(async () => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType,
      isPrimary,
      clientX,
      clientY,
    });
    Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp });
    target.dispatchEvent(event);
  });
};

const dispatchClick = async (target: Element, detail = 1) => {
  let event: MouseEvent;
  await act(async () => {
    event = new MouseEvent('click', { bubbles: true, cancelable: true, detail });
    target.dispatchEvent(event);
  });
  return event!;
};

const dispatchDoubleClick = async (target: Element) => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
  });
};

const blockFor = (container: HTMLElement, id = 'first-block') => container.querySelector<HTMLElement>(`[data-block-id="${id}"] .manuscript-block`)!;
const groupFor = (container: HTMLElement, id = 'first-block') => container.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!;

const selectBlockText = (block: HTMLElement) => {
  const copy = block.querySelector('.manuscript-block-copy')!;
  const range = document.createRange();
  range.selectNodeContents(copy);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

const moveCollapsedCaret = (block: HTMLElement, offset: number) => {
  const copy = block.querySelector('.manuscript-block-copy')!;
  const text = copy.firstChild;
  if (!text) throw new Error('The manuscript block has no text node.');
  const range = document.createRange();
  range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

const clearSelection = () => {
  document.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  clearSelection();
});

describe('manuscript block selection', () => {
  it('selects from a short ordinary click and keeps the separate selection button keyboard reachable', async () => {
    const container = await mount();
    const block = blockFor(container);
    await dispatchPointer(block, 'pointerdown', { timeStamp: 10 });
    await dispatchPointer(block, 'pointerup', { timeStamp: 50 });
    const click = await dispatchClick(block, 1);
    expect(click.defaultPrevented).toBe(false);
    expect(groupFor(container).dataset.selected).toBe('true');

    const selectionButton = container.querySelector<HTMLButtonElement>('.manuscript-block-select')!;
    expect(selectionButton.type).toBe('button');
    selectionButton.focus();
    await act(async () => selectionButton.click());
    expect(groupFor(container).dataset.selected).toBeUndefined();
  });

  it('restores the prior block state after a mouse double click while native word selection remains available', async () => {
    const container = await mount();
    const block = blockFor(container);
    await dispatchPointer(block, 'pointerdown', { timeStamp: 10, clientX: 20, clientY: 20 });
    await dispatchPointer(block, 'pointerup', { timeStamp: 50, clientX: 20, clientY: 20 });
    await dispatchClick(block, 1);
    expect(groupFor(container).dataset.selected).toBe('true');

    selectBlockText(block);
    await dispatchPointer(block, 'pointerdown', { timeStamp: 100, clientX: 20, clientY: 20 });
    await dispatchPointer(block, 'pointerup', { timeStamp: 140, clientX: 20, clientY: 20 });
    await dispatchClick(block, 2);
    await dispatchDoubleClick(block);

    expect(groupFor(container).dataset.selected).toBeUndefined();
    expect(document.getSelection()?.toString()).toContain('第一块正文');
  });

  it('blocks moved, non-collapsed, cleared drag selections and preserves the selected text', async () => {
    const container = await mount();
    const block = blockFor(container);
    await dispatchPointer(block, 'pointerdown', { timeStamp: 10, clientX: 10, clientY: 10 });
    await dispatchPointer(block, 'pointermove', { timeStamp: 30, clientX: 40, clientY: 10 });
    selectBlockText(block);
    clearSelection();
    await dispatchPointer(block, 'pointerup', { timeStamp: 50, clientX: 40, clientY: 10 });
    await dispatchClick(block, 1);

    expect(groupFor(container).dataset.selected).toBeUndefined();
    expect(document.getSelection()?.toString()).toBe('');
  });

  it('does not mistake a collapsed caret move for a text selection', async () => {
    const container = await mount();
    const block = blockFor(container);
    moveCollapsedCaret(block, 0);
    await dispatchPointer(block, 'pointerdown', { timeStamp: 10, clientX: 10, clientY: 10 });
    moveCollapsedCaret(block, 3);
    await dispatchPointer(block, 'pointerup', { timeStamp: 50, clientX: 10, clientY: 10 });
    await dispatchClick(block, 1);

    expect(groupFor(container).dataset.selected).toBe('true');
  });

  it('rejects long, cancelled, secondary-pointer and scrolled touch gestures', async () => {
    const container = await mount();
    let block = blockFor(container);

    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', isPrimary: false, timeStamp: 10 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', isPrimary: false, timeStamp: 50 });
    await dispatchClick(block, 1);

    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 2, timeStamp: 100 });
    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: false, timeStamp: 120 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 2, timeStamp: 150 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 3, isPrimary: false, timeStamp: 160 });
    await dispatchClick(block, 1);

    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 4, timeStamp: 200 });
    await dispatchPointer(block, 'pointercancel', { pointerType: 'touch', pointerId: 4, timeStamp: 220 });
    await dispatchClick(block, 1);

    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 5, timeStamp: 300 });
    await act(async () => block.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: true })));
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 5, timeStamp: 340 });
    await dispatchClick(block, 1);

    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 6, timeStamp: 400 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 6, timeStamp: 900 });
    await dispatchClick(block, 1);

    expect(groupFor(container).dataset.selected).toBeUndefined();

    block = blockFor(container);
    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 20, clientY: 20, timeStamp: 1_000 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 7, clientX: 20, clientY: 20, timeStamp: 1_040 });
    await dispatchClick(block, 1);
    block = blockFor(container);
    await dispatchPointer(block, 'pointerdown', { pointerType: 'touch', pointerId: 8, clientX: 24, clientY: 22, timeStamp: 1_150 });
    await dispatchPointer(block, 'pointerup', { pointerType: 'touch', pointerId: 8, clientX: 24, clientY: 22, timeStamp: 1_190 });
    await dispatchClick(block, 1);
    expect(groupFor(container).dataset.selected).toBeUndefined();

    const penContainer = await mount();
    let penBlock = blockFor(penContainer);
    await dispatchPointer(penBlock, 'pointerdown', { pointerType: 'pen', pointerId: 9, clientX: 30, clientY: 30, timeStamp: 2_000 });
    await dispatchPointer(penBlock, 'pointerup', { pointerType: 'pen', pointerId: 9, clientX: 30, clientY: 30, timeStamp: 2_040 });
    await dispatchClick(penBlock, 1);
    penBlock = blockFor(penContainer);
    await dispatchPointer(penBlock, 'pointerdown', { pointerType: 'pen', pointerId: 10, clientX: 35, clientY: 34, timeStamp: 2_150 });
    await dispatchPointer(penBlock, 'pointerup', { pointerType: 'pen', pointerId: 10, clientX: 35, clientY: 34, timeStamp: 2_190 });
    await dispatchClick(penBlock, 1);
    expect(groupFor(penContainer).dataset.selected).toBeUndefined();
  });
});
