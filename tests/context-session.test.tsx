// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useContextToolSession } from '../src/components/context/useContextToolSession';
import { contextToolDraftKey, emptyContextToolMemoryDraft, initialContextToolDraftSession } from '../src/contextToolDrafts';
import type { ContextToolDraftSession } from '../src/contextToolDrafts';
import type { Book, SectionMemoryDraft } from '../src/types';

type SessionOptions = Parameters<typeof useContextToolSession>[0];
type SessionController = ReturnType<typeof useContextToolSession>;
const makeBook = (): Book => ({
  id: 'context-session-book', title: 'Synthetic context session', writingBrief: '',
  characters: [], worldRules: [], canonFacts: [], summaries: [], branches: [],
  chapters: [{ id: 'chapter', title: 'Chapter', sections: [
    { id: 'source', title: 'Source', content: 'Synthetic source content' },
    { id: 'target', title: 'Target', content: 'Synthetic target content',
      contextReferences: [{ sectionId: 'source', mode: 'summary', reason: 'manual' }] },
    { id: 'later-target', title: 'Later target', content: 'Synthetic later target' },
  ] }], updatedAt: '2026-01-01T00:00:00.000Z',
});
const memoryDraft = (synopsis: string): SectionMemoryDraft => ({ ...emptyContextToolMemoryDraft(), synopsis });
const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
};
const makeOptions = (book = makeBook()): SessionOptions => ({
  book, section: book.chapters[0]!.sections[1]!, canEdit: true,
  sessionDrafts: new Map(), onPendingDraftsChange: vi.fn(),
  onGenerateMemory: vi.fn(async () => memoryDraft('Synthetic generated synopsis')),
  onSaveMemoriesAndLoad: vi.fn(async () => undefined), onCancelGeneration: vi.fn(),
});
const roots = new Set<ReturnType<typeof createRoot>>();
const mountSession = async (options: SessionOptions) => {
  let current!: SessionController;
  function Probe(props: SessionOptions) {
    current = useContextToolSession(props);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.add(root);
  const rerender = async (next: SessionOptions) => { await act(async () => root.render(<Probe {...next} />)); };
  await rerender(options);
  return {
    current: () => current, rerender,
    unmount: async () => { await act(async () => root.unmount()); roots.delete(root); },
  };
};
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Context tool session ownership', () => {
  it('restores and sanitizes the supplied Map while leaving other targets intact', async () => {
    const options = makeOptions();
    const key = contextToolDraftKey(options.book.id, options.section.id);
    const otherKey = contextToolDraftKey(options.book.id, 'later-target');
    const other = initialContextToolDraftSession(options.book.id, 'later-target');
    options.sessionDrafts!.set(key, {
      ...initialContextToolDraftSession(options.book.id, options.section.id, ['source', 'missing']),
      hasChanges: true, expandedSectionIds: ['source', 'missing'],
      memoryDrafts: { source: memoryDraft('Synthetic restored draft'), missing: memoryDraft('Removed') },
    });
    options.sessionDrafts!.set(otherKey, other);
    const probe = await mountSession(options);
    expect(probe.current().sessionState.selectedSectionIds).toEqual(['source']);
    expect(probe.current().sessionState.expandedSectionIds).toEqual(['source']);
    expect(Object.keys(probe.current().sessionState.memoryDrafts)).toEqual(['source']);
    expect(options.sessionDrafts!.get(otherKey)).toBe(other);
    expect(options.onPendingDraftsChange).toHaveBeenLastCalledWith(true);
  });

  it('rejects all mutating controller commands in read-only mode', async () => {
    const options = { ...makeOptions(), canEdit: false };
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    await act(async () => {
      probe.current().setSelectedSectionIds(new Set(['source']));
      probe.current().setExpandedSectionIds(new Set(['source']));
      probe.current().flagMissingSummaries(['source']);
      probe.current().updateSummary(source, 'Synthetic forbidden edit');
      await probe.current().generateSummary(source);
      await probe.current().saveSummariesAndLoad([source], []);
    });
    expect(options.sessionDrafts!.size).toBe(0);
    expect(options.onGenerateMemory).not.toHaveBeenCalled();
    expect(options.onSaveMemoriesAndLoad).not.toHaveBeenCalled();
    expect(probe.current().sessionState.hasChanges).toBe(false);
  });

  it('settles generation into its original target after switching to another target', async () => {
    const options = makeOptions();
    const generated = deferred<SectionMemoryDraft>();
    options.onGenerateMemory = vi.fn(() => generated.promise);
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    let task!: Promise<SectionMemoryDraft>;
    await act(async () => { task = probe.current().generateSummary(source); });
    await probe.rerender({ ...options, section: options.book.chapters[0]!.sections[2]! });
    const draft = memoryDraft('Synthetic late original-target draft');
    await act(async () => { generated.resolve(draft); await task; });
    expect(options.sessionDrafts!.get(contextToolDraftKey(options.book.id, options.section.id))?.memoryDrafts.source).toBe(draft);
    expect(probe.current().sessionState.sectionId).toBe('later-target');
    expect(probe.current().sessionState.memoryDrafts).toEqual({});
    expect(probe.current().summaryBusyId).toBe('');
  });

  it('cancels a removed source and rejects its late generation result', async () => {
    const options = makeOptions();
    const generated = deferred<SectionMemoryDraft>();
    options.onGenerateMemory = vi.fn(() => generated.promise);
    const probe = await mountSession(options);
    let task!: Promise<SectionMemoryDraft>;
    await act(async () => { task = probe.current().generateSummary(options.book.chapters[0]!.sections[0]!); });
    const nextBook = { ...options.book, chapters: [{ ...options.book.chapters[0]!,
      sections: options.book.chapters[0]!.sections.slice(1) }] };
    await probe.rerender({ ...options, book: nextBook, section: nextBook.chapters[0]!.sections[0]! });
    expect(options.onCancelGeneration).toHaveBeenCalledOnce();
    await act(async () => { generated.resolve(memoryDraft('Synthetic removed-source result')); await task; });
    expect(probe.current().sessionState.memoryDrafts).toEqual({});
    expect(probe.current().summaryBusyId).toBe('');
    expect(options.sessionDrafts!.has(contextToolDraftKey(options.book.id, options.section.id))).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('does not write a %s generation result into a recreated same-key entry', async (outcome) => {
    const options = makeOptions();
    const generated = deferred<SectionMemoryDraft>();
    options.onGenerateMemory = vi.fn(() => generated.promise);
    const first = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    let result!: Promise<SectionMemoryDraft | unknown>;
    await act(async () => { result = first.current().generateSummary(source).catch((error: unknown) => error); });
    const key = contextToolDraftKey(options.book.id, options.section.id);
    options.sessionDrafts!.delete(key);
    await first.unmount();
    const second = await mountSession(options);
    await act(async () => second.current().updateSummary(source, 'Synthetic newer instance draft'));
    const replacement = options.sessionDrafts!.get(key);
    await act(async () => {
      if (outcome === 'resolve') generated.resolve(memoryDraft('Synthetic obsolete generation'));
      else generated.reject(new Error('Synthetic obsolete failure'));
      await result;
    });
    expect(options.sessionDrafts!.get(key)).toBe(replacement);
    expect(second.current().sessionState.memoryDrafts.source?.synopsis).toBe('Synthetic newer instance draft');
    expect(second.current().sessionState.summaryErrors.source).toBe('');
    expect(second.current().sessionState.generatedDrafts).toEqual({});
  });

  it('clears an owned save after switching targets and unmounting without losing another session', async () => {
    const options = makeOptions();
    const saved = deferred<void>();
    options.onSaveMemoriesAndLoad = vi.fn(() => saved.promise);
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    await act(async () => probe.current().updateSummary(source, 'Synthetic saved draft'));
    let task!: Promise<void>;
    await act(async () => { task = probe.current().saveSummariesAndLoad([source], []); });
    const laterOptions = { ...options, section: options.book.chapters[0]!.sections[2]! };
    await probe.rerender(laterOptions);
    await act(async () => probe.current().updateSummary(source, 'Synthetic other target draft'));
    const laterKey = contextToolDraftKey(options.book.id, laterOptions.section.id);
    const laterDraft = options.sessionDrafts!.get(laterKey);
    await probe.unmount();
    await act(async () => { saved.resolve(undefined); await task; });
    expect(options.sessionDrafts!.has(contextToolDraftKey(options.book.id, options.section.id))).toBe(false);
    expect(options.sessionDrafts!.get(laterKey)).toBe(laterDraft);
    expect(options.onPendingDraftsChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps a newer edit unchanged when an older save fails', async () => {
    const options = makeOptions();
    const saved = deferred<void>();
    options.onSaveMemoriesAndLoad = vi.fn(() => saved.promise);
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    await act(async () => probe.current().updateSummary(source, 'Synthetic first edit'));
    let result!: Promise<unknown>;
    await act(async () => { result = probe.current().saveSummariesAndLoad([source], []).catch((error: unknown) => error); });
    await act(async () => probe.current().updateSummary(source, 'Synthetic newer edit'));
    const key = contextToolDraftKey(options.book.id, options.section.id);
    const latest = options.sessionDrafts!.get(key);
    await act(async () => { saved.reject(new Error('Synthetic older save failed')); await result; });
    expect(options.sessionDrafts!.get(key)).toBe(latest);
    expect(probe.current().sessionState.memoryDrafts.source?.synopsis).toBe('Synthetic newer edit');
    expect(probe.current().sessionState.summaryErrors.source).toBe('');
  });

  it('keeps draft contents and records a current save failure for retry', async () => {
    const options = makeOptions();
    options.onSaveMemoriesAndLoad = vi.fn(async () => { throw new Error('Synthetic save failed'); });
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    await act(async () => probe.current().updateSummary(source, 'Synthetic retry draft'));
    await act(async () => {
      await expect(probe.current().saveSummariesAndLoad([source], [])).rejects.toThrow('Synthetic save failed');
    });
    expect(probe.current().sessionState.memoryDrafts.source?.synopsis).toBe('Synthetic retry draft');
    expect(probe.current().sessionState.summaryErrors.source).toBe('Synthetic save failed');
    expect(probe.current().sessionState.hasChanges).toBe(true);
    options.onSaveMemoriesAndLoad = vi.fn(async () => undefined);
    await probe.rerender(options);
    await act(async () => { await probe.current().saveSummariesAndLoad([source], []); });
    expect(options.sessionDrafts!.has(contextToolDraftKey(options.book.id, options.section.id))).toBe(false);
  });

  it('generates into a restored entry whose local epoch starts at zero', async () => {
    const options = makeOptions();
    const key = contextToolDraftKey(options.book.id, options.section.id);
    options.sessionDrafts!.set(key, {
      ...initialContextToolDraftSession(options.book.id, options.section.id, ['source']),
      hasChanges: true, memoryDrafts: { source: memoryDraft('Synthetic restored draft') },
    });
    const probe = await mountSession(options);
    await act(async () => { await probe.current().generateSummary(options.book.chapters[0]!.sections[0]!); });
    expect(probe.current().sessionState.memoryDrafts.source?.synopsis).toBe('Synthetic generated synopsis');
    expect(probe.current().sessionState.generatedDrafts.source?.synopsis).toBe('Synthetic generated synopsis');
  });

  it('preserves generated provenance and explicit inactive-reference retention arguments', async () => {
    const options = makeOptions();
    const probe = await mountSession(options);
    const source = options.book.chapters[0]!.sections[0]!;
    await act(async () => { await probe.current().generateSummary(source); });
    await act(async () => probe.current().setSelectedSectionIds(new Set(['source', 'inactive-kept'])));
    await act(async () => { await probe.current().saveSummariesAndLoad([source], ['inactive-kept', 'inactive-removed']); });
    expect(options.onSaveMemoriesAndLoad).toHaveBeenCalledWith([{
      sourceSectionId: source.id, draft: memoryDraft('Synthetic generated synopsis'), provenance: 'model-confirmed',
    }], ['inactive-kept']);
    expect(probe.current().sessionState.selectedSectionIds).toEqual(['source', 'inactive-kept']);
    expect(probe.current().sessionState.hasChanges).toBe(false);
  });
});
