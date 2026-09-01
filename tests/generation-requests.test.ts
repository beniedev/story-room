import { describe, expect, it } from 'vitest';
import {
  applyRegenerateBlockOutcome,
  makeRegenerateBlockRequest,
} from '../src/generationRequests';

describe('generation request helpers', () => {
  it('isolates regenerate-block from bottom-of-writer drafts', () => {
    expect(makeRegenerateBlockRequest({
      bookId: 'book',
      sectionId: 'section',
      providerProfileId: 'provider',
      mode: 'author',
      selectedCharacterId: undefined,
      targetBlockId: 'block',
    })).toEqual({
      bookId: 'book',
      sectionId: 'section',
      providerProfileId: 'provider',
      mode: 'author',
      selectedCharacterId: undefined,
      targetBlockId: 'block',
      authorNote: undefined,
      instruction: '',
      generationKind: 'regenerate-block',
    });
  });

  it('changes only the selected block and preserves bottom drafts for every outcome', () => {
    const section = {
      id: 'section',
      title: 'Section',
      content: '旧前文\n\n旧目标',
      blocks: [
        { id: 'prefix', kind: 'assistant' as const, content: '旧前文' },
        { id: 'target', kind: 'assistant' as const, content: '旧目标' },
      ],
    };
    const writerDraft = { instruction: '底部指令', authorNote: '底部注释' };
    for (const outcome of [
      { status: 'failed' as const },
      { status: 'cancelled' as const },
    ]) {
      const unchanged = applyRegenerateBlockOutcome({ section, targetBlockId: 'target', writerDraft, outcome });
      expect(unchanged.section).toBe(section);
      expect(unchanged.writerDraft).toEqual(writerDraft);
    }
    const success = applyRegenerateBlockOutcome({
      section,
      targetBlockId: 'target',
      writerDraft,
      outcome: { status: 'success', content: '新目标' },
    });
    expect(success.section.blocks?.map((block) => block.content)).toEqual(['旧前文', '新目标']);
    expect(success.section.content).toBe('旧前文\n\n新目标');
    expect(success.writerDraft).toEqual(writerDraft);
  });
});
