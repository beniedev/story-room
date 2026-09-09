import type { AddressInfo } from 'node:net';
import { createStoryServer } from '../server/main.ts';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryStore } from '../server/store.ts';
import { createLegacyFixtureBook } from '../src/fixtures.ts';
import { createSectionMemory } from '../src/sectionMemory';
import type { Book, BookIndexEntry } from '../src/types.ts';

const temporaryRoots: string[] = [];

const expectMissing = async (file: string) => {
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
};

const makeIntegrityBook = (): Book => ({
  id: 'integrity-book',
  title: 'Integrity Book',
  writingBrief: '',
  characters: [{
    id: 'integrity-character',
    name: 'Character',
    role: 'lead',
    title: 'Character',
    content: 'Character context.',
    includeInPrompt: true,
  }],
  worldRules: [{
    id: 'integrity-rule',
    title: 'Rule',
    content: 'Rule context.',
    includeInPrompt: true,
  }],
  canonFacts: [{
    id: 'integrity-fact',
    title: 'Fact',
    content: 'Fact context.',
    includeInPrompt: true,
  }],
  summaries: [{
    id: 'integrity-summary',
    title: 'Summary',
    content: 'Summary context.',
    includeInPrompt: true,
    sourceSectionIds: ['integrity-source'],
  }],
  chapters: [{
    id: 'integrity-chapter',
    title: 'Chapter',
    sections: [
      { id: 'integrity-source', title: 'Source', content: 'Source.' },
      {
        id: 'integrity-target',
        title: 'Target',
        content: 'Target.',
        blocks: [{ id: 'integrity-block', kind: 'assistant', content: 'Target block.' }],
        plan: { goal: 'Continue.', intendedBeats: ['Beat'], povCharacterId: 'integrity-character' },
        contextReferences: [{ sectionId: 'integrity-source', mode: 'full', reason: 'manual' }],
      },
    ],
  }],
  branches: [{ id: 'integrity-branch', title: 'Branch', fromSectionId: 'integrity-source' }],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

class FailingDeleteStore extends StoryStore {
  protected override async removeBookTree(_directory: string) {
    throw new Error('synthetic quarantine removal failure');
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('story store', () => {
  it('round-trips manuscript bytes while keeping source types separate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const content = 'Line one.\r\n\r\n第二行保留原始换行。';
    const book: Book = {
      id: 'round-trip-book',
      title: 'Round Trip',
      plotOutline: 'Follow the signal.',
      writingBrief: 'Keep it quiet.',
      characters: [],
      worldRules: [{
        id: 'rule-one',
        title: 'Rule',
        content: 'A rule.',
        includeInPrompt: true,
        loadedSectionIds: ['section-one'],
      }],
      canonFacts: [{ id: 'fact-one', title: 'Fact', content: 'A fact.', includeInPrompt: true }],
      summaries: [{
        id: 'summary-one',
        title: 'Summary',
        content: 'A summary.',
        includeInPrompt: true,
        sourceSectionIds: ['section-one'],
      }],
      chapters: [{
        id: 'chapter-one',
        title: 'Chapter',
        sections: [
          { id: 'section-zero', title: 'Earlier Section', content: 'Earlier manuscript.' },
          {
            id: 'section-one',
            title: 'Section',
            content,
            note: '只在当前 Section 生效。',
            plan: { goal: '未来目标', intendedBeats: ['下一拍'] },
            memory: createSectionMemory({
              synopsis: '当前摘要',
              beats: ['当前节拍'],
              continuityFacts: [],
              characterStateChanges: [],
              foreshadowingCandidates: [],
            }, content, 'model-confirmed', '2026-01-01T00:00:00.000Z'),
            previousMemory: createSectionMemory({
              synopsis: '上一版摘要',
              beats: [],
              continuityFacts: [],
              characterStateChanges: [],
              foreshadowingCandidates: [],
            }, content, 'manual', '2025-12-31T00:00:00.000Z'),
            blocks: [
              { id: 'section-one-user', kind: 'user', content: '先观察窗外。' },
              { id: 'section-one-assistant', kind: 'assistant', content: '微光仍未消失。' },
            ],
            contextReferences: [{ sectionId: 'section-zero', mode: 'full', reason: 'manual' }],
          },
        ],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.saveBook(book);
    const loaded = await store.loadBook(book.id);
    const loadedTarget = loaded.chapters[0]?.sections.find((item) => item.id === 'section-one');

    expect(loadedTarget?.content).toBe(content);
    expect(loadedTarget?.note).toBe('只在当前 Section 生效。');
    expect(loadedTarget?.plan).toEqual({ goal: '未来目标', intendedBeats: ['下一拍'] });
    expect(loadedTarget?.memory?.provenance).toBe('model-confirmed');
    expect(loadedTarget?.memory?.status).toBe('fresh');
    expect(loadedTarget?.previousMemory?.synopsis).toBe('上一版摘要');
    expect(loadedTarget?.blocks).toEqual([
      { id: 'section-one-user', kind: 'user', content: '先观察窗外。' },
      { id: 'section-one-assistant', kind: 'assistant', content: '微光仍未消失。' },
    ]);
    expect(loadedTarget?.contextReferences).toEqual([{ sectionId: 'section-zero', mode: 'full', reason: 'manual' }]);
    expect(loaded.plotOutline).toBe('Follow the signal.');
    expect(loaded.worldRules[0]?.loadedSectionIds).toEqual(['section-one']);
    expect(await readFile(path.join(root, 'books', book.id, 'canon', 'fact-one.json'), 'utf8')).toContain('A fact.');
    expect(await readFile(path.join(root, 'books', book.id, 'summaries', 'summary-one.json'), 'utf8')).toContain('sourceSectionIds');
    expect(await readFile(path.join(root, 'books', book.id, 'world', 'rule-one.md'), 'utf8')).toBe('A rule.');
  });

  it('migrates a legacy note on save and marks changed memory stale', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const original = 'Original manuscript.';
    const book: Book = {
      id: 'legacy-memory-book',
      title: 'Legacy Memory',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'legacy-memory-chapter',
        title: 'Chapter',
        sections: [{
          id: 'legacy-memory-section',
          title: 'Section',
          content: 'Changed manuscript.',
          note: '  exact legacy goal\nsecond line  ',
          memory: createSectionMemory({
            synopsis: 'Old synopsis',
            beats: [],
            continuityFacts: [],
            characterStateChanges: [],
            foreshadowingCandidates: [],
          }, original),
        }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const store = new StoryStore(root);
    await store.saveBook(book);
    const loaded = await store.loadBook(book.id);
    const section = loaded.chapters[0]?.sections[0];
    expect(section?.note).toBe('  exact legacy goal\nsecond line  ');
    expect(section?.plan).toBeUndefined();
    expect(section?.memory?.status).toBe('stale');
    const manifest = await readFile(path.join(root, 'books', book.id, 'book.json'), 'utf8');
    expect(manifest).toContain('exact legacy goal');
    expect(manifest).toContain('"note"');
    expect(manifest).not.toContain('"plan"');
  });

  it('rejects duplicate context reference source IDs at the host boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const book: Book = {
      id: 'duplicate-reference-book',
      title: 'Duplicate Reference',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'duplicate-reference-chapter',
        title: 'Chapter',
        sections: [
          { id: 'duplicate-reference-source', title: 'Source', content: 'Source.' },
          {
            id: 'duplicate-reference-target',
            title: 'Target',
            content: 'Target.',
            contextReferences: [
              { sectionId: 'duplicate-reference-source', mode: 'full', reason: 'manual' },
              { sectionId: 'duplicate-reference-source', mode: 'summary', reason: 'manual' },
            ],
          },
        ],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await expect(new StoryStore(root).saveBook(book)).rejects.toThrow('不得重复');
  });

  it('rejects duplicate IDs and broken references before writing a Book', async () => {
    const cases: Array<[string, (book: Book) => void]> = [
      ['duplicate character IDs', (book) => book.characters.push({ ...book.characters[0]! })],
      ['duplicate world rule IDs', (book) => book.worldRules.push({ ...book.worldRules[0]! })],
      ['duplicate canon fact IDs', (book) => book.canonFacts.push({ ...book.canonFacts[0]! })],
      ['duplicate summary IDs', (book) => book.summaries.push({ ...book.summaries[0]! })],
      ['duplicate chapter IDs', (book) => book.chapters.push({ ...book.chapters[0]! })],
      ['duplicate section IDs', (book) => book.chapters.push({
        id: 'integrity-second-chapter',
        title: 'Second Chapter',
        sections: [{ ...book.chapters[0]!.sections[0]! }],
      })],
      ['duplicate block IDs', (book) => {
        const target = book.chapters[0]!.sections[1]!;
        target.blocks = [...target.blocks!, { ...target.blocks![0]! }];
      }],
      ['duplicate branch IDs', (book) => book.branches.push({ ...book.branches[0]! })],
      ['unknown loaded Section', (book) => { book.characters[0]!.loadedSectionIds = ['missing-section']; }],
      ['unknown Summary source', (book) => { book.summaries[0]!.sourceSectionIds = ['missing-section']; }],
      ['unknown context reference', (book) => {
        book.chapters[0]!.sections[1]!.contextReferences = [{ sectionId: 'missing-section', mode: 'full', reason: 'manual' }];
      }],
      ['future context reference', (book) => {
        book.chapters[0]!.sections[1]!.contextReferences = [{ sectionId: 'integrity-target', mode: 'full', reason: 'manual' }];
      }],
      ['unknown Branch source', (book) => { book.branches[0]!.fromSectionId = 'missing-section'; }],
      ['unknown POV character', (book) => { book.chapters[0]!.sections[1]!.plan!.povCharacterId = 'missing-character'; }],
    ];

    for (const [label, mutate] of cases) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const store = new StoryStore(root);
      const book = makeIntegrityBook();
      mutate(book);
      await expect(store.saveBook(book), label).rejects.toThrow();
      await expectMissing(path.join(root, 'library.json'));
    }
  });

  it('serializes concurrent saves so the library keeps both Books', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
    const store = new StoryStore(root);
    const makeBook = (id: string, content: string): Book => ({
      id,
      title: id,
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{ id: `${id}-chapter`, title: 'Chapter', sections: [{ id: `${id}-section`, title: 'Section', content }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await Promise.all([
      store.saveBook(makeBook('book-one', 'One')),
      store.saveBook(makeBook('book-two', 'Two')),
    ]);

    expect((await store.listBooks()).map((item) => item.id)).toEqual(expect.arrayContaining(['book-one', 'book-two']));
    expect((await store.loadBook('book-one')).chapters[0]?.sections[0]?.content).toBe('One');
    expect((await store.loadBook('book-two')).chapters[0]?.sections[0]?.content).toBe('Two');
  });

  it('removes stale managed files while preserving user files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book: Book = {
      id: 'reconcile-book',
      title: 'Reconcile',
      writingBrief: '',
      characters: [
        { id: 'character-one', name: 'One', role: 'lead', title: 'One', content: 'Keep', includeInPrompt: true },
        { id: 'character-two', name: 'Two', role: 'support', title: 'Two', content: 'Remove', includeInPrompt: true },
      ],
      worldRules: [
        { id: 'rule-one', title: 'One', content: 'Keep', includeInPrompt: true },
        { id: 'rule-two', title: 'Two', content: 'Remove', includeInPrompt: true },
      ],
      canonFacts: [
        { id: 'fact-one', title: 'One', content: 'Keep', includeInPrompt: true },
        { id: 'fact-two', title: 'Two', content: 'Remove', includeInPrompt: true },
      ],
      summaries: [
        { id: 'summary-one', title: 'One', content: 'Keep', includeInPrompt: true, sourceSectionIds: [] },
        { id: 'summary-two', title: 'Two', content: 'Remove', includeInPrompt: true, sourceSectionIds: [] },
      ],
      chapters: [{
        id: 'chapter-one',
        title: 'Chapter',
        sections: [
          { id: 'section-one', title: 'One', content: 'Keep' },
          { id: 'section-two', title: 'Two', content: 'Remove' },
        ],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.saveBook(book);
    const bookRoot = path.join(root, 'books', book.id);
    await writeFile(path.join(bookRoot, 'characters', 'notes.txt'), 'user file', 'utf8');
    await writeFile(path.join(bookRoot, 'manuscript', 'chapter-one', 'README.txt'), 'user file', 'utf8');

    const next: Book = {
      ...book,
      characters: [book.characters[0]!],
      worldRules: [book.worldRules[0]!],
      canonFacts: [book.canonFacts[0]!],
      summaries: [book.summaries[0]!],
      chapters: [{ ...book.chapters[0]!, sections: [book.chapters[0]!.sections[0]!] }],
    };
    await store.saveBook(next);

    await expectMissing(path.join(bookRoot, 'characters', 'character-two.json'));
    await expectMissing(path.join(bookRoot, 'world', 'rule-two.md'));
    await expectMissing(path.join(bookRoot, 'canon', 'fact-two.json'));
    await expectMissing(path.join(bookRoot, 'summaries', 'summary-two.json'));
    await expectMissing(path.join(bookRoot, 'manuscript', 'chapter-one', 'section-two.md'));
    expect(await readFile(path.join(bookRoot, 'characters', 'notes.txt'), 'utf8')).toBe('user file');
    expect(await readFile(path.join(bookRoot, 'manuscript', 'chapter-one', 'README.txt'), 'utf8')).toBe('user file');
  });

  it('removes empty managed directories after a whole chapter or section set is deleted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book: Book = {
      id: 'empty-tree-book',
      title: 'Empty Tree',
      writingBrief: '',
      characters: [{ id: 'character-one', name: 'One', role: 'lead', title: 'One', content: 'Text', includeInPrompt: true }],
      worldRules: [{ id: 'rule-one', title: 'One', content: 'Text', includeInPrompt: true }],
      canonFacts: [{ id: 'fact-one', title: 'One', content: 'Text', includeInPrompt: true }],
      summaries: [{ id: 'summary-one', title: 'One', content: 'Text', includeInPrompt: true, sourceSectionIds: [] }],
      chapters: [{ id: 'chapter-one', title: 'Chapter', sections: [{ id: 'section-one', title: 'One', content: 'Text' }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.saveBook(book);
    await store.saveBook({ ...book, characters: [], worldRules: [], canonFacts: [], summaries: [], chapters: [] });

    const bookRoot = path.join(root, 'books', book.id);
    for (const directory of ['characters', 'world', 'canon', 'summaries', 'manuscript']) {
      await expectMissing(path.join(bookRoot, directory));
    }
    await expectMissing(path.join(bookRoot, 'manuscript', 'chapter-one'));
  });

  it('removes renamed managed IDs without affecting another Book', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const first: Book = {
      id: 'rename-book',
      title: 'Rename',
      writingBrief: '',
      characters: [{ id: 'old-name', name: 'Old', role: 'lead', title: 'Old', content: 'Old', includeInPrompt: true }],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const second: Book = {
      ...first,
      id: 'other-book',
      title: 'Other',
      characters: [{ id: 'other-character', name: 'Other', role: 'lead', title: 'Other', content: 'Keep', includeInPrompt: true }],
    };
    await store.saveBook(first);
    await store.saveBook(second);
    await store.saveBook({
      ...first,
      characters: [{ ...first.characters[0]!, id: 'new-name', name: 'New' }],
    });

    await expectMissing(path.join(root, 'books', first.id, 'characters', 'old-name.json'));
    expect(await readFile(path.join(root, 'books', first.id, 'characters', 'new-name.json'), 'utf8')).toContain('New');
    expect(await readFile(path.join(root, 'books', second.id, 'characters', 'other-character.json'), 'utf8')).toContain('Keep');
  });

  it('fails closed on a junction or non-directory managed path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book: Book = {
      id: 'unsafe-tree-book',
      title: 'Unsafe Tree',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.saveBook(book);
    const bookRoot = path.join(root, 'books', book.id);
    const outside = path.join(root, 'outside-sentinel');
    await mkdir(outside, { recursive: true });
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'unchanged', 'utf8');

    const linkedDirectory = path.join(bookRoot, 'characters');
    try {
      await symlink(outside, linkedDirectory, 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    await expect(store.saveBook({
      ...book,
      characters: [{ id: 'character-one', name: 'One', role: 'lead', title: 'One', content: 'No write', includeInPrompt: true }],
    })).rejects.toThrow();
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged');
    await rm(linkedDirectory, { recursive: true, force: true });

    await writeFile(path.join(bookRoot, 'world'), 'not a directory', 'utf8');
    await expect(store.saveBook(book)).rejects.toThrow();
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged');
  });

  it('fails closed when a managed source directory is replaced by a junction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = makeIntegrityBook();
    await store.saveBook(book);

    const outside = path.join(root, 'outside-characters');
    const charactersDirectory = path.join(root, 'books', book.id, 'characters');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, `${book.characters[0]!.id}.json`), JSON.stringify(book.characters[0]), 'utf8');
    await rm(charactersDirectory, { recursive: true, force: true });
    try {
      await symlink(outside, charactersDirectory, 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    await expect(store.loadBook(book.id)).rejects.toThrow('结构异常');
  });

  it('restores the Book and library when quarantine removal fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const book = makeIntegrityBook();
    const store = new StoryStore(root);
    await store.saveBook(book);

    const failingStore = new FailingDeleteStore(root);
    await expect(failingStore.deleteBook(book.id)).rejects.toThrow('synthetic quarantine removal failure');

    expect((await JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')) as BookIndexEntry[])
      .map((entry) => entry.id)).toContain(book.id);
    expect((await failingStore.loadBook(book.id)).title).toBe(book.title);
    expect(await readdir(path.join(root, 'books'))).toEqual([book.id]);
  });

  it('loads a legacy Section without optional note or blocks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book: Book = {
      id: 'legacy-section-book',
      title: 'Legacy Section',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{ id: 'legacy-chapter', title: 'Chapter', sections: [{ id: 'legacy-section', title: 'Section', content: 'Old prose' }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.saveBook(book);
    const loaded = await store.loadBook(book.id);

    expect(loaded.chapters[0]?.sections[0]?.content).toBe('Old prose');
    expect(loaded.chapters[0]?.sections[0]?.note).toBeUndefined();
    expect(loaded.chapters[0]?.sections[0]?.blocks).toBeUndefined();
  });

  it('round-trips answer candidates while manuscript storage keeps adopted content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book: Book = {
      id: 'candidate-book',
      title: 'Candidate Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: 'candidate-chapter',
        title: 'Chapter',
        sections: [{
          id: 'candidate-section',
          title: 'Section',
          content: '用户输入\n\n采用答案',
          blocks: [
            { id: 'candidate-user', kind: 'user', content: '用户输入' },
            {
              id: 'candidate-answer',
              kind: 'assistant',
              content: '采用答案',
              adoptedCandidateId: 'candidate-1',
              candidates: [
                { id: 'candidate-1', content: '采用答案', sourceSignature: '0123456789abcdef' },
                { id: 'candidate-2', content: '备选答案', sourceSignature: '0123456789abcdef' },
              ],
            },
          ],
        }],
      }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.saveBook(book);
    const loaded = await store.loadBook(book.id);
    const section = loaded.chapters[0]?.sections[0];
    expect(section?.content).toBe('用户输入\n\n采用答案');
    expect(section?.blocks?.[1]?.adoptedCandidateId).toBe('candidate-1');
    expect(section?.blocks?.[1]?.candidates?.[1]?.content).toBe('备选答案');
    expect(await readFile(path.join(root, 'books', book.id, 'manuscript', 'candidate-chapter', 'candidate-section.md'), 'utf8'))
      .toBe('用户输入\n\n采用答案');
    const manifest = JSON.parse(await readFile(path.join(root, 'books', book.id, 'book.json'), 'utf8')) as {
      chapters: Array<{ sections: Array<{ blocks?: Array<{ candidates?: unknown[] }> }> }>;
    };
    expect(manifest.chapters[0]?.sections[0]?.blocks?.[1]?.candidates).toHaveLength(2);
  });

  it('rejects an answer block whose content is not the adopted candidate mirror', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = makeIntegrityBook();
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('integrity section missing');
    section.content = 'mismatch';
    section.blocks = [{
      id: 'answer-block',
      kind: 'assistant',
      content: 'adopted',
      adoptedCandidateId: 'candidate-1',
      candidates: [{ id: 'candidate-1', content: 'adopted' }],
    }];
    await expect(store.saveBook(book)).rejects.toThrow('Section 正文必须镜像');
  });

  it('rejects candidate metadata with content but no adopted candidate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = makeIntegrityBook();
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('integrity section missing');
    section.content = 'candidate text';
    section.blocks = [{ id: 'answer-block', kind: 'assistant', content: 'candidate text', candidates: [] }];
    await expect(store.saveBook(book)).rejects.toThrow('没有 adopted candidate');
  });

  it('upgrades present legacy fixtures without restoring a deliberately deleted example', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    await store.listBooks();
    await store.saveBook(createLegacyFixtureBook('the-observatory', 'The Observatory', 'Mira'));
    const customized = createLegacyFixtureBook('harbor-at-noon', 'Harbor at Noon', 'Rowan');
    customized.writingBrief = 'Keep this user edit.';
    await store.saveBook(customized);
    await store.deleteBook('south-of-snowline');

    const reopened = new StoryStore(root);
    const library = await reopened.listBooks();
    expect(library.map((item) => item.id)).toEqual(expect.arrayContaining([
      'the-observatory',
      'harbor-at-noon',
    ]));
    expect(library.map((item) => item.id)).not.toContain('south-of-snowline');
    await expect(reopened.loadBook('south-of-snowline')).rejects.toThrow();
    expect((await reopened.loadBook('the-observatory')).characters).toHaveLength(5);
    expect((await reopened.loadBook('harbor-at-noon')).writingBrief).toBe('Keep this user edit.');
  });

  it('fails closed when the library file is malformed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const library = path.join(root, 'library.json');
    await writeFile(library, '{not-json}\n', 'utf8');
    const store = new StoryStore(root);

    await expect(store.listBooks()).rejects.toThrow();
    await expect(store.saveBook({
      id: 'safe-book',
      title: 'Safe Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })).rejects.toThrow();
    expect(await readFile(library, 'utf8')).toBe('{not-json}\n');
  });

  it('returns actionable HTTP statuses without exposing internal errors', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
    const server = createStoryServer(new StoryStore(root));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const missing = await fetch(`${base}/api/books/missing-book`);
      expect(missing.status).toBe(404);

      const malformed = await fetch(`${base}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(malformed.status).toBe(400);

      const wrongMethod = await fetch(`${base}/api/health`, { method: 'POST' });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('allow')).toBe('GET');

      const created = await fetch(`${base}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Temporary Book' }),
      });
      const createdBook = await created.json() as Book;
      const deleted = await fetch(`${base}/api/books/${createdBook.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect(await fetch(`${base}/api/books/${createdBook.id}`)).toHaveProperty('status', 404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
