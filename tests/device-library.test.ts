import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';
import { createSectionMemory } from '../src/sectionMemory';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('device-local library', () => {
  let environment: ReturnType<typeof installFakeDeviceLocks>;

  beforeEach(async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
    environment = installFakeDeviceLocks();
  });

  afterEach(() => {
    environment.restore();
  });

  it('seeds examples and keeps creates, edits, and deletes on the current device', async () => {
    const seeded = await deviceLibrary.listBooks();
    expect(seeded).toHaveLength(3);

    const created = await deviceLibrary.createBook('本地新书');
    expect((await deviceLibrary.loadBook(created.id)).title).toBe('本地新书');
    const targetSectionId = created.chapters[0]?.sections[0]?.id;
    if (!targetSectionId) throw new Error('target section fixture missing');

    const saved = await deviceLibrary.saveBook({
      ...created,
      title: '本地改名',
      chapters: created.chapters.map((chapter, chapterIndex) => ({
        ...chapter,
        sections: chapterIndex === 0
          ? [
              { id: 'prior-section', title: '前文', content: 'Earlier device manuscript.' },
              ...chapter.sections.map((section, sectionIndex) => sectionIndex === 0
                ? {
                    ...section,
                    contextReferences: [{ sectionId: 'prior-section', mode: 'full' as const, reason: 'manual' as const }],
                    plan: { goal: 'Device future goal', intendedBeats: ['Device beat'] },
                    memory: createSectionMemory({
                      synopsis: 'Device synopsis',
                      beats: [],
                      continuityFacts: [],
                      characterStateChanges: [],
                      foreshadowingCandidates: [],
                    }, section.content, 'manual'),
                  }
                : section),
            ]
          : chapter.sections,
      })),
    }, created.updatedAt);
    expect((await deviceLibrary.listBooks())[0]).toMatchObject({ id: saved.id, title: '本地改名' });
    const loaded = await deviceLibrary.loadBook(saved.id);
    const loadedTarget = loaded.chapters.flatMap((chapter) => chapter.sections).find((section) => section.id === targetSectionId);
    expect(loadedTarget?.contextReferences)
      .toEqual([{ sectionId: 'prior-section', mode: 'full', reason: 'manual' }]);
    expect(loadedTarget?.plan?.goal).toBe('Device future goal');
    expect(loadedTarget?.memory?.synopsis).toBe('Device synopsis');

    await deviceLibrary.deleteBook(saved.id);
    await expect(deviceLibrary.loadBook(saved.id)).rejects.toThrow('找不到 Book');
  });

  it('recovers pre-index device caches when upgrading from the previous demo', async () => {
    const cached = { ...createExampleBooks()[0], id: 'book-local-draft', title: '未导出的本地草稿' };
    const legacySection = cached.chapters[0]?.sections[0];
    if (!legacySection) throw new Error('legacy section fixture missing');
    cached.chapters[0] = {
      ...cached.chapters[0],
      sections: [{
        ...legacySection,
        content: 'changed device content',
        note: 'legacy device goal',
        memory: createSectionMemory({
          synopsis: 'legacy device synopsis',
          beats: [],
          continuityFacts: [],
          characterStateChanges: [],
          foreshadowingCandidates: [],
        }, legacySection.content),
      }],
    };
    localStorage.setItem(`story-native:book:${cached.id}`, JSON.stringify(cached));

    const library = await deviceLibrary.listBooks();
    expect(library).toContainEqual(expect.objectContaining({ id: cached.id, title: cached.title }));
    const loaded = await deviceLibrary.loadBook(cached.id);
    expect(loaded).toMatchObject({ id: cached.id, title: cached.title });
    expect(loaded.chapters[0]?.sections[0]).toMatchObject({
      note: 'legacy device goal',
      memory: { status: 'stale' },
    });
    expect(loaded.chapters[0]?.sections[0]?.plan).toBeUndefined();
  });

  it('returns only aggregate preview metadata and a draft-only generation result', async () => {
    const book = (await deviceLibrary.listBooks())[0];
    if (!book) throw new Error('device fixture book missing');
    const loaded = await deviceLibrary.loadBook(book.id);
    const section = loaded.chapters[0]?.sections[0];
    if (!section) throw new Error('device fixture section missing');
    const request = {
      bookId: loaded.id,
      sectionId: section.id,
      mode: 'author' as const,
      instruction: 'Synthetic continuation input.',
    };

    const preview = await deviceLibrary.contextPlan(request);
    expect(preview).not.toHaveProperty('messages');
    expect(JSON.stringify(preview)).not.toContain(section.content);

    const result = await deviceLibrary.generate(request);
    expect(result).toEqual({ draft: expect.any(String), finishReason: 'stop', sourceSignature: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(result).not.toHaveProperty('plan');
  });

  it('emits one immediate delta for a streamed fake generation', async () => {
    const entry = (await deviceLibrary.listBooks())[0];
    if (!entry) throw new Error('device fixture book missing');
    const book = await deviceLibrary.loadBook(entry.id);
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('device fixture section missing');
    const deltas: string[] = [];

    const result = await deviceLibrary.generate({
      bookId: book.id,
      sectionId: section.id,
      mode: 'author',
      instruction: 'Synthetic streamed continuation.',
      stream: true,
    }, undefined, (delta) => deltas.push(delta));

    expect(deltas).toEqual([result.draft]);
  });

  it('keeps persisted reads pure and does not bypass a failed write coordinator', async () => {
    const entries = await deviceLibrary.listBooks();
    const book = await deviceLibrary.loadBook(entries[0].id);
    const before = JSON.stringify(Array.from({ length: localStorage.length }, (_, i) => {
      const key = localStorage.key(i)!;
      return [key, localStorage.getItem(key)];
    }));
    await deviceLibrary.listPersistedBooks();
    await deviceLibrary.loadPersistedBook(book.id);
    for (const write of [
      () => deviceLibrary.listBooks(),
      () => deviceLibrary.createBook('Synthetic'),
      () => deviceLibrary.importBook(book),
      () => deviceLibrary.saveBook(book, book.updatedAt),
      () => deviceLibrary.deleteBook(book.id),
    ]) {
      environment.locks.rejectNext();
      await expect(write()).rejects.toThrow('Web Locks failure');
    }
    expect(JSON.stringify(Array.from({ length: localStorage.length }, (_, i) => {
      const key = localStorage.key(i)!;
      return [key, localStorage.getItem(key)];
    }))).toBe(before);
  });

  it('serializes all mutations and checks the version after waiting', async () => {
    await Promise.all([deviceLibrary.listBooks(), deviceLibrary.listBooks()]);
    expect(await deviceLibrary.listBooks()).toHaveLength(3);
    const [one, two] = await Promise.all([deviceLibrary.createBook('One'), deviceLibrary.createBook('Two')]);
    const results = await Promise.allSettled([
      deviceLibrary.saveBook({ ...one, title: 'First' }, one.updatedAt),
      deviceLibrary.saveBook({ ...one, title: 'Stale' }, one.updatedAt),
      deviceLibrary.saveBook({ ...two, title: 'Other book' }, two.updatedAt),
      deviceLibrary.importBook(one),
      deviceLibrary.deleteBook('the-observatory'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(results[1]).toMatchObject({ reason: { code: 'BOOK_CONFLICT' } });
    const entries = await deviceLibrary.listBooks();
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(5);
    expect((await deviceLibrary.loadBook(one.id)).title).toBe('First');
    expect((await deviceLibrary.loadBook(two.id)).title).toBe('Other book');
  });

  it('preserves an explicit empty index instead of reseeding examples', async () => {
    for (const entry of [...await deviceLibrary.listBooks()]) {
      await deviceLibrary.deleteBook(entry.id);
    }

    expect(await deviceLibrary.listBooks()).toEqual([]);
    expect(await deviceLibrary.listPersistedBooks()).toEqual([]);
    expect(localStorage.getItem('story-native:library')).toBe('[]');
    expect([...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))])
      .not.toContain('story-native:book:example-1');
  });

  it('repairs an index that only references missing Books without reseeding examples', async () => {
    localStorage.setItem('story-native:library', JSON.stringify([{
      id: 'deleted-book',
      title: '已删除书目',
      updatedAt: new Date().toISOString(),
    }]));

    expect(await deviceLibrary.listBooks()).toEqual([]);
    expect(localStorage.getItem('story-native:library')).toBe('[]');
    expect(localStorage.getItem('story-native:book:the-observatory')).toBeNull();
  });
});
