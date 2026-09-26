import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { appendCandidate } from '../answerCandidates';
import { makeId } from '../components/shared/id';
import { sectionBlocks } from '../components/shared/sectionContent';
import { makeRegenerateBlockRequest, makeRespondToInputRequest } from '../generationRequests';
import { parseSectionMemoryDraft } from '../sectionMemory';
import type { Book, GenerationMode, GenerationRequest, SectionBlock } from '../types';
import { referenceLocation } from './bookRecipes';
import { staleSaveError } from './bookSessionErrors';
import {
  appendGeneratedBlocks, applyGeneratedResponse, applyRegeneratedCandidate,
  finalizePreviousAnswer, generationSourceFingerprint, previousAnswerWithCandidates,
} from './generationRecipes';
import {
  abortGenerationError, finishReasonSuccessStatus, isAbortError, isUnsuccessfulFinishReason,
  streamingDraftKey, unsuccessfulFinishMessage, type StreamingDraft, type StreamingDraftStatus,
} from './generationStatus';
import type { useBookSession } from './useBookSession';

type GenerationBookSession = Pick<ReturnType<typeof useBookSession>,
  'getSnapshot' | 'captureToken' | 'isCurrent' | 'saveCurrent' | 'changeBook'>;

export type GenerationInput = {
  sectionId: string;
  mode: GenerationMode;
  selectedCharacterId: string;
  providerProfileId?: string;
  streamingOutput: boolean;
};
export type ContinuationInput = GenerationInput & { instruction: string; authorNote: string };

type GenerationSessionOptions = {
  bookSession: GenerationBookSession;
  getSelection: () => { sectionId: string; view: 'write' | 'shelf' };
  withBusy: (action: () => Promise<void>) => Promise<void>;
  onStatus: (message: string) => void;
  onSummaryBusyChange: (busy: boolean) => void;
  onContinuationApplied: (applied: { bookId: string; sectionId: string; instruction: string }) => void;
};

