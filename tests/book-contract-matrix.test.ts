import { describe, expect, it } from 'vitest';
import { validateBook } from '../server/bookValidation.ts';
import { StoreInputError } from '../server/storeErrors.ts';
import { parseBookBackup } from '../src/bookImport';
import { createSectionMemory } from '../src/sectionMemory';
import type { Book } from '../src/types';

const makeBook = (): Book => ({
  id: 'contract-book',
  title: 'Synthetic contract book',
  writingBrief: '',
  characters: [{ id: 'lead', name: 'Lead', role: 'lead', title: '', content: '', includeInPrompt: true }],
  worldRules: [],
  canonFacts: [],
  summaries: [{ id: 'summary', title: '', content: '', includeInPrompt: true, sourceSectionIds: ['source'] }],
  chapters: [{ id: 'chapter', title: '', sections: [
    { id: 'source', title: '', content: 'Earlier prose.' },
    { id: 'target', title: '', content: 'Current prose.' },
  ] }],
  branches: [{ id: 'branch', title: '', fromSectionId: 'source' }],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

type ContractCase = {
  name: string;
  change: (book: Book) => void;
  importAccepted: boolean;
  storeAccepted: boolean;
};

const cases: ContractCase[] = [
  { name: 'legacy optional fields', change: () => {}, importAccepted: true, storeAccepted: true },
  { name: 'unsafe Book ID', change: (book) => { book.id = '../other'; }, importAccepted: false, storeAccepted: false },
  { name: 'foreign source scope', change: (book) => { book.characters[0].loadedSectionIds = ['foreign']; }, importAccepted: false, storeAccepted: false },
  { name: 'foreign Summary source', change: (book) => { book.summaries[0].sourceSectionIds = ['foreign']; }, importAccepted: false, storeAccepted: false },
  { name: 'foreign Branch source', change: (book) => { book.branches[0].fromSectionId = 'foreign'; }, importAccepted: false, storeAccepted: false },
  { name: 'foreign POV character', change: (book) => {
    book.chapters[0].sections[1].plan = { goal: '', intendedBeats: [], povCharacterId: 'foreign' };
  }, importAccepted: false, storeAccepted: false },
  { name: 'foreign context reference', change: (book) => {
    book.chapters[0].sections[1].contextReferences = [{ sectionId: 'foreign', mode: 'full', reason: 'manual' }];
  }, importAccepted: false, storeAccepted: false },
  { name: 'self context reference', change: (book) => {
    book.chapters[0].sections[1].contextReferences = [{ sectionId: 'target', mode: 'full', reason: 'manual' }];
  }, importAccepted: false, storeAccepted: false },
  { name: 'duplicate context reference', change: (book) => {
    book.chapters[0].sections[1].contextReferences = [
      { sectionId: 'source', mode: 'full', reason: 'manual' },
      { sectionId: 'source', mode: 'both', reason: 'manual' },
    ];
  }, importAccepted: false, storeAccepted: false },
  { name: 'duplicate Section identity', change: (book) => { book.chapters[0].sections[1].id = 'source'; }, importAccepted: false, storeAccepted: false },
  { name: 'stored future reference, excluded separately by planner', change: (book) => {
    book.chapters[0].sections[0].contextReferences = [{ sectionId: 'target', mode: 'full', reason: 'manual' }];
  }, importAccepted: true, storeAccepted: true },
  { name: 'broken adopted candidate mirror', change: (book) => {
    book.chapters[0].sections[1].blocks = [{
      id: 'answer', kind: 'assistant', content: 'Wrong mirror.',
      candidates: [{ id: 'candidate', content: 'Accepted prose.' }], adoptedCandidateId: 'candidate',
    }];
  }, importAccepted: false, storeAccepted: false },
  // Import is lossless backup validation; store preserves these legacy tolerances.
  { name: 'legacy block body mirror', change: (book) => {
    book.chapters[0].sections[1].blocks = [{ id: 'legacy-answer', kind: 'assistant', content: 'Different prose.' }];
  }, importAccepted: false, storeAccepted: true },
  { name: 'invalid Book timestamp', change: (book) => { book.updatedAt = 'invalid'; }, importAccepted: false, storeAccepted: true },
  { name: 'missing Book timestamp', change: (book) => { delete (book as Partial<Book>).updatedAt; }, importAccepted: false, storeAccepted: true },
  { name: 'duplicate source load scope', change: (book) => { book.characters[0].loadedSectionIds = ['source', 'source']; }, importAccepted: false, storeAccepted: true },
  { name: 'duplicate Summary source', change: (book) => { book.summaries[0].sourceSectionIds = ['source', 'source']; }, importAccepted: false, storeAccepted: true },
  { name: 'invalid Memory timestamp', change: (book) => {
    const section = book.chapters[0].sections[1];
    section.memory = createSectionMemory({ synopsis: '', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [] },
      section.content, 'manual', 'invalid');
  }, importAccepted: false, storeAccepted: true },
  { name: 'unconfirmed Memory remains stored data', change: (book) => {
    const section = book.chapters[0].sections[1];
    section.memory = createSectionMemory({ synopsis: '', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [] },
      section.content, 'model-draft', '2026-01-01T00:00:00.000Z');
  }, importAccepted: true, storeAccepted: true },
];

describe('import and store validation contract matrix without IO', () => {
  it.each(cases)('$name: import=$importAccepted, store=$storeAccepted', ({ change, importAccepted, storeAccepted }) => {
    const book = makeBook();
    change(book);
    const before = structuredClone(book);
    const importBook = () => parseBookBackup(JSON.stringify(book));
    const storeBook = () => validateBook(book);
    if (importAccepted) expect(importBook).not.toThrow();
    else expect(importBook).toThrow(Error);
    if (storeAccepted) expect(storeBook).not.toThrow();
    else expect(storeBook).toThrow(StoreInputError);
    expect(book).toEqual(before);
  });
});
