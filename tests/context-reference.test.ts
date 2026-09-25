import { describe, expect, it } from 'vitest';
import {
  reconcileReferencesAfterMemoryDeletion,
  applySummaryReferenceSelection,
} from '../src/contextReferences';
import { buildContextPlan } from '../src/contextPlan';
import type { Book, Section } from '../src/types';

const section = (id: string, content: string): Section => ({ id, title: id, content });

const bookWithReferences = (sections: Section[]): Book => ({
  id: 'reference-book',
  title: 'Reference Book',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{ id: 'chapter', title: 'Chapter', sections }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const userPacketOf = (plan: ReturnType<typeof buildContextPlan>) => {
  const content = plan.messages.find((message) => message.role === 'user')?.content ?? '';
  const firstLineEnd = content.indexOf('\n');
  const lastLineStart = content.lastIndexOf('\n');
  if (firstLineEnd < 0 || lastLineStart <= firstLineEnd) throw new Error('prompt packet framing missing');
  return JSON.parse(content.slice(firstLineEnd + 1, lastLineStart)) as {
    blocks: Array<{ kind: string; title: string; content: string }>;
  };
};

describe('context reference helpers', () => {
  it('sends the saved section note as raw content in a trailing assistant message', () => {
    const note = '  SYNTHETIC_PREFILL_NOTE first line\nsecond line  \n';
    const target = { ...section('target', 'Current prose.'), note };
    const plan = buildContextPlan(bookWithReferences([target]), {
      sectionId: 'target',
      mode: 'author',
      instruction: 'Continue.',
    });
    const packet = userPacketOf(plan);

    expect(plan.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant']);
    expect(plan.messages.at(-1)?.content).toBe(note);
    expect(plan.included.find((item) => item.layer === 'note')?.messageRole).toBe('assistant');
    expect(packet.blocks.some((item) => item.kind === 'note' || item.title === '小节注释')).toBe(false);
    expect(plan.messages[1]?.content).not.toContain('SYNTHETIC_PREFILL_NOTE');
  });

  it('keeps continue authorNote precedence and uses the section note for regeneration', () => {
    const savedNote = 'SYNTHETIC_SAVED_NOTE';
    const authorNote = '  SYNTHETIC_AUTHOR_NOTE\nkeep line break  ';
    const target = {
      ...section('target', 'PREFIX_ONLY\nTARGET_TO_REPLACE\nLATER_BLOCK'),
      note: savedNote,
      blocks: [
        { id: 'prefix', kind: 'user' as const, content: 'PREFIX_ONLY' },
        { id: 'target-reply', kind: 'assistant' as const, content: 'TARGET_TO_REPLACE' },
        { id: 'later', kind: 'assistant' as const, content: 'LATER_BLOCK' },
      ],
    };
    const book = bookWithReferences([target]);
    const continued = buildContextPlan(book, {
      sectionId: 'target',
      mode: 'author',
      instruction: 'Continue.',
      authorNote,
    });
    const blankAuthorNote = buildContextPlan(book, {
      sectionId: 'target',
      mode: 'author',
      instruction: 'Continue.',
      authorNote: '',
    });
    const regenerated = buildContextPlan(book, {
      sectionId: 'target',
      mode: 'author',
      instruction: 'Regenerate.',
      generationKind: 'regenerate-block',
      targetBlockId: 'target-reply',
    });

    expect(continued.messages.at(-1)?.content).toBe(authorNote);
    expect(continued.messages[1]?.content).not.toContain('SYNTHETIC_SAVED_NOTE');
    expect(continued.messages[1]?.content).not.toContain('SYNTHETIC_AUTHOR_NOTE');
    expect(blankAuthorNote.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(blankAuthorNote.messages[1]?.content).not.toContain('SYNTHETIC_SAVED_NOTE');
    expect(regenerated.messages.at(-1)?.content).toBe(savedNote);
    expect(regenerated.messages[1]?.content).toContain('PREFIX_ONLY');
    expect(regenerated.messages[1]?.content).not.toContain('TARGET_TO_REPLACE');
    expect(regenerated.messages[1]?.content).not.toContain('LATER_BLOCK');
    expect(userPacketOf(regenerated).blocks.some((item) => item.kind === 'note')).toBe(false);
  });

  it('uses only the target section note for character-mode replies to user input', () => {
    const targetNote = 'SYNTHETIC_TARGET_SECTION_NOTE';
    const responseBook = bookWithReferences([
      { ...section('previous', 'Previous prose.'), note: 'SYNTHETIC_OTHER_SECTION_NOTE' },
      {
        ...section('target', 'Prefix prose. User input.'),
        note: targetNote,
        blocks: [
          { id: 'prefix', kind: 'assistant' as const, content: 'SYNTHETIC_PREFIX' },
          { id: 'input', kind: 'user' as const, content: 'SYNTHETIC_TARGET_INPUT' },
        ],
      },
    ]);
    responseBook.characters = [{
      id: 'synthetic-character',
      title: 'Synthetic character',
      name: 'Synthetic character',
      role: 'protagonist',
      content: 'Synthetic character details.',
      includeInPrompt: true,
    }];
    const plan = buildContextPlan(responseBook, {
      sectionId: 'target',
      mode: 'character',
      selectedCharacterId: 'synthetic-character',
      instruction: '',
      generationKind: 'respond-to-input',
      targetBlockId: 'input',
    });

    expect(plan.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant']);
    expect(plan.messages.at(-1)?.content).toBe(targetNote);
    expect(plan.messages[1]?.content).toContain('SYNTHETIC_TARGET_INPUT');
    expect(plan.messages.map((message) => message.content).join('\n'))
      .not.toContain('SYNTHETIC_OTHER_SECTION_NOTE');
    expect(userPacketOf(plan).blocks.some((item) => item.kind === 'note')).toBe(false);
  });

  it('omits whitespace-only notes and never adds section notes to summaries', () => {
    const blankNotePlan = buildContextPlan(bookWithReferences([
      { ...section('target', 'Current prose.'), note: '\n \t  \n' },
    ]), {
      sectionId: 'target',
      mode: 'author',
      instruction: 'Continue.',
    });
    const summaryPlan = buildContextPlan(bookWithReferences([
      { ...section('target', 'Current prose.'), note: 'SYNTHETIC_SUMMARY_EXCLUDED_NOTE' },
    ]), {
      sectionId: 'target',
      mode: 'author',
      instruction: '',
      generationKind: 'summarize-section',
    });

    expect(blankNotePlan.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(blankNotePlan.included.some((item) => item.layer === 'note')).toBe(false);
    expect(summaryPlan.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(summaryPlan.messages.map((message) => message.content).join('\n'))
      .not.toContain('SYNTHETIC_SUMMARY_EXCLUDED_NOTE');
  });

  it('replaces confirmed references with summaries without changing source prose or the original Book', () => {
    const source = section('source', 'SYNTHETIC_PREVIOUS_PROSE '.repeat(40_000));
    const target = { ...section('target', 'Current prose.'), contextReferences: [
      { sectionId: 'source', mode: 'full' as const, reason: 'manual' as const },
    ] };
    const book = bookWithReferences([source, target]);
    const request = { sectionId: 'target', mode: 'author' as const, instruction: 'Continue.' };
    const before = buildContextPlan(book, request);
    const draft = { synopsis: 'SYNTHETIC_SUMMARY', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [] };
    const saved = applySummaryReferenceSelection(book, 'target', [{ sourceSectionId: 'source', draft, provenance: 'manual' }]);
    const after = buildContextPlan(saved, request);

    expect(book.chapters[0].sections[1].contextReferences?.[0].mode).toBe('full');
    expect(book.chapters[0].sections[0].memory).toBeUndefined();
    expect(saved.chapters[0].sections[0].content).toBe(source.content);
    expect(saved.chapters[0].sections[1].contextReferences?.[0].mode).toBe('summary');
    expect(before.estimatedTokens).toBeGreaterThan(after.estimatedTokens * 10);
    expect(JSON.stringify(after.messages)).toContain('SYNTHETIC_SUMMARY');
    expect(JSON.stringify(after.messages)).not.toContain('SYNTHETIC_PREVIOUS_PROSE');

    const cleared = applySummaryReferenceSelection(saved, 'target', []);
    expect(cleared.chapters[0].sections[1].contextReferences).toBeUndefined();
    expect(cleared.chapters[0].sections[0]).toEqual(saved.chapters[0].sections[0]);
    expect(() => applySummaryReferenceSelection(book, 'target', [{
      sourceSectionId: 'source', draft: { ...draft, synopsis: '' }, provenance: 'manual',
    }])).toThrow('梗概');
  });

  it('reconciles summary references after explicit current-memory deletion', () => {
    const source = section('source', 'source content');
    const target = {
      ...section('target', 'target content'),
      contextReferences: [
        { sectionId: 'source', mode: 'summary' as const, reason: 'manual' as const },
      ],
    };
    const bothTarget = {
      ...section('both-target', 'target content'),
      contextReferences: [
        { sectionId: 'source', mode: 'both' as const, reason: 'manual' as const },
      ],
    };
    const reconciled = reconcileReferencesAfterMemoryDeletion(bookWithReferences([source, target, bothTarget]), 'source');
    expect(reconciled.chapters[0]?.sections[1]?.contextReferences).toBeUndefined();
    expect(reconciled.chapters[0]?.sections[2]?.contextReferences).toEqual([
      { sectionId: 'source', mode: 'full', reason: 'manual' },
    ]);
  });
});
