import { describe, expect, it } from 'vitest';
import { deleteBookSectionBlock, editBookSectionMemory, referenceLocation, renameBookChapter, renameBookSection } from '../src/application/bookRecipes';
import { createSectionMemory } from '../src/sectionMemory';
import type { Book, SectionMemoryDraft } from '../src/types';

const makeBook = (): Book => ({
  id: 'recipe-book', title: 'Synthetic book', writingBrief: '', characters: [], worldRules: [], canonFacts: [], summaries: [], branches: [],
  chapters: [
    { id: 'chapter-one', title: 'One', sections: [{ id: 'section-one', title: 'One', content: 'Synthetic source', blocks: [
      { id: 'block-one', kind: 'user', content: 'Synthetic source' },
      { id: 'block-two', kind: 'assistant', content: 'Synthetic answer' },
    ] }] },
    { id: 'chapter-two', title: 'Two', sections: [{ id: 'section-two', title: 'Two', content: 'Synthetic target' }] },
  ], updatedAt: '2026-01-01T00:00:00.000Z',
});
const draft = (synopsis: string): SectionMemoryDraft => ({ synopsis, beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [] });
const withMemory = () => {
  const book = makeBook();
  const section = book.chapters[0]!.sections[0]!;
  section.memory = createSectionMemory(draft('Current synthetic memory'), section.content);
  section.previousMemory = createSectionMemory(draft('Previous synthetic memory'), section.content);
  book.chapters[1]!.sections[0]!.contextReferences = [{ sectionId: section.id, mode: 'both', reason: 'manual' }];
  return book;
};

describe('Book mutation recipes', () => {
  it('renames only the addressed chapter and preserves the input and unrelated chapter identity', () => {
    const book = makeBook();
    const before = structuredClone(book);
    const changed = renameBookChapter(book, 'chapter-one', '  Renamed  ');
    expect(changed.chapters[0]!.title).toBe('Renamed');
    expect(changed.chapters[1]).toBe(book.chapters[1]);
    expect(changed.id).toBe(book.id);
    expect(book).toEqual(before);
  });

  it('requires both the chapter and section ID for title changes', () => {
    const book = makeBook();
    expect(renameBookSection(book, 'chapter-two', 'section-one', 'Wrong target')).toEqual(book);
    const changed = renameBookSection(book, 'chapter-one', 'section-one', '  Renamed section  ');
    expect(changed.chapters[0]!.sections[0]!.title).toBe('Renamed section');
    expect(changed.chapters[1]).toBe(book.chapters[1]);
    expect(book.chapters[0]!.sections[0]!.title).toBe('One');
  });

  it('deletes the selected block and derives prose from the remaining blocks without touching another section', () => {
    const book = makeBook();
    const changed = deleteBookSectionBlock(book, 'section-one', 'block-one');
    expect(changed.chapters[0]!.sections[0]!.blocks?.map((block) => block.id)).toEqual(['block-two']);
    expect(changed.chapters[0]!.sections[0]!.content).toBe('Synthetic answer');
    expect(changed.chapters[1]!.sections[0]).toBe(book.chapters[1]!.sections[0]);
    expect(book.chapters[0]!.sections[0]!.blocks).toHaveLength(2);
  });

  it('locates section ordinals across chapter boundaries and rejects missing IDs', () => {
    const book = makeBook();
    expect(referenceLocation(book, 'section-two')).toMatchObject({ chapter: book.chapters[1], sectionIndex: 0, ordinal: 1 });
    expect(referenceLocation(book, 'missing')).toBeUndefined();
  });

  it('deletes current memory, retains the previous version, and downgrades dependent references', () => {
    const book = withMemory();
    const before = structuredClone(book);
    const changed = editBookSectionMemory(book, 'section-one', 'delete', '2026-01-02T00:00:00.000Z');
    expect(changed.chapters[0]!.sections[0]!.memory).toBeUndefined();
    expect(changed.chapters[0]!.sections[0]!.previousMemory?.synopsis).toBe('Previous synthetic memory');
    expect(changed.chapters[1]!.sections[0]!.contextReferences?.[0]?.mode).toBe('full');
    expect(changed.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(book).toEqual(before);
  });

  it('rolls memory back without discarding the displaced version or reference scope', () => {
    const book = withMemory();
    const changed = editBookSectionMemory(book, 'section-one', 'rollback', book.updatedAt);
    expect(changed.chapters[0]!.sections[0]!.memory?.synopsis).toBe('Previous synthetic memory');
    expect(changed.chapters[0]!.sections[0]!.previousMemory?.synopsis).toBe('Current synthetic memory');
    expect(changed.chapters[1]!.sections[0]!.contextReferences?.[0]?.mode).toBe('both');
  });

  it('clears only previous memory without changing current memory or other Book fields', () => {
    const book = withMemory();
    const changed = editBookSectionMemory(book, 'section-one', 'clear-previous', book.updatedAt);
    expect(changed.chapters[0]!.sections[0]!.previousMemory).toBeUndefined();
    expect(changed.chapters[0]!.sections[0]!.memory?.synopsis).toBe('Current synthetic memory');
    expect(changed.title).toBe(book.title);
    expect(book.chapters[0]!.sections[0]!.previousMemory).toBeDefined();
  });
});
