import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';

type InlineTitleProps = {
  value: string;
  label: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
  className?: string;
};

type PointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
};

type TapPoint = {
  x: number;
  y: number;
  endedAt: number;
};

const TAP_MAX_DURATION = 420;
const DOUBLE_TAP_MAX_INTERVAL = 360;
const TAP_MOVE_TOLERANCE = 12;
const TAP_DISTANCE_TOLERANCE = 24;

const isTouchLike = (pointerType: string) => pointerType === 'touch' || pointerType === 'pen';

const distanceBetween = (firstX: number, firstY: number, secondX: number, secondY: number) => {
  const x = firstX - secondX;
  const y = firstY - secondY;
  return Math.sqrt(x * x + y * y);
};

const eventTime = (event: { timeStamp: number }) => Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();

const stopPropagation = (event: SyntheticEvent) => {
  event.stopPropagation();
};

export function InlineTitle({
  value,
  label,
  disabled = false,
  onSave,
  className,
}: InlineTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const displayRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLSpanElement>(null);
  const focusDisplayOnExitRef = useRef(false);
  const mountedRef = useRef(false);
  const editingRef = useRef(editing);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const savingRef = useRef(saving);
  const composingRef = useRef(false);
  const commitAfterCompositionRef = useRef(false);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const lastTapRef = useRef<TapPoint | null>(null);
  const failedDraftRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const onSaveRef = useRef(onSave);

  editingRef.current = editing;
  draftRef.current = draft;
  valueRef.current = value;
  disabledRef.current = disabled;
  savingRef.current = saving;
  onSaveRef.current = onSave;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    operationRef.current += 1;
    savingRef.current = false;
    setSaving(false);
    pointerGestureRef.current = null;
    lastTapRef.current = null;
    failedDraftRef.current = null;
    focusDisplayOnExitRef.current = false;
    if (disabled && editingRef.current) {
      setEditing(false);
      setDraft(valueRef.current);
      setError('');
    }
  }, [disabled]);

  useLayoutEffect(() => {
    if (editing) {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.select();
      return;
    }
    if (focusDisplayOnExitRef.current) {
      focusDisplayOnExitRef.current = false;
      displayRef.current?.focus();
    }
  }, [editing]);

  const beginEditing = useCallback(() => {
    if (disabledRef.current || editingRef.current || savingRef.current) return;
    operationRef.current += 1;
    failedDraftRef.current = null;
    setDraft(valueRef.current);
    setError('');
    setEditing(true);
  }, []);

  const cancelEditing = useCallback((restoreFocus = true) => {
    if (savingRef.current) return;
    operationRef.current += 1;
    savingRef.current = false;
    setSaving(false);
    failedDraftRef.current = null;
    focusDisplayOnExitRef.current = restoreFocus;
    setEditing(false);
    setDraft(valueRef.current);
    setError('');
    commitAfterCompositionRef.current = false;
  }, []);

  const submitDraft = useCallback(async (restoreFocus = false) => {
    if (disabledRef.current || !editingRef.current || savingRef.current) return;

    const nextValue = draftRef.current.trim();
    const currentValue = valueRef.current.trim();
    if (!nextValue) {
      setError('标题不能为空，请输入内容后重试。');
      return;
    }

    if (nextValue === currentValue && failedDraftRef.current !== nextValue) {
      operationRef.current += 1;
      failedDraftRef.current = null;
      focusDisplayOnExitRef.current = restoreFocus && document.activeElement === inputRef.current;
      setEditing(false);
      setDraft(valueRef.current);
      setError('');
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    savingRef.current = true;
    setSaving(true);
    setError('');

    try {
      await onSaveRef.current(nextValue);
      if (!mountedRef.current || operationRef.current !== operation || disabledRef.current) return;
      savingRef.current = false;
      failedDraftRef.current = null;
      setSaving(false);
      focusDisplayOnExitRef.current = restoreFocus && document.activeElement === inputRef.current;
      setEditing(false);
      setError('');
    } catch (reason) {
      if (!mountedRef.current || operationRef.current !== operation || disabledRef.current) return;
      savingRef.current = false;
      failedDraftRef.current = nextValue;
      setSaving(false);
      const message = reason instanceof Error ? reason.message : '';
      setError(message ? `保存失败：${message}` : '保存失败，请重试。');
    }
  }, []);

  useEffect(() => {
    if (!editing) return;
    const finishOutside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node) || editorRef.current?.contains(event.target)) return;
      // Touching a non-focusable surface does not blur inputs in every browser.
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      else if (!composingRef.current) void submitDraft();
    };
    document.addEventListener('pointerdown', finishOutside, true);
    return () => document.removeEventListener('pointerdown', finishOutside, true);
  }, [editing, submitDraft]);

  const handleDisplayClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.detail === 0) beginEditing();
  }, [beginEditing]);

  const handleDisplayDoubleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    beginEditing();
  }, [beginEditing]);

  const handleDisplayKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabledRef.current) return;
    if (event.key === 'F2' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      beginEditing();
    }
  }, [beginEditing]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabledRef.current || editingRef.current || savingRef.current || event.isPrimary === false
      || !isTouchLike(event.pointerType)) {
      return;
    }
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: eventTime(event),
      moved: false,
    };
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (distanceBetween(gesture.startX, gesture.startY, event.clientX, event.clientY) > TAP_MOVE_TOLERANCE) {
      gesture.moved = true;
      lastTapRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const gesture = pointerGestureRef.current;
    pointerGestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved || disabledRef.current) return;

    const endedAt = eventTime(event);
    const duration = endedAt - gesture.startedAt;
    if (duration < 0 || duration > TAP_MAX_DURATION) {
      lastTapRef.current = null;
      return;
    }

    const previousTap = lastTapRef.current;
    const closeToPrevious = previousTap
      && endedAt - previousTap.endedAt >= 0
      && endedAt - previousTap.endedAt <= DOUBLE_TAP_MAX_INTERVAL
      && distanceBetween(gesture.startX, gesture.startY, previousTap.x, previousTap.y) <= TAP_DISTANCE_TOLERANCE;

    if (closeToPrevious) {
      lastTapRef.current = null;
      event.preventDefault();
      beginEditing();
      return;
    }

    lastTapRef.current = { x: gesture.startX, y: gesture.startY, endedAt };
  }, [beginEditing]);

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    pointerGestureRef.current = null;
    lastTapRef.current = null;
  }, []);

  const handlePointerLeave = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const gesture = pointerGestureRef.current;
    if (gesture && gesture.pointerId === event.pointerId) {
      gesture.moved = true;
      lastTapRef.current = null;
    }
  }, []);

  const handleScroll = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
    pointerGestureRef.current = null;
    lastTapRef.current = null;
  }, []);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    draftRef.current = event.target.value;
    setDraft(event.target.value);
    setError('');
  }, []);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || composingRef.current
      || event.keyCode === 229 || event.nativeEvent.keyCode === 229) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitDraft(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing(true);
    }
  }, [cancelEditing, submitDraft]);

  const handleInputBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && editorRef.current?.contains(relatedTarget)) return;
    if (composingRef.current) {
      commitAfterCompositionRef.current = true;
      return;
    }
    void submitDraft();
  }, [submitDraft]);

  const handleCompositionStart = useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
    event.stopPropagation();
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
    event.stopPropagation();
    composingRef.current = false;
    if (commitAfterCompositionRef.current) {
      commitAfterCompositionRef.current = false;
      draftRef.current = event.currentTarget.value;
      setDraft(event.currentTarget.value);
      void submitDraft();
    }
  }, [submitDraft]);

  const handleEditorClick = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
  }, []);

  const handleEditorPointerDown = useCallback((event: React.PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
  }, []);

  const rootClassName = ['inline-title', className].filter(Boolean).join(' ');
  const tooltip = `双击或双点修改${label}`;

  if (!editing) {
    return (
      <span className={rootClassName} onScrollCapture={handleScroll}>
        <button
          ref={displayRef}
          type="button"
          className="inline-title-display"
          disabled={disabled}
          aria-label={`${label}：${value}`}
          title={tooltip}
          onClick={handleDisplayClick}
          onDoubleClick={handleDisplayDoubleClick}
          onKeyDown={handleDisplayKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
        >
          {value}
        </button>
      </span>
    );
  }

  return (
    <span
      ref={editorRef}
      className={rootClassName}
      aria-busy={saving || undefined}
      onClick={handleEditorClick}
      onPointerDown={handleEditorPointerDown}
      onPointerUp={stopPropagation}
      onPointerCancel={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onKeyDown={stopPropagation}
      onKeyUp={stopPropagation}
      onScrollCapture={handleScroll}
    >
      <input
        ref={inputRef}
        className="inline-title-input"
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={draft}
        disabled={disabled}
        readOnly={saving}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={stopPropagation}
        onPointerDown={stopPropagation}
      />
      {saving && <span className="inline-title-status" role="status">保存中…</span>}
      {error && <span className="inline-title-error" role="alert">{error}</span>}
    </span>
  );
}
