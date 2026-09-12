import type { AddressInfo } from 'node:net';
import { createStoryServer } from '../server/main.ts';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StoreConflictError,
  StoryStore,
  type StoreDeleteFaultStage,
  type StoreFaultStage,
  type StoreRecoveryStage,
} from '../server/store.ts';
import { createLegacyFixtureBook } from '../src/fixtures.ts';
import { createSectionMemory, normalizeBook } from '../src/sectionMemory';
import type { Book, BookIndexEntry } from '../src/types.ts';
import { createBookExport } from '../src/bookExport';
import { parseBookBackup } from '../src/bookImport';
import { moveDirectoryItem, reverseDirectoryMove } from '../src/directoryOperations';

const temporaryRoots: string[] = [];

const expectMissing = async (file: string) => {
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
};

const stageDeleteTransaction = async (
  root: string,
  bookId: string,
  id: string,
  status: 'prepared' | 'committed',
) => {
  const transactionRoot = path.join(root, '.story-transactions', id);
  await mkdir(transactionRoot, { recursive: true });
  await copyFile(path.join(root, 'library.json'), path.join(transactionRoot, 'library.json'));
  await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
    schemaVersion: 1,
    id,
    bookId,
    operation: 'delete',
    status,
    snapshotReady: true,
    bookExists: true,
    libraryExists: true,
    bookFiles: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }, null, 2)}\n`, 'utf8');
  return {
    transactionRoot,
    quarantineRoot: path.join(transactionRoot, 'book'),
  };
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

const integrityBookFiles = (book: Book) => [
  'book.json',
  'characters/integrity-character.json',
  'world/integrity-rule.md',
  'canon/integrity-fact.json',
  'summaries/integrity-summary.json',
  `manuscript/${book.chapters[0]!.id}/${book.chapters[0]!.sections[0]!.id}.md`,
  `manuscript/${book.chapters[0]!.id}/${book.chapters[0]!.sections[1]!.id}.md`,
];

class FailingDeleteStore extends StoryStore {
  protected override async removeBookTree(_directory: string) {
    throw new Error('synthetic quarantine removal failure');
  }
}

class FaultingDeleteStore extends StoryStore {
  constructor(root: string, private readonly faultStage: StoreDeleteFaultStage) {
    super(root);
  }

  protected override async deleteTransactionCheckpoint(stage: StoreDeleteFaultStage) {
    if (stage === this.faultStage) throw new Error(`synthetic ${stage} failure`);
  }
}

class FaultingStore extends StoryStore {
  constructor(root: string, private readonly faultStage: StoreFaultStage) {
    super(root);
  }

  protected override async transactionCheckpoint(stage: StoreFaultStage) {
    if (stage === this.faultStage) throw new Error(`synthetic ${stage} failure`);
  }
}

class RecoveryFailingStore extends FaultingStore {
  protected override async recoveryCheckpoint(_stage: StoreRecoveryStage) {
    throw new Error('synthetic recovery failure');
  }
}

class FailingTransactionCleanupStore extends StoryStore {
  constructor(root: string, private readonly failureMessage = 'synthetic transaction cleanup failure') {
    super(root);
  }

  protected override async removeTransactionTree(_directory: string) {
    throw new Error(this.failureMessage);
  }
}

class PausingStore extends StoryStore {
  readonly reached: Promise<void>;
  private reachedResolve!: () => void;
  private readonly releasePromise: Promise<void>;
  private releaseResolve!: () => void;

  constructor(root: string) {
    super(root);
    this.reached = new Promise<void>((resolve) => { this.reachedResolve = resolve; });
    this.releasePromise = new Promise<void>((resolve) => { this.releaseResolve = resolve; });
  }

  release() {
    this.releaseResolve();
  }

  protected override async transactionCheckpoint(stage: StoreFaultStage) {
    if (stage !== 'after-sources') return;
    this.reachedResolve();
    await this.releasePromise;
  }
}

class SourceWriteRaceStore extends StoryStore {
  readonly sourceStarted: Promise<void>;
  private sourceStartedResolve!: () => void;
  private readonly sourceRelease: Promise<void>;
  private sourceReleaseResolve!: () => void;
  restoreStarted = false;

  constructor(root: string) {
    super(root);
    this.sourceStarted = new Promise<void>((resolve) => { this.sourceStartedResolve = resolve; });
    this.sourceRelease = new Promise<void>((resolve) => { this.sourceReleaseResolve = resolve; });
  }

  releaseSource() {
    this.sourceReleaseResolve();
  }

  protected override async writeManagedSource(file: string, content: string) {
    if (file.endsWith(path.join('characters', 'integrity-character.json'))) {
      this.sourceStartedResolve();
      await this.sourceRelease;
    }
    if (file.endsWith(path.join('characters', 'integrity-late-character.json'))) {
      throw new Error('synthetic source write failure');
    }
    await super.writeManagedSource(file, content);
  }

  protected override async recoveryCheckpoint(stage: StoreRecoveryStage) {
    if (stage === 'before-restore') this.restoreStarted = true;
  }
}

class PartialSaveCleanupStore extends StoryStore {
  private interrupted = false;

  protected override async removeTransactionTree(directory: string) {
    if (!this.interrupted) {
      this.interrupted = true;
      await rm(path.join(directory, 'book', 'book.json'), { force: false });
      throw new Error('synthetic partial save cleanup interruption');
    }
    await super.removeTransactionTree(directory);
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

  it('checks expectedUpdatedAt inside the serialized save boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const first = await store.saveBook({
      id: 'revision-book',
      title: 'Revision Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{ id: 'revision-chapter', title: 'Chapter', sections: [{ id: 'revision-section', title: 'Section', content: 'R0' }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = await store.saveBook({
      ...first,
      title: 'Revision R1',
      chapters: [{ ...first.chapters[0]!, sections: [{ ...first.chapters[0]!.sections[0]!, content: 'R1' }] }],
    }, { expectedUpdatedAt: first.updatedAt });

    await expect(store.saveBook({ ...second, title: 'Stale overwrite' }, {
      expectedUpdatedAt: first.updatedAt,
    })).rejects.toBeInstanceOf(StoreConflictError);
    expect((await store.loadBook(first.id)).title).toBe('Revision R1');
    expect((await store.loadBook(first.id)).chapters[0]?.sections[0]?.content).toBe('R1');
  });

  it('preserves references through move, disk reopen, JSON backup, import and undo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const fixture = makeIntegrityBook();
    fixture.chapters[0].sections[1].content = 'Target block.';
    const baseline = await store.saveBook(normalizeBook(fixture));
    const chapter = baseline.chapters[0];
    const source = chapter.sections[0];
    const target = chapter.sections[1];
    const move = { kind: 'section' as const, id: source.id, targetChapterId: chapter.id, beforeId: null };
    const undo = reverseDirectoryMove(baseline, move);
    const moved = await store.saveBook(moveDirectoryItem(baseline, move), { expectedUpdatedAt: baseline.updatedAt });
    const reopened = await new StoryStore(root).loadBook(moved.id);
    expect(reopened.chapters[0].sections[0].id).toBe(target.id);
    expect(reopened.chapters[0].sections[0].contextReferences).toEqual(target.contextReferences);
    const backup = createBookExport(reopened, 'json');
    const restored = await store.importBook(parseBookBackup(backup.content as string));
    expect(restored.id).not.toBe(baseline.id);
    const restoredAgain = await new StoryStore(root).loadBook(restored.id);
    const undone = await store.saveBook(moveDirectoryItem(restoredAgain, undo), { expectedUpdatedAt: restoredAgain.updatedAt });
    expect(undone.chapters).toEqual(baseline.chapters);
    expect((await store.loadBook(baseline.id)).chapters).toEqual(reopened.chapters);
  });

  it('imports a validated Book as a new copy without replacing the source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const source = await store.saveBook(makeIntegrityBook());
    const restored = await store.importBook(source);

    expect(restored.id).not.toBe(source.id);
    expect(restored.title).toBe(source.title);
    expect(restored.chapters).toEqual(source.chapters);
    expect(restored.characters).toEqual(source.characters);
    expect((await store.listBooks()).map((entry) => entry.id)).toEqual(expect.arrayContaining([source.id, restored.id]));
    expect((await store.loadBook(source.id)).title).toBe(source.title);
  });

  it.each(['after-sources', 'after-manifest', 'after-library'] as const)(
    'restores a complete old Book when a save fails at %s',
    async (faultStage) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const baseline = new StoryStore(root);
      const oldBook = await baseline.saveBook(makeIntegrityBook());
      const nextBook = {
        ...oldBook,
        title: 'Synthetic New Title',
        chapters: oldBook.chapters.map((chapter) => ({
          ...chapter,
          sections: chapter.sections.map((section) => ({ ...section, content: 'Synthetic New Content.' })),
        })),
      };

      await expect(new FaultingStore(root, faultStage).saveBook(nextBook)).rejects.toThrow(`synthetic ${faultStage} failure`);
      const reopened = new StoryStore(root);
      const recovered = await reopened.loadBook(oldBook.id);
      expect(recovered.title).toBe(oldBook.title);
      expect(recovered.chapters[0]?.sections[0]?.content).toBe(oldBook.chapters[0]?.sections[0]?.content);
      expect(await readdir(path.join(root, '.story-transactions'))).toEqual([]);
    },
  );

  it('waits for every started source write before restoring after one write fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const baseline = new StoryStore(root);
    const oldBook = await baseline.saveBook(makeIntegrityBook());
    const nextBook = {
      ...oldBook,
      title: 'Synthetic source race',
      characters: [
        ...oldBook.characters.map((character, index) => index === 0
          ? { ...character, content: 'Synthetic late character context.' }
          : character),
        {
          id: 'integrity-late-character',
          name: 'Late Character',
          role: 'support',
          title: 'Late Character',
          content: 'Late character context.',
          includeInPrompt: true,
        },
      ],
    };
    const racingStore = new SourceWriteRaceStore(root);
    const savePromise = racingStore.saveBook(nextBook);
    let settled = false;
    savePromise.then(() => { settled = true; }, () => { settled = true; });

    await racingStore.sourceStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(racingStore.restoreStarted).toBe(false);

    racingStore.releaseSource();
    await expect(savePromise).rejects.toThrow('synthetic source write failure');
    expect(racingStore.restoreStarted).toBe(true);
    const recovered = await new StoryStore(root).loadBook(oldBook.id);
    expect(recovered.title).toBe(oldBook.title);
    expect(recovered.characters).toEqual(oldBook.characters);
    expect(recovered.chapters).toEqual(oldBook.chapters);
  });

  it('does not let a read observe a save between source and manifest publication', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const baseline = new StoryStore(root);
    const oldBook = await baseline.saveBook(makeIntegrityBook());
    const nextBook = {
      ...oldBook,
      title: 'Synthetic queued title',
      chapters: oldBook.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((section) => ({ ...section, content: 'Synthetic queued content.' })),
      })),
    };
    const pausing = new PausingStore(root);
    const savePromise = pausing.saveBook(nextBook);
    await pausing.reached;
    let loaded = false;
    const loadPromise = pausing.loadBook(oldBook.id).then(() => { loaded = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(loaded).toBe(false);
    pausing.release();
    await savePromise;
    await loadPromise;
    expect(loaded).toBe(true);
    expect((await pausing.loadBook(oldBook.id)).title).toBe('Synthetic queued title');
  });

  it('recovers a prepared journal after a process exit before commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const oldBook = await store.saveBook(makeIntegrityBook());
    const bookRoot = path.join(root, 'books', oldBook.id);
    const relativeFiles = [
      'book.json',
      'characters/integrity-character.json',
      'world/integrity-rule.md',
      'canon/integrity-fact.json',
      'summaries/integrity-summary.json',
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[0]!.id}.md`,
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[1]!.id}.md`,
    ];
    const transactionRoot = path.join(root, '.story-transactions', 'tx-crash');
    await mkdir(path.join(transactionRoot, 'book'), { recursive: true });
    for (const relative of relativeFiles) {
      const source = path.join(bookRoot, ...relative.split('/'));
      const target = path.join(transactionRoot, 'book', ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    await copyFile(path.join(root, 'library.json'), path.join(transactionRoot, 'library.json'));
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-crash',
      bookId: oldBook.id,
      status: 'prepared',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: relativeFiles,
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    const manifest = JSON.parse(await readFile(path.join(bookRoot, 'book.json'), 'utf8')) as Record<string, unknown>;
    manifest.title = 'Synthetic interrupted title';
    await writeFile(path.join(bookRoot, 'book.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(path.join(bookRoot, 'manuscript', oldBook.chapters[0]!.id, `${oldBook.chapters[0]!.sections[0]!.id}.md`), 'Synthetic interrupted content.', 'utf8');

    const recovered = await new StoryStore(root).loadBook(oldBook.id);
    expect(recovered.title).toBe(oldBook.title);
    expect(recovered.chapters[0]?.sections[0]?.content).toBe(oldBook.chapters[0]?.sections[0]?.content);
    await expectMissing(transactionRoot);
  });

  it('cleans a save-initializing marker created before its journal exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const initializingRoot = path.join(root, '.story-transactions', 'save-initializing-tx-before-journal');
    await mkdir(initializingRoot, { recursive: true });

    expect((await new StoryStore(root).loadBook(book.id)).title).toBe(book.title);
    await expectMissing(initializingRoot);
  });

  it('cleans a committed save marker after its journal was deleted first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const cleanupRoot = path.join(root, '.story-transactions', 'save-cleanup-tx-committed-partial');
    await mkdir(path.join(cleanupRoot, 'book'), { recursive: true });
    await copyFile(
      path.join(root, 'books', book.id, 'book.json'),
      path.join(cleanupRoot, 'book', 'book.json'),
    );
    await writeFile(path.join(cleanupRoot, 'journal.json'), 'committed journal', 'utf8');
    await rm(path.join(cleanupRoot, 'journal.json'));

    expect((await new StoryStore(root).loadBook(book.id)).title).toBe(book.title);
    await expectMissing(cleanupRoot);
  });

  it('retries a save cleanup after restore deleted one snapshot file first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const oldBook = await store.saveBook(makeIntegrityBook());
    const relativeFiles = integrityBookFiles(oldBook);
    const transactionRoot = path.join(root, '.story-transactions', 'tx-save-restore-cleanup');
    await mkdir(path.join(transactionRoot, 'book'), { recursive: true });
    for (const relative of relativeFiles) {
      const source = path.join(root, 'books', oldBook.id, ...relative.split('/'));
      const target = path.join(transactionRoot, 'book', ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    await copyFile(path.join(root, 'library.json'), path.join(transactionRoot, 'library.json'));
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-save-restore-cleanup',
      bookId: oldBook.id,
      operation: 'save',
      status: 'prepared',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: relativeFiles,
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');
    const manifestPath = path.join(root, 'books', oldBook.id, 'book.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.title = 'Synthetic interrupted title';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await expect(new PartialSaveCleanupStore(root).loadBook(oldBook.id))
      .rejects.toThrow('已恢复事务清理失败');
    const cleanupRoot = path.join(root, '.story-transactions', 'save-cleanup-tx-save-restore-cleanup');
    await expect(access(cleanupRoot)).resolves.toBeUndefined();
    await expectMissing(transactionRoot);
    expect((await new StoryStore(root).loadBook(oldBook.id)).title).toBe(oldBook.title);
    await expectMissing(cleanupRoot);
  });

  it.each(['save-initializing', 'save-cleanup'] as const)(
    'fails closed instead of deleting unknown content under a %s marker',
    async (marker) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const store = new StoryStore(root);
      const book = await store.saveBook(makeIntegrityBook());
      const markerRoot = path.join(root, '.story-transactions', `${marker}-tx-unknown`);
      const sentinel = path.join(markerRoot, 'unknown.txt');
      await mkdir(markerRoot, { recursive: true });
      await writeFile(sentinel, 'do not erase', 'utf8');

      await expect(new StoryStore(root).loadBook(book.id)).rejects.toThrow('包含未知内容');
      expect(await readFile(sentinel, 'utf8')).toBe('do not erase');
    },
  );

  it.each(['save-initializing', 'save-cleanup'] as const)(
    'fails closed instead of deleting a junction under a %s marker',
    async (marker) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const store = new StoryStore(root);
      const book = await store.saveBook(makeIntegrityBook());
      const markerRoot = path.join(root, '.story-transactions', `${marker}-tx-linked`);
      const outside = path.join(root, `${marker}-outside`);
      await mkdir(markerRoot, { recursive: true });
      await mkdir(outside);
      try {
        await symlink(outside, path.join(markerRoot, 'linked'), 'junction');
      } catch (error) {
        throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }

      await expect(new StoryStore(root).loadBook(book.id)).rejects.toThrow('结构异常');
      await expect(access(markerRoot)).resolves.toBeUndefined();
    },
  );

  it('keeps a formal save transaction with no journal and fails closed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const transactionRoot = path.join(root, '.story-transactions', 'tx-no-journal');
    await mkdir(transactionRoot, { recursive: true });

    await expect(new StoryStore(root).loadBook(book.id)).rejects.toThrow('事务记录损坏');
    await expect(access(transactionRoot)).resolves.toBeUndefined();
  });

  it('discards an unready prepared journal without restoring or hiding the old Book', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const oldBook = await store.saveBook(makeIntegrityBook());
    const relativeFiles = [
      'book.json',
      'characters/integrity-character.json',
      'world/integrity-rule.md',
      'canon/integrity-fact.json',
      'summaries/integrity-summary.json',
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[0]!.id}.md`,
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[1]!.id}.md`,
    ];
    const transactionRoot = path.join(root, '.story-transactions', 'tx-unready');
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-unready',
      bookId: oldBook.id,
      status: 'prepared',
      snapshotReady: false,
      bookExists: true,
      libraryExists: true,
      bookFiles: relativeFiles,
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new FailingTransactionCleanupStore(root, 'unready cleanup failure').loadBook(oldBook.id))
      .rejects.toThrow('未完成事务清理失败');
    await expect(access(path.join(root, '.story-transactions', 'save-cleanup-tx-unready'))).resolves.toBeUndefined();
    await expectMissing(transactionRoot);
    expect((await new StoryStore(root).loadBook(oldBook.id)).title).toBe(oldBook.title);
    await expectMissing(transactionRoot);
  });

  it('fails closed and keeps prepared recovery material when its snapshot inventory is incomplete', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const oldBook = await store.saveBook(makeIntegrityBook());
    const relativeFiles = [
      'book.json',
      'characters/integrity-character.json',
      'world/integrity-rule.md',
      'canon/integrity-fact.json',
      'summaries/integrity-summary.json',
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[0]!.id}.md`,
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[1]!.id}.md`,
    ];
    const transactionRoot = path.join(root, '.story-transactions', 'tx-incomplete');
    await mkdir(path.join(transactionRoot, 'book'), { recursive: true });
    for (const relative of relativeFiles.slice(0, -1)) {
      const source = path.join(root, 'books', oldBook.id, ...relative.split('/'));
      const target = path.join(transactionRoot, 'book', ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    await copyFile(path.join(root, 'library.json'), path.join(transactionRoot, 'library.json'));
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-incomplete',
      bookId: oldBook.id,
      status: 'prepared',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: relativeFiles,
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new StoryStore(root).loadBook(oldBook.id)).rejects.toThrow('事务快照与记录不一致');
    await expect(access(transactionRoot)).resolves.toBeUndefined();
    expect(await readFile(path.join(root, 'books', oldBook.id, 'book.json'), 'utf8')).toContain(oldBook.title);
  });

  it('fails closed when a prepared journal requires a missing library snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const oldBook = await store.saveBook(makeIntegrityBook());
    const relativeFiles = [
      'book.json',
      'characters/integrity-character.json',
      'world/integrity-rule.md',
      'canon/integrity-fact.json',
      'summaries/integrity-summary.json',
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[0]!.id}.md`,
      `manuscript/${oldBook.chapters[0]!.id}/${oldBook.chapters[0]!.sections[1]!.id}.md`,
    ];
    const transactionRoot = path.join(root, '.story-transactions', 'tx-missing-library');
    await mkdir(path.join(transactionRoot, 'book'), { recursive: true });
    for (const relative of relativeFiles) {
      const source = path.join(root, 'books', oldBook.id, ...relative.split('/'));
      const target = path.join(transactionRoot, 'book', ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-missing-library',
      bookId: oldBook.id,
      status: 'prepared',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: relativeFiles,
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new StoryStore(root).loadBook(oldBook.id)).rejects.toThrow('事务 library 快照与记录不一致');
    await expect(access(transactionRoot)).resolves.toBeUndefined();
  });

  it('retains a committed result and only cleans its committed journal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const saved = await store.saveBook(makeIntegrityBook());
    const transactionRoot = path.join(root, '.story-transactions', 'tx-committed');
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-committed',
      bookId: saved.id,
      status: 'committed',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    expect((await new StoryStore(root).loadBook(saved.id)).title).toBe(saved.title);
    await expectMissing(transactionRoot);
  });

  it('converges a committed journal after cleanup fails once', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const saved = await store.saveBook(makeIntegrityBook());
    const transactionRoot = path.join(root, '.story-transactions', 'tx-committed-retry');
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-committed-retry',
      bookId: saved.id,
      status: 'committed',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new FailingTransactionCleanupStore(root).loadBook(saved.id)).rejects.toThrow('已提交事务清理失败');
    await expect(access(path.join(root, '.story-transactions', 'save-cleanup-tx-committed-retry'))).resolves.toBeUndefined();
    await expectMissing(transactionRoot);
    expect((await new StoryStore(root).loadBook(saved.id)).title).toBe(saved.title);
    await expectMissing(transactionRoot);
  });

  it('fails closed instead of deleting a committed transaction that contains a junction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const saved = await store.saveBook(makeIntegrityBook());
    const transactionRoot = path.join(root, '.story-transactions', 'tx-committed-link');
    const outside = path.join(root, 'outside-transaction');
    await mkdir(transactionRoot, { recursive: true });
    await mkdir(outside);
    try {
      await symlink(outside, path.join(transactionRoot, 'linked'), 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-committed-link',
      bookId: saved.id,
      status: 'committed',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new StoryStore(root).loadBook(saved.id)).rejects.toThrow('结构异常');
    await expect(access(transactionRoot)).resolves.toBeUndefined();
  });

  it('keeps recovery material when restoring a failed save also fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const baseline = new StoryStore(root);
    const oldBook = await baseline.saveBook(makeIntegrityBook());
    await expect(new RecoveryFailingStore(root, 'after-manifest').saveBook({
      ...oldBook,
      title: 'Synthetic failed recovery',
    })).rejects.toThrow('无法恢复');
    const transactionEntries = await readdir(path.join(root, '.story-transactions'));
    expect(transactionEntries.length).toBeGreaterThan(0);
    expect((await new StoryStore(root).loadBook(oldBook.id)).title).toBe(oldBook.title);
  });

  it('skips unchanged managed files while still publishing updated metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = makeIntegrityBook();
    const first = await store.saveBook(book);
    const bookRoot = path.join(root, 'books', book.id);
    const characterFile = path.join(bookRoot, 'characters', 'integrity-character.json');
    const manuscriptFile = path.join(bookRoot, 'manuscript', 'integrity-chapter', 'integrity-source.md');
    const fixedMtime = new Date('2020-01-01T00:00:00.000Z');
    await utimes(characterFile, fixedMtime, fixedMtime);
    await utimes(manuscriptFile, fixedMtime, fixedMtime);
    const firstCharacterStat = await stat(characterFile);
    const firstManuscriptStat = await stat(manuscriptFile);
    const firstManifest = await readFile(path.join(bookRoot, 'book.json'), 'utf8');

    await store.saveBook({ ...first, title: 'Changed title' });

    expect((await stat(characterFile)).mtimeMs).toBe(firstCharacterStat.mtimeMs);
    expect((await stat(manuscriptFile)).mtimeMs).toBe(firstManuscriptStat.mtimeMs);
    const secondManifest = await readFile(path.join(bookRoot, 'book.json'), 'utf8');
    expect(secondManifest).not.toBe(firstManifest);
    expect(secondManifest).toContain('Changed title');
    expect((await readFile(path.join(root, 'library.json'), 'utf8'))).toContain('Changed title');
    expect((await store.loadBook(book.id)).title).toBe('Changed title');
  });

  it('persists title and manuscript changes and repairs external managed file edits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = makeIntegrityBook();
    await store.saveBook(book);

    const bookRoot = path.join(root, 'books', book.id);
    const characterFile = path.join(bookRoot, 'characters', 'integrity-character.json');
    const manuscriptFile = path.join(bookRoot, 'manuscript', 'integrity-chapter', 'integrity-source.md');
    await writeFile(characterFile, 'external character edit', 'utf8');
    await writeFile(manuscriptFile, Buffer.from([0xff]));

    const next = {
      ...book,
      title: 'Changed title',
      characters: book.characters.map((item) => ({ ...item, content: 'Changed character context.' })),
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((section) => section.id === 'integrity-source'
          ? { ...section, content: '\uFFFD' }
          : section),
      })),
    };
    const saved = await store.saveBook(next);

    expect(await readFile(characterFile, 'utf8')).toBe(`${JSON.stringify(saved.characters[0], null, 2)}\n`);
    expect(await readFile(manuscriptFile)).toEqual(Buffer.from('\uFFFD', 'utf8'));
    const loaded = await store.loadBook(book.id);
    expect(loaded.title).toBe('Changed title');
    expect(loaded.characters[0]?.content).toBe('Changed character context.');
    expect(loaded.chapters[0]?.sections[0]?.content).toBe('\uFFFD');
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
    await expect(store.deleteBook(book.id)).rejects.toThrow('结构异常');
    expect(await readFile(path.join(outside, `${book.characters[0]!.id}.json`), 'utf8'))
      .toBe(JSON.stringify(book.characters[0]));
    expect((await JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')) as BookIndexEntry[])
      .map((entry) => entry.id)).toContain(book.id);
  });

  it('does not move a Book when its library cannot form a valid delete snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    await writeFile(path.join(root, 'library.json'), `${JSON.stringify([{ id: book.id }])}\n`, 'utf8');

    await expect(store.deleteBook(book.id)).rejects.toThrow('library 快照损坏');
    expect(await readFile(path.join(root, 'books', book.id, 'book.json'), 'utf8')).toContain(book.title);
    expect(await readdir(path.join(root, '.story-transactions'))).toEqual([]);
  });

  it.each(['after-quarantine', 'after-delete-library'] as const)(
    'restores the complete Book when deletion fails at %s before commit',
    async (faultStage) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const book = makeIntegrityBook();
      const store = new StoryStore(root);
      await store.saveBook(book);
      const unmanaged = path.join(root, 'books', book.id, 'private-note.txt');
      await writeFile(unmanaged, 'Synthetic unmanaged file.', 'utf8');

      await expect(new FaultingDeleteStore(root, faultStage).deleteBook(book.id))
        .rejects.toThrow(`synthetic ${faultStage} failure`);

      expect((await JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')) as BookIndexEntry[])
        .map((entry) => entry.id)).toContain(book.id);
      expect((await new StoryStore(root).loadBook(book.id)).title).toBe(book.title);
      expect(await readFile(unmanaged, 'utf8')).toBe('Synthetic unmanaged file.');
      expect(await readdir(path.join(root, '.story-transactions'))).toEqual([]);
    },
  );

  it.each([false, true])(
    'rolls back a prepared delete after restart when library removal is %s',
    async (libraryRemoved) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
      temporaryRoots.push(root);
      const store = new StoryStore(root);
      const book = await store.saveBook(makeIntegrityBook());
      const unmanaged = path.join(root, 'books', book.id, 'private-note.txt');
      await writeFile(unmanaged, 'Synthetic unmanaged file.', 'utf8');
      const transaction = await stageDeleteTransaction(root, book.id, `tx-delete-prepared-${libraryRemoved}`, 'prepared');
      await rename(path.join(root, 'books', book.id), transaction.quarantineRoot);
      if (libraryRemoved) {
        await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
        await writeFile(
          path.join(transaction.transactionRoot, 'journal.json.tmp-1-00000000-0000-4000-8000-000000000000'),
          'partial committed journal',
          'utf8',
        );
      }

      const reopened = new StoryStore(root);
      expect((await reopened.loadBook(book.id)).title).toBe(book.title);
      expect((await reopened.listBooks()).map((entry) => entry.id)).toContain(book.id);
      expect(await readFile(unmanaged, 'utf8')).toBe('Synthetic unmanaged file.');
      await expectMissing(transaction.transactionRoot);
    },
  );

  it('removes an initializing delete directory without touching the Book', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const initializingRoot = path.join(root, '.story-transactions', 'delete-initializing-tx-crash');
    await mkdir(initializingRoot, { recursive: true });
    await writeFile(
      path.join(initializingRoot, 'journal.json.tmp-1-00000000-0000-4000-8000-000000000000'),
      'partial',
      'utf8',
    );

    expect((await new StoryStore(root).loadBook(book.id)).title).toBe(book.title);
    await expectMissing(initializingRoot);
  });

  it('fails closed and retains a prepared delete whose library snapshot is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const transactionRoot = path.join(root, '.story-transactions', 'tx-delete-missing-library');
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(transactionRoot, 'journal.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'tx-delete-missing-library',
      bookId: book.id,
      operation: 'delete',
      status: 'prepared',
      snapshotReady: true,
      bookExists: true,
      libraryExists: true,
      bookFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`, 'utf8');

    await expect(new StoryStore(root).loadBook(book.id)).rejects.toThrow('library 快照损坏');
    await expect(access(transactionRoot)).resolves.toBeUndefined();
    expect(await readFile(path.join(root, 'books', book.id, 'book.json'), 'utf8')).toContain(book.title);
  });

  it('fails closed when a prepared delete quarantine contains a junction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const transaction = await stageDeleteTransaction(root, book.id, 'tx-delete-linked', 'prepared');
    await rename(path.join(root, 'books', book.id), transaction.quarantineRoot);
    const outside = path.join(root, 'outside-delete');
    await mkdir(outside);
    await writeFile(path.join(outside, 'sentinel.txt'), 'unchanged', 'utf8');
    try {
      await symlink(outside, path.join(transaction.quarantineRoot, 'linked'), 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    await expect(new StoryStore(root).listBooks()).rejects.toThrow('结构异常');
    await expect(access(transaction.transactionRoot)).resolves.toBeUndefined();
    expect(await readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged');
  });

  it('finishes a committed delete after restart even when quarantine cleanup was partial', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const transaction = await stageDeleteTransaction(root, book.id, 'tx-delete-committed', 'committed');
    await rename(path.join(root, 'books', book.id), transaction.quarantineRoot);
    await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
    await rm(path.join(transaction.quarantineRoot, 'characters'), { recursive: true, force: true });

    const reopened = new StoryStore(root);
    expect((await reopened.listBooks()).map((entry) => entry.id)).not.toContain(book.id);
    await expect(reopened.loadBook(book.id)).rejects.toThrow(`找不到 Book：${book.id}`);
    await expectMissing(path.join(root, 'books', book.id));
    await expectMissing(transaction.transactionRoot);
  });

  it('keeps a committed journal when Book cleanup fails and finishes it on the next start', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const book = makeIntegrityBook();
    const store = new StoryStore(root);
    await store.saveBook(book);

    const failingStore = new FailingDeleteStore(root);
    await expect(failingStore.deleteBook(book.id)).resolves.toEqual({ id: book.id });

    expect((await JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')) as BookIndexEntry[])
      .map((entry) => entry.id)).not.toContain(book.id);
    const pending = await readdir(path.join(root, '.story-transactions'));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatch(/^tx-/);

    const reopened = new StoryStore(root);
    expect((await reopened.listBooks()).map((entry) => entry.id)).not.toContain(book.id);
    await expect(reopened.loadBook(book.id)).rejects.toThrow(`找不到 Book：${book.id}`);
    expect(await readdir(path.join(root, '.story-transactions'))).toEqual([]);
  });

  it('retries a retired delete transaction whose final journal cleanup was interrupted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const book = makeIntegrityBook();
    const store = new StoryStore(root);
    await store.saveBook(book);

    await expect(new FailingTransactionCleanupStore(root).deleteBook(book.id)).resolves.toEqual({ id: book.id });
    const pending = await readdir(path.join(root, '.story-transactions'));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatch(/^delete-cleanup-tx-/);

    const reopened = new StoryStore(root);
    expect((await reopened.listBooks()).map((entry) => entry.id)).not.toContain(book.id);
    await expectMissing(path.join(root, 'books', book.id));
    expect(await readdir(path.join(root, '.story-transactions'))).toEqual([]);
  });

  it('fails closed instead of erasing unknown content under a delete cleanup marker', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const book = await store.saveBook(makeIntegrityBook());
    const cleanupRoot = path.join(root, '.story-transactions', 'delete-cleanup-tx-unknown');
    const sentinel = path.join(cleanupRoot, 'unknown.txt');
    await mkdir(cleanupRoot, { recursive: true });
    await writeFile(sentinel, 'do not erase', 'utf8');

    await expect(new StoryStore(root).loadBook(book.id)).rejects.toThrow('包含未知内容');
    expect(await readFile(sentinel, 'utf8')).toBe('do not erase');
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

  it('fails closed when STORY_DATA_DIR is a junction', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(sandbox);
    const outside = path.join(sandbox, 'outside-root');
    const root = path.join(sandbox, 'linked-root');
    await mkdir(outside);
    try {
      await symlink(outside, root, 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    await expect(new StoryStore(root).listBooks()).rejects.toThrow('结构异常');
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('fails closed when the books directory is a junction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const outside = path.join(root, 'outside-books');
    await mkdir(outside);
    try {
      await symlink(outside, path.join(root, 'books'), 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    await expect(new StoryStore(root).listBooks()).rejects.toThrow('结构异常');
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('fails closed when library.json is a symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'books'));
    const outside = path.join(root, 'outside-library');
    const library = path.join(root, 'library.json');
    await mkdir(outside);
    try {
      await symlink(outside, library, 'junction');
    } catch (error) {
      throw new Error(`junction fixture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    await expect(new StoryStore(root).listBooks()).rejects.toThrow('结构异常');
    await expect(readdir(outside)).resolves.toEqual([]);
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
