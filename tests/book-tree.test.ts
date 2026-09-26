import { describe, expect, it } from 'vitest';
import { decodeBookManifest, encodeBookManifest, sourceWriteBatches } from '../server/storage/bookTree.ts';
import { StoreDataError } from '../server/storeErrors.ts';
import type { Book } from '../src/types.ts';

const makeBook = (): Book => ({
  id: 'source-book',
  title: 'Synthetic Book',
  writingBrief: '',
  characters: [{ id: 'character-one', title: 'Character', name: 'Character', role: '', content: 'Character context.', includeInPrompt: true }],
  worldRules: [{ id: 'world-one', title: 'World', content: 'World context.', includeInPrompt: true }],
  canonFacts: [{ id: 'fact-one', title: 'Fact', content: 'Fact context.', includeInPrompt: true }],
  summaries: [{ id: 'summary-one', title: 'Summary', content: 'Summary context.', includeInPrompt: true, sourceSectionIds: ['section-one'] }],
  chapters: [{ id: 'chapter-one', title: 'Chapter', sections: [{ id: 'section-one', title: 'Section', content: 'Manuscript.' }] }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const firstBatch = (writes: ReturnType<typeof sourceWriteBatches>) => {
  const next = writes.next();
  if (next.done) throw new Error('Expected a source batch.');
  return next.value;
};

describe('Book tree boundaries', () => {
  it('materializes source content only when its write callback starts', () => {
    const book = makeBook();
    Object.defineProperty(book.characters[0], 'toJSON', {
      value: () => { throw new Error('synthetic serialization failure'); },
    });

    const batch = firstBatch(sourceWriteBatches(book, 'book-root'));
    expect(() => batch[0]!()).toThrow('synthetic serialization failure');
  });

  it('does not inspect a later source group while the current batch is being written', () => {
    const book = makeBook();
    Object.defineProperty(book, 'worldRules', {
      get: () => { throw new Error('synthetic later group failure'); },
    });

    const writes = sourceWriteBatches(book, 'book-root');
    const batch = firstBatch(writes);
    expect(batch[0]!().content).toContain('Character context.');
    expect(() => writes.next()).toThrow('synthetic later group failure');
  });

  it.each(['character', 'world', 'canon', 'summary', 'chapter', 'section'] as const)(
    'rejects an unsafe stored %s ID before source paths can be used',
    (source) => {
      const manifest = encodeBookManifest(makeBook());
      const item = {
        character: manifest.characters[0]!,
        world: manifest.worldRules[0]!,
        canon: manifest.canonFacts[0]!,
        summary: manifest.summaries[0]!,
        chapter: manifest.chapters[0]!,
        section: manifest.chapters[0]!.sections[0]!,
      }[source];
      item.id = '../outside';

      expect(() => decodeBookManifest(manifest, 'source-book')).toThrow(StoreDataError);
    },
  );
});
