import { describe, expect, it } from 'vitest';
import type { Book, SectionMemoryDraft } from '../src/types';
import {
  commitSectionMemoryDraft,
  clearPreviousSectionMemory,
  createSectionMemory,
  deleteCurrentSectionMemory,
  draftFromSectionMemory,
  hashSectionContent,
  isEligibleSectionMemory,
  normalizeBook,
  parseSectionMemoryDraft,
  rollbackSectionMemory,
  sectionMemoryProvenanceAfterReview,
  sectionMemoryFreshness,
  serializeSectionMemoryDraft,
} from '../src/sectionMemory';

const draft: SectionMemoryDraft = {
  synopsis: '摘要',
  beats: ['节拍'],
  continuityFacts: ['事实'],
  characterStateChanges: ['状态'],
  foreshadowingCandidates: ['候选'],
};

const bookWithSection = (section: Book['chapters'][number]['sections'][number]): Book => ({
  id: 'memory-book',
  title: 'Memory Book',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{ id: 'memory-chapter', title: 'Chapter', sections: [section] }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('section memory helper', () => {
  it('hashes content deterministically and detects changes', () => {
    const content = '合成正文\n第二行\r\n尾部';
    const hash = hashSectionContent(content);
    expect(hash).toBe(hashSectionContent(content));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashSectionContent(content)).not.toBe(hashSectionContent('changed content'));
  });

  it('strictly parses and serializes the five-field draft schema', () => {
    const serialized = serializeSectionMemoryDraft(draft);
    expect(parseSectionMemoryDraft(serialized)).toEqual(draft);
    expect(() => parseSectionMemoryDraft('not json')).toThrow('有效 JSON');
    expect(() => parseSectionMemoryDraft(JSON.stringify({ ...draft, extra: true }))).toThrow('严格匹配');
    expect(() => parseSectionMemoryDraft(JSON.stringify({ ...draft, beats: ['ok', 1] }))).toThrow('文本');
    const largeDraft = { ...draft, synopsis: '摘要'.repeat(40_000), beats: Array.from({ length: 40 }, () => '节拍'.repeat(1_001)) };
    expect(parseSectionMemoryDraft(serializeSectionMemoryDraft(largeDraft))).toEqual(largeDraft);
  });

  it('gates freshness by content hash and rejects model drafts as usable memory', () => {
    const manual = createSectionMemory(draft, 'source content', 'manual', '2026-01-01T00:00:00.000Z');
    const modelDraft = createSectionMemory(draft, 'source content', 'model-draft', '2026-01-01T00:00:00.000Z');
    expect(sectionMemoryFreshness(manual, 'source content')).toBe('fresh');
    expect(isEligibleSectionMemory(manual, 'source content')).toBe(true);
    expect(isEligibleSectionMemory(modelDraft, 'source content')).toBe(false);
    expect(sectionMemoryFreshness(manual, 'changed content')).toBe('stale');
    expect(isEligibleSectionMemory(manual, 'changed content')).toBe(false);

    const persistedStale = { ...manual, status: 'stale' as const };
    expect(sectionMemoryFreshness(persistedStale, 'source content')).toBe('stale');
    expect(normalizeBook(bookWithSection({
      id: 'restored-section',
      title: 'Restored',
      content: 'source content',
      memory: persistedStale,
    })).chapters[0]?.sections[0]?.memory?.status).toBe('stale');
  });

  it('keeps legacy note and plan fields for compatibility without migrating them', () => {
    const memory = createSectionMemory(draft, 'old content');
    const migrated = normalizeBook(bookWithSection({
      id: 'legacy-section',
      title: 'Legacy',
      content: 'new content',
      note: '  keep exact\n第二行  ',
      memory,
    })).chapters[0]?.sections[0];
    expect(migrated?.note).toBe('  keep exact\n第二行  ');
    expect(migrated?.plan).toBeUndefined();
    expect(migrated?.memory?.status).toBe('stale');

    const planned = normalizeBook(bookWithSection({
      id: 'planned-section',
      title: 'Planned',
      content: 'content',
      note: 'legacy note retained',
      plan: { goal: 'existing plan', intendedBeats: [] },
    })).chapters[0]?.sections[0];
    expect(planned?.note).toBe('legacy note retained');
    expect(planned?.plan?.goal).toBe('existing plan');
  });

  it('keeps memory drafts local until explicit confirmation and swaps one rollback version', () => {
    const original = createSectionMemory(draft, 'source content', 'model-confirmed', '2026-01-01T00:00:00.000Z');
    const section = {
      id: 'memory-section',
      title: 'Section',
      content: 'source content',
      memory: original,
    };
    const copiedDraft = draftFromSectionMemory(original);
    expect(copiedDraft).toEqual(draft);
    copiedDraft?.beats.push('仅在草稿中');
    expect(original.beats).toEqual(draft.beats);

    const replacement = { ...draft, synopsis: '新摘要' };
    const committed = commitSectionMemoryDraft(section, replacement, 'model-confirmed', '2026-01-02T00:00:00.000Z');
    expect(committed.memory?.synopsis).toBe('新摘要');
    expect(committed.previousMemory).toEqual(original);
    expect(() => commitSectionMemoryDraft(section, replacement, 'model-draft')).toThrow('不能直接保存');
    expect(section.memory).toEqual(original);

    const rolledBack = rollbackSectionMemory(committed);
    expect(rolledBack.memory).toEqual(original);
    expect(rolledBack.previousMemory?.synopsis).toBe('新摘要');
  });

  it('deletes current memory without deleting history and can clear history separately', () => {
    const original = createSectionMemory(draft, 'source content', 'manual', '2026-01-01T00:00:00.000Z');
    const replacement = createSectionMemory({ ...draft, synopsis: '新摘要' }, 'source content', 'manual', '2026-01-02T00:00:00.000Z');
    const section = { id: 'memory-section', title: 'Section', content: 'source content', memory: replacement, previousMemory: original };
    const deleted = deleteCurrentSectionMemory(section);
    expect(deleted.memory).toBeUndefined();
    expect(deleted.previousMemory).toEqual(original);
    const cleared = clearPreviousSectionMemory(section);
    expect(cleared.memory).toEqual(replacement);
    expect(cleared.previousMemory).toBeUndefined();
  });

  it('turns a reviewed model draft into confirmed memory before commit', () => {
    const modelDraft = createSectionMemory(draft, 'source content', 'model-draft');
    expect(sectionMemoryProvenanceAfterReview(modelDraft, draft)).toBe('model-confirmed');
    expect(sectionMemoryProvenanceAfterReview(modelDraft, { ...draft, synopsis: 'edited' })).toBe('model-edited');
  });

  it('requires a complete review when refreshing stale memory', () => {
    const stale = {
      ...createSectionMemory(draft, 'old content', 'model-confirmed'),
      status: 'stale' as const,
    };
    const replacement: SectionMemoryDraft = {
      synopsis: '新摘要',
      beats: [...stale.beats],
      continuityFacts: [...stale.continuityFacts],
      characterStateChanges: [...stale.characterStateChanges],
      foreshadowingCandidates: [...stale.foreshadowingCandidates],
    };
    const section = { id: 'stale-section', title: 'Stale', content: 'new content', memory: stale };
    const provenance = sectionMemoryProvenanceAfterReview(stale, replacement);
    const committed = commitSectionMemoryDraft(section, replacement, provenance, '2026-01-02T00:00:00.000Z');
    expect(provenance).toBe('model-edited');
    expect(committed.memory).toMatchObject({
      synopsis: '新摘要',
      beats: stale.beats,
      continuityFacts: stale.continuityFacts,
      characterStateChanges: stale.characterStateChanges,
      foreshadowingCandidates: stale.foreshadowingCandidates,
      status: 'fresh',
      sourceContentHash: hashSectionContent('new content'),
    });
    expect(committed.memory?.sourceContentHash).not.toBe(stale.sourceContentHash);
  });

  it('removes only references to sections that no longer exist', () => {
    const normalized = normalizeBook({
      ...bookWithSection({
        id: 'target',
        title: 'Target',
        content: 'target',
        contextReferences: [
          { sectionId: 'blank-source', mode: 'full', reason: 'manual' },
          { sectionId: 'missing-source', mode: 'full', reason: 'manual' },
        ],
      }),
      chapters: [{
        id: 'memory-chapter',
        title: 'Chapter',
        sections: [
          { id: 'blank-source', title: 'Blank', content: '' },
          { id: 'target', title: 'Target', content: 'target', contextReferences: [
            { sectionId: 'blank-source', mode: 'full', reason: 'manual' },
            { sectionId: 'missing-source', mode: 'full', reason: 'manual' },
          ] },
        ],
      }],
    }).chapters[0]?.sections[1];
    expect(normalized?.contextReferences).toEqual([
      { sectionId: 'blank-source', mode: 'full', reason: 'manual' },
    ]);
  });
});
