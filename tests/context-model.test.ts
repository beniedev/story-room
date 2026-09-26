import { describe, expect, it } from 'vitest';
import {
  contextToolDraftKey,
  copyContextToolDraftSession,
  emptyContextToolMemoryDraft,
  hasPendingContextToolDrafts,
  initialContextToolDraftSession,
  sanitizeContextToolDraftSession,
} from '../src/contextToolDrafts';

describe('Context tool draft model', () => {
  it('uses collision-free Book/Section tuple keys and copies the initial selection', () => {
    expect(contextToolDraftKey('a:b', 'c')).not.toBe(contextToolDraftKey('a', 'b:c'));
    const selected = ['source'];
    const session = initialContextToolDraftSession('book', 'target', selected);
    selected.push('later');
    expect(session.selectedSectionIds).toEqual(['source']);
    expect(session.hasChanges).toBe(false);
    expect(hasPendingContextToolDrafts(new Map([['session', session]]))).toBe(false);
  });

  it('copies all editable containers without cloning immutable draft payloads', () => {
    const draft = emptyContextToolMemoryDraft();
    const session = {
      ...initialContextToolDraftSession('book', 'target', ['source']),
      expandedSectionIds: ['source'],
      memoryDrafts: { source: draft },
      generatedDrafts: { source: draft },
      summaryErrors: { source: 'Synthetic error' },
    };
    const copied = copyContextToolDraftSession(session);
    copied.selectedSectionIds.push('other');
    copied.expandedSectionIds.length = 0;
    delete copied.memoryDrafts.source;
    delete copied.generatedDrafts.source;
    delete copied.summaryErrors.source;
    expect(session.selectedSectionIds).toEqual(['source']);
    expect(session.expandedSectionIds).toEqual(['source']);
    expect(session.memoryDrafts.source).toBe(draft);
    expect(session.generatedDrafts.source).toBe(draft);
    expect(session.summaryErrors.source).toBe('Synthetic error');
  });

  it('creates empty Memory payloads with independent arrays', () => {
    const first = emptyContextToolMemoryDraft();
    const second = emptyContextToolMemoryDraft();
    first.beats.push('Synthetic beat');
    expect(second).toEqual({
      synopsis: '', beats: [], continuityFacts: [], characterStateChanges: [], foreshadowingCandidates: [],
    });
  });

  it('removes missing sources from every container without mutating the original', () => {
    const draft = emptyContextToolMemoryDraft();
    const session = {
      ...initialContextToolDraftSession('book', 'target', ['missing', 'source', 'later']),
      hasChanges: true,
      expandedSectionIds: ['missing', 'source'],
      memoryDrafts: { missing: draft, source: draft },
      generatedDrafts: { missing: draft, source: draft },
      summaryErrors: { missing: 'Missing source', source: '' },
    };
    const next = sanitizeContextToolDraftSession(session, new Set(['source', 'later']), ['source']);
    expect(next.selectedSectionIds).toEqual(['source', 'later']);
    expect(next.expandedSectionIds).toEqual(['source']);
    expect(Object.keys(next.memoryDrafts)).toEqual(['source']);
    expect(Object.keys(next.generatedDrafts)).toEqual(['source']);
    expect(next.summaryErrors).toEqual({ source: '' });
    expect(next.hasChanges).toBe(true);
    expect(session.selectedSectionIds).toEqual(['missing', 'source', 'later']);
    expect(session.memoryDrafts.missing).toBe(draft);
  });

  it('clears invalid-only changes and keeps expansion from becoming a pending edit', () => {
    const session = {
      ...initialContextToolDraftSession('book', 'target', ['source', 'missing']),
      hasChanges: true,
      expandedSectionIds: ['source', 'missing'],
      memoryDrafts: { missing: emptyContextToolMemoryDraft() },
      generatedDrafts: { missing: emptyContextToolMemoryDraft() },
      summaryErrors: { missing: 'Missing source' },
    };
    const next = sanitizeContextToolDraftSession(session, new Set(['source']), ['missing', 'source']);
    expect(next.hasChanges).toBe(false);
    expect(next.expandedSectionIds).toEqual(['source']);
    expect(hasPendingContextToolDrafts(new Map([['session', next]]))).toBe(false);
  });

  it('compares selection membership independently of order and preserves the dirty flag contract', () => {
    const session = { ...initialContextToolDraftSession('book', 'target', ['second', 'first']), hasChanges: true };
    const ids = new Set(['first', 'second']);
    expect(sanitizeContextToolDraftSession(session, ids, ['first', 'second']).hasChanges).toBe(false);
    expect(sanitizeContextToolDraftSession(session, ids, ['first']).hasChanges).toBe(true);
    expect(sanitizeContextToolDraftSession({ ...session, hasChanges: false }, ids, ['first']).hasChanges).toBe(false);
  });

  it('keeps an existing valid error key as pending even when its message is empty', () => {
    const session = {
      ...initialContextToolDraftSession('book', 'target', ['source']),
      hasChanges: true,
      summaryErrors: { source: '' },
    };
    const next = sanitizeContextToolDraftSession(session, new Set(['source']), ['source']);
    expect(next.hasChanges).toBe(true);
  });
});
