import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getDirectoryMoveImpact, type DirectoryMove, type DirectoryReferenceImpact } from '../../directoryOperations';
import type { DirectorySelection } from '../../directorySelection';
import { idleDialogOperation } from '../shared/DialogOperationStatus';
import { describeDirectoryMove, describeDirectoryMoveSubject, isDirectoryMoveNoop, moveAtDirectoryPoint } from './directoryDrag';
import type { BookshelfProps, DirectoryDragState, DirectoryMoveOperation, InlineSectionDraft } from './types';

type BookDirectoryProps = Pick<BookshelfProps, 'canEdit' | 'book' | 'directoryBusy' | 'canUndoDirectoryMove' | 'onAddSection' | 'onMoveDirectoryItem' | 'onUndoDirectoryMove'>;

export function useBookDirectory(props: BookDirectoryProps, sourceMoveBusy: boolean) {
  const canEdit = props.canEdit !== false;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<DirectorySelection>({
    chapterIds: new Set(),
    sectionIds: new Set(),
  });
  const [openChapterIds, setOpenChapterIds] = useState<Set<string>>(
    () => new Set(props.book.chapters.map((chapter) => chapter.id)),
  );
  const [newSectionDraft, setNewSectionDraft] = useState<InlineSectionDraft | null>(null);
  const [moveOperation, setMoveOperation] = useState<DirectoryMoveOperation | null>(null);
  const [dragState, setDragState] = useState<DirectoryDragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DirectoryMove | null>(null);
  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const chapterDetailsRefs = useRef(new Map<string, HTMLDetailsElement>());
  const knownChapterIdsRef = useRef(new Set(props.book.chapters.map((chapter) => chapter.id)));
  const dragSessionRef = useRef<DirectoryDragState | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const dragPointerXRef = useRef<number | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const canWrite = canEdit
    && !props.directoryBusy
    && !sourceMoveBusy
    && moveOperation?.phase !== 'pending'
    && newSectionDraft?.operation.phase !== 'pending';

  const stopDirectoryAutoScroll = () => {
    if (dragAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
      dragAutoScrollFrameRef.current = null;
    }
    dragPointerXRef.current = null;
    dragPointerYRef.current = null;
  };

  const runDirectoryAutoScroll = () => {
    dragAutoScrollFrameRef.current = null;
    const session = dragSessionRef.current;
    const pointerX = dragPointerXRef.current;
    const pointerY = dragPointerYRef.current;
    if (!session?.active || pointerX === null || pointerY === null) return;

    const panel = document.querySelector<HTMLElement>('.directory-panel');
    const panelCanScroll = panel && panel.scrollHeight > panel.clientHeight
      && ['auto', 'scroll', 'overlay'].includes(window.getComputedStyle(panel).overflowY);
    const scrollContainer = panelCanScroll ? panel : null;
    const containerRect = scrollContainer?.getBoundingClientRect();
    const top = containerRect ? Math.max(0, containerRect.top) : 0;
    const bottom = containerRect ? Math.min(window.innerHeight, containerRect.bottom) : window.innerHeight;
    const edge = 48;
    const amount = pointerY <= top + edge ? -16 : pointerY >= bottom - edge ? 16 : 0;
    if (!amount) return;

    if (scrollContainer) {
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      if ((amount < 0 && scrollContainer.scrollTop <= 0)
        || (amount > 0 && scrollContainer.scrollTop >= maxScrollTop)) return;
      try {
        scrollContainer.scrollBy({ top: amount, behavior: 'auto' });
      } catch {
        return;
      }
    } else {
      const root = document.scrollingElement ?? document.documentElement;
      const maxScrollTop = Math.max(0, root.scrollHeight - window.innerHeight);
      const scrollTop = window.scrollY || root.scrollTop;
      if ((amount < 0 && scrollTop <= 0) || (amount > 0 && scrollTop >= maxScrollTop)) return;
      if (typeof window.scrollBy !== 'function') return;
      try {
        window.scrollBy({ top: amount, behavior: 'auto' });
      } catch {
        return;
      }
    }

    session.move = moveAtDirectoryPoint(props.book, session.kind, session.id, pointerX, pointerY);
    setDragState({ ...session });
    setDragPreview(session.move);
    dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDirectoryAutoScroll);
  };

  const scheduleDirectoryAutoScroll = (clientX: number, clientY: number) => {
    dragPointerXRef.current = clientX;
    dragPointerYRef.current = clientY;
    if (dragAutoScrollFrameRef.current === null && dragSessionRef.current?.active) {
      dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDirectoryAutoScroll);
    }
  };

  useEffect(() => () => {
    if (dragAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
      dragAutoScrollFrameRef.current = null;
    }
    dragPointerYRef.current = null;
    dragPointerXRef.current = null;
  }, []);
  useEffect(() => {
    setSelectionMode(false);
    setSelection({ chapterIds: new Set(), sectionIds: new Set() });
    const chapterIds = new Set(props.book.chapters.map((chapter) => chapter.id));
    knownChapterIdsRef.current = chapterIds;
    setOpenChapterIds(new Set(chapterIds));
    setNewSectionDraft(null);
    setMoveOperation(null);
    setDragState(null);
    setDragPreview(null);
    dragSessionRef.current = null;
    stopDirectoryAutoScroll();
  }, [props.book.id]);

  useEffect(() => {
    const chapterIds = new Set(props.book.chapters.map((chapter) => chapter.id));
    const knownChapterIds = knownChapterIdsRef.current;
    setOpenChapterIds((current) => {
      const next = new Set([...current].filter((id) => chapterIds.has(id)));
      chapterIds.forEach((id) => {
        if (!knownChapterIds.has(id)) next.add(id);
      });
      return next;
    });
    knownChapterIdsRef.current = chapterIds;
  }, [props.book.chapters]);

  useEffect(() => {
    if (!newSectionDraft) return undefined;
    const focusInput = () => {
      newSectionInputRef.current?.focus();
      newSectionInputRef.current?.select();
    };
    focusInput();
    const frame = window.requestAnimationFrame(focusInput);
    return () => window.cancelAnimationFrame(frame);
  }, [newSectionDraft?.chapterId, newSectionDraft?.afterSectionId]);
  const openChapter = (chapterId: string) => {
    chapterDetailsRefs.current.get(chapterId)?.setAttribute('open', '');
    setOpenChapterIds((current) => {
      if (current.has(chapterId)) return current;
      const next = new Set(current);
      next.add(chapterId);
      return next;
    });
  };

  const beginInlineSection = (chapterId: string, afterSectionId: string | null) => {
    if (!canWrite || selectionMode) return;
    openChapter(chapterId);
    setNewSectionDraft({
      chapterId,
      afterSectionId,
      value: '',
      operation: idleDialogOperation,
    });
  };

  const cancelInlineSection = () => {
    if (newSectionDraft?.operation.phase === 'pending') return;
    setNewSectionDraft(null);
  };

  const submitInlineSection = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || !newSectionDraft || newSectionDraft.operation.phase === 'pending') return;
    const value = newSectionDraft.value.trim();
    if (!value) {
      setNewSectionDraft((current) => current ? {
        ...current,
        operation: { phase: 'error', title: '请输入小节名称', detail: '名称不能为空。' },
      } : current);
      return;
    }
    const { chapterId, afterSectionId } = newSectionDraft;
    setNewSectionDraft((current) => current ? {
      ...current,
      operation: { phase: 'pending', title: '正在新建小节…' },
    } : current);
    try {
      await props.onAddSection(chapterId, value, afterSectionId ?? undefined);
      setNewSectionDraft(null);
    } catch (error) {
      setNewSectionDraft((current) => current ? {
        ...current,
        operation: {
          phase: 'error',
          title: '新建小节失败',
          detail: error instanceof Error ? error.message : '请稍后重试。',
        },
      } : current);
    }
  };

  const startDirectoryMove = async (move: DirectoryMove) => {
    if (!canWrite || isDirectoryMoveNoop(props.book, move)) return;
    let impact: DirectoryReferenceImpact[] = [];
    try {
      impact = getDirectoryMoveImpact(props.book, move);
    } catch {
      // The save callback remains the source of truth for invalid or stale targets.
    }
    setMoveOperation({
      action: 'move',
      phase: 'pending',
      title: '正在保存目录移动…',
      move,
      impact,
    });
    try {
      await props.onMoveDirectoryItem(move);
      setMoveOperation({ action: 'move', phase: 'success', title: '目录已移动', move, impact });
    } catch (error) {
      setMoveOperation({
        action: 'move',
        phase: 'error',
        title: '目录移动失败',
        detail: error instanceof Error ? error.message : '目标可能已经改变，请重试。',
        move,
        impact,
      });
    }
  };

  const retryDirectoryOperation = () => {
    if (!moveOperation || !canWrite) return;
    if (moveOperation.action === 'undo') {
      void undoDirectoryMove();
    } else if (moveOperation.move) {
      void startDirectoryMove(moveOperation.move);
    }
  };

  const undoDirectoryMove = async () => {
    if (!canWrite || !props.canUndoDirectoryMove || moveOperation?.phase === 'pending') return;
    setMoveOperation((current) => current
      ? { ...current, action: 'undo', phase: 'pending', title: '正在撤销目录移动…', detail: undefined }
      : { action: 'undo', phase: 'pending', title: '正在撤销目录移动…', move: null, impact: [] });
    try {
      await props.onUndoDirectoryMove();
      setMoveOperation((current) => current
        ? { ...current, action: 'undo', phase: 'success', title: '已撤销目录移动', detail: undefined }
        : { action: 'undo', phase: 'success', title: '已撤销目录移动', move: null, impact: [] });
    } catch (error) {
      setMoveOperation((current) => current ? {
        ...current,
        action: 'undo',
        phase: 'error',
        title: '撤销目录移动失败',
        detail: error instanceof Error ? error.message : '请稍后重试。',
      } : {
        action: 'undo',
        phase: 'error',
        title: '撤销目录移动失败',
        detail: error instanceof Error ? error.message : '请稍后重试。',
        move: null,
        impact: [],
      });
    }
  };

  const beginDirectoryDrag = (kind: DirectoryMove['kind'], id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canWrite || !selectionMode || props.directoryBusy) return;
    event.preventDefault();
    event.stopPropagation();
    stopDirectoryAutoScroll();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const session: DirectoryDragState = {
      kind,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      move: null,
    };
    dragSessionRef.current = session;
    setDragState({ ...session });
    setDragPreview(null);
  };

  const updateDirectoryDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.active && distance < 6) return;
    session.active = true;
    scheduleDirectoryAutoScroll(event.clientX, event.clientY);
    session.move = moveAtDirectoryPoint(props.book, session.kind, session.id, event.clientX, event.clientY);
    setDragState({ ...session });
    setDragPreview(session.move);
  };

  const finishDirectoryDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const finalX = dragPointerXRef.current ?? event.clientX;
    const finalY = dragPointerYRef.current ?? event.clientY;
    const move = session.active
      ? moveAtDirectoryPoint(props.book, session.kind, session.id, finalX, finalY) ?? session.move
      : null;
    stopDirectoryAutoScroll();
    dragSessionRef.current = null;
    setDragState(null);
    setDragPreview(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!cancelled && session.active && move && !isDirectoryMoveNoop(props.book, move)) {
      void startDirectoryMove(move);
    }
  };

  const resetSelection = () => {
    setSelectionMode(false);
    setSelection({ chapterIds: new Set(), sectionIds: new Set() });
  };

  return {
    canEdit, canWrite, selectionMode, setSelectionMode, selection, setSelection,
    openChapterIds, setOpenChapterIds, newSectionDraft, setNewSectionDraft,
    moveOperation, setMoveOperation, dragState, dragPreview, chapterDetailsRefs,
    newSectionInputRef, beginInlineSection, cancelInlineSection, submitInlineSection,
    startDirectoryMove, retryDirectoryOperation, undoDirectoryMove,
    beginDirectoryDrag, updateDirectoryDrag, finishDirectoryDrag, resetSelection,
  };
}
