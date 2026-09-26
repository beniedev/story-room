// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { useBookSession } from '../src/application/useBookSession';
import { useGenerationSession } from '../src/application/useGenerationSession';
import type { Book, GenerationResult } from '../src/types';

const makeBook = (): Book => ({
  id: 'generation-session-book', title: 'Synthetic generation session', writingBrief: '',
  characters: [], worldRules: [], canonFacts: [], summaries: [], branches: [],
  chapters: [{ id: 'chapter', title: 'Chapter', sections: [{
    id: 'section', title: 'Section', content: 'Synthetic existing text',
    blocks: [{ id: 'answer', kind: 'assistant', content: 'Synthetic existing text' }],
  }] }], updatedAt: '2026-01-01T00:00:00.000Z',
});
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const settle = async () => { for (let index = 0; index < 8; index += 1) await act(async () => { await Promise.resolve(); }); };

const mountGeneration = async () => {
  const book = makeBook();
  const saves: Book[] = [];
  const statuses: string[] = [];
  const applied = vi.fn();
  const errors: unknown[] = [];
  let busy = false;
  let current!: ReturnType<typeof useGenerationSession>;
  let session!: ReturnType<typeof useBookSession<null>>;
  let selection: { sectionId: string; view: 'write' | 'shelf' } = { sectionId: 'section', view: 'write' };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/library') return response([book]);
    if (String(input) === `/api/books/${book.id}` && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as { book: Book };
      saves.push(payload.book);
      return response(payload.book);
    }
    if (String(input) === `/api/books/${book.id}`) return response(book);
    throw new Error(`Unexpected generation session request: ${String(input)}`);
  }));
  function Probe() {
    session = useBookSession({
      bootstrap: { load: async () => null, apply: vi.fn() },
      onStatus: (message) => statuses.push(message), onTransition: vi.fn(),
      isBusy: () => busy, hasLocalEditorDraft: () => false,
    });
    current = useGenerationSession({
      bookSession: session, getSelection: () => selection,
      withBusy: async (action) => {
        if (busy) return;
        busy = true;
        try { await action(); } catch (error) { errors.push(error); } finally { busy = false; }
      },
      onStatus: (message) => statuses.push(message), onSummaryBusyChange: vi.fn(),
      onContinuationApplied: applied,
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  await settle();
  return {
    root, saves, statuses, applied, errors,
    getCurrent: () => current, getBookSession: () => session,
    select: (next: typeof selection) => { selection = next; },
  };
};

const continuation = {
  sectionId: 'section', mode: 'author' as const, selectedCharacterId: '',
  streamingOutput: false, instruction: 'Synthetic next input', authorNote: '',
};
const pendingGeneration = () => {
  let complete!: (result: GenerationResult) => void;
  let signal: AbortSignal | undefined;
  let delta: ((value: string) => void) | undefined;
  // Deliberately ignore cancellation so the session itself must reject late data.
  vi.spyOn(api, 'generate').mockImplementation(async (_request, requestSignal, onDelta) => {
    signal = requestSignal;
    delta = onDelta;
    return new Promise<GenerationResult>((resolve) => { complete = resolve; });
  });
  return { complete: (result: GenerationResult) => complete(result), getSignal: () => signal, emit: (value: string) => delta?.(value) };
};

beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

describe('Generation session lifecycle and Book guards', () => {
  it('aborts on unmount, cancels queued frames, and rejects late deltas and a late final result', async () => {
    const generation = pendingGeneration();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    const probe = await mountGeneration();
    let task!: Promise<void>;
    await act(async () => { task = probe.getCurrent().generateContinuation({ ...continuation, streamingOutput: true }); });
    await settle();
    await act(async () => generation.emit('Synthetic pending delta'));
    expect(frames.size).toBe(1);
    await act(async () => probe.root.unmount());
    expect(generation.getSignal()?.aborted).toBe(true);
    expect(frames.size).toBe(0);
    generation.emit('Synthetic late delta');
    expect(frames.size).toBe(0);
    generation.complete({ draft: 'Synthetic late truncated result', finishReason: 'length' });
    await task;
    expect(probe.applied).not.toHaveBeenCalled();
    expect(probe.saves).toEqual([]);
    expect(probe.errors).toEqual([expect.objectContaining({ name: 'AbortError' })]);
    expect(probe.getBookSession().getSnapshot().book?.chapters[0]?.sections[0]?.content).toBe('Synthetic existing text');
  });

  it('keeps transport alive across an ordinary edit but rejects application against the older revision', async () => {
    const generation = pendingGeneration();
    const probe = await mountGeneration();
    try {
      let task!: Promise<void>;
      await act(async () => { task = probe.getCurrent().generateContinuation(continuation); });
      await settle();
      await act(async () => probe.getBookSession().changeBook((book) => ({ ...book, writingBrief: 'Synthetic concurrent edit' })));
      generation.complete({ draft: 'Synthetic obsolete answer', finishReason: 'stop' });
      await act(async () => { await task; });
      expect(generation.getSignal()?.aborted).toBe(false);
      expect(probe.errors).toEqual([]);
      expect(probe.statuses.at(-1)).toBe('当前书目或正文已变化，生成结果未写入。');
      expect(probe.applied).not.toHaveBeenCalled();
      expect(probe.getBookSession().getSnapshot().book?.writingBrief).toBe('Synthetic concurrent edit');
      expect(probe.getBookSession().getSnapshot().book?.chapters[0]?.sections[0]?.content).toBe('Synthetic existing text');
    } finally { await act(async () => probe.root.unmount()); }
  });

  it('rejects an older result after reloading the same Book with the same visible section', async () => {
    const generation = pendingGeneration();
    const probe = await mountGeneration();
    try {
      let task!: Promise<void>;
      await act(async () => { task = probe.getCurrent().generateContinuation(continuation); });
      await settle();
      await act(async () => { await probe.getBookSession().reloadBook('generation-session-book'); });
      generation.complete({ draft: 'Synthetic late partial result', finishReason: 'length' });
      await act(async () => { await task; });
      expect(probe.errors).toEqual([expect.objectContaining({ name: 'AbortError' })]);
      expect(probe.getCurrent().streamingDraft).toBeNull();
      expect(probe.applied).not.toHaveBeenCalled();
      expect(probe.saves).toEqual([]);
    } finally { await act(async () => probe.root.unmount()); }
  });

  it.each([
    { sectionId: 'other-section', view: 'write' as const },
    { sectionId: 'section', view: 'shelf' as const },
  ])('rejects a late result when the visible target changes to $sectionId/$view', async (selection) => {
    const generation = pendingGeneration();
    const probe = await mountGeneration();
    try {
      let task!: Promise<void>;
      await act(async () => { task = probe.getCurrent().generateContinuation(continuation); });
      await settle();
      probe.select(selection);
      generation.complete({ draft: 'Synthetic result for the previous view', finishReason: 'stop' });
      await act(async () => { await task; });
      expect(probe.errors).toEqual([expect.objectContaining({ name: 'AbortError' })]);
      expect(probe.applied).not.toHaveBeenCalled();
      expect(probe.saves).toEqual([]);
    } finally { await act(async () => probe.root.unmount()); }
  });
});
