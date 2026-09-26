import { Fragment, memo, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { MousePointer2 } from 'lucide-react';
import { parseProseFormatting } from '../../proseFormatting';
import type { SectionBlock } from '../../types';

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

export const ManuscriptBlock = memo(function ManuscriptBlock({ block, selected, onSelect, canEdit, children }: {
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

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch/pen pointers leave after lifting, sometimes before the compatibility click.
    // Keep the completed gesture and double-tap history until click consumes them.
    if (isTouchLikePointer(event.pointerType) && !pointerGestureRef.current) return;
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
