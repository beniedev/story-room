import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  BookMarked,
  BookOpenText,
  Check,
  ListTree,
  Menu,
  MessageSquareText,
  MousePointer2,
  Pencil,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { parseProseFormatting } from '../proseFormatting';
import { countWords, estimateTokens } from '../textMetrics';
import { ContextCompositionDrawer } from './ContextCompositionDrawer';
import { blocksAsContent, sectionBlocks } from './shared/sectionContent';
import { compactTokenCount } from './shared/text';
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
  contextCompositionOpen: boolean;
  contextToolsOpen: boolean;
  providerName: string;
  modelId: string;
  onBack: () => void;
  onOpenBookSettings: () => void;
  onOpenSettings: () => void;
  onOpenContextComposition: () => void;
  onOpenContextTools: () => void;
  onCancelGeneration: () => void;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onAuthorNoteChange: (value: string) => void;
  onSectionBlocksChange: (blocks: SectionBlock[]) => void;
  onRegenerateBlock: (blockId: string) => void;
  onSectionTitleChange: (value: string) => void;
  onGenerate: () => void;
}

export function Writer(props: WriterProps) {
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;
  const blocks = props.section ? sectionBlocks(props.section) : [];
  const [sectionTitle, setSectionTitle] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [editingBlockId, setEditingBlockId] = useState('');
  const titleDialog = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleTrigger = useRef<HTMLElement | null>(null);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const deleteBlockDialog = useRef<HTMLDialogElement>(null);
  const blockActionTrigger = useRef<HTMLElement | null>(null);
  const readerScrollPosition = useRef(0);
  const manuscriptWrapRef = useRef<HTMLElement>(null);
  const instructionDockRef = useRef<HTMLFormElement>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const resizePressTimer = useRef<number | null>(null);
  const resizeGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const resizeGestureActive = useRef(false);
  const [instructionInputHeight, setInstructionInputHeight] = useState<number | null>(null);
  const [instructionDockHeight, setInstructionDockHeight] = useState(0);
  const [isResizingInstruction, setIsResizingInstruction] = useState(false);
  const selectedBlock = blocks.find((item) => item.id === selectedBlockId);
  const editingBlock = blocks.find((item) => item.id === editingBlockId);
  const manuscriptText = blocksAsContent(blocks);
  const manuscriptWordCount = countWords(manuscriptText);
  const manuscriptTokenCount = estimateTokens(manuscriptText);

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

  const openTitleDialog = () => {
    if (document.activeElement instanceof HTMLElement) {
      titleTrigger.current = document.activeElement;
    }
    setSectionTitle(props.section?.title ?? '');
    titleDialog.current?.showModal();
    const focusTitleInput = () => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    };
    focusTitleInput();
    window.requestAnimationFrame(focusTitleInput);
  };

  const restoreTitleTriggerFocus = () => {
    const trigger = titleTrigger.current;
    const focusTrigger = () => {
      if (trigger?.isConnected) trigger.focus();
    };
    focusTrigger();
    window.requestAnimationFrame(focusTrigger);
  };

  const closeActionMenu = (restoreFocus = false) => {
    if (!actionMenu.current) return;
    actionMenu.current.open = false;
    if (restoreFocus) actionMenu.current.querySelector('summary')?.focus();
  };

  const openBlockEditor = () => {
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
    if (!selectedBlock) return;
    blockActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    deleteBlockDialog.current?.showModal();
  };

  const restoreBlockActionFocus = () => {
    window.requestAnimationFrame(() => {
      if (blockActionTrigger.current?.isConnected) blockActionTrigger.current.focus();
      else document.querySelector<HTMLElement>('.writer-menu-trigger')?.focus();
    });
  };

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

  const selectManuscriptBlock = (blockId: string) => {
    actionMenu.current?.removeAttribute('open');
    setSelectedBlockId((current) => current === blockId ? '' : blockId);
  };

  if (editingBlock) {
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
          <textarea
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
              className="book-settings-button button-with-icon writer-book-settings-button"
              onClick={props.onOpenBookSettings}
              disabled={props.busy}
              aria-label="打开本书设定"
              title="本书设定"
            ><BookMarked aria-hidden="true" /><span>设定</span></button>
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
              onClick={openTitleDialog}
              disabled={!props.section || props.busy}
              aria-label="修改小节名称"
              title="修改小节名称"
            ><Pencil aria-hidden="true" /></button>
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

        <p className="writer-section-title" title={`${props.chapterTitle} · ${props.section?.title ?? ''}`}>
          <strong>{props.chapterTitle}</strong>
          {props.section && <span> · {props.section.title}</span>}
        </p>
      <div className="writer-status-row">
        <p className="writer-status" role="status" aria-live="polite" aria-atomic="true">{props.status}</p>
        {props.generationState === 'generating' && (
          <button type="button" className="quiet-action writer-cancel-button" onClick={props.onCancelGeneration}>
            取消生成
          </button>
        )}
      </div>
      </header>

      <section className="manuscript-wrap" ref={manuscriptWrapRef} aria-labelledby="manuscript-label">
        <h2 id="manuscript-label" className="sr-only">连续小说正文</h2>
        <div className="manuscript" aria-label="连续小说正文">
          {blocks.map((block) => (
            <div className="manuscript-block-group" data-selected={selectedBlockId === block.id || undefined} key={block.id}>
              <div
                className="manuscript-block"
                data-kind={block.kind}
                onClick={() => selectManuscriptBlock(block.id)}
              >
                <span className="manuscript-block-copy">{renderBlockContent(block)}</span>
              </div>
              <button
                type="button"
                className="manuscript-block-select icon-button"
                aria-pressed={selectedBlockId === block.id}
                aria-label={`${selectedBlockId === block.id ? '取消选择' : '选择'} ${block.kind === 'user' ? '用户输入' : 'AI 输出'}片段`}
                title={`${selectedBlockId === block.id ? '取消选择' : '选择'}片段`}
                onClick={() => selectManuscriptBlock(block.id)}
              >
                <MousePointer2 aria-hidden="true" />
              </button>
              {selectedBlockId === block.id && (
                <div className="manuscript-block-actions" data-block-id={block.id} role="group" aria-label={`所选${block.kind === 'user' ? '用户输入' : 'AI 输出'}操作`}>
                  {block.kind === 'assistant' && <button
                    type="button"
                    className="icon-button"
                    onClick={() => props.onRegenerateBlock(block.id)}
                    disabled={props.busy}
                    aria-label="重新生成所选 AI 输出"
                    title="重新生成"
                  ><RefreshCw aria-hidden="true" /></button>}
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
            </div>
          ))}
          {blocks.length === 0 && <p className="empty-manuscript">本节还没有正文。</p>}
        </div>
      </section>

      <form ref={instructionDockRef} className="instruction-dock" onSubmit={(event) => { event.preventDefault(); props.onGenerate(); }}>
        <details
          ref={actionMenu}
          className="writer-action-menu"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeActionMenu(true);
          }}
        >
          <summary className="icon-button writer-menu-trigger" title="写作操作" aria-disabled={props.busy || undefined} onClick={(event) => { if (props.busy) { event.preventDefault(); return; } setSelectedBlockId(''); }}>
            <Menu aria-hidden="true" />
            <span className="sr-only">打开写作操作</span>
          </summary>
          <div className="writer-action-sheet" aria-label="写作操作">
            <div className="writer-menu-modes" role="group" aria-label="写作模式">
              <button
                type="button"
                className="writer-menu-action"
                disabled={props.busy}
                aria-pressed={props.mode === 'author'}
                onClick={() => props.onModeChange('author')}
              ><BookOpenText aria-hidden="true" />作者模式 · 写作接龙</button>
              <button
                type="button"
                className="writer-menu-action"
                disabled={props.busy}
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
                  disabled={props.busy}
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
            {props.mode === 'author' && (
              <label className="writer-section-note" htmlFor="author-note-input">
                <span><MessageSquareText aria-hidden="true" />小节注释</span>
                <textarea
                  id="author-note-input"
                  rows={4}
                  value={props.authorNote}
                  disabled={props.busy}
                  onChange={(event) => props.onAuthorNoteChange(event.target.value)}
                  placeholder="例如：跳过路程，直接写抵达后的重逢……"
                  spellCheck
                />
                <small>只指导当前小节的下一次续写，不进入正文；发送后自动清空。</small>
              </label>
            )}
          </div>
        </details>
        <div className="instruction-input-wrap">
          <button
            type="button"
            className="instruction-resize-handle"
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
          <textarea
            ref={instructionInput}
            id="writing-instruction"
            rows={1}
            value={props.instruction}
            style={instructionInputHeight === null ? undefined : { height: instructionInputHeight }}
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
            disabled={props.busy || characterModeNeedsSelection}
            aria-busy={props.busy || undefined}
            aria-label={props.busy ? '正在续写' : '发送并续写'}
            title={props.busy ? '正在续写…' : '发送并续写'}
            aria-describedby={characterModeNeedsSelection ? 'character-mode-send-hint' : undefined}
        ><Send aria-hidden="true" /></button>
      </form>

      <dialog
        className="confirm-dialog"
        ref={deleteBlockDialog}
        onClose={restoreBlockActionFocus}
        onCancel={(event) => { event.preventDefault(); deleteBlockDialog.current?.close(); }}
        aria-labelledby="delete-block-dialog-heading"
        aria-describedby="delete-block-dialog-description"
      >
        <header className="dialog-heading">
          <h2 id="delete-block-dialog-heading">删除所选片段</h2>
          <button type="button" className="icon-button" onClick={() => deleteBlockDialog.current?.close()} aria-label="取消删除片段" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          <p id="delete-block-dialog-description">只会删除当前选中的这一块用户输入或 AI 输出，其他正文不会改变。</p>
          <div className="dialog-actions">
            <button type="button" className="quiet-action" onClick={() => deleteBlockDialog.current?.close()}>取消</button>
            <button
              type="button"
              className="danger-action button-with-icon"
              onClick={() => {
                if (!selectedBlock) return;
                props.onSectionBlocksChange(blocks.filter((item) => item.id !== selectedBlock.id));
                setSelectedBlockId('');
                deleteBlockDialog.current?.close();
              }}
            ><Trash2 aria-hidden="true" />删除这一块</button>
          </div>
        </div>
      </dialog>

      <dialog
        className="name-dialog"
        ref={titleDialog}
        onClose={restoreTitleTriggerFocus}
        onCancel={(event) => { event.preventDefault(); titleDialog.current?.close(); }}
        aria-labelledby="section-title-dialog-heading"
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          const cleanTitle = sectionTitle.trim();
          if (!cleanTitle) return;
          props.onSectionTitleChange(cleanTitle);
          titleDialog.current?.close();
        }}>
          <header className="dialog-heading">
            <h2 id="section-title-dialog-heading">修改小节名称</h2>
            <button type="button" className="icon-button" onClick={() => titleDialog.current?.close()} aria-label="取消修改小节名称" title="取消"><X aria-hidden="true" /></button>
          </header>
          <div className="name-dialog-body">
            <label htmlFor="section-title-input">小节名称</label>
            <input id="section-title-input" ref={titleInputRef} required autoComplete="off" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
            <div className="dialog-actions">
              <button type="button" className="quiet-action" onClick={() => titleDialog.current?.close()}>取消</button>
              <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />保存</button>
            </div>
          </div>
        </form>
      </dialog>
    </div>
  );
}
