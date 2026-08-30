import { describe, expect, it } from 'vitest';
import {
  deleteDirectorySelection,
  toggleChapterSelection,
  toggleSectionSelection,
  type DirectorySelection,
} from '../src/directorySelection';
import type { Book } from '../src/types';

const book: Book = {
  id: 'book-one',
  title: 'Book One',
  plotOutline: '',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [{
    id: 'summary-one',
    title: 'Summary',
    content: '',
    includeInPrompt: false,
    sourceSectionIds: ['section-a', 'section-c'],
  }],
  chapters: [
    {
      id: 'chapter-one',
      title: 'One',
      sections: [
        { id: 'section-a', title: 'A', content: 'A' },
        { id: 'section-b', title: 'B', content: 'B' },
      ],
    },
    {
      id: 'chapter-two',
      title: 'Two',
      sections: [{ id: 'section-c', title: 'C', content: 'C' }],
    },
  ],
  branches: [
    { id: 'branch-a', title: 'A branch', fromSectionId: 'section-a' },
    { id: 'branch-c', title: 'C branch', fromSectionId: 'section-c' },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const emptySelection = (): DirectorySelection => ({ chapterIds: new Set(), sectionIds: new Set() });

describe('directory selection', () => {
  it('selects and deselects every section with its chapter', () => {
    const selected = toggleChapterSelection(book, emptySelection(), 'chapter-one');
    expect([...selected.chapterIds]).toEqual(['chapter-one']);
    expect([...selected.sectionIds]).toEqual(['section-a', 'section-b']);

    const cleared = toggleChapterSelection(book, selected, 'chapter-one');
    expect(cleared.chapterIds.size).toBe(0);
    expect(cleared.sectionIds.size).toBe(0);
  });

  it('lets one section be selected without selecting its chapter', () => {
    const selected = toggleSectionSelection(book, emptySelection(), 'section-c');
    expect(selected.chapterIds.size).toBe(0);
    expect([...selected.sectionIds]).toEqual(['section-c']);
  });

  it('batch deletes only the selection and clears its references', () => {
    const selection = toggleSectionSelection(
      book,
      toggleChapterSelection(book, emptySelection(), 'chapter-one'),
      'section-c',
    );
    const result = deleteDirectorySelection(book, selection);

    expect(result.book.chapters).toHaveLength(1);
    expect(result.book.chapters[0].sections).toHaveLength(0);
    expect(result.book.summaries[0].sourceSectionIds).toEqual([]);
    expect(result.book.branches).toEqual([]);
    expect([...result.removedSectionIds].sort()).toEqual(['section-a', 'section-b', 'section-c']);
  });
});
