import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GenerationMode, SectionBlock } from '../../types';
import type { StreamingDraftView } from './StreamingDraftBlock';

// Preserve reading positions for the same browser session, including Writer unmounts.
const manuscriptScrollPositions = new Map<string, number>();
const manuscriptTailTargets = new Map<string, string>();

type ManuscriptScrollOptions = {
  scrollKey: string;
  blocks: SectionBlock[];
  manuscriptText: string;
  generationState: 'idle' | 'generating';
  streamingDraft?: StreamingDraftView | null;
  instructionDockRef: RefObject<HTMLFormElement | null>;
  instructionInputHeight: number | null;
  authorNote: string;
  mode: GenerationMode;
};

export function useManuscriptScroll({
  scrollKey: manuscriptScrollKey, blocks, manuscriptText, generationState, streamingDraft,
  instructionDockRef, instructionInputHeight, authorNote, mode,
}: ManuscriptScrollOptions) {
  const manuscriptWrapRef = useRef<HTMLElement>(null);
  const manuscriptTailRef = useRef<HTMLDivElement>(null);
  const [instructionDockHeight, setInstructionDockHeight] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const generationStart = useRef<{ scrollKey: string; blockCount: number } | null>(null);
  const streamingScrollState = useRef<{
    key: string;
    wasAtBottom: boolean;
    userScrolledUp: boolean;
    autoScrolled: boolean;
  } | null>(null);
  const streamingDraftKey = streamingDraft
    ? `${manuscriptScrollKey}:${streamingDraft.targetBlockId ?? 'section'}`
    : '';

  const prepareManuscriptTail = (targetBlockId = manuscriptTailTargets.get(manuscriptScrollKey)) => {
    const container = manuscriptWrapRef.current;
    const tail = manuscriptTailRef.current;
    if (!container || !tail) return;
    tail.style.height = '0px';
    if (!targetBlockId) return;
    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]'))
      .find((element) => element.dataset.blockId === targetBlockId);
    if (!target) {
      manuscriptTailTargets.delete(manuscriptScrollKey);
      return;
    }
    const desiredScrollTop = container.scrollTop
      + target.getBoundingClientRect().top
      - container.getBoundingClientRect().top;
    const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    tail.style.height = `${Math.max(0, Math.ceil(desiredScrollTop - maximumScrollTop))}px`;
  };

  const updateManuscriptScrollState = () => {
    const container = manuscriptWrapRef.current;
    if (!container) return;
    const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
    manuscriptScrollPositions.set(manuscriptScrollKey, container.scrollTop);
    setShowScrollToBottom(remaining > 12);
    const streaming = streamingScrollState.current;
    if (streaming?.key === streamingDraftKey && remaining > 96 && !streaming.autoScrolled) {
      streaming.userScrolledUp = true;
    }
  };

  const scrollManuscriptToBottom = () => {
    const container = manuscriptWrapRef.current;
    if (!container) return;
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    updateManuscriptScrollState();
  };

  useEffect(() => {
    if (generationState === 'generating') {
      generationStart.current = { scrollKey: manuscriptScrollKey, blockCount: blocks.length };
    }
  }, [generationState, manuscriptScrollKey]);

  useLayoutEffect(() => {
    const container = manuscriptWrapRef.current;
    if (!container) return undefined;
    prepareManuscriptTail();
    container.scrollTop = manuscriptScrollPositions.get(manuscriptScrollKey) ?? 0;
    updateManuscriptScrollState();
    return () => {
      manuscriptScrollPositions.set(manuscriptScrollKey, container.scrollTop);
    };
  }, [manuscriptScrollKey]);

  useLayoutEffect(() => {
    const start = generationStart.current;
    if (!start || generationState === 'generating') return;
    if (start.scrollKey !== manuscriptScrollKey) {
      generationStart.current = null;
      return;
    }
    if (blocks.length <= start.blockCount) return;

    const targetBlock = blocks.slice(start.blockCount).find((block) => block.kind === 'user')
      ?? blocks[start.blockCount];
    const container = manuscriptWrapRef.current;
    const target = targetBlock && Array.from(container?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])
      .find((element) => element.dataset.blockId === targetBlock.id);
    if (!container || !target) return;

    manuscriptTailTargets.set(manuscriptScrollKey, targetBlock.id);
    prepareManuscriptTail(targetBlock.id);
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    generationStart.current = null;
    updateManuscriptScrollState();
  }, [blocks.length, generationState, manuscriptScrollKey]);

  useLayoutEffect(() => {
    prepareManuscriptTail();
    updateManuscriptScrollState();
  }, [instructionDockHeight, manuscriptText, manuscriptScrollKey]);

  useLayoutEffect(() => {
    const container = manuscriptWrapRef.current;
    const draft = streamingDraft;
    if (!container || !draft || !streamingDraftKey) {
      if (!draft) streamingScrollState.current = null;
      return;
    }
    const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
    const current = streamingScrollState.current;
    if (!current || current.key !== streamingDraftKey) {
      streamingScrollState.current = {
        key: streamingDraftKey,
        wasAtBottom: remaining <= 96,
        userScrolledUp: false,
        autoScrolled: false,
      };
    }
    const state = streamingScrollState.current;
    if (!draft.content || !state || state.autoScrolled || state.userScrolledUp || !state.wasAtBottom) return;
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    state.autoScrolled = true;
    updateManuscriptScrollState();
  }, [streamingDraft, streamingDraftKey]);

  useEffect(() => {
    const update = () => {
      prepareManuscriptTail();
      updateManuscriptScrollState();
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [manuscriptScrollKey]);

  useEffect(() => {
    const dock = instructionDockRef.current;
    if (!dock) return undefined;
    const updateDockHeight = () => setInstructionDockHeight(dock.getBoundingClientRect().height);
    updateDockHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateDockHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [instructionInputHeight, authorNote, mode]);


  return {
    manuscriptWrapRef, manuscriptTailRef, instructionDockHeight, showScrollToBottom,
    updateManuscriptScrollState, scrollManuscriptToBottom,
  };
}
