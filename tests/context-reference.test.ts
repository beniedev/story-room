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

describe('context reference helpers', () => {
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
