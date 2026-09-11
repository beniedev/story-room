import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookExport } from '../src/bookExport';
import { parseBookBackup } from '../src/bookImport';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';
import { createSectionMemory } from '../src/sectionMemory';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('JSON Book backup recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it('round-trips the complete Book shape and rejects a broken body mirror', () => {
    const source = structuredClone(createExampleBooks()[0]);
    const sourceSection = source.chapters[0]?.sections[1];
    const priorSection = source.chapters[0]?.sections[0];
    if (!sourceSection || !priorSection) throw new Error('fixture section missing');
    sourceSection.blocks = [
      { id: 'import-user', kind: 'user', content: '保留用户输入。' },
      {
        id: 'import-answer',
        kind: 'assistant',
        content: '采用候选正文。',
        candidates: [
          { id: 'import-candidate', content: '采用候选正文。' },
          { id: 'import-alternate', content: '未采用候选。' },
        ],
        adoptedCandidateId: 'import-candidate',
      },
    ];
    sourceSection.content = '保留用户输入。\n\n采用候选正文。';
    sourceSection.contextReferences = [{ sectionId: priorSection.id, mode: 'summary', reason: 'manual' }];
    sourceSection.plan = { goal: '保留计划', intendedBeats: ['保留节拍'], povCharacterId: source.characters[0]?.id };
    sourceSection.memory = createSectionMemory({
      synopsis: '当前 Memory',
      beats: ['当前节拍'],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, sourceSection.content);
    sourceSection.previousMemory = createSectionMemory({
      synopsis: '上一版本 Memory',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, sourceSection.content);
    source.characters[0]!.loadedSectionIds = [sourceSection.id];
    source.summaries = [{
      id: 'import-summary',
      title: '保留摘要',
      content: '保留摘要正文',
      includeInPrompt: true,
      sourceSectionIds: [sourceSection.id],
    }];
    source.branches = [{ id: 'import-branch', title: '保留分支', fromSectionId: sourceSection.id }];
    const parsed = parseBookBackup(String(createBookExport(source, 'json').content));
    expect(parsed).toEqual(source);

    const broken = structuredClone(source);
    const brokenSection = broken.chapters[0]?.sections[0];
    if (!brokenSection) throw new Error('fixture section missing');
    brokenSection.content = '与 blocks 不一致';
    expect(() => parseBookBackup(JSON.stringify(broken))).toThrow('正文镜像不一致');
  });

  it('rejects an adopted candidate that is not present in its block', () => {
    const source = structuredClone(createExampleBooks()[0]);
    const section = source.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.blocks = [{
      id: 'answer',
      kind: 'assistant',
      content: '正文',
      adoptedCandidateId: 'missing',
      candidates: [{ id: 'available', content: '正文' }],
    }];
    section.content = '正文';
    expect(() => parseBookBackup(JSON.stringify(source))).toThrow('没有对应候选');
  });

  it('rejects malformed IDs, duplicate layers, candidate metadata, hashes, mirrors, and references', () => {
    const makeValid = () => {
      const book = structuredClone(createExampleBooks()[0]);
      const prior = book.chapters[0]?.sections[0];
      const target = book.chapters[0]?.sections[1];
      const character = book.characters[0];
      if (!prior || !target || !character) throw new Error('fixture section missing');
      const candidate = { id: 'import-candidate', content: '采用候选正文。', sourceSignature: '0123456789abcdef' };
      target.blocks = [{
        id: 'import-answer',
        kind: 'assistant',
        content: candidate.content,
        candidates: [candidate],
        adoptedCandidateId: candidate.id,
      }];
      target.content = candidate.content;
      target.contextReferences = [{ sectionId: prior.id, mode: 'summary', reason: 'manual' }];
      target.memory = createSectionMemory({
        synopsis: '当前 Memory',
        beats: [],
        continuityFacts: [],
        characterStateChanges: [],
        foreshadowingCandidates: [],
      }, target.content);
      character.loadedSectionIds = [prior.id];
      book.summaries = [{
        id: 'import-summary',
        title: '摘要',
        content: '摘要正文',
        includeInPrompt: true,
        sourceSectionIds: [prior.id],
      }];
      book.branches = [{ id: 'import-branch', title: '分支', fromSectionId: prior.id }];
      return book;
    };

    const cases: Array<[string, (book: ReturnType<typeof makeValid>) => void, string]> = [
      ['ID 格式', (book) => { book.id = 'bad/id'; }, '格式无效'],
      ['重复 Section', (book) => { book.chapters[0]!.sections[1]!.id = book.chapters[0]!.sections[0]!.id; }, 'Section ID 必须'],
      ['重复 block', (book) => {
        const section = book.chapters[0]!.sections[1]!;
        section.blocks = [section.blocks![0]!, { ...section.blocks![0]! }];
        section.content = `${section.content}\n\n${section.content}`;
      }, 'blocks ID'],
      ['user candidates', (book) => {
        const section = book.chapters[0]!.sections[1]!;
        section.blocks![0]!.kind = 'user';
      }, 'assistant block'],
      ['重复 candidate', (book) => {
        const block = book.chapters[0]!.sections[1]!.blocks![0]!;
        block.candidates = [block.candidates![0]!, { ...block.candidates![0]! }];
      }, 'candidates ID'],
      ['sourceSignature 格式', (book) => {
        book.chapters[0]!.sections[1]!.blocks![0]!.candidates![0]!.sourceSignature = 'bad-signature';
      }, 'sourceSignature'],
      ['hash 格式', (book) => {
        book.chapters[0]!.sections[1]!.memory!.sourceContentHash = 'bad-hash';
      }, 'sourceContentHash'],
      ['block mirror', (book) => {
        book.chapters[0]!.sections[1]!.blocks![0]!.content = '不同正文';
      }, 'content 必须镜像 adopted'],
      ['section mirror', (book) => { book.chapters[0]!.sections[1]!.content = '不同正文'; }, '正文镜像'],
      ['duplicate reference', (book) => {
        const section = book.chapters[0]!.sections[1]!;
        section.contextReferences = [...section.contextReferences!, ...section.contextReferences!];
      }, 'contextReferences'],
      ['future reference', (book) => {
        book.chapters[0]!.sections[0]!.contextReferences = [{
          sectionId: book.chapters[0]!.sections[1]!.id,
          mode: 'summary',
          reason: 'manual',
        }];
      }, '严格早于'],
      ['missing cross reference', (book) => { book.branches[0]!.fromSectionId = 'missing-section'; }, 'Branch 来源必须'],
    ];

    for (const [name, mutate, message] of cases) {
      const broken = makeValid();
      mutate(broken);
      expect(() => parseBookBackup(JSON.stringify(broken)), name).toThrow(message);
    }
  });

  it('rejects a stale device revision and imports as a new Book', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const entry = (await deviceLibrary.listBooks())[0];
    if (!entry) throw new Error('fixture book missing');
    const original = await deviceLibrary.loadBook(entry.id);
    const saved = await deviceLibrary.saveBook({ ...original, title: '设备更新' }, original.updatedAt);
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt));
    await expect(deviceLibrary.saveBook({ ...original, title: '旧页面覆盖' }, original.updatedAt))
      .rejects.toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409 });
    expect((await deviceLibrary.loadBook(saved.id)).title).toBe('设备更新');

    const imported = await deviceLibrary.importBook(original);
    expect(imported.id).not.toBe(original.id);
    expect(imported.title).toBe(original.title);
    expect((await deviceLibrary.listBooks()).some((entry) => entry.id === original.id)).toBe(true);
  });

  it('rejects a save when another page deleted the known local revision', async () => {
    const entry = (await deviceLibrary.listBooks())[0];
    if (!entry) throw new Error('fixture book missing');
    const original = await deviceLibrary.loadBook(entry.id);
    localStorage.removeItem(`story-native:book:${original.id}`);

    await expect(deviceLibrary.saveBook({ ...original, title: '不应复活' }, original.updatedAt))
      .rejects.toMatchObject({ code: 'BOOK_CONFLICT', statusCode: 409 });
    expect(localStorage.getItem(`story-native:book:${original.id}`)).toBeNull();
  });
});
