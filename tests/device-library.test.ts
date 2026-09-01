import { beforeEach, describe, expect, it } from 'vitest';
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

describe('device-local library', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
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
    });
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
});