export function useGenerationSession(options: GenerationSessionOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { bookSession } = options;
  const { changeBook, saveCurrent } = bookSession;
  const setStatus = (message: string) => optionsRef.current.onStatus(message);
  const withBusy = (action: () => Promise<void>) => optionsRef.current.withBusy(action);
  const [generationState, setGenerationState] = useState<'idle' | 'generating'>('idle');
  const generationAbort = useRef<AbortController | null>(null);
  const generationTarget = useRef<{ bookId: string; sectionId: string; targetBlockId?: string } | null>(null);
  const [streamingDraft, setStreamingDraft] = useState<StreamingDraft | null>(null);
  const streamingDraftRef = useRef<StreamingDraft | null>(null);
  const streamingControllerRef = useRef<AbortController | null>(null);
  const streamingPending = useRef<{ controller: AbortController; key: string; content: string } | null>(null);
  const streamingFrame = useRef<number | null>(null);

  const cancelStreamingFrame = () => {
    if (streamingFrame.current === null) return;
    window.cancelAnimationFrame?.(streamingFrame.current);
    window.clearTimeout(streamingFrame.current);
    streamingFrame.current = null;
  };

  useEffect(() => () => {
    generationAbort.current?.abort();
    generationAbort.current = null;
    generationTarget.current = null;
    cancelStreamingFrame();
    streamingControllerRef.current = null;
    streamingPending.current = null;
  }, []);

  const setStreamingDraftState = (next: StreamingDraft | null) => {
    streamingDraftRef.current = next;
    setStreamingDraft(next);
  };

  const flushStreamingDraft = (controller: AbortController) => {
    const pending = streamingPending.current;
    if (!pending || pending.controller !== controller) return;
    streamingPending.current = null;
    const current = streamingDraftRef.current;
    if (!current || current.key !== pending.key || current.status !== 'streaming') return;
    setStreamingDraftState({ ...current, content: pending.content });
  };

  const scheduleStreamingDelta = (
    controller: AbortController,
    key: string,
    delta: string,
  ) => {
    if (!delta || streamingControllerRef.current !== controller) return;
    const current = streamingDraftRef.current;
    if (!current || current.key !== key || current.status !== 'streaming') return;
    const pending = streamingPending.current;
    streamingPending.current = {
      controller,
      key,
      content: (pending?.controller === controller && pending.key === key ? pending.content : current.content) + delta,
    };
    if (streamingFrame.current !== null) return;
    const flush = () => {
      streamingFrame.current = null;
      flushStreamingDraft(controller);
    };
    streamingFrame.current = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(flush)
      : window.setTimeout(flush, 0);
  };

  const beginStreamingDraft = (request: GenerationRequest, controller: AbortController) => {
    const draft: StreamingDraft = {
      key: streamingDraftKey(request),
      bookId: request.bookId,
      sectionId: request.sectionId,
      ...(request.targetBlockId ? { targetBlockId: request.targetBlockId } : {}),
      replaceTarget: request.generationKind === 'regenerate-block',
      content: '',
      status: 'streaming',
      message: '正在逐步生成，尚未写入正文。',
    };
    cancelStreamingFrame();
    streamingControllerRef.current = controller;
    streamingPending.current = null;
    setStreamingDraftState(draft);
  };

  const finishStreamingDraft = (
    controller: AbortController,
    status: Exclude<StreamingDraftStatus, 'streaming'>,
  ) => {
    if (streamingControllerRef.current !== controller) return;
    flushStreamingDraft(controller);
    cancelStreamingFrame();
    const current = streamingDraftRef.current;
    if (!current) return;
    setStreamingDraftState({
      ...current,
      status,
      message: status === 'stopped'
        ? '已停止，生成草稿未写入正文。'
        : '生成失败，草稿未写入正文。',
    });
  };

  const clearStreamingDraft = (controller?: AbortController) => {
    if (controller && streamingControllerRef.current !== controller) return;
    cancelStreamingFrame();
    streamingControllerRef.current = null;
    streamingPending.current = null;
    setStreamingDraftState(null);
  };

  const runGeneration = async (request: GenerationRequest, label: string) => {
    if (generationAbort.current) throw new Error('已有生成正在进行，请先完成或取消当前生成。');
    const controller = new AbortController();
    const visibleSelection = optionsRef.current.getSelection();
    const visibleBookId = bookSession.getSnapshot().book?.id ?? request.bookId;
    const requestBookToken = { ...bookSession.captureToken(), bookId: visibleBookId };
    const sourceSectionTitle = request.generationKind === 'summarize-section'
      ? bookSession.getSnapshot().book?.chapters.flatMap((chapter) => chapter.sections)
        .find((item) => item.id === request.sectionId)?.title
      : undefined;
    const target = {
      bookId: request.bookId,
      sectionId: request.sectionId,
      targetBlockId: request.targetBlockId,
    };
    generationAbort.current = controller;
    generationTarget.current = target;
    if (request.stream) beginStreamingDraft(request, controller);
    else clearStreamingDraft();
    setGenerationState('generating');
    setStatus(label);
    try {
      const result = await api.generate(
        request,
        controller.signal,
        request.stream ? (delta) => scheduleStreamingDelta(controller, streamingDraftKey(request), delta) : undefined,
      );
      if (controller.signal.aborted
        || generationAbort.current !== controller
        || generationTarget.current !== target
        || !bookSession.isCurrent(requestBookToken)
        || optionsRef.current.getSelection().sectionId !== visibleSelection.sectionId
        || optionsRef.current.getSelection().view !== visibleSelection.view) throw abortGenerationError();
      const finishReason = result.finishReason ?? 'unknown';
      if (isUnsuccessfulFinishReason(finishReason)) {
        const isSummary = request.generationKind === 'summarize-section';
        const message = unsuccessfulFinishMessage(finishReason, isSummary, sourceSectionTitle);
        cancelStreamingFrame();
        streamingControllerRef.current = null;
        streamingPending.current = null;
        setStreamingDraftState({
          key: `${request.bookId}:${visibleSelection.sectionId}:${request.targetBlockId ?? 'section'}`,
          bookId: visibleBookId,
          sectionId: visibleSelection.sectionId,
          ...(request.targetBlockId ? { targetBlockId: request.targetBlockId } : {}),
          replaceTarget: request.generationKind === 'regenerate-block',
          content: result.draft,
          status: 'failed',
          message,
        });
        throw new Error(message);
      }
      if (request.stream) clearStreamingDraft(controller);
      return { ...result, finishReason };
    } catch (error) {
      if (request.stream && streamingControllerRef.current === controller) {
        finishStreamingDraft(controller, isAbortError(error) ? 'stopped' : 'failed');
      }
      throw error;
    } finally {
      if (generationAbort.current === controller) {
        generationAbort.current = null;
        generationTarget.current = null;
        setGenerationState('idle');
      }
    }
  };

  const cancelGeneration = () => {
    if (!generationAbort.current) return;
    generationAbort.current.abort();
    setStatus('正在取消生成…');
  };

  const finalizePreviousAnswerCandidates = (savedBook: Book, targetSectionId: string, targetBlockId: string) => {
    if (bookSession.getSnapshot().book?.id !== savedBook.id) return;
    const previousAnswerId = previousAnswerWithCandidates(savedBook, targetSectionId, targetBlockId);
    if (!previousAnswerId) return;
    changeBook((current) => finalizePreviousAnswer(current, targetSectionId, previousAnswerId));
  };

  const generateContinuation = (input: ContinuationInput) => withBusy(async () => {
    const { sectionId, instruction, authorNote, mode, selectedCharacterId, streamingOutput } = input;
    if (mode === 'character' && !bookSession.getSnapshot().book?.characters.some((character) => character.id === selectedCharacterId)) {
      setStatus('角色模式需要先选择本书角色。');
      return;
    }
    const targetSectionId = sectionId;
    const inputSnapshot = instruction;
    const noteSnapshot = authorNote;
    const modeSnapshot = mode;
    const characterSnapshot = selectedCharacterId;
    const providerProfileIdSnapshot = input.providerProfileId;
    const streamingOutputSnapshot = streamingOutput;
    const generationRevision = bookSession.getSnapshot().revision;
    const saved = await saveCurrent();
    if (bookSession.getSnapshot().revision !== generationRevision) throw staleSaveError();
    const generation = {
      bookId: saved.id,
      sectionId: targetSectionId,
      providerProfileId: providerProfileIdSnapshot,
      mode: modeSnapshot,
      selectedCharacterId: modeSnapshot === 'character' ? characterSnapshot : undefined,
      authorNote: noteSnapshot || undefined,
      instruction: inputSnapshot,
      generationKind: 'continue-section',
      stream: streamingOutputSnapshot,
    } satisfies GenerationRequest;
    const result = await runGeneration(generation, '正在生成当前小节…');
    if (bookSession.getSnapshot().book?.id !== saved.id || bookSession.getSnapshot().revision !== generationRevision) {
      setStatus('当前书目或正文已变化，生成结果未写入。');
      return;
    }
    const inputBlockId = inputSnapshot.trim() ? makeId('block') : undefined;
    const additions: SectionBlock[] = [
      ...(inputBlockId
        ? [{ id: inputBlockId, kind: 'user' as const, content: inputSnapshot.trim() }]
        : []),
      appendCandidate(
        { id: makeId('block'), kind: 'assistant', content: '' },
        {
          id: makeId('candidate'),
          content: result.draft,
          ...(result.sourceSignature !== undefined ? { sourceSignature: result.sourceSignature } : {}),
        },
      ),
    ];
    changeBook((current) => appendGeneratedBlocks(current, targetSectionId, additions));
    optionsRef.current.onContinuationApplied({ bookId: saved.id, sectionId: targetSectionId, instruction: inputSnapshot });
    if (inputBlockId) {
      const responseRevision = bookSession.getSnapshot().revision;
      const savedResponse = await saveCurrent();
      if (savedResponse.id !== bookSession.getSnapshot().book?.id || bookSession.getSnapshot().revision !== responseRevision) {
        setStatus('当前正文已变化，候选整理未写入。');
        return;
      }
      finalizePreviousAnswerCandidates(savedResponse, targetSectionId, inputBlockId);
    }
    setStatus(finishReasonSuccessStatus('续写已加入当前小节。', result.finishReason ?? 'unknown'));
  });

  const respondToInput = (blockId: string, input: GenerationInput) => {
    const currentBook = bookSession.getSnapshot().book;
    const currentSection = currentBook?.chapters.flatMap((chapter) => chapter.sections)
      .find((item) => item.id === input.sectionId);
    if (!currentSection) return;
    const targetSectionId = currentSection.id;
    const currentBlocks = sectionBlocks(currentSection);
    const targetIndex = currentBlocks.findIndex((item) => item.id === blockId);
    const target = targetIndex >= 0 ? currentBlocks[targetIndex] : undefined;
    if (!target || target.kind !== 'user' || !target.content.trim()) return;
    const targetContentSnapshot = target.content;
    const sourceSnapshot = generationSourceFingerprint(currentBlocks, targetIndex);
    void withBusy(async () => {
      const modeSnapshot = input.mode;
      const characterSnapshot = input.selectedCharacterId;
      const providerProfileIdSnapshot = input.providerProfileId;
      const streamingOutputSnapshot = input.streamingOutput;
      const generationRevision = bookSession.getSnapshot().revision;
      const saved = await saveCurrent();
      if (bookSession.getSnapshot().revision !== generationRevision) throw staleSaveError();
      const savedSection = saved.chapters.flatMap((chapter) => chapter.sections)
        .find((item) => item.id === targetSectionId);
      const savedBlocks = savedSection ? sectionBlocks(savedSection) : [];
      const savedTargetIndex = savedBlocks.findIndex((item) => item.id === blockId);
      const savedTarget = savedTargetIndex >= 0 ? savedBlocks[savedTargetIndex] : undefined;
      const savedLastNonEmptyIndex = savedBlocks.reduce((last, item, index) => item.content.trim() ? index : last, -1);
      if (saved.id !== bookSession.getSnapshot().book?.id
        || !savedTarget
        || savedTarget.kind !== 'user'
        || savedTarget.content !== targetContentSnapshot
        || savedTargetIndex !== savedLastNonEmptyIndex
        || generationSourceFingerprint(savedBlocks, savedTargetIndex) !== sourceSnapshot) {
        setStatus('当前输入已变化，回答未写入正文。');
        return;
      }
      const generation = {
        ...makeRespondToInputRequest({
          bookId: saved.id,
          sectionId: targetSectionId,
          providerProfileId: providerProfileIdSnapshot,
          mode: modeSnapshot,
          selectedCharacterId: modeSnapshot === 'character' ? characterSnapshot : undefined,
          targetBlockId: blockId,
        }),
        stream: streamingOutputSnapshot,
      } satisfies GenerationRequest;
      const result = await runGeneration(generation, '正在生成这条输入的回答…');
      const currentBook = bookSession.getSnapshot().book;
      const currentSection = currentBook?.chapters.flatMap((chapter) => chapter.sections)
        .find((item) => item.id === targetSectionId);
      const currentBlocks = currentSection ? sectionBlocks(currentSection) : [];
      const currentTargetIndex = currentBlocks.findIndex((item) => item.id === blockId);
      const currentLastNonEmptyIndex = currentBlocks.reduce((last, item, index) =>
        item.content.trim() ? index : last, -1);
      if (currentBook?.id !== saved.id
        || bookSession.getSnapshot().revision !== generationRevision
        || currentTargetIndex < 0
        || currentTargetIndex !== currentLastNonEmptyIndex
        || currentBlocks[currentTargetIndex]?.kind !== 'user'
        || currentBlocks[currentTargetIndex]?.content !== targetContentSnapshot
        || generationSourceFingerprint(currentBlocks, currentTargetIndex) !== sourceSnapshot) {
        setStatus('当前输入已变化，回答未写入正文。');
        return;
      }
      changeBook((current) => applyGeneratedResponse(current, targetSectionId, blockId, result));
      // Persist the new answer before collapsing the candidate set belonging
      // to the immediately preceding AI answer. If this save fails, the new
      // text and older candidates remain available for an autosave retry.
      const responseRevision = bookSession.getSnapshot().revision;
      const savedResponse = await saveCurrent();
      if (savedResponse.id !== bookSession.getSnapshot().book?.id || bookSession.getSnapshot().revision !== responseRevision) {
        setStatus('当前正文已变化，候选整理未写入。');
        return;
      }
      finalizePreviousAnswerCandidates(savedResponse, targetSectionId, blockId);
      setStatus(finishReasonSuccessStatus('已生成回答并加入正文。', result.finishReason ?? 'unknown'));
    });
  };

  const regenerateBlock = (blockId: string, input: GenerationInput) => {
    const currentBook = bookSession.getSnapshot().book;
    const currentSection = currentBook?.chapters.flatMap((chapter) => chapter.sections)
      .find((item) => item.id === input.sectionId);
    if (!currentSection) return;
    const currentBlocks = sectionBlocks(currentSection);
    const targetIndex = currentBlocks.findIndex((item) => item.id === blockId);
    const target = targetIndex >= 0 ? currentBlocks[targetIndex] : undefined;
    if (!target || target.kind !== 'assistant') return;
    const targetSectionId = currentSection.id;
    const targetContentSnapshot = target.content;
    const sourceSnapshot = generationSourceFingerprint(currentBlocks, targetIndex);
    void withBusy(async () => {
      const modeSnapshot = input.mode;
      const characterSnapshot = input.selectedCharacterId;
      const providerProfileIdSnapshot = input.providerProfileId;
      const streamingOutputSnapshot = input.streamingOutput;
      const generationRevision = bookSession.getSnapshot().revision;
      const saved = await saveCurrent();
      if (bookSession.getSnapshot().revision !== generationRevision) throw staleSaveError();
      const savedSection = saved.chapters.flatMap((chapter) => chapter.sections)
        .find((item) => item.id === targetSectionId);
      const savedBlocks = savedSection ? sectionBlocks(savedSection) : [];
      const savedTargetIndex = savedBlocks.findIndex((item) => item.id === blockId);
      const savedTarget = savedTargetIndex >= 0 ? savedBlocks[savedTargetIndex] : undefined;
      if (saved.id !== bookSession.getSnapshot().book?.id
        || !savedTarget
        || savedTarget.kind !== 'assistant'
        || savedTarget.content !== targetContentSnapshot
        || generationSourceFingerprint(savedBlocks, savedTargetIndex) !== sourceSnapshot) {
        setStatus('当前 AI 正文已变化，候选未写入。');
        return;
      }
      const generation = {
        ...makeRegenerateBlockRequest({
          bookId: saved.id,
          sectionId: targetSectionId,
          providerProfileId: providerProfileIdSnapshot,
          mode: modeSnapshot,
          selectedCharacterId: modeSnapshot === 'character' ? characterSnapshot : undefined,
          targetBlockId: blockId,
        }),
        stream: streamingOutputSnapshot,
      } satisfies GenerationRequest;
      const result = await runGeneration(generation, '正在生成新的候选回答…');
      const resultSection = bookSession.getSnapshot().book?.chapters.flatMap((chapter) => chapter.sections)
        .find((item) => item.id === targetSectionId);
      const resultBlocks = resultSection ? sectionBlocks(resultSection) : [];
      const resultTargetIndex = resultBlocks.findIndex((item) => item.id === blockId);
      if (bookSession.getSnapshot().book?.id !== saved.id
        || bookSession.getSnapshot().revision !== generationRevision
        || resultTargetIndex < 0
        || resultBlocks[resultTargetIndex]?.kind !== 'assistant'
        || resultBlocks[resultTargetIndex]?.content !== targetContentSnapshot
        || generationSourceFingerprint(resultBlocks, resultTargetIndex) !== sourceSnapshot) {
        setStatus('当前书目或正文已变化，候选未写入。');
        return;
      }
      const candidate = {
        id: makeId('candidate'),
        content: result.draft,
        ...(result.sourceSignature !== undefined ? { sourceSignature: result.sourceSignature } : {}),
      };
      changeBook((current) => applyRegeneratedCandidate(current, targetSectionId, blockId, candidate));
      if (streamingOutputSnapshot) {
        const responseRevision = bookSession.getSnapshot().revision;
        const savedResponse = await saveCurrent();
        if (savedResponse.id !== bookSession.getSnapshot().book?.id || bookSession.getSnapshot().revision !== responseRevision) {
          setStatus('当前正文已变化，候选未写入。');
          return;
        }
      }
      setStatus(finishReasonSuccessStatus('已生成新的回答，并已切换到当前版本。', result.finishReason ?? 'unknown'));
    });
  };

  const generateSectionMemory = async (sourceSectionId: string, input: Pick<GenerationInput, 'sectionId' | 'providerProfileId'>) => {
    optionsRef.current.onSummaryBusyChange(true);
    try {
      const book = bookSession.getSnapshot().book;
      const section = book?.chapters.flatMap((chapter) => chapter.sections).find((item) => item.id === input.sectionId);
      if (!book || !section) throw new Error('请先选择一个小节。');
      const source = referenceLocation(book, sourceSectionId);
      if (!source) throw new Error('找不到要生成梗概的小节。');
      const targetOrdinal = book.chapters.flatMap((chapter) => chapter.sections)
        .findIndex((item) => item.id === section.id);
      if (targetOrdinal < 0 || source.ordinal >= targetOrdinal) throw new Error('只能为当前小节之前的内容生成梗概。');
      if (!source.section.content.trim()) throw new Error('这一节还没有正文，无法生成梗概。');
      const saved = await saveCurrent();
      const generation = {
        bookId: saved.id,
        sectionId: sourceSectionId,
        providerProfileId: input.providerProfileId,
        mode: 'author',
        instruction: '',
        generationKind: 'summarize-section',
        stream: false,
      } satisfies GenerationRequest;
      const result = await runGeneration(generation, '正在生成前文梗概…');
      const draft = parseSectionMemoryDraft(result.draft);
      setStatus(finishReasonSuccessStatus(`已生成「${source.section.title}」的梗概草稿，请确认保存。`, result.finishReason ?? 'unknown'));
      return draft;
    } catch (error) {
      setStatus(isAbortError(error)
        ? '已取消生成；迟到结果未写入正文。'
        : error instanceof Error ? error.message : '梗概生成失败。');
      throw error;
    } finally {
      optionsRef.current.onSummaryBusyChange(false);
    }
  };

  return {
    generationState, streamingDraft, cancelGeneration,
    generateContinuation, respondToInput, regenerateBlock, generateSectionMemory,
  };
}
