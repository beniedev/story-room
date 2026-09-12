import { describe, expect, it } from 'vitest';
import { getDirectoryMoveImpact, moveDirectoryItem, reverseDirectoryMove } from '../src/directoryOperations';
import { applySummaryReferenceSelection } from '../src/contextReferences';
import { buildContextPlan } from '../src/contextPlan';
import type { Book } from '../src/types';

const fixture = (): Book => ({
  id: 'directory-book', title: '合成目录', writingBrief: '',
  characters: [], worldRules: [], canonFacts: [], summaries: [], branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  chapters: [
    { id: 'one', title: '第一章', sections: [
      { id: 'a', title: '前文', content: 'SYNTHETIC_REFERENCE_TEXT' },
      { id: 'b', title: '当前', content: '当前正文', contextReferences: [{ sectionId: 'a', mode: 'full', reason: 'manual' }] },
    ] },
    { id: 'empty', title: '空章', sections: [] },
    { id: 'two', title: '后章', sections: [{ id: 'c', title: '后文', content: '后文正文' }] },
  ],
});

describe('directory ordering', () => {
  it('moves chapters and sections to first, last and empty destinations without cloning prose or linked material', () => {
    const book = fixture();
    const moved = moveDirectoryItem(book, { kind: 'section', id: 'a', targetChapterId: 'empty', beforeId: null });
    expect(moved.chapters[0].sections.map((section) => section.id)).toEqual(['b']);
    expect(moved.chapters[1].sections[0]).toBe(book.chapters[0].sections[0]);
    expect(moved.characters).toBe(book.characters);
    expect(moved.branches).toBe(book.branches);
    expect(moved.chapters[0].sections[0].contextReferences).toBe(book.chapters[0].sections[1].contextReferences);
    expect(book.chapters[0].sections).toHaveLength(2);
    const reordered = moveDirectoryItem(moved, { kind: 'chapter', id: 'two', beforeId: 'one' });
    expect(reordered.chapters.map((chapter) => chapter.id)).toEqual(['two', 'one', 'empty']);
    expect(moveDirectoryItem(reordered, { kind: 'chapter', id: 'two', beforeId: null }).chapters.map((chapter) => chapter.id))
      .toEqual(['one', 'empty', 'two']);
    const first = moveDirectoryItem(moved, { kind: 'section', id: 'a', targetChapterId: 'one', beforeId: 'b' });
    expect(first).toEqual(book);
  });

  it('keeps no-op moves unchanged and rejects stale destinations', () => {
    const book = fixture();
    expect(moveDirectoryItem(book, { kind: 'chapter', id: 'one', beforeId: 'one' })).toBe(book);
    expect(moveDirectoryItem(book, { kind: 'chapter', id: 'one', beforeId: 'empty' })).toBe(book);
    expect(moveDirectoryItem(book, { kind: 'section', id: 'b', targetChapterId: 'one', beforeId: null })).toBe(book);
    expect(() => moveDirectoryItem(book, { kind: 'section', id: 'a', targetChapterId: 'missing', beforeId: null })).toThrow('目标章节');
    expect(() => moveDirectoryItem(book, { kind: 'section', id: 'a', targetChapterId: 'empty', beforeId: 'b' })).toThrow('目标位置');
    expect(() => moveDirectoryItem(book, { kind: 'chapter', id: 'missing', beforeId: null })).toThrow('找不到');
  });

  it('undoes position on the latest book, preserving later prose and new sections', () => {
    const book = fixture();
    const move = { kind: 'section' as const, id: 'a', targetChapterId: 'two', beforeId: null };
    const undo = reverseDirectoryMove(book, move);
    const moved = structuredClone(moveDirectoryItem(book, move));
    moved.chapters[2].sections[1].content = '移动之后继续写的正文';
    moved.chapters[0].sections.push({ id: 'new', title: '新节', content: '另一个新段落' });
    const restored = moveDirectoryItem(moved, undo);
    expect(restored.chapters[0].sections.map((section) => section.id)).toEqual(['a', 'b', 'new']);
    expect(restored.chapters[0].sections[0].content).toBe('移动之后继续写的正文');
    expect(restored.chapters[0].sections[2].content).toBe('另一个新段落');
    const chapterMove = { kind: 'chapter' as const, id: 'one', beforeId: null };
    expect(moveDirectoryItem(moveDirectoryItem(book, chapterMove), reverseDirectoryMove(book, chapterMove))).toEqual(book);
  });

  it('reports changed reference eligibility and the actual prompt follows the new order', () => {
    const book = fixture();
    const move = { kind: 'section' as const, id: 'a', targetChapterId: 'two', beforeId: null };
    const request = { sectionId: 'b', mode: 'author' as const, instruction: '继续' };
    expect(JSON.stringify(buildContextPlan(book, request).messages)).toContain('SYNTHETIC_REFERENCE_TEXT');
    expect(getDirectoryMoveImpact(book, move)).toEqual([{
      targetSectionId: 'b', targetTitle: '当前', sourceSectionId: 'a', sourceTitle: '前文', availableAfter: false,
    }]);
    const moved = moveDirectoryItem(book, move);
    expect(JSON.stringify(buildContextPlan(moved, request).messages)).not.toContain('SYNTHETIC_REFERENCE_TEXT');
    const undo = reverseDirectoryMove(book, move);
    expect(getDirectoryMoveImpact(moved, undo)[0].availableAfter).toBe(true);
    expect(JSON.stringify(buildContextPlan(moveDirectoryItem(moved, undo), request).messages)).toContain('SYNTHETIC_REFERENCE_TEXT');
  });

  it('preserves inactive references on confirmation unless explicitly deselected and never adds a future reference', () => {
    const book = moveDirectoryItem(fixture(), { kind: 'section', id: 'a', targetChapterId: 'two', beforeId: null });
    expect(applySummaryReferenceSelection(book, 'b', []).chapters[0].sections[0].contextReferences)
      .toEqual([{ sectionId: 'a', mode: 'full', reason: 'manual' }]);
    expect(applySummaryReferenceSelection(book, 'b', [], ['a']).chapters[0].sections[0].contextReferences).toHaveLength(1);
    expect(applySummaryReferenceSelection(book, 'b', [], []).chapters[0].sections[0].contextReferences).toBeUndefined();
    expect(() => applySummaryReferenceSelection(book, 'b', [], ['c'])).toThrow('引用已经改变');
  });
});
