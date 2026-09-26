import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, BookMarked, ChevronLeft, ChevronRight, ListTree, Pencil, RefreshCw, Settings, Trash2, X } from 'lucide-react';
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
import { InlineTitle } from './shared/InlineTitle';
import { ManuscriptBlock } from './writer/ManuscriptBlock';
import { StreamingDraftBlock, type StreamingDraftView } from './writer/StreamingDraftBlock';
import { BlockEditorPage } from './writer/BlockEditorPage';
import { GenerationInput, useGenerationInput } from './writer/GenerationInput';
import { useManuscriptScroll } from './writer/useManuscriptScroll';
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

export function Writer(props: WriterProps) {
  const canEdit = props.canEdit !== false;
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
  const instructionDockRef = useRef<HTMLFormElement>(null);
  const input = useGenerationInput();
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
  useEffect(() => {
    props.onEditorOpenChange?.(editorOpen);
    return () => props.onEditorOpenChange?.(false);
  }, [editorOpen, props.onEditorOpenChange]);

  const {
    manuscriptWrapRef, manuscriptTailRef, instructionDockHeight, showScrollToBottom,
    updateManuscriptScrollState, scrollManuscriptToBottom,
  } = useManuscriptScroll({
    scrollKey: manuscriptScrollKey, blocks, manuscriptText, generationState: props.generationState,
    streamingDraft: props.streamingDraft, instructionDockRef,
    instructionInputHeight: input.instructionInputHeight, authorNote: props.authorNote, mode: props.mode,
  });

  useDismissSuccessfulDialog(deleteOperation.phase === 'success', () => deleteBlockDialog.current?.close());

  const contextTokens = props.contextPlan?.estimatedTokens ?? 0;
  const availableInput = props.contextPlan?.budget.availableInput ?? 0;
  const contextPercent = availableInput > 0
    ? Math.round((contextTokens / availableInput) * 100)
    : 0;
  const progressMax = Math.max(1, availableInput);
  const progressValue = Math.min(contextTokens, progressMax);

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
    return (
      <BlockEditorPage
        block={editingBlock}
        bookTitle={props.book.title}
        chapterTitle={props.chapterTitle}
        sectionTitle={props.section?.title ?? ''}
        onClose={closeBlockEditor}
        onChange={(content) => props.onSectionBlocksChange(blocks.map((item) => item.id === editingBlock.id
          ? { ...item, content }
          : item))}
      />
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

      <GenerationInput
        dockRef={instructionDockRef}
        actionMenu={actionMenu}
        input={input}
        characters={props.book.characters}
        mode={props.mode}
        selectedCharacterId={props.selectedCharacterId}
        instruction={props.instruction}
        authorNote={props.authorNote}
        busy={props.busy}
        canEdit={canEdit}
        requiresInputResponse={requiresInputResponse}
        onGenerate={props.onGenerate}
        onModeChange={props.onModeChange}
        onCharacterChange={props.onCharacterChange}
        onInstructionChange={props.onInstructionChange}
        onAuthorNoteChange={props.onAuthorNoteChange}
        onClearSelection={leaveCandidatePreview}
      />

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
