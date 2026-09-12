import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import {
  draftFromSectionMemory,
  sectionMemoryProvenanceAfterReview,
} from '../sectionMemory';
import { focusFirstDrawerElement } from './shared/dialogFocus';
import { TextArea } from './shared/TextArea';
import {
  DialogOperationStatus,
  idleDialogOperation,
  useDismissSuccessfulDialog,
  type DialogOperationState,
} from './shared/DialogOperationStatus';
import type { Book, SectionMemoryDraft, SectionMemoryProvenance } from '../types';

export function ContextToolsDrawer({
  open,
  book,
  section,
  onGenerateMemory,
  onSaveMemoriesAndLoad,
  busy,
  onCancelGeneration,
  onClose,
  canEdit = true,
}: {
  open: boolean;
  book: Book;
  section: Book['chapters'][number]['sections'][number];
  onGenerateMemory: (sourceSectionId: string) => Promise<SectionMemoryDraft>;
  onSaveMemoriesAndLoad: (items: Array<{
    sourceSectionId: string;
    draft: SectionMemoryDraft;
    provenance: SectionMemoryProvenance;
  }>) => Promise<void>;
  busy: boolean;
  onCancelGeneration: () => void;
  onClose: () => void;
  canEdit?: boolean;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const summaryConfirmDialog = useRef<HTMLDialogElement>(null);
  const summaryActionTrigger = useRef<HTMLElement | null>(null);
  const summaryActionAccepted = useRef(false);
  const summaryGenerationRequest = useRef(0);
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [summaryBusyId, setSummaryBusyId] = useState('');
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [pendingSummarySectionId, setPendingSummarySectionId] = useState('');
  const [pendingSummaryAction, setPendingSummaryAction] = useState<'generate' | 'save' | ''>('');
  const [summaryFeedback, setSummaryFeedback] = useState<DialogOperationState>(idleDialogOperation);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return undefined;
    if (open) {
      if (!drawer.open) drawer.showModal();
      const frame = window.requestAnimationFrame(() => focusFirstDrawerElement(drawer));
      return () => window.cancelAnimationFrame(frame);
    }
    if (drawer.open) drawer.close();
    return undefined;
  }, [open]);

  useEffect(() => {
    summaryGenerationRequest.current += 1;
    setSelectedSectionIds(new Set((section.contextReferences ?? []).map((reference) => reference.sectionId)));
    setExpandedSections(new Set());
    setMemoryDrafts({});
    setGeneratedDrafts({});
    setSummaryBusyId('');
    setSummaryErrors({});
    summaryConfirmDialog.current?.close();
    setPendingSummarySectionId('');
    setPendingSummaryAction('');
    setSummaryFeedback(idleDialogOperation);
    return undefined;
  }, [open, book.id, section.id]);

  const currentReferences = useMemo(() => new Map((section.contextReferences ?? [])
    .map((reference) => [reference.sectionId, reference.mode] as const)), [section.contextReferences]);
  const { referenceSections, referenceChapters, selectableReferenceSections } = useMemo(() => {
    const locations = (open ? book.chapters : []).flatMap((chapter, chapterIndex) =>
      chapter.sections.map((item, sectionIndex) => ({ chapter, section: item, chapterIndex, sectionIndex })));
    const targetOrdinal = locations.findIndex((item) => item.section.id === section.id);
    const referenceSections = locations.slice(0, Math.max(0, targetOrdinal));
    const referenceChapters = (open ? book.chapters : []).map((chapter) => ({
      chapter,
      sections: referenceSections.filter((item) => item.chapter.id === chapter.id),
    })).filter((item) => item.sections.length > 0);
    return { referenceSections, referenceChapters,
      selectableReferenceSections: referenceSections.filter((item) => item.section.content.trim()) };
  }, [open, book.chapters, section.id]);
  const selectedReferenceCount = selectableReferenceSections
    .filter((item) => selectedSectionIds.has(item.section.id)).length;
  const allSelected = selectableReferenceSections.length > 0
    && selectableReferenceSections.every((item) => selectedSectionIds.has(item.section.id));
  const someSelected = selectedReferenceCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (!canEdit) return;
    setSelectedSectionIds(allSelected ? new Set() : new Set(selectableReferenceSections.map((item) => item.section.id)));
  };
  const toggleSelection = (sourceSectionId: string) => {
    if (!canEdit) return;
    setSelectedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sourceSectionId)) next.delete(sourceSectionId);
      else next.add(sourceSectionId);
      return next;
    });
  };
  const toggleSection = (sourceSectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sourceSectionId)) next.delete(sourceSectionId);
      else next.add(sourceSectionId);
      return next;
    });
  };
  const emptyMemoryDraft = (): SectionMemoryDraft => ({
    synopsis: '',
    beats: [],
    continuityFacts: [],
    characterStateChanges: [],
    foreshadowingCandidates: [],
  });
  const memoryDraftFor = (item: typeof referenceSections[number]) => (
    memoryDrafts[item.section.id]
      ?? draftFromSectionMemory(item.section.memory)
      ?? emptyMemoryDraft()
  );
  const summaryValue = (item: typeof referenceSections[number]) => memoryDraftFor(item).synopsis;
  const updateSummary = (item: typeof referenceSections[number], synopsis: string) => {
    if (!canEdit) return;
    setMemoryDrafts((current) => ({
      ...current,
      [item.section.id]: { ...memoryDraftFor(item), synopsis },
    }));
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
  };
  const generateSummary = async (item: typeof referenceSections[number]) => {
    if (!canEdit) return emptyMemoryDraft();
    setSummaryBusyId(item.section.id);
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
    try {
      const draft = await onGenerateMemory(item.section.id);
      setGeneratedDrafts((current) => ({ ...current, [item.section.id]: draft }));
      setMemoryDrafts((current) => ({ ...current, [item.section.id]: draft }));
      return draft;
    } catch (error) {
      setSummaryErrors((current) => ({
        ...current,
        [item.section.id]: error instanceof Error ? error.message : '梗概生成失败。',
      }));
      throw error;
    } finally {
      setSummaryBusyId('');
    }
  };
  const requestSummaryAction = (
    item: typeof referenceSections[number],
    action: 'generate' | 'save',
  ) => {
    if (!canEdit) return;
    summaryActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSummarySectionId(item.section.id);
    setPendingSummaryAction(action);
    setSummaryFeedback(idleDialogOperation);
    summaryConfirmDialog.current?.showModal();
  };
  const saveableSummaryItems = referenceSections.filter((item) => selectedSectionIds.has(item.section.id));
  const legacyFullCount = [...currentReferences.values()].filter((mode) => mode !== 'summary').length;
  const requestSummarySave = () => {
    if (!canEdit) return;
    const missing = saveableSummaryItems.filter((item) => !summaryValue(item).trim());
    if (missing.length) {
      setSummaryErrors((current) => ({
        ...current,
        ...Object.fromEntries(missing.map((item) => [item.section.id, '请先填写或生成梗概，或取消勾选；不会加载原文。'])),
      }));
      setExpandedSections((current) => new Set([...current, ...missing.map((item) => item.section.id)]));
      return;
    }
    summaryActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSummarySectionId('');
    setPendingSummaryAction('save');
    setSummaryFeedback(idleDialogOperation);
    summaryConfirmDialog.current?.showModal();
  };
  const focusSummaryTextarea = (sourceSectionId: string) => {
    window.setTimeout(() => document.getElementById(`context-summary-textarea-${sourceSectionId}`)?.focus(), 0);
  };
  const dismissSummaryFeedback = (sourceSectionId: string) => {
    summaryActionAccepted.current = true;
    summaryConfirmDialog.current?.close();
    if (sourceSectionId) focusSummaryTextarea(sourceSectionId);
    else window.setTimeout(() => summaryActionTrigger.current?.focus(), 0);
  };
  const closeSummaryConfirmation = () => {
    if (summaryFeedback.phase === 'pending') {
      if (pendingSummaryAction === 'generate') onCancelGeneration();
      else return;
    }
    summaryConfirmDialog.current?.close();
  };
  const saveSummariesAndLoad = async (items: typeof referenceSections) => {
    const entries = items.map((item) => {
      const draft = memoryDraftFor(item);
      return {
        sourceSectionId: item.section.id,
        draft,
        provenance: sectionMemoryProvenanceAfterReview(
          item.section.memory,
          draft,
          generatedDrafts[item.section.id],
        ),
      };
    });
    try {
      await onSaveMemoriesAndLoad(entries);
      setGeneratedDrafts((current) => {
        const next = { ...current };
        for (const item of items) delete next[item.section.id];
        return next;
      });
      setSummaryErrors((current) => {
        const next = { ...current };
        for (const item of items) next[item.section.id] = '';
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '梗概保存失败，请重试。';
      setSummaryErrors((current) => {
        const next = { ...current };
        for (const item of items) next[item.section.id] = message;
        return next;
      });
      throw error;
    }
  };
  const confirmSummaryAction = () => {
    if (!canEdit) return;
    const action = pendingSummaryAction;
    if (action === 'generate') {
      const item = referenceSections.find((candidate) => candidate.section.id === pendingSummarySectionId);
      if (!item) return;
      summaryActionAccepted.current = true;
      setSummaryFeedback({ phase: 'pending', title: '正在生成梗概…' });
      const request = ++summaryGenerationRequest.current;
      void generateSummary(item)
        .then(() => {
          if (summaryGenerationRequest.current !== request || !summaryConfirmDialog.current?.open) return;
          setSummaryFeedback({ phase: 'success', title: '已生成梗概' });
        })
        .catch((error) => {
          if (summaryGenerationRequest.current !== request || !summaryConfirmDialog.current?.open) return;
          setSummaryFeedback({
            phase: 'error',
            title: '生成梗概失败',
            detail: error instanceof Error ? error.message : '请稍后重试。',
          });
        });
      return;
    }
    if (action === 'save') {
      summaryActionAccepted.current = true;
      setSummaryFeedback({ phase: 'pending', title: '正在保存并加载梗概…' });
      void saveSummariesAndLoad(saveableSummaryItems)
        .then(() => {
          if (!summaryConfirmDialog.current?.open) return;
          setSummaryFeedback({ phase: 'success', title: '梗概保存并加载成功' });
        })
        .catch((error) => {
          if (!summaryConfirmDialog.current?.open) return;
          setSummaryFeedback({
            phase: 'error',
            title: '梗概保存并加载失败',
            detail: error instanceof Error ? error.message : '请稍后重试。',
          });
        });
    }
  };
  const pendingSummarySection = referenceSections.find((item) => item.section.id === pendingSummarySectionId);
  useDismissSuccessfulDialog(
    summaryFeedback.phase === 'success',
    () => dismissSummaryFeedback(pendingSummaryAction === 'generate' ? pendingSummarySectionId : ''),
  );

  return (
    <dialog
      id="context-tools-drawer"
      ref={drawerRef}
      className="context-tools-drawer"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      aria-modal="true"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX >= bounds.right
          || event.clientY < bounds.top || event.clientY >= bounds.bottom) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || summaryConfirmDialog.current?.open) return;
        event.preventDefault();
        onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="context-tools-drawer-title"
    >
      <div className="context-tools-drawer-scroll">
        <header className="drawer-heading">
          <h2 id="context-tools-drawer-title">前文选择</h2>
          <button type="button" className="icon-button" ref={closeButtonRef} autoFocus onClick={onClose} aria-label="关闭前文选择" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>

        <section className="context-reference-section" aria-label="加载前文梗概">
          <p className="helper-copy">勾选只作待确认选择；确认保存后才加载梗概，不加载前文原文。关闭后未确认的修改不生效。</p>
          {!canEdit && <p className="helper-copy">当前页面为只读，可查看已保存的前文设置；关闭其他编辑页后可修改。</p>}
          {legacyFullCount > 0 && <p className="helper-copy">当前设置仍含 {legacyFullCount} 节全文引用；确认后将按勾选结果改为梗概引用。</p>}
          {referenceSections.length === 0 ? <p className="helper-copy">这是第一节，暂无前文可选。</p> : (
            <div className="source-scope-drawer context-reference-scope" data-open>
              <div className="source-load-tab">
                <label className="source-load-toggle" title="选择全部前文">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    aria-label={allSelected ? '取消选择全部前文' : '选择全部前文'}
                    onChange={toggleAll}
                    disabled={!canEdit || busy}
                  />
                </label>
                <div className="context-reference-scope-title">
                  <strong>加载前文</strong>
                  <small>待确认 {selectedReferenceCount}/{selectableReferenceSections.length} 小节</small>
                </div>
                <button
                  type="button"
                  className="source-scope-all"
                  aria-pressed={allSelected}
                  aria-label={allSelected ? '取消全选前文' : '全选前文'}
                  onClick={toggleAll}
                  disabled={!canEdit || busy}
                >
                  <span>{allSelected ? '取消全选' : '全选'}</span>
                </button>
                <button
                  type="button"
                  className="primary-action icon-button context-summary-save"
                  disabled={!canEdit || busy || (selectedSectionIds.size === 0 && currentReferences.size === 0)}
                  onClick={requestSummarySave}
                  aria-label="保存并加载梗概"
                  title={saveableSummaryItems.length ? '保存并加载勾选的梗概' : '确认取消加载前文'}
                >
                  <Check aria-hidden="true" />
                </button>
              </div>
              <div className="source-scope-content">
                <div className="source-scope-chapters" aria-label="可加载的前文">
                  {referenceChapters.map((chapterItem) => (
                    <fieldset key={chapterItem.chapter.id}>
                      <legend>{chapterItem.chapter.title}</legend>
                      {chapterItem.sections.map((item) => {
                        const selected = selectedSectionIds.has(item.section.id);
                        const expanded = expandedSections.has(item.section.id);
                        const panelId = `context-summary-${item.section.id}`;
                        const value = summaryValue(item);
                        const summaryBusy = summaryBusyId === item.section.id;
                        const hasContent = Boolean(item.section.content.trim());
                        return (
                          <Fragment key={item.section.id}>
                            <div className="context-reference-row">
                              <label className="context-reference-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleSelection(item.section.id)}
                                  disabled={!canEdit || busy || (!hasContent && !selected)}
                                />
                                <span className="sr-only">选择{item.section.title}梗概</span>
                              </label>
                              <button
                                type="button"
                                className="context-reference-disclosure"
                                aria-expanded={expanded}
                                aria-controls={panelId}
                                aria-label={expanded ? `收起${item.section.title}梗概` : `展开${item.section.title}梗概`}
                                onClick={() => toggleSection(item.section.id)}
                              >
                                <span>{item.section.title}{!value.trim() && <small> · 尚无梗概</small>}</span>
                                <ChevronRight aria-hidden="true" />
                              </button>
                            </div>
                            {expanded && (
                              <div className="context-summary-editor" id={panelId}>
                                <label>
                                  <span className="sr-only">{item.section.title}梗概</span>
                                  <TextArea
                                    id={`context-summary-textarea-${item.section.id}`}
                                    value={value}
                                    readOnly={!canEdit}
                                    onChange={(event) => updateSummary(item, event.target.value)}
                                    aria-invalid={Boolean(summaryErrors[item.section.id]) || undefined}
                                    aria-describedby={summaryErrors[item.section.id] ? `context-summary-error-${item.section.id}` : undefined}
                                    placeholder="填写这一节的梗概…"
                                    spellCheck
                                  />
                                </label>
                                <div className="context-summary-actions">
                                  <button
                                    type="button"
                                    className="icon-button context-summary-generate"
                                    disabled={!canEdit || (busy && !summaryBusy) || !hasContent}
                                    onClick={() => summaryBusy ? onCancelGeneration() : requestSummaryAction(item, 'generate')}
                                    aria-busy={summaryBusy || undefined}
                                    aria-label={summaryBusy ? '取消生成该节梗概' : '生成该节梗概'}
                                    title={summaryBusy ? '取消生成该节梗概' : '生成该节梗概'}
                                  >
                                    <Sparkles aria-hidden="true" />
                                  </button>
                                </div>
                                {summaryErrors[item.section.id] && (
                                  <p className="context-summary-error" id={`context-summary-error-${item.section.id}`} role="alert">
                                    {summaryErrors[item.section.id]}
                                  </p>
                                )}
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <dialog
        className="confirm-dialog"
        ref={summaryConfirmDialog}
        onClose={(event) => {
          event.stopPropagation();
          summaryGenerationRequest.current += 1;
          setPendingSummarySectionId('');
          setPendingSummaryAction('');
          setSummaryFeedback(idleDialogOperation);
          if (!summaryActionAccepted.current) {
            window.requestAnimationFrame(() => summaryActionTrigger.current?.focus());
          }
          summaryActionAccepted.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeSummaryConfirmation();
        }}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeSummaryConfirmation();
        }}
        aria-labelledby="summary-confirm-dialog-title"
        aria-describedby={summaryFeedback.phase === 'idle' ? 'summary-confirm-dialog-description' : undefined}
        aria-busy={summaryFeedback.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id="summary-confirm-dialog-title">
            {pendingSummaryAction === 'save' ? '保存并加载梗概' : '生成该节梗概'}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={closeSummaryConfirmation}
            disabled={summaryFeedback.phase === 'pending' && pendingSummaryAction === 'save'}
            aria-label="关闭确认"
            title="关闭"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        {summaryFeedback.phase !== 'idle' ? (
          <div className="confirm-dialog-body summary-generation-body">
            <DialogOperationStatus
              state={summaryFeedback}
              onReturn={() => setSummaryFeedback(idleDialogOperation)}
            />
          </div>
        ) : (
          <div className="confirm-dialog-body">
            <p id="summary-confirm-dialog-description">
              {pendingSummaryAction === 'save'
                ? (saveableSummaryItems.length
                    ? `只保存并加载勾选的 ${saveableSummaryItems.length} 节梗概；未勾选的前文引用将移除，原文和已有梗概均保留。`
                    : '会取消当前小节的全部前文引用；前文原文和已有梗概均保留。')
                : `会用 AI 生成的内容替换「${pendingSummarySection?.section.title ?? ''}」编辑框里的梗概；确认保存前不会写入书目。`}
            </p>
            <div className="dialog-actions">
              <button type="button" className="quiet-action" onClick={closeSummaryConfirmation}>取消</button>
              <button type="button" className="primary-action button-with-icon" onClick={confirmSummaryAction}>
                {pendingSummaryAction === 'save'
                  ? <><Check aria-hidden="true" />确认保存并加载</>
                  : <><Sparkles aria-hidden="true" />确认生成</>}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </dialog>
  );
}
