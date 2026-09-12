import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  BookMarked,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Menu,
  MessageSquareText,
  MousePointer2,
  Pencil,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { parseProseFormatting } from '../proseFormatting';
import { countWords, estimateTokens } from '../textMetrics';
import { ContextCompositionDrawer } from './ContextCompositionDrawer';
import {
  DialogOperationStatus,
  idleDialogOperation,
  useDismissSuccessfulDialog,
  type DialogOperationState,
} from './shared/DialogOperationStatus';
import { getAnswerCandidates } from '../answerCandidates';
import { blocksAsContent, sectionBlocks } from './shared/sectionContent';
import { compactTokenCount } from './shared/text';
import { TextArea } from './shared/TextArea';
import { InlineTitle } from './shared/InlineTitle';
import type { Book, ContextPlan, GenerationMode, SectionBlock } from '../types';

interface WriterProps {
  book: Book;
  section: Book['chapters'][number]['sections'][number] | undefined;
  chapterTitle: string;
  mode: GenerationMode;
  selectedCharacterId: string;
  instruction: string;
  authorNote: string;
  busy: boolean;
  status: string;
  generationState: 'idle' | 'generating';
  contextPlan: ContextPlan | null;
  contextPlanError: string;
  contextPlanPending?: boolean;
  contextCompositionOpen: boolean;
  contextToolsOpen: boolean;
  streamingDraft?: StreamingDraftView | null;
  providerName: string;
  modelId: string;
  canEdit?: boolean;
  onBack: () => void;
  onOpenBookSettings: () => void;
  onOpenSettings: () => void;
  onOpenContextComposition: () => void;
  onOpenContextTools: () => void;
  onCancelGeneration: () => void;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onAuthorNoteChange: (value: string) => void;
  onSectionBlocksChange: (blocks: SectionBlock[]) => void;
  onDeleteSectionBlock: (blockId: string) => Promise<void>;
  onRegenerateBlock: (blockId: string) => void;
  onGenerateForBlock?: (blockId: string) => void;
  onSelectCandidate?: (blockId: string, candidateId: string) => void;
  onDeleteAdoptedCandidate?: (blockId: string, candidateId: string, replacementId: string) => Promise<void>;
  onSectionTitleChange: (value: string) => Promise<void>;
  onChapterTitleChange?: (value: string) => Promise<void>;
  onGenerate: () => void;
}

type StreamingDraftView = {
  content: string;
  status: 'streaming' | 'stopped' | 'failed';
  message: string;
  targetBlockId?: string;
  replaceTarget: boolean;
};

const manuscriptScrollPositions = new Map<string, number>();
const manuscriptTailTargets = new Map<string, string>();

const renderBlockContent = (block: SectionBlock) => {
  const renderDialogue = (text: string, segmentIndex: number) => block.kind === 'assistant'
    ? text.split(/(“[^”]*”|"[^"\n]*")/g).map((part, dialogueIndex) => (
      /^“[^”]*”$|^"[^"\n]*"$/.test(part)
        ? <span className="manuscript-dialogue" key={`${block.id}-${segmentIndex}-dialogue-${dialogueIndex}`}>{part}</span>
        : part
    ))
    : text;

  return parseProseFormatting(block.content).map((segment, index) => (
    segment.emphasized
      ? <em key={`${block.id}-emphasis-${index}`}>{renderDialogue(segment.text, index)}</em>
      : <Fragment key={`${block.id}-text-${index}`}>{renderDialogue(segment.text, index)}</Fragment>
  ));
};

const ManuscriptBlockCopy = memo(function ManuscriptBlockCopy({ block }: { block: SectionBlock }) {
  return <span className="manuscript-block-copy">{renderBlockContent(block)}</span>;
});

type ManuscriptPointerGesture = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startedAt: number;
  initialSelected: boolean;
  moved: boolean;
  multiplePointer: boolean;
  selectionObserved: boolean;
  selectionListener: (() => void) | null;
  doubleTap: boolean;
};

type ManuscriptGestureOutcome = {
  gesture: ManuscriptPointerGesture;
  blocked: boolean;
};

type ManuscriptTap = {
  pointerType: string;
  endedAt: number;
  x: number;
  y: number;
  initialSelected: boolean;
};

const MANUSCRIPT_TAP_MAX_DURATION = 420;
const MANUSCRIPT_DOUBLE_TAP_MAX_INTERVAL = 360;
const MANUSCRIPT_TAP_MOVE_TOLERANCE = 12;
const MANUSCRIPT_TAP_DISTANCE_TOLERANCE = 24;

const manuscriptDistance = (firstX: number, firstY: number, secondX: number, secondY: number) => {
  const x = firstX - secondX;
  const y = firstY - secondY;
  return Math.sqrt(x * x + y * y);
};

const manuscriptEventTime = (event: { timeStamp: number }) => Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();

const hasNonCollapsedManuscriptSelection = () => {
  if (typeof document === 'undefined') return false;
  return document.getSelection()?.isCollapsed === false;
};

const isTouchLikePointer = (pointerType: string) => pointerType === 'touch' || pointerType === 'pen';

