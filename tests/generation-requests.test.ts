import { describe, expect, it } from 'vitest';
import {
  applyAnswerCandidateOutcome,
  applyRegenerateBlockOutcome,
  makeRespondToInputRequest,
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

  it('builds a respond-to-input request without duplicating the bottom draft', () => {
    expect(makeRespondToInputRequest({
      bookId: 'book',
      sectionId: 'section',
      mode: 'author',
      targetBlockId: 'input',
    })).toMatchObject({
      bookId: 'book',
      sectionId: 'section',
      targetBlockId: 'input',
      instruction: '',
      authorNote: undefined,
      generationKind: 'respond-to-input',
    });
  });

  it('adds a first answer below a user block and keeps later candidates out of content', () => {
    const section = {
      id: 'section',
      title: 'Section',
      content: '用户输入',
      blocks: [{ id: 'input', kind: 'user' as const, content: '用户输入' }],
    };
    const writerDraft = { instruction: '底部草稿', authorNote: '' };
    const first = applyAnswerCandidateOutcome({
      section,
      targetBlockId: 'input',
      writerDraft,
      outcome: { status: 'success' as const, content: '第一版', candidateId: 'candidate-1', sourceSignature: '0123456789abcdef' },
    });
    expect(first.section.blocks?.map((block) => block.kind)).toEqual(['user', 'assistant']);
    expect(first.section.content).toBe('用户输入\n\n第一版');

    const second = applyAnswerCandidateOutcome({
      section: first.section,
      targetBlockId: first.section.blocks?.[1]?.id ?? '',
      writerDraft,
      outcome: { status: 'success' as const, content: '第二版', candidateId: 'candidate-2', sourceSignature: '0123456789abcdef' },
    });
    expect(second.section.blocks).toHaveLength(2);
    expect(second.section.blocks?.[1]?.candidates?.map((candidate) => candidate.content)).toEqual(['第一版', '第二版']);
    expect(second.section.content).toBe('用户输入\n\n第一版');
  });
});
