import { describe, expect, it } from 'vitest';
import { deleteSourceSelection, toggleSourceSelection } from '../src/sourceSelection';
import type { Book } from '../src/types';

const book: Book = {
  id: 'book-one',
  title: 'Book One',
  writingBrief: '',
  characters: [
    { id: 'character-a', name: 'A', title: 'A', role: 'Lead', content: '', includeInPrompt: true },
    { id: 'character-b', name: 'B', title: 'B', role: 'Guide', content: '', includeInPrompt: true },
  ],
  worldRules: [
    { id: 'world-a', title: 'Rule A', content: '', includeInPrompt: true },
    { id: 'world-b', title: 'Rule B', content: '', includeInPrompt: false },
  ],
  canonFacts: [],
  summaries: [],
  chapters: [],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('source selection', () => {
  it('toggles independent rows for multi-selection', () => {
    const first = toggleSourceSelection(new Set(), 'character-a');
    const second = toggleSourceSelection(first, 'character-b');
    expect([...second]).toEqual(['character-a', 'character-b']);
    expect([...toggleSourceSelection(second, 'character-a')]).toEqual(['character-b']);
  });

  it('deletes only selected character cards', () => {
    const next = deleteSourceSelection(book, 'character', new Set(['character-a']));
    expect(next.characters.map((item) => item.id)).toEqual(['character-b']);
    expect(next.worldRules).toEqual(book.worldRules);
  });

  it('deletes multiple world rules without changing characters', () => {
    const next = deleteSourceSelection(book, 'world', new Set(['world-a', 'world-b']));
    expect(next.worldRules).toEqual([]);
    expect(next.characters).toEqual(book.characters);
  });
});