const ManuscriptBlock = memo(function ManuscriptBlock({ block, selected, onSelect, canEdit, children }: {
  block: SectionBlock;
  selected: boolean;
  onSelect: (id: string) => void;
  canEdit: boolean;
  children?: ReactNode;
}) {
  const activePointersRef = useRef(new Set<number>());
  const pointerGestureRef = useRef<ManuscriptPointerGesture | null>(null);
  const gestureOutcomeRef = useRef<ManuscriptGestureOutcome | null>(null);
  const lastTouchTapRef = useRef<ManuscriptTap | null>(null);
  const lastMouseTapRef = useRef<ManuscriptTap | null>(null);
  const doubleClickSourceRef = useRef<{ initialSelected: boolean; pointerType: string } | null>(null);
  const ignoredSecondaryPointerRef = useRef(false);

  const observeSelection = (gesture: ManuscriptPointerGesture) => {
    if (hasNonCollapsedManuscriptSelection()) gesture.selectionObserved = true;
  };

  const detachSelectionListener = (gesture: ManuscriptPointerGesture) => {
    if (!gesture.selectionListener) return;
    document.removeEventListener('selectionchange', gesture.selectionListener);
    gesture.selectionListener = null;
  };

  const clearGestureOutcome = () => {
    const outcome = gestureOutcomeRef.current;
    if (outcome) detachSelectionListener(outcome.gesture);
    gestureOutcomeRef.current = null;
  };

  const cancelPointerGesture = () => {
    const gesture = pointerGestureRef.current;
    if (gesture) {
      gesture.moved = true;
      detachSelectionListener(gesture);
      gestureOutcomeRef.current = { gesture, blocked: true };
    } else if (gestureOutcomeRef.current) {
      gestureOutcomeRef.current.blocked = true;
      detachSelectionListener(gestureOutcomeRef.current.gesture);
    }
    pointerGestureRef.current = null;
    activePointersRef.current.clear();
    lastTouchTapRef.current = null;
    lastMouseTapRef.current = null;
    doubleClickSourceRef.current = null;
  };

  useEffect(() => () => {
    const gesture = pointerGestureRef.current;
    if (gesture) detachSelectionListener(gesture);
    const outcome = gestureOutcomeRef.current;
    if (outcome) detachSelectionListener(outcome.gesture);
    activePointersRef.current.clear();
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearGestureOutcome();

    const pointerType = event.pointerType || 'mouse';
    const now = manuscriptEventTime(event);
    const activePointers = activePointersRef.current;
    const currentGesture = pointerGestureRef.current;
    if (event.isPrimary === false) {
      ignoredSecondaryPointerRef.current = true;
      if (currentGesture) {
        currentGesture.multiplePointer = true;
        activePointers.add(event.pointerId);
      }
      return;
    }
    if (currentGesture) {
      if (!activePointers.has(event.pointerId)) {
        currentGesture.multiplePointer = true;
        activePointers.add(event.pointerId);
      }
      return;
    }

    ignoredSecondaryPointerRef.current = false;
    activePointers.clear();
    let doubleTap = false;
    let initialSelected = selected;
    const previousTap = isTouchLikePointer(pointerType)
      ? lastTouchTapRef.current
      : lastMouseTapRef.current;
    if (previousTap
      && now - previousTap.endedAt >= 0
      && now - previousTap.endedAt <= MANUSCRIPT_DOUBLE_TAP_MAX_INTERVAL
      && manuscriptDistance(event.clientX, event.clientY, previousTap.x, previousTap.y) <= MANUSCRIPT_TAP_DISTANCE_TOLERANCE) {
      doubleTap = true;
      initialSelected = previousTap.initialSelected;
    }

    if (pointerType === 'mouse') {
      doubleClickSourceRef.current = {
        initialSelected,
        pointerType,
      };
    } else {
      doubleClickSourceRef.current = null;
    }

    const gesture: ManuscriptPointerGesture = {
      pointerId: event.pointerId,
      pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: now,
      initialSelected,
      moved: false,
      multiplePointer: false,
      selectionObserved: hasNonCollapsedManuscriptSelection(),
      selectionListener: null,
      doubleTap,
    };
    const selectionListener = () => {
      const activeGesture = pointerGestureRef.current;
      const pendingOutcome = gestureOutcomeRef.current;
      if (activeGesture === gesture) observeSelection(gesture);
      else if (pendingOutcome?.gesture === gesture) observeSelection(gesture);
    };
    gesture.selectionListener = selectionListener;
    pointerGestureRef.current = gesture;
    activePointers.add(event.pointerId);
    document.addEventListener('selectionchange', selectionListener);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (manuscriptDistance(gesture.startX, gesture.startY, event.clientX, event.clientY) > MANUSCRIPT_TAP_MOVE_TOLERANCE) {
      gesture.moved = true;
      lastTouchTapRef.current = null;
      lastMouseTapRef.current = null;
      doubleClickSourceRef.current = null;
    }
    observeSelection(gesture);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      cancelPointerGesture();
      return;
    }

    observeSelection(gesture);
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size > 0) {
      gesture.multiplePointer = true;
      return;
    }

    pointerGestureRef.current = null;
    const endedAt = manuscriptEventTime(event);
    const duration = endedAt - gesture.startedAt;
    const blocked = gesture.moved
      || gesture.multiplePointer
      || gesture.selectionObserved
      || (isTouchLikePointer(gesture.pointerType) && gesture.doubleTap)
      || duration < 0
      || duration > MANUSCRIPT_TAP_MAX_DURATION;

    if (isTouchLikePointer(gesture.pointerType) && gesture.doubleTap) {
      lastTouchTapRef.current = null;
      doubleClickSourceRef.current = null;
      if (selected !== gesture.initialSelected) onSelect(block.id);
    } else if (!blocked) {
      if (gesture.pointerType === 'mouse' && gesture.doubleTap) {
        lastMouseTapRef.current = null;
      } else {
        const tap: ManuscriptTap = {
          pointerType: gesture.pointerType,
          endedAt,
          x: event.clientX,
          y: event.clientY,
          initialSelected: gesture.initialSelected,
        };
        if (isTouchLikePointer(gesture.pointerType)) lastTouchTapRef.current = tap;
        else lastMouseTapRef.current = tap;
      }
    } else if (isTouchLikePointer(gesture.pointerType)) {
      lastTouchTapRef.current = null;
    } else {
      lastMouseTapRef.current = null;
    }

    gestureOutcomeRef.current = { gesture, blocked };
  };

  const handlePointerCancel = () => {
    cancelPointerGesture();
  };

  const handlePointerLeave = () => {
    cancelPointerGesture();
  };

  const handleBlockScroll = () => {
    cancelPointerGesture();
  };

  const handleBlockClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const outcome = gestureOutcomeRef.current;
    if (outcome) observeSelection(outcome.gesture);
    const pointerType = outcome?.gesture.pointerType ?? 'mouse';
    const ignoredSecondaryPointer = ignoredSecondaryPointerRef.current;
    ignoredSecondaryPointerRef.current = false;
    const blocked = event.detail > 1
      || ignoredSecondaryPointer
      || Boolean(outcome?.blocked || outcome?.gesture.selectionObserved)
      || hasNonCollapsedManuscriptSelection();
    clearGestureOutcome();
    if (blocked) {
      if (event.detail <= 1 || pointerType !== 'mouse') doubleClickSourceRef.current = null;
      return;
    }

    doubleClickSourceRef.current = {
      initialSelected: selected,
      pointerType,
    };
    onSelect(block.id);
  };

  const handleBlockDoubleClick = () => {
    const source = doubleClickSourceRef.current;
    doubleClickSourceRef.current = null;
    if (!source || source.pointerType !== 'mouse') return;
    if (selected !== source.initialSelected) onSelect(block.id);
  };

  return (
    <div className="manuscript-block-group" data-block-id={block.id} data-selected={selected || undefined}>
      <div
        className="manuscript-block"
        data-kind={block.kind}
        onClick={handleBlockClick}
        onDoubleClick={handleBlockDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onScrollCapture={handleBlockScroll}
      >
        <ManuscriptBlockCopy block={block} />
      </div>
      {canEdit && <button
          type="button"
          className="manuscript-block-select icon-button"
          aria-pressed={selected}
          aria-label={`${selected ? '取消选择' : '选择'} ${block.kind === 'user' ? '用户输入' : 'AI 输出'}片段`}
          title={`${selected ? '取消选择' : '选择'}片段`}
          onClick={() => onSelect(block.id)}
        ><MousePointer2 aria-hidden="true" /></button>}
      {children}
    </div>
  );
});

