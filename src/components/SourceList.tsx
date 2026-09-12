import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronRight, GripVertical } from 'lucide-react';

interface SourceListProps {
  items: { id: string; title: string; detail: string }[];
  label: string;
  selecting: boolean;
  selectedIds: Set<string>;
  disabled: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, beforeId: string | null) => Promise<void>;
}

type DropTarget = { id: string; edge: 'before' | 'after'; beforeId: string | null };
type DragSession = { id: string; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean };

export function SourceList({ items, label, selecting, selectedIds, disabled, onSelect, onOpen, onMove }: SourceListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [error, setError] = useState('');

  const stopDrag = () => {
    sessionRef.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    setDragId(null);
    setTarget(null);
  };

  useEffect(() => {
    if (!selecting || disabled) stopDrag();
  }, [selecting, disabled]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current = null;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  const targetAt = (x: number, y: number): DropTarget | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-source-id]');
    if (!row || row.parentElement !== listRef.current) return null;
    const index = items.findIndex((item) => item.id === row.dataset.sourceId);
    if (index < 0) return null;
    const rect = row.getBoundingClientRect();
    const edge = y < rect.top + rect.height / 2 ? 'before' : 'after';
    return { id: items[index]!.id, edge, beforeId: edge === 'before' ? items[index]!.id : items[index + 1]?.id ?? null };
  };

  const scrollDuringDrag = () => {
    scrollFrame.current = null;
    const session = sessionRef.current;
    const dialog = listRef.current?.closest('dialog');
    if (!session?.active || !dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (session.x < rect.left || session.x > rect.right) return;
    const step = session.y < Math.max(0, rect.top) + 48 ? -12
      : session.y > Math.min(innerHeight, rect.bottom) - 48 ? 12 : 0;
    const previous = dialog.scrollTop;
    if (step) dialog.scrollTop = Math.max(0, Math.min(dialog.scrollHeight - dialog.clientHeight, previous + step));
    setTarget(targetAt(session.x, session.y));
    if (dialog.scrollTop !== previous) scrollFrame.current = requestAnimationFrame(scrollDuringDrag);
  };

  const saveMove = async (id: string, beforeId: string | null) => {
    const index = items.findIndex((item) => item.id === id);
    if (!selecting || disabled || savingRef.current || index < 0
      || id === beforeId || (items[index + 1]?.id ?? null) === beforeId) return;
    savingRef.current = true;
    setError('');
    try {
      await onMove(id, beforeId);
    } catch (cause) {
      if (mounted.current) setError(`排序保存失败：${cause instanceof Error ? cause.message : '请重试。'}`);
    } finally {
      savingRef.current = false;
    }
  };

  const beginDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selecting || disabled || savingRef.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sessionRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, active: false };
  };

  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    session.x = event.clientX;
    session.y = event.clientY;
    if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return;
    session.active = true;
    setDragId(session.id);
    setTarget(targetAt(session.x, session.y));
    if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(scrollDuringDrag);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const drop = session.active && !cancelled ? targetAt(event.clientX, event.clientY) : null;
    stopDrag();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drop) void saveMove(session.id, drop.beforeId);
  };

  return (
    <div className="source-list" ref={listRef}>
      {items.map((item, index) => (
        <div className="source-list-row" data-source-id={item.id} key={item.id}
          data-dragging={dragId === item.id || undefined}
          data-drop-edge={target?.id === item.id && dragId !== item.id ? target.edge : undefined}>
          <button type="button" className={`source-open-row${selecting ? ' source-selection-row' : ''}`}
            disabled={selecting && disabled}
            data-selected={selecting && selectedIds.has(item.id) || undefined}
            aria-pressed={selecting ? selectedIds.has(item.id) : undefined}
            aria-label={`${selecting ? selectedIds.has(item.id) ? '取消选择' : '选择' : '打开'}${label}：${item.title}`}
            onClick={() => selecting ? onSelect(item.id) : onOpen(item.id)}>
            {selecting && <span className="directory-selection-checkbox" data-state={selectedIds.has(item.id) ? 'checked' : 'unchecked'} aria-hidden="true">
              {selectedIds.has(item.id) && <Check />}
            </span>}
            <span className="source-card-name"><strong>{item.title}</strong><small>{item.detail}</small></span>
            {!selecting && <ChevronRight className="icon-directional" aria-hidden="true" />}
          </button>
          {selecting && <button type="button" className="directory-drag-handle source-drag-handle" disabled={disabled}
            aria-label={`拖动${label}：${item.title}`} aria-keyshortcuts="ArrowUp ArrowDown" title={`移动${label}`}
            onPointerDown={(event) => beginDrag(item.id, event)} onPointerMove={updateDrag}
            onPointerUp={(event) => finishDrag(event, false)} onPointerCancel={(event) => finishDrag(event, true)}
            onLostPointerCapture={(event) => finishDrag(event, true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') stopDrag();
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              stopDrag();
              if (event.key === 'ArrowUp' && index > 0) void saveMove(item.id, items[index - 1]!.id);
              if (event.key === 'ArrowDown' && index < items.length - 1) void saveMove(item.id, items[index + 2]?.id ?? null);
            }}><GripVertical aria-hidden="true" /></button>}
        </div>
      ))}
      {items.length === 0 && <p className="empty-source">还没有{label}。</p>}
      {error && <p className="source-move-error" role="alert">{error}</p>}
    </div>
  );
}
