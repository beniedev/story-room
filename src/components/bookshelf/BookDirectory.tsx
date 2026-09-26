import { Fragment, memo, useRef, type FormEvent, type RefObject } from 'react';
import { BookMarked, BookPlus, Check, ChevronDown, ChevronRight, FilePlus2, FolderPlus, GripVertical, ListChecks, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { toggleChapterSelection, toggleSectionSelection } from '../../directorySelection';
import { countWords, estimateTokens } from '../../textMetrics';
import { compactTokenCount } from '../shared/text';
import { InlineTitle } from '../shared/InlineTitle';
import { DirectoryActions } from '../DirectoryActions';
import { DialogOperationStatus } from '../shared/DialogOperationStatus';
import { describeDirectoryMove, describeDirectoryMoveSubject } from './directoryDrag';
import type { BookshelfProps, DeleteDialogState, DirectorySelectionState, InlineSectionDraft, NameDialogState } from './types';
import type { useBookDirectory } from './useBookDirectory';

const SectionMetrics = memo(function SectionMetrics({ content }: { content: string }) {
  return <>{countWords(content).toLocaleString('zh-CN')} 字 | 约 {compactTokenCount(estimateTokens(content))} tokens</>;
});
function DirectorySelectionIndicator({ state }: { state: DirectorySelectionState }) {
  return (
    <span className="directory-selection-checkbox" data-state={state} aria-hidden="true">
      {state === 'checked' && <Check />}
    </span>
  );
}
function InlineNewSectionRow({
  draft,
  inputRef,
  disabled = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: InlineSectionDraft;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const pending = draft.operation.phase === 'pending';
  const composingRef = useRef(false);
  return (
    <li className="section-row new-section-row">
      <form className="inline-new-section" onSubmit={onSubmit}>
        <span className="section-index" aria-hidden="true">＋</span>
        <label className="inline-new-section-field">
          <span className="sr-only">新小节名称</span>
          <input
            ref={inputRef}
            value={draft.value}
            onChange={(event) => onChange(event.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
              if (event.key === 'Escape' && !pending) {
                event.preventDefault();
                onCancel();
              } else if (event.key === 'Enter' && !pending) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="输入小节名称"
            autoComplete="off"
            disabled={disabled || pending}
            aria-invalid={draft.operation.phase === 'error' || undefined}
          />
        </label>
        <div className="inline-new-section-actions">
          <button type="button" className="quiet-action" disabled={disabled || pending} onClick={onCancel}>取消</button>
          <button type="submit" className="primary-action" disabled={disabled || pending}>确认</button>
        </div>
        {draft.operation.phase === 'error' && <p className="inline-new-section-error" role="alert">{draft.operation.title}：{draft.operation.detail}</p>}
      </form>
    </li>
  );
}


type BookDirectoryProps = Pick<BookshelfProps, 'book' | 'selectedSectionId' | 'onOpenSection' | 'onRenameChapter' | 'onRenameSection' | 'directoryBusy' | 'canUndoDirectoryMove'> & {
  controller: ReturnType<typeof useBookDirectory>;
  bookSettingsTrigger: RefObject<HTMLButtonElement | null>;
  onOpenSettings: () => void;
  openNameDialog: (dialog: NameDialogState) => void;
  openDeleteDialog: (dialog: DeleteDialogState) => void;
};

export function BookDirectory(props: BookDirectoryProps) {
  const { bookSettingsTrigger, onOpenSettings, openNameDialog, openDeleteDialog } = props;
  const {
    canEdit, canWrite, selectionMode, setSelectionMode, selection, setSelection,
    openChapterIds, setOpenChapterIds, newSectionDraft, setNewSectionDraft, moveOperation,
    setMoveOperation, dragState, dragPreview, chapterDetailsRefs, newSectionInputRef,
    beginInlineSection, cancelInlineSection, submitInlineSection, startDirectoryMove,
    retryDirectoryOperation, undoDirectoryMove, beginDirectoryDrag, updateDirectoryDrag,
    finishDirectoryDrag,
  } = props.controller;
  return (
        <section className={`directory-panel${selectionMode ? ' selection-mode' : ''}`} aria-label="章节目录">
            <div className="directory-toolbar">
              <button
                ref={bookSettingsTrigger}
                type="button"
                className="book-settings-button icon-button"
                onClick={onOpenSettings}
                aria-label="打开本书设定"
                title="本书设定"
              ><BookMarked aria-hidden="true" /></button>
              <div className="directory-actions">
                <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-chapter', value: '' })} disabled={!canWrite} aria-label="新建章节" title="新建章节"><FolderPlus aria-hidden="true" /></button>
                {selectionMode && <button
                  type="button"
                  className="icon-button danger-icon"
                  aria-haspopup="dialog"
                  disabled={!canWrite || (selection.chapterIds.size === 0 && selection.sectionIds.size === 0)}
                  onClick={() => openDeleteDialog({
                    kind: 'selection',
                    chapterIds: [...selection.chapterIds],
                    sectionIds: [...selection.sectionIds],
                    chapterCount: selection.chapterIds.size,
                    sectionCount: selection.sectionIds.size,
                  })}
                  aria-label="删除所选章节或小节"
                  title={selection.chapterIds.size || selection.sectionIds.size ? '删除所选内容' : '请先选择章节或小节'}
                ><Trash2 aria-hidden="true" /></button>}
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={selectionMode}
                  disabled={!canWrite}
                  onClick={() => {
                    setSelectionMode((current) => !current);
                    setSelection({ chapterIds: new Set(), sectionIds: new Set() });
                    if (!selectionMode) setNewSectionDraft(null);
                  }}
                  aria-label={selectionMode ? '完成整理目录' : '整理目录'}
                  title={selectionMode ? '完成整理目录' : '整理目录'}
                >{selectionMode ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
              </div>
            </div>
            {moveOperation && (
              <div className="directory-operation-status" data-phase={moveOperation.phase} role={moveOperation.phase === 'error' ? 'alert' : 'status'} aria-live={moveOperation.phase === 'error' ? 'assertive' : 'polite'}>
                <div>
                  <strong>{moveOperation.title}</strong>
                  {moveOperation.action === 'move' && moveOperation.move ? (
                    <>
                      <p>
                        {moveOperation.phase === 'pending' ? '正在移动' : '项目'}“{describeDirectoryMoveSubject(props.book, moveOperation.move)}”至{describeDirectoryMove(props.book, moveOperation.move)}。
                        {moveOperation.impact.length > 0 && ` 将改变 ${moveOperation.impact.length} 处前文资格（引用可用性）。`}
                      </p>
                      {moveOperation.impact.length > 0 && <small>梗概仍需已确认且新鲜才会使用。</small>}
                    </>
                  ) : (
                    <p>{moveOperation.phase === 'pending' ? '正在撤销最近一次保存的目录移动。' : '最近一次目录移动的撤销操作。'}</p>
                  )}
                </div>
                {moveOperation.action === 'move' && moveOperation.move && moveOperation.impact.length > 0 && (
                  <details>
                    <summary>查看受影响的小节</summary>
                    <ul>
                      {moveOperation.impact.map((entry) => (
                        <li key={`${entry.targetSectionId}:${entry.sourceSectionId}`}>
                          <strong>{entry.targetTitle}</strong> ← {entry.sourceTitle}，移动后前文资格{entry.availableAfter ? '可用' : '暂不可用'}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {moveOperation.action === 'move' && moveOperation.phase === 'success' && props.canUndoDirectoryMove && (
                  <button type="button" className="quiet-action button-with-icon" disabled={!canWrite} onClick={() => void undoDirectoryMove()}><RotateCcw aria-hidden="true" />撤销</button>
                )}
                {moveOperation.phase === 'error' && (
                  <button type="button" className="quiet-action" disabled={!canWrite} onClick={retryDirectoryOperation}>{moveOperation.action === 'undo' ? '重试撤销' : '重试移动'}</button>
                )}
              </div>
            )}
            {!moveOperation && props.canUndoDirectoryMove && (
              <div className="directory-operation-status" data-phase="success" role="status" aria-live="polite">
                <div>
                  <strong>最近的目录移动可撤销</strong>
                  <p>可以撤销上一次保存的目录移动。</p>
                </div>
                <button type="button" className="quiet-action button-with-icon" disabled={!canWrite} onClick={() => void undoDirectoryMove()}><RotateCcw aria-hidden="true" />撤销</button>
              </div>
            )}
            <ol className="chapter-list">
              {props.book.chapters.map((chapter, chapterIndex) => {
                const chapterSelectionState: DirectorySelectionState = selection.chapterIds.has(chapter.id)
                  ? 'checked'
                  : chapter.sections.some((section) => selection.sectionIds.has(section.id)) ? 'mixed' : 'unchecked';
                const chapterMoveTarget = dragPreview?.kind === 'chapter' && dragPreview.beforeId === chapter.id;
                const chapterMoveEndTarget = dragPreview?.kind === 'chapter'
                  && dragPreview.beforeId === null
                  && props.book.chapters[props.book.chapters.length - 1]?.id === chapter.id;
                return (
                  <li
                    className="chapter-card"
                    data-directory-chapter-id={chapter.id}
                    data-selected={selection.chapterIds.has(chapter.id) || undefined}
                    data-dragging={dragState?.kind === 'chapter' && dragState.id === chapter.id || undefined}
                    data-drop-target={chapterMoveTarget || chapterMoveEndTarget || undefined}
                    key={chapter.id}
                  >
                    <details
                      ref={(node) => {
                        if (node) chapterDetailsRefs.current.set(chapter.id, node);
                        else chapterDetailsRefs.current.delete(chapter.id);
                      }}
                      open={openChapterIds.has(chapter.id)}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setOpenChapterIds((current) => {
                          const next = new Set(current);
                          if (isOpen) next.add(chapter.id);
                          else next.delete(chapter.id);
                          return next;
                        });
                      }}
                    >
                      <summary
                        role={selectionMode ? 'checkbox' : undefined}
                        aria-checked={selectionMode
                          ? chapterSelectionState === 'mixed' ? 'mixed' : chapterSelectionState === 'checked'
                          : undefined}
                        aria-label={selectionMode ? `${selection.chapterIds.has(chapter.id) ? '取消选择' : '选择'}章节${chapter.title}` : undefined}
                        onClickCapture={(event) => {
                          if (selectionMode) return;
                          if (props.directoryBusy) {
                            event.preventDefault();
                            return;
                          }
                        }}
                        onClick={(event) => {
                          if (!selectionMode) return;
                          event.preventDefault();
                          setSelection((current) => toggleChapterSelection(props.book, current, chapter.id));
                        }}
                      >
                        <span className="chapter-index">
                          {selectionMode
                            ? <DirectorySelectionIndicator state={chapterSelectionState} />
                            : String(chapterIndex + 1).padStart(2, '0')}
                        </span>
                        <span className="chapter-title-cell">
                          <strong>
                            {selectionMode ? chapter.title : <InlineTitle
                              key={`${props.book.id}:chapter:${chapter.id}`}
                              value={chapter.title}
                              label="章节名称"
                              disabled={!canWrite}
                              onActivate={() => setOpenChapterIds((current) => {
                                const next = new Set(current);
                                if (next.has(chapter.id)) next.delete(chapter.id);
                                else next.add(chapter.id);
                                return next;
                              })}
                              title="单击展开或收起，双击修改标题"
                              onSave={(title) => props.onRenameChapter(chapter.id, title)}
                              className="chapter-inline-title"
                            />}
                          </strong>
                        </span>
                        <span>{chapter.sections.length} 节</span>
                        {!selectionMode && <ChevronDown className="chapter-chevron" aria-hidden="true" />}
                        {!selectionMode && canWrite && (
                          <DirectoryActions
                            className="chapter-object-actions"
                            label={`操作章节：${chapter.title}`}
                            items={[
                              { key: 'new-section', label: '新建小节', ariaLabel: `在${chapter.title}中新建小节`, icon: <FilePlus2 aria-hidden="true" />, onSelect: () => beginInlineSection(chapter.id, chapter.sections[chapter.sections.length - 1]?.id ?? null) },
                            ]}
                          />
                        )}
                      </summary>
                    {selectionMode && canWrite && (
                      <button
                        type="button"
                        className="directory-drag-handle chapter-drag-handle"
                        aria-label={`拖动章节${chapter.title}调整顺序`}
                        title="拖动调整顺序"
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        onPointerDown={(event) => beginDirectoryDrag('chapter', chapter.id, event)}
                        onPointerMove={updateDirectoryDrag}
                        onPointerUp={(event) => finishDirectoryDrag(event, false)}
                        onPointerCancel={(event) => finishDirectoryDrag(event, true)}
                        onLostPointerCapture={(event) => finishDirectoryDrag(event, true)}
                      ><GripVertical aria-hidden="true" /></button>
                    )}
                    <ol className="section-list">
                      {chapter.sections.map((section, sectionIndex) => {
                        const sectionMoveBeforeTarget = dragPreview?.kind === 'section'
                          && dragPreview.targetChapterId === chapter.id
                          && dragPreview.beforeId === section.id;
                        const sectionMoveEndTarget = dragPreview?.kind === 'section'
                          && dragPreview.targetChapterId === chapter.id
                          && dragPreview.beforeId === null
                          && chapter.sections[chapter.sections.length - 1]?.id === section.id;
                        return (
                          <Fragment key={section.id}>
                            <li
                              className="section-row"
                              data-directory-section-id={section.id}
                              data-selected={selection.sectionIds.has(section.id) || undefined}
                              data-dragging={dragState?.kind === 'section' && dragState.id === section.id || undefined}
                              data-drop-target={sectionMoveBeforeTarget || sectionMoveEndTarget || undefined}
                            >
                              <button
                                className="section-open"
                                type="button"
                                disabled={props.directoryBusy}
                                aria-current={!selectionMode && section.id === props.selectedSectionId ? 'true' : undefined}
                                role={selectionMode ? 'checkbox' : undefined}
                                aria-checked={selectionMode ? selection.sectionIds.has(section.id) : undefined}
                                onClick={() => selectionMode
                                  ? setSelection((current) => toggleSectionSelection(props.book, current, section.id))
                                  : props.onOpenSection(section.id)}
                                aria-label={selectionMode
                                  ? `${selection.sectionIds.has(section.id) ? '取消选择' : '选择'}小节${section.title}`
                                  : `打开小节：${section.title}`}
                              >
                                <span className="section-index">
                                  {selectionMode
                                    ? <DirectorySelectionIndicator state={selection.sectionIds.has(section.id) ? 'checked' : 'unchecked'} />
                                    : `${chapterIndex + 1}.${sectionIndex + 1}`}
                                </span>
                                <span className="sr-only">{section.title}</span>
                                {!selectionMode && <ChevronRight className="icon-directional" aria-hidden="true" />}
                              </button>
                              <span className="section-title-cell">
                                <strong>
                                  {selectionMode ? section.title : <InlineTitle
                                    key={`${props.book.id}:section:${section.id}`}
                                    value={section.title}
                                    label="小节名称"
                                    disabled={!canWrite}
                                    onActivate={() => props.onOpenSection(section.id)}
                                    title="单击打开，双击修改标题"
                                    onSave={(title) => props.onRenameSection(chapter.id, section.id, title)}
                                    className="section-inline-title"
                                  />}
                                </strong>
                                <small><SectionMetrics content={section.content} /></small>
                              </span>
                              {selectionMode && canWrite && (
                                <button
                                  type="button"
                                  className="directory-drag-handle section-drag-handle"
                                  aria-label={`拖动小节${section.title}调整顺序`}
                                  title="拖动调整顺序"
                                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                  onPointerDown={(event) => beginDirectoryDrag('section', section.id, event)}
                                  onPointerMove={updateDirectoryDrag}
                                  onPointerUp={(event) => finishDirectoryDrag(event, false)}
                                  onPointerCancel={(event) => finishDirectoryDrag(event, true)}
                                  onLostPointerCapture={(event) => finishDirectoryDrag(event, true)}
                                ><GripVertical aria-hidden="true" /></button>
                              )}
                            </li>
                            {newSectionDraft?.chapterId === chapter.id && newSectionDraft.afterSectionId === section.id && (
                              <InlineNewSectionRow
                                draft={newSectionDraft}
                                inputRef={newSectionInputRef}
                                disabled={!canWrite}
                                onChange={(value) => setNewSectionDraft((current) => current ? { ...current, value } : current)}
                                onSubmit={submitInlineSection}
                                onCancel={cancelInlineSection}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                      {chapter.sections.length === 0 && newSectionDraft?.chapterId !== chapter.id && <li className="empty-section">这一章还没有小节。</li>}
                      {newSectionDraft?.chapterId === chapter.id
                        && (newSectionDraft.afterSectionId === null || !chapter.sections.some((section) => section.id === newSectionDraft.afterSectionId))
                        && <InlineNewSectionRow
                          draft={newSectionDraft}
                          inputRef={newSectionInputRef}
                          disabled={!canWrite}
                          onChange={(value) => setNewSectionDraft((current) => current ? { ...current, value } : current)}
                          onSubmit={submitInlineSection}
                          onCancel={cancelInlineSection}
                        />}
                    </ol>
                    </details>
                  </li>
                );
              })}
            </ol>
        </section>
  );
}