const StreamingDraftBlock = memo(function StreamingDraftBlock({ draft }: { draft: StreamingDraftView }) {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyFeedbackTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
  }, []);
  const copyDraft = async () => {
    if (!draft.content) return;
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draft.content);
        success = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = draft.content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
          textarea.select();
          success = document.execCommand('copy');
        } finally {
          textarea.remove();
        }
      }
    } catch {
      success = false;
    }
    setCopyState(success ? 'success' : 'error');
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = window.setTimeout(() => setCopyState('idle'), 2_000);
  };
  return (
    <div className="streaming-draft-block" data-streaming-status={draft.status}>
      {draft.content ? (
        <div className="streaming-draft-text" role="textbox" aria-readonly="true" aria-label="临时生成草稿" tabIndex={0}>
          {draft.content}
        </div>
      ) : (
        <p className="streaming-draft-empty">{draft.status === 'streaming' ? '正在生成…' : '没有可保留的临时草稿。'}</p>
      )}
      <div className="streaming-draft-footer">
        <p role="status" aria-live="polite">{draft.message}</p>
        {draft.content && draft.status !== 'streaming' && (
          <button type="button" className="quiet-action" onClick={() => void copyDraft()}>
            {copyState === 'success' ? '已复制' : copyState === 'error' ? '未能复制，请选中文字复制' : '复制临时草稿'}
          </button>
        )}
      </div>
    </div>
  );
});

