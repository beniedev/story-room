import { describe, expect, it } from 'vitest';
import {
  reconcileReferencesAfterMemoryDeletion,
  selectAllUnsetReferences,
} from '../src/contextReferences';
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
  it('selects only nonblank unset sections and preserves existing references', () => {
    const references = [
      { sectionId: 'summary', mode: 'summary' as const, reason: 'manual' as const },
      { sectionId: 'blank', mode: 'both' as const, reason: 'manual' as const },
    ];
    expect(selectAllUnsetReferences(references, [
      section('summary', 'summary content'),
      section('blank', ''),
      section('unset', 'new content'),
    ])).toEqual([
      ...references,
      { sectionId: 'unset', mode: 'full', reason: 'manual' },
    ]);
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
