import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { BookOpenText, Menu, MessageSquareText, Send, UsersRound } from 'lucide-react';
import { TextArea } from '../shared/TextArea';
import type { Book, GenerationMode } from '../../types';

// Writer invokes this hook while the editor replaces the input DOM, so height survives editor visits.
export function useGenerationInput() {
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const resizePressTimer = useRef<number | null>(null);
  const resizeGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const resizeGestureActive = useRef(false);
  const [instructionInputHeight, setInstructionInputHeight] = useState<number | null>(null);
  const [isResizingInstruction, setIsResizingInstruction] = useState(false);
  useEffect(() => () => {
    if (resizePressTimer.current !== null) window.clearTimeout(resizePressTimer.current);
  }, []);

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

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
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
  };
  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = resizeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = gesture.startY - event.clientY;
    if (!resizeGestureActive.current) {
      if (Math.abs(distance) > 8) finishInstructionResize(event.pointerId, event.currentTarget);
      return;
    }
    event.preventDefault();
    setInstructionInputHeight(clampInstructionHeight(gesture.startHeight + distance));
  };
  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const currentHeight = instructionInputHeight
      ?? instructionInput.current?.getBoundingClientRect().height
      ?? 44;
    setInstructionInputHeight(clampInstructionHeight(currentHeight + (event.key === 'ArrowUp' ? 16 : -16)));
  };
  return {
    instructionInput, instructionInputHeight, isResizingInstruction,
    handleResizePointerDown, handleResizePointerMove, handleResizeKeyDown, finishInstructionResize,
  };
}

type GenerationInputProps = {
  dockRef: RefObject<HTMLFormElement | null>;
  actionMenu: RefObject<HTMLDetailsElement | null>;
  input: ReturnType<typeof useGenerationInput>;
  characters: Book['characters'];
  mode: GenerationMode;
  selectedCharacterId: string;
  instruction: string;
  authorNote: string;
  busy: boolean;
  canEdit: boolean;
  requiresInputResponse: boolean;
  onGenerate: () => void;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onAuthorNoteChange: (value: string) => void;
  onClearSelection: () => void;
};

export function GenerationInput(props: GenerationInputProps) {
  const { dockRef, actionMenu, input, canEdit, requiresInputResponse } = props;
  const { instructionInput, instructionInputHeight, isResizingInstruction } = input;
  const selectedCharacter = props.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;
  const closeActionMenu = (restoreFocus = false) => {
    if (!actionMenu.current) return;
    actionMenu.current.open = false;
    if (restoreFocus) actionMenu.current.querySelector('summary')?.focus();
  };

  return (
    <form ref={dockRef} className="instruction-dock" data-readonly={!canEdit || undefined} onSubmit={(event) => { event.preventDefault(); if (canEdit) props.onGenerate(); }}>
      <details
        ref={actionMenu}
        className="writer-action-menu"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          closeActionMenu(true);
        }}
      >
        <summary className="icon-button writer-menu-trigger" title="写作操作" aria-disabled={!canEdit || props.busy || undefined} onClick={(event) => { if (!canEdit || props.busy) { event.preventDefault(); return; } props.onClearSelection(); }}>
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
                {props.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
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
          onPointerDown={input.handleResizePointerDown}
          onPointerMove={input.handleResizePointerMove}
          onPointerUp={(event) => input.finishInstructionResize(event.pointerId, event.currentTarget)}
          onPointerCancel={(event) => input.finishInstructionResize(event.pointerId, event.currentTarget)}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={input.handleResizeKeyDown}
        ><span aria-hidden="true" /></button>
        <label className="sr-only" htmlFor="writing-instruction">{props.mode === 'author' ? '接龙正文' : '角色行动或台词'}</label>
        <TextArea
          ref={instructionInput}
          id="writing-instruction"
          rows={1}
          value={props.instruction}
          disabled={!canEdit}
          style={instructionInputHeight === null ? undefined : { height: instructionInputHeight }}
          onPointerDown={props.onClearSelection}
          onFocus={props.onClearSelection}
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
  );
}