export function Writer(props: WriterProps) {
  const canEdit = props.canEdit !== false;
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;
  const blocks = useMemo(() => props.section ? sectionBlocks(props.section) : [],
    [props.section?.id, props.section?.blocks, props.section?.content]);
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [editingBlockId, setEditingBlockId] = useState('');
  const [candidateDeleteId, setCandidateDeleteId] = useState('');
  const [deleteOperation, setDeleteOperation] = useState<DialogOperationState>(idleDialogOperation);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const deleteBlockDialog = useRef<HTMLDialogElement>(null);
  const blockActionTrigger = useRef<HTMLElement | null>(null);
  const readerScrollPosition = useRef(0);
  const manuscriptWrapRef = useRef<HTMLElement>(null);
  const manuscriptTailRef = useRef<HTMLDivElement>(null);
  const instructionDockRef = useRef<HTMLFormElement>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const resizePressTimer = useRef<number | null>(null);
  const resizeGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const resizeGestureActive = useRef(false);
  const [instructionInputHeight, setInstructionInputHeight] = useState<number | null>(null);
  const [instructionDockHeight, setInstructionDockHeight] = useState(0);
  const [isResizingInstruction, setIsResizingInstruction] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const generationStart = useRef<{ scrollKey: string; blockCount: number } | null>(null);
  const streamingScrollState = useRef<{
    key: string;
    wasAtBottom: boolean;
    userScrolledUp: boolean;
    autoScrolled: boolean;
  } | null>(null);
  const selectedBlock = blocks.find((item) => item.id === selectedBlockId);
  const editingBlock = blocks.find((item) => item.id === editingBlockId);
  const lastNonEmptyBlockId = useMemo(() => [...blocks].reverse().find((block) => block.content.trim())?.id ?? '', [blocks]);
  const finalNonEmptyBlock = blocks.find((block) => block.id === lastNonEmptyBlockId);
  const requiresInputResponse = finalNonEmptyBlock?.kind === 'user' && !props.instruction.trim();
  const selectedCandidates = useMemo(() => selectedBlock?.kind === 'assistant'
    ? getAnswerCandidates(selectedBlock)
    : [], [selectedBlock]);
  const selectedCandidateIndex = selectedBlock?.kind === 'assistant' && selectedCandidates.length
    ? Math.max(0, selectedCandidates.findIndex((candidate) => candidate.id === selectedBlock.adoptedCandidateId))
    : undefined;
  const selectedCandidate = selectedCandidateIndex === undefined
    ? undefined
    : selectedCandidates[selectedCandidateIndex];
  const deletingCandidate = candidateDeleteId
    ? selectedCandidates.find((candidate) => candidate.id === candidateDeleteId)
    : undefined;
  const deletingCandidateIndex = deletingCandidate
    ? selectedCandidates.findIndex((candidate) => candidate.id === deletingCandidate.id)
    : -1;
  const deletingCurrent = Boolean(deletingCandidate && selectedBlock?.kind === 'assistant' && selectedCandidates.length > 1);
  const deletingReplacementOriginalIndex = deletingCandidateIndex > 0 ? deletingCandidateIndex - 1 : 1;
  const deletingReplacement = selectedCandidates[deletingReplacementOriginalIndex];
  const deletingReplacementIndex = deletingReplacementOriginalIndex > deletingCandidateIndex
    ? deletingReplacementOriginalIndex - 1
    : deletingReplacementOriginalIndex;
  const editorOpen = Boolean(editingBlock);
  const manuscriptText = useMemo(() => editorOpen ? '' : blocksAsContent(blocks), [blocks, editorOpen]);
  const manuscriptWordCount = useMemo(() => countWords(manuscriptText), [manuscriptText]);
  const manuscriptTokenCount = useMemo(() => estimateTokens(manuscriptText), [manuscriptText]);
  const manuscriptScrollKey = `${props.book.id}:${props.section?.id ?? ''}`;
  const streamingDraftKey = props.streamingDraft
    ? `${props.book.id}:${props.section?.id ?? ''}:${props.streamingDraft.targetBlockId ?? 'section'}`
    : '';

  useEffect(() => {
    props.onEditorOpenChange?.(editorOpen);
    return () => props.onEditorOpenChange?.(false);
  }, [editorOpen, props.onEditorOpenChange]);

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

  useDismissSuccessfulDialog(deleteOperation.phase === 'success', () => deleteBlockDialog.current?.close());

  const contextTokens = props.contextPlan?.estimatedTokens ?? 0;
  const availableInput = props.contextPlan?.budget.availableInput ?? 0;
  const contextPercent = availableInput > 0
    ? Math.round((contextTokens / availableInput) * 100)
    : 0;
  const progressMax = Math.max(1, availableInput);
  const progressValue = Math.min(contextTokens, progressMax);

  useEffect(() => () => {
    if (resizePressTimer.current !== null) window.clearTimeout(resizePressTimer.current);
  }, []);

  useEffect(() => {
    if (props.generationState === 'generating') {
      generationStart.current = { scrollKey: manuscriptScrollKey, blockCount: blocks.length };
    }
  }, [props.generationState, manuscriptScrollKey]);

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
    if (!start || props.generationState === 'generating') return;
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
  }, [blocks.length, props.generationState, manuscriptScrollKey]);

  useLayoutEffect(() => {
    prepareManuscriptTail();
    updateManuscriptScrollState();
  }, [instructionDockHeight, manuscriptText, manuscriptScrollKey]);

  useLayoutEffect(() => {
    const container = manuscriptWrapRef.current;
    const draft = props.streamingDraft;
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
  }, [props.streamingDraft, streamingDraftKey]);

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
  }, [instructionInputHeight, props.authorNote, props.mode]);

  const clampInstructionHeight = (height: number) => Math.min(
    Math.max(44, height),
    Math.min(window.innerHeight * 0.45, 320),
  );

  const finishInstructionResize = (pointerId?: number, target?: HTMLButtonElement) => {
    if (resizePressTimer.current !== null) {
      window.clearTimeout(resizePressTimer.current);
      resizePressTimer.current = null;
    }
    if (pointerId !== undefined && target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    resizeGesture.current = null;
    resizeGestureActive.current = false;
    setIsResizingInstruction(false);
  };

  const closeActionMenu = (restoreFocus = false) => {
    if (!actionMenu.current) return;
    actionMenu.current.open = false;
    if (restoreFocus) actionMenu.current.querySelector('summary')?.focus();
  };

  const openBlockEditor = () => {
    if (!canEdit) return;
    if (!selectedBlock) return;
    readerScrollPosition.current = manuscriptWrapRef.current?.scrollTop ?? 0;
    blockActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingBlockId(selectedBlock.id);
  };

  const closeBlockEditor = () => {
    setEditingBlockId('');
    window.requestAnimationFrame(() => {
      if (manuscriptWrapRef.current) manuscriptWrapRef.current.scrollTop = readerScrollPosition.current;
      window.requestAnimationFrame(() => {
        if (blockActionTrigger.current?.isConnected) {
          blockActionTrigger.current.focus({ preventScroll: true });
          return;
        }
        document.querySelector<HTMLElement>(`.manuscript-block-group[data-selected="true"] .manuscript-block-actions button`)?.focus({ preventScroll: true });
      });
    });
  };

  const openDeleteBlockDialog = () => {
    if (!canEdit) return;
    if (!selectedBlock) return;
    blockActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCandidateDeleteId(selectedBlock.kind === 'assistant' && selectedCandidates.length > 1
      ? selectedCandidate?.id ?? ''
      : '');
    setDeleteOperation(idleDialogOperation);
    deleteBlockDialog.current?.showModal();
  };

  const closeDeleteBlockDialog = () => {
    if (deleteOperation.phase === 'pending') return;
    deleteBlockDialog.current?.close();
  };

  const restoreBlockActionFocus = () => {
    window.requestAnimationFrame(() => {
      if (blockActionTrigger.current?.isConnected) blockActionTrigger.current.focus();
      else document.querySelector<HTMLElement>('.writer-menu-trigger')?.focus();
    });
  };

  const selectManuscriptBlock = useCallback((blockId: string) => {
    actionMenu.current?.removeAttribute('open');
    setSelectedBlockId((current) => current === blockId ? '' : blockId);
  }, []);

  const selectCandidate = (block: SectionBlock, index: number) => {
    if (!canEdit || block.kind !== 'assistant') return;
    const candidates = selectedBlock?.id === block.id ? selectedCandidates : getAnswerCandidates(block);
    const candidate = candidates[index];
    if (!candidate) return;
    props.onSelectCandidate?.(block.id, candidate.id);
  };

  const leaveCandidatePreview = () => {
    setSelectedBlockId('');
  };

  const candidateNavigation = (block: SectionBlock) => {
    const candidates = selectedBlock?.id === block.id ? selectedCandidates : getAnswerCandidates(block);
    if (candidates.length < 2) return null;
    const index = Math.min(Math.max(0, candidates.findIndex((candidate) => candidate.id === block.adoptedCandidateId)), candidates.length - 1);
    return (
      <div className="answer-candidate-strip" data-block-id={block.id} aria-label="浏览 AI 回答候选">
        <div className="answer-candidate-navigation" role="group" aria-label="浏览回答候选">
          <button
            type="button"
            className="icon-button"
            onClick={() => selectCandidate(block, Math.max(0, index - 1))}
            disabled={props.busy || index <= 0}
            aria-label="上一版回答候选"
            title="上一版"
          ><ChevronLeft aria-hidden="true" /></button>
          <span aria-live="polite">{index + 1} / {candidates.length}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => selectCandidate(block, Math.min(candidates.length - 1, index + 1))}
            disabled={props.busy || index >= candidates.length - 1}
            aria-label="下一版回答候选"
            title="下一版"
          ><ChevronRight aria-hidden="true" /></button>
        </div>
      </div>
    );
  };

  if (editingBlock && canEdit) {
    const editorLabel = editingBlock.kind === 'user' ? '用户输入' : 'AI 输出';
    return (
      <article className="block-editor-page" aria-labelledby="block-editor-title">
        <header className="block-editor-header">
          <button
            type="button"
            className="icon-button"
            onClick={closeBlockEditor}
            aria-label="返回正文"
            title="返回正文"
          ><ArrowLeft aria-hidden="true" /></button>
          <div className="block-editor-heading">
            <h1 id="block-editor-title">编辑{editorLabel}</h1>
            <p title={`${props.book.title} · ${props.chapterTitle} · ${props.section?.title ?? ''}`}>
              {props.book.title} · {props.chapterTitle} · {props.section?.title ?? ''} · 自动保存
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={closeBlockEditor}
            aria-label="完成编辑并返回正文"
            title="完成"
          ><Check aria-hidden="true" /></button>
        </header>
        <div className="block-editor-body">
          <label className="sr-only" htmlFor="block-editor-textarea">{editorLabel}内容</label>
          <TextArea
            key={editingBlock.id}
            id="block-editor-textarea"
            className="block-editor-textarea"
            data-kind={editingBlock.kind}
            autoFocus
            value={editingBlock.content}
            onChange={(event) => props.onSectionBlocksChange(blocks.map((item) => item.id === editingBlock.id
              ? { ...item, content: event.target.value }
              : item))}
            spellCheck
          />
        </div>
      </article>
    );
  }

  return (
    <div className="writer-page" style={instructionDockHeight > 0 ? { '--instruction-dock-height': `${instructionDockHeight}px` } as CSSProperties : undefined}>
      <header className="writer-heading">
        <div className="writer-context-row">
          <button
            type="button"
            className="icon-button writer-back-button"
            onClick={props.onBack}
            disabled={props.busy}
            aria-label="返回故事书架"
            title="返回故事书架"
          ><ArrowLeft aria-hidden="true" /></button>
          <button
            type="button"
            className="writer-context-trigger"
            onClick={props.onOpenContextComposition}
            disabled={props.busy}
            aria-expanded={props.contextCompositionOpen}
            aria-controls="context-composition-drawer"
            aria-busy={props.contextPlanPending || undefined}
            aria-label={props.contextPlanError
              ? `查看当前上下文：${props.contextPlanError}`
              : `查看当前上下文：已估算约 ${contextTokens} tokens，可用输入约 ${availableInput} tokens`}
          >
            <progress
              className="writer-context-progress"
              max={progressMax}
              value={progressValue}
              aria-hidden="true"
            />
            <span className="writer-context-count" data-over-limit={contextPercent > 100 || undefined}>
              {props.contextPlanError ? '无法预览' : `约 ${compactTokenCount(contextTokens)} / 约 ${compactTokenCount(availableInput)} · ${contextPercent}%`}
              {props.contextPlanPending && <span className="sr-only">，上下文预览更新中</span>}
            </span>
            <small className="writer-provider-line">
              <span>{props.providerName}</span><span aria-hidden="true">|</span><span>{props.modelId}</span>
            </small>
            <span className="writer-manuscript-count">
              字数 <strong>{manuscriptWordCount.toLocaleString('zh-CN')}</strong>
              <span aria-hidden="true"> | </span>
              约 token <strong>{compactTokenCount(manuscriptTokenCount)}</strong>
            </span>
          </button>
        </div>

        {(props.contextPlan || props.contextPlanError) && (
          <ContextCompositionDrawer
            open={props.contextCompositionOpen}
            plan={props.contextPlan}
            error={props.contextPlanError}
            onClose={props.onOpenContextComposition}
          />
        )}

        <div className="writer-tool-row" role="group" aria-label="写作工具">
          <div className="writer-tool-leading">
            <button
              type="button"
              className="book-settings-button icon-button writer-book-settings-button"
              onClick={props.onOpenBookSettings}
              disabled={props.busy}
              aria-label="打开本书设定"
              title="本书设定"
            ><BookMarked aria-hidden="true" /></button>
            <button
              type="button"
              className="icon-button writer-context-tools-button"
              onClick={props.onOpenContextTools}
              disabled={props.busy}
              aria-expanded={props.contextToolsOpen}
              aria-controls="context-tools-drawer"
              aria-label="选择前文"
              title="选择前文"
            ><ListTree aria-hidden="true" /></button>
          </div>
          <div className="writer-tool-actions">
            <button
              type="button"
              className="icon-button"
              onClick={props.onOpenSettings}
              disabled={props.busy}
              aria-label="打开设置"
              title="设置"
            ><Settings aria-hidden="true" /></button>
          </div>
        </div>

        <div className="writer-section-title">
          <strong>
            {props.onChapterTitleChange ? <InlineTitle
              key={`${props.book.id}:${props.section?.id}:chapter`}
              value={props.chapterTitle}
              label="章节名称"
              disabled={!canEdit || !props.section || props.busy}
              onSave={props.onChapterTitleChange}
            /> : props.chapterTitle}
          </strong>
          {props.section && <>
            <span aria-hidden="true"> · </span>
            <InlineTitle
              key={`${props.book.id}:${props.section.id}:section`}
              value={props.section.title}
              label="小节名称"
              disabled={!canEdit || props.busy}
              onSave={props.onSectionTitleChange}
            />
          </>}
        </div>
      <div className="writer-status-row">
        <p className="writer-status" role="status" aria-live="polite" aria-atomic="true">{props.status}</p>
        {props.generationState === 'generating' && (
          <button type="button" className="quiet-action writer-cancel-button" onClick={props.onCancelGeneration}>
            取消生成
          </button>
        )}
      </div>
      </header>

      <div className="manuscript-stage">
        <section className="manuscript-wrap" ref={manuscriptWrapRef} onScroll={updateManuscriptScrollState} aria-labelledby="manuscript-label">
          <h2 id="manuscript-label" className="sr-only">连续小说正文</h2>
          <div className="manuscript" aria-label="连续小说正文">
            {blocks.map((block) => (
              <Fragment key={block.id}>
                <ManuscriptBlock block={block} selected={selectedBlockId === block.id} onSelect={selectManuscriptBlock} canEdit={canEdit}>
                  {canEdit && selectedBlockId === block.id && (
                    <div className="manuscript-block-actions" data-block-id={block.id} role="group" aria-label={`所选${block.kind === 'user' ? '用户输入' : 'AI 输出'}操作`}>
                      {block.kind === 'assistant' && <button
                        type="button"
                        className="icon-button"
                        onClick={() => props.onRegenerateBlock(block.id)}
                        disabled={props.busy}
                        aria-label="再生成一版：重新生成所选 AI 输出"
                        title="再生成一版"
                      ><RefreshCw aria-hidden="true" /><span className="sr-only">再生成一版</span></button>}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={openBlockEditor}
                        disabled={props.busy}
                        aria-label="编辑所选片段"
                        title="编辑"
                      ><Pencil aria-hidden="true" /></button>
                      <button
                        type="button"
                        className="icon-button danger-icon"
                        onClick={openDeleteBlockDialog}
                        disabled={props.busy}
                        aria-haspopup="dialog"
                        aria-label="删除所选片段"
                        title="删除"
                      ><Trash2 aria-hidden="true" /></button>
                    </div>
                  )}
                </ManuscriptBlock>
                {props.streamingDraft?.replaceTarget
                  && props.streamingDraft.targetBlockId === block.id && (
                  <StreamingDraftBlock draft={props.streamingDraft} />
                )}
                {canEdit && selectedBlockId === block.id && block.kind === 'assistant' && selectedCandidates.length > 1 && candidateNavigation(block)}
                {block.id === lastNonEmptyBlockId && block.kind === 'user' && (
                  <button
                    type="button"
                    className="respond-to-input-button quiet-action"
                    onClick={() => props.onGenerateForBlock?.(block.id)}
                    disabled={!canEdit || props.busy || !props.onGenerateForBlock}
                  >生成回答</button>
                )}
              </Fragment>
            ))}
            {props.streamingDraft && !props.streamingDraft.replaceTarget && (
              <StreamingDraftBlock draft={props.streamingDraft} />
            )}
            {blocks.length === 0 && <p className="empty-manuscript">本节还没有正文。</p>}
            <div className="manuscript-tail-space" ref={manuscriptTailRef} aria-hidden="true" />
          </div>
        </section>
        {showScrollToBottom && (
          <button
            type="button"
            className="icon-button manuscript-scroll-bottom"
            onClick={scrollManuscriptToBottom}
            aria-label="跳到正文末尾"
            title="跳到正文末尾"
          >
            <ArrowDown aria-hidden="true" />
          </button>
        )}
      </div>

      <form ref={instructionDockRef} className="instruction-dock" data-readonly={!canEdit || undefined} onSubmit={(event) => { event.preventDefault(); if (canEdit) props.onGenerate(); }}>
        <details
          ref={actionMenu}
          className="writer-action-menu"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeActionMenu(true);
          }}
        >
          <summary className="icon-button writer-menu-trigger" title="写作操作" aria-disabled={!canEdit || props.busy || undefined} onClick={(event) => { if (!canEdit || props.busy) { event.preventDefault(); return; } setSelectedBlockId(''); }}>
            <Menu aria-hidden="true" />
            <span className="sr-only">打开写作操作</span>
          </summary>
          <div className="writer-action-sheet" aria-label="写作操作">
            <div className="writer-menu-modes" role="group" aria-label="写作模式">
              <button
                type="button"
                className="writer-menu-action"
                disabled={!canEdit || props.busy}
                aria-pressed={props.mode === 'author'}
                onClick={() => props.onModeChange('author')}
              ><BookOpenText aria-hidden="true" />作者模式 · 写作接龙</button>
              <button
                type="button"
                className="writer-menu-action"
                disabled={!canEdit || props.busy}
                aria-pressed={props.mode === 'character'}
                onClick={() => props.onModeChange('character')}
              ><UsersRound aria-hidden="true" />角色模式 · 第一视角</button>
            </div>
            {props.mode === 'character' && (
              <div className="character-select writer-menu-character">
                <label htmlFor="character-select">扮演角色</label>
                <select
                  id="character-select"
                  value={props.selectedCharacterId}
                  disabled={!canEdit || props.busy}
                  onChange={(event) => props.onCharacterChange(event.target.value)}
                  required
                  aria-invalid={characterModeNeedsSelection ? 'true' : undefined}
                  aria-describedby="character-mode-hint"
                >
                  <option value="">选择本书角色</option>
                  {props.book.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                </select>
                <p id="character-mode-hint" className="mode-hint">
                  {characterModeNeedsSelection
                    ? '请选择本书角色后再发送。'
                    : `以 ${selectedCharacter?.name ?? '所选角色'} 的第一人称连续正文生成。你控制该角色，AI 处理世界和其他角色。`}
                </p>
              </div>
            )}
            <label className="writer-section-note" htmlFor="author-note-input">
              <span><MessageSquareText aria-hidden="true" />小节注释</span>
              <TextArea
                id="author-note-input"
                rows={4}
                value={props.authorNote}
                disabled={!canEdit || props.busy}
                onChange={(event) => props.onAuthorNoteChange(event.target.value)}
                placeholder="例如：跳过路程，直接写抵达后的重逢……"
                spellCheck
              />
              <small>指导当前小节之后的写作，不进入正文；修改后会保留，并在作者和扮演模式中生效。</small>
            </label>
          </div>
        </details>
        <div className="instruction-input-wrap">
          <button
            type="button"
            className="instruction-resize-handle"
            disabled={!canEdit}
            data-resizing={isResizingInstruction || undefined}
            aria-label="调整输入框高度：电脑上下拖动，手机长按后拖动"
            title="上下拖动调整高度；手机请先长按"
            onPointerDown={(event) => {
              const textarea = instructionInput.current;
              if (!textarea) return;
              resizeGesture.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: textarea.getBoundingClientRect().height,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              if (event.pointerType === 'mouse') {
                resizeGestureActive.current = true;
                setIsResizingInstruction(true);
                return;
              }
              resizePressTimer.current = window.setTimeout(() => {
                resizeGestureActive.current = true;
                setIsResizingInstruction(true);
              }, 300);
            }}
            onPointerMove={(event) => {
              const gesture = resizeGesture.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              const distance = gesture.startY - event.clientY;
              if (!resizeGestureActive.current) {
                if (Math.abs(distance) > 8) finishInstructionResize(event.pointerId, event.currentTarget);
                return;
              }
              event.preventDefault();
              setInstructionInputHeight(clampInstructionHeight(gesture.startHeight + distance));
            }}
            onPointerUp={(event) => finishInstructionResize(event.pointerId, event.currentTarget)}
            onPointerCancel={(event) => finishInstructionResize(event.pointerId, event.currentTarget)}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const currentHeight = instructionInputHeight
                ?? instructionInput.current?.getBoundingClientRect().height
                ?? 44;
              setInstructionInputHeight(clampInstructionHeight(currentHeight + (event.key === 'ArrowUp' ? 16 : -16)));
            }}
          ><span aria-hidden="true" /></button>
          <label className="sr-only" htmlFor="writing-instruction">{props.mode === 'author' ? '接龙正文' : '角色行动或台词'}</label>
          <TextArea
            ref={instructionInput}
            id="writing-instruction"
            rows={1}
            value={props.instruction}
            disabled={!canEdit}
            style={instructionInputHeight === null ? undefined : { height: instructionInputHeight }}
            onPointerDown={leaveCandidatePreview}
            onFocus={leaveCandidatePreview}
            onChange={(event) => props.onInstructionChange(event.target.value)}
            placeholder={props.mode === 'author' ? '写下一段正文，让 AI 从这里接着写……' : '以当前角色输入行动、台词或选择……'}
          />
        </div>
        {characterModeNeedsSelection && (
          <p className="writer-send-hint" id="character-mode-send-hint" role="alert">
            角色模式需要先选择本书角色，选择后才能发送。
          </p>
        )}
        <button
            type="submit"
            className="primary-action icon-button writer-send-button"
            disabled={!canEdit || props.busy || characterModeNeedsSelection || requiresInputResponse}
            aria-busy={props.busy || undefined}
            aria-label={props.busy ? '正在续写' : '发送并续写'}
            title={props.busy ? '正在续写…' : '发送并续写'}
            aria-describedby={characterModeNeedsSelection ? 'character-mode-send-hint' : undefined}
        ><Send aria-hidden="true" /></button>
      </form>

      <dialog
        className="confirm-dialog"
        ref={deleteBlockDialog}
        onClose={() => {
          setDeleteOperation(idleDialogOperation);
          setCandidateDeleteId('');
          restoreBlockActionFocus();
        }}
        onCancel={(event) => { event.preventDefault(); closeDeleteBlockDialog(); }}
        aria-labelledby="delete-block-dialog-heading"
        aria-describedby={deleteOperation.phase === 'idle' ? 'delete-block-dialog-description' : undefined}
        aria-busy={deleteOperation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id="delete-block-dialog-heading">{candidateDeleteId ? '删除当前回答候选' : '删除所选片段'}</h2>
          <button type="button" className="icon-button" disabled={deleteOperation.phase === 'pending'} onClick={closeDeleteBlockDialog} aria-label="取消删除片段" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {deleteOperation.phase === 'idle' ? (
            candidateDeleteId && selectedBlock && deletingCandidate && deletingCurrent && deletingReplacement ? (
                <>
                  <p id="delete-block-dialog-description">删除当前第 {deletingCandidateIndex + 1} 版后，将保留第 {deletingReplacementIndex + 1} 版并继续作为正文。</p>
                  <div className="dialog-actions answer-candidate-delete-options">
                    <button
                      type="button"
                      className="quiet-action"
                      onClick={() => {
                        if (!props.onDeleteAdoptedCandidate) return;
                        setDeleteOperation({ phase: 'pending', title: '正在保留相邻版本…' });
                        void props.onDeleteAdoptedCandidate(selectedBlock.id, deletingCandidate.id, deletingReplacement.id)
                          .then(() => {
                            setDeleteOperation({ phase: 'success', title: '已保留相邻版本' });
                          })
                          .catch((error) => setDeleteOperation({
                            phase: 'error',
                            title: '操作失败',
                            detail: error instanceof Error ? error.message : '请稍后重试。',
                          }));
                      }}
                      disabled={props.busy || !props.onDeleteAdoptedCandidate}
                    >保留第 {deletingReplacementIndex + 1} 版</button>
                    <button
                      type="button"
                      className="danger-action button-with-icon"
                      onClick={() => {
                        if (!selectedBlock) return;
                        setDeleteOperation({ phase: 'pending', title: '正在删除整段…' });
                        void props.onDeleteSectionBlock(selectedBlock.id)
                          .then(() => {
                            setSelectedBlockId('');
                            setDeleteOperation({ phase: 'success', title: '删除成功' });
                          })
                          .catch((error) => setDeleteOperation({
                            phase: 'error',
                            title: '删除失败',
                            detail: error instanceof Error ? error.message : '请稍后重试。',
                          }));
                      }}
                    ><Trash2 aria-hidden="true" />删除整段（含全部候选）</button>
                  </div>
                </>
            ) : (
              <>
                <p id="delete-block-dialog-description">只会删除当前选中的这一块用户输入或 AI 输出，其他正文不会改变。</p>
                <div className="dialog-actions">
                  <button type="button" className="quiet-action" onClick={closeDeleteBlockDialog}>取消</button>
                  <button
                    type="button"
                    className="danger-action button-with-icon"
                    onClick={() => {
                      if (!selectedBlock) return;
                      setDeleteOperation({ phase: 'pending', title: '正在删除…' });
                      void props.onDeleteSectionBlock(selectedBlock.id)
                        .then(() => {
                          setSelectedBlockId('');
                          setDeleteOperation({ phase: 'success', title: '删除成功' });
                        })
                        .catch((error) => setDeleteOperation({
                          phase: 'error',
                          title: '删除失败',
                          detail: error instanceof Error ? error.message : '请稍后重试。',
                        }));
                    }}
                  ><Trash2 aria-hidden="true" />删除这一块</button>
                </div>
              </>
            )
          ) : (
            <DialogOperationStatus state={deleteOperation} onReturn={() => setDeleteOperation(idleDialogOperation)} />
          )}
        </div>
      </dialog>

    </div>
  );
}
