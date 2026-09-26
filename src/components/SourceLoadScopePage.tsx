import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers3, ListTree, X } from 'lucide-react';
import type { Book } from '../types';
import { DialogOperationStatus, idleDialogOperation, useDismissSuccessfulDialog, type DialogOperationState } from './shared/DialogOperationStatus';

export function SourceLoadScopePage({
  sourceId,
  title,
  bookTitle,
  enabled,
  chapters,
  loadedSectionIds,
  onConfirm,
  canEdit = true,
}: {
  sourceId: string;
  title: string;
  bookTitle: string;
  enabled: boolean;
  chapters: Book['chapters'];
  loadedSectionIds?: string[];
  onConfirm: (patch: { includeInPrompt: boolean; loadedSectionIds: string[] | undefined }) => Promise<void>;
  canEdit?: boolean;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirmOperation, setConfirmOperation] = useState<DialogOperationState>(idleDialogOperation);
  const sectionIds = chapters.flatMap((chapter) => chapter.sections.map((section) => section.id));
  const validSectionIds = new Set(sectionIds);
  const [selectedIds, setSelectedIds] = useState(() => new Set(enabled
    ? (loadedSectionIds ?? sectionIds).filter((id) => validSectionIds.has(id))
    : []));
  const allSelected = sectionIds.length > 0 && selectedIds.size === sectionIds.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const sourceLabel = title.replace(/^加载/, '');

  useDismissSuccessfulDialog(confirmOperation.phase === 'success', () => confirmDialogRef.current?.close());

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const applySelection = (nextIds: Set<string>) => {
    if (!canEdit) return;
    setSelectedIds(new Set(sectionIds.filter((id) => nextIds.has(id))));
  };

  const selectionPatch = () => {
    const orderedIds = sectionIds.filter((id) => selectedIds.has(id));
    return {
      includeInPrompt: orderedIds.length > 0,
      loadedSectionIds: orderedIds.length === sectionIds.length ? undefined : orderedIds,
    };
  };

  const toggleSection = (sectionId: string, selected: boolean) => {
    if (!canEdit) return;
    const nextIds = new Set(selectedIds);
    if (selected) nextIds.add(sectionId);
    else nextIds.delete(sectionId);
    applySelection(nextIds);
  };

  const closeConfirmation = () => {
    if (confirmOperation.phase === 'pending') return;
    confirmDialogRef.current?.close();
  };

  const confirmSelection = async () => {
    if (!canEdit) return;
    if (confirmOperation.phase === 'pending') return;
    setConfirmOperation({ phase: 'pending', title: `正在保存${sourceLabel}加载范围…` });
    try {
      await onConfirm(selectionPatch());
      setConfirmOperation({ phase: 'success', title: `${sourceLabel}加载范围保存成功` });
    } catch (error) {
      setConfirmOperation({
        phase: 'error',
        title: `${sourceLabel}加载范围保存失败`,
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  return (
    <>
      <article className="source-scope-page" aria-labelledby={`${sourceId}-load-scope-title`}>
        <header className="source-editor-heading">
          <p className="eyebrow">{bookTitle} · 加载范围</p>
          <h1 id={`${sourceId}-load-scope-title`}>{title}</h1>
          <p>选择生成时需要加载这份资料的章节小节。</p>
          {!canEdit && <p className="helper-copy">当前页面为只读，可查看已保存的加载范围；关闭其他编辑页后可修改。</p>}
        </header>
        <div className="source-scope-drawer context-reference-scope" data-open>
          <div className="source-load-tab">
            <label className="source-load-toggle" title={allSelected ? '取消全选' : '全选'}>
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                aria-label={allSelected ? `取消全选${title}` : `全选${title}`}
                onChange={() => applySelection(allSelected ? new Set() : new Set(sectionIds))}
                disabled={!canEdit}
              />
            </label>
            <div className="context-reference-scope-title">
              <strong>{title}</strong>
              <small>已选 {selectedIds.size}/{sectionIds.length} 小节</small>
            </div>
            <button
              type="button"
              className="source-scope-all"
              aria-pressed={allSelected}
              aria-label={allSelected ? `取消全选${title}` : `全选${title}`}
              onClick={() => applySelection(allSelected ? new Set() : new Set(sectionIds))}
              disabled={!canEdit}
            >
              <span>{allSelected ? '取消全选' : '全选'}</span>
            </button>
            <button
              ref={confirmTriggerRef}
              type="button"
              className="primary-action icon-button context-summary-save source-scope-confirm"
              onClick={() => {
                setConfirmOperation(idleDialogOperation);
                confirmDialogRef.current?.showModal();
              }}
              aria-haspopup="dialog"
              aria-label={`确认载入${sourceLabel}`}
              title="确认载入"
              disabled={!canEdit}
            >
              <Check aria-hidden="true" />
            </button>
          </div>
          <div className="source-scope-content">
            <div className="source-scope-chapters" aria-label={`${title}指定小节`}>
              {chapters.map((chapter) => (
                <fieldset key={chapter.id}>
                  <legend>{chapter.title}</legend>
                  {chapter.sections.map((section) => (
                    <label className="source-scope-section" key={section.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(section.id)}
                        onChange={(event) => toggleSection(section.id, event.target.checked)}
                        disabled={!canEdit}
                      />
                      <span>{section.title}</span>
                    </label>
                  ))}
                  {chapter.sections.length === 0 && <small className="source-scope-empty">这一章还没有小节。</small>}
                </fieldset>
              ))}
              {chapters.length === 0 && <p className="source-scope-empty">本书还没有章节。</p>}
            </div>
          </div>
        </div>
      </article>

      <dialog
        className="confirm-dialog"
        ref={confirmDialogRef}
        onClose={(event) => {
          event.stopPropagation();
          setConfirmOperation(idleDialogOperation);
          window.requestAnimationFrame(() => confirmTriggerRef.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeConfirmation();
        }}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeConfirmation();
        }}
        aria-labelledby={`${sourceId}-load-confirm-title`}
        aria-describedby={confirmOperation.phase === 'idle' ? `${sourceId}-load-confirm-description` : undefined}
        aria-busy={confirmOperation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id={`${sourceId}-load-confirm-title`}>确认载入{sourceLabel}</h2>
          <button type="button" className="icon-button" disabled={confirmOperation.phase === 'pending'} onClick={closeConfirmation} aria-label="取消载入" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {confirmOperation.phase === 'idle' ? (
            <>
              <p id={`${sourceId}-load-confirm-description`}>会保存当前选择，作为这份{sourceLabel}在后续生成时的加载范围；取消或返回不会更改已保存范围。</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={closeConfirmation}>取消</button>
                <button type="button" className="primary-action button-with-icon" onClick={() => void confirmSelection()}><Check aria-hidden="true" />确认载入</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={confirmOperation} onReturn={() => setConfirmOperation(idleDialogOperation)} />
          )}
        </div>
      </dialog>
    </>
  );
}
