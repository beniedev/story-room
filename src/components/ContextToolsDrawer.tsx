import { Fragment, useEffect, useRef, useState } from 'react';
import { BookOpenText, Check, ChevronRight, Sparkles, X } from 'lucide-react';
import { selectAllUnsetReferences } from '../contextReferences';
import {
  draftFromSectionMemory,
  sectionMemoryProvenanceAfterReview,
} from '../sectionMemory';
import { focusFirstDrawerElement } from './shared/dialogFocus';
import type { Book, SectionMemoryDraft, SectionMemoryProvenance } from '../types';

export function ContextToolsDrawer({
  open,
  book,
  section,
  onContextReferenceChange,
  onContextReferencesChange,
  onGenerateMemory,
  onSaveMemoryAndLoad,
  busy,
  onCancelGeneration,
  onClose,
}: {
  open: boolean;
  book: Book;
  section: Book['chapters'][number]['sections'][number];
  onContextReferenceChange: (sourceSectionId: string, selected: boolean) => void;
  onContextReferencesChange: (references: Book['chapters'][number]['sections'][number]['contextReferences']) => void;
  onGenerateMemory: (sourceSectionId: string) => Promise<SectionMemoryDraft>;
  onSaveMemoryAndLoad: (
    sourceSectionId: string,
    draft: SectionMemoryDraft,
    provenance: SectionMemoryProvenance,
  ) => Promise<void>;
  busy: boolean;
  onCancelGeneration: () => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const summaryConfirmDialog = useRef<HTMLDialogElement>(null);
  const summaryActionTrigger = useRef<HTMLElement | null>(null);
  const summaryActionAccepted = useRef(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [summaryBusyId, setSummaryBusyId] = useState('');
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [pendingSummarySectionId, setPendingSummarySectionId] = useState('');
  const [pendingSummaryAction, setPendingSummaryAction] = useState<'generate' | 'save' | ''>('');

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
    setExpandedSections(new Set());
    setMemoryDrafts({});
    setGeneratedDrafts({});
    setSummaryBusyId('');
    setSummaryErrors({});
    summaryConfirmDialog.current?.close();
    setPendingSummarySectionId('');
    setPendingSummaryAction('');
  }, [open, section.id]);

  const currentReferences = new Map((section.contextReferences ?? [])
    .map((reference) => [reference.sectionId, reference.mode] as const));
  const targetLocation = book.chapters.flatMap((chapter, chapterIndex) => chapter.sections.map((item, sectionIndex) => ({
    chapter,
    section: item,
    chapterIndex,
    sectionIndex,
  }))).find((item) => item.section.id === section.id);
  const targetOrdinal = targetLocation
    ? book.chapters.slice(0, targetLocation.chapterIndex)
      .reduce((total, chapter) => total + chapter.sections.length, 0) + targetLocation.sectionIndex
    : 0;
  const referenceSections = book.chapters.flatMap((chapter, chapterIndex) => chapter.sections.map((item, sectionIndex) => ({
    chapter,
    section: item,
    chapterIndex,
    sectionIndex,
    ordinal: book.chapters.slice(0, chapterIndex)
      .reduce((total, previousChapter) => total + previousChapter.sections.length, 0) + sectionIndex,
  }))).filter((item) => item.ordinal < targetOrdinal);
  const referenceChapters = book.chapters.map((chapter) => ({
    chapter,
    sections: referenceSections.filter((item) => item.chapter.id === chapter.id),
  })).filter((item) => item.sections.length > 0);
  const selectableReferenceSections = referenceSections.filter((item) => item.section.content.trim());
  const selectedReferenceCount = selectableReferenceSections
    .filter((item) => currentReferences.has(item.section.id)).length;
  const allSelected = selectableReferenceSections.length > 0
    && selectableReferenceSections.every((item) => currentReferences.has(item.section.id));
  const someSelected = selectedReferenceCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      onContextReferencesChange(undefined);
      return;
    }
    onContextReferencesChange(selectAllUnsetReferences(
      section.contextReferences,
      referenceSections.map((item) => item.section),
    ));
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
    setMemoryDrafts((current) => ({
      ...current,
      [item.section.id]: { ...memoryDraftFor(item), synopsis },
    }));
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
  };
  const generateSummary = async (item: typeof referenceSections[number]) => {
    setSummaryBusyId(item.section.id);
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
    try {
      const draft = await onGenerateMemory(item.section.id);
      setGeneratedDrafts((current) => ({ ...current, [item.section.id]: draft }));
      setMemoryDrafts((current) => ({ ...current, [item.section.id]: draft }));
    } catch (error) {
      setSummaryErrors((current) => ({
        ...current,
        [item.section.id]: error instanceof Error ? error.message : '梗概生成失败。',
      }));
    } finally {
      setSummaryBusyId('');
      window.setTimeout(() => document.getElementById(`context-summary-textarea-${item.section.id}`)?.focus(), 0);
    }
  };
  const requestSummaryAction = (
    item: typeof referenceSections[number],
    action: 'generate' | 'save',
  ) => {
    summaryActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSummarySectionId(item.section.id);
    setPendingSummaryAction(action);
    summaryConfirmDialog.current?.showModal();
  };
  const closeSummaryConfirmation = () => summaryConfirmDialog.current?.close();
  const saveSummaryAndLoad = async (item: typeof referenceSections[number]) => {
    const draft = memoryDraftFor(item);
    if (!draft.synopsis.trim()) {
      setSummaryErrors((current) => ({ ...current, [item.section.id]: '请先填写或生成梗概。' }));
      return;
    }
    const generated = generatedDrafts[item.section.id];
    const provenance: SectionMemoryProvenance = sectionMemoryProvenanceAfterReview(
      item.section.memory,
      draft,
      generated,
    );
    try {
      await onSaveMemoryAndLoad(item.section.id, draft, provenance);
      setGeneratedDrafts((current) => {
        const next = { ...current };
        delete next[item.section.id];
        return next;
      });
      setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
    } catch (error) {
      setSummaryErrors((current) => ({
        ...current,
        [item.section.id]: error instanceof Error ? error.message : '梗概保存失败，请重试。',
      }));
    }
  };
  const confirmSummaryAction = () => {
    const item = referenceSections.find((candidate) => candidate.section.id === pendingSummarySectionId);
    if (!item) return;
    const action = pendingSummaryAction;
    summaryActionAccepted.current = true;
    summaryConfirmDialog.current?.close();
    if (action === 'generate') {
      void generateSummary(item);
      return;
    }
    if (action === 'save') {
      void saveSummaryAndLoad(item);
      window.setTimeout(() => document.getElementById(`context-summary-textarea-${item.section.id}`)?.focus(), 0);
    }
  };
  const pendingSummarySection = referenceSections.find((item) => item.section.id === pendingSummarySectionId);

  return (
    <dialog
      id="context-tools-drawer"
      ref={drawerRef}
      className="context-tools-drawer"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      aria-modal="true"
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

        <section className="context-reference-section" aria-label="加载前文">
          {referenceSections.length === 0 ? <p className="helper-copy">这是第一节，暂无前文可选。</p> : (
            <div className="source-scope-drawer context-reference-scope" data-open>
              <div className="source-load-tab">
                <label className="source-load-toggle" title="选择全部前文">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    aria-label="选择全部前文"
                    onChange={toggleAll}
                    disabled={busy}
                  />
                </label>
                <div className="context-reference-scope-title">
                  <strong>加载前文</strong>
                  <small>已选 {selectedReferenceCount}/{selectableReferenceSections.length} 小节</small>
                </div>
                <button
                  type="button"
                  className="source-scope-all"
                  aria-pressed={allSelected}
                  onClick={toggleAll}
                  disabled={busy}
                >
                  <BookOpenText aria-hidden="true" />
                  <span>全部</span>
                </button>
              </div>
              <div className="source-scope-content">
                <div className="source-scope-chapters" aria-label="可加载的前文">
                  {referenceChapters.map((chapterItem) => (
                    <fieldset key={chapterItem.chapter.id}>
                      <legend>{chapterItem.chapter.title}</legend>
                      {chapterItem.sections.map((item) => {
                        const selected = currentReferences.has(item.section.id);
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
                                  onChange={() => onContextReferenceChange(item.section.id, !selected)}
                                  disabled={busy || (!hasContent && !selected)}
                                />
                                <span className="sr-only">加载{item.section.title}前文</span>
                              </label>
                              <button
                                type="button"
                                className="context-reference-disclosure"
                                aria-expanded={expanded}
                                aria-controls={panelId}
                                aria-label={expanded ? `收起${item.section.title}梗概` : `展开${item.section.title}梗概`}
                                onClick={() => toggleSection(item.section.id)}
                              >
                                <span>{item.section.title}</span>
                                <ChevronRight aria-hidden="true" />
                              </button>
                            </div>
                            {expanded && (
                              <div className="context-summary-editor" id={panelId}>
                                <label>
                                  <span className="sr-only">{item.section.title}梗概</span>
                                  <textarea
                                    id={`context-summary-textarea-${item.section.id}`}
                                    value={value}
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
                                    disabled={(busy && !summaryBusy) || !hasContent}
                                    onClick={() => summaryBusy ? onCancelGeneration() : requestSummaryAction(item, 'generate')}
                                    aria-busy={summaryBusy || undefined}
                                    aria-label={summaryBusy ? '取消生成该节梗概' : '生成该节梗概'}
                                    title={summaryBusy ? '取消生成该节梗概' : '生成该节梗概'}
                                  >
                                    <Sparkles aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="primary-action icon-button context-summary-save"
                                    disabled={busy || summaryBusy || !value.trim()}
                                    onClick={() => requestSummaryAction(item, 'save')}
                                    aria-label="保存并加载梗概"
                                    title={value.trim() ? '保存并加载梗概' : '请先填写或生成梗概'}
                                  >
                                    <Check aria-hidden="true" />
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
          setPendingSummarySectionId('');
          setPendingSummaryAction('');
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
        aria-describedby="summary-confirm-dialog-description"
      >
        <header className="dialog-heading">
          <h2 id="summary-confirm-dialog-title">
            {pendingSummaryAction === 'save' ? '保存并加载梗概' : '生成该节梗概'}
          </h2>
          <button type="button" className="icon-button" onClick={closeSummaryConfirmation} aria-label="关闭确认" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="confirm-dialog-body">
          <p id="summary-confirm-dialog-description">
            {pendingSummaryAction === 'save'
              ? `会保存「${pendingSummarySection?.section.title ?? ''}」编辑框里的梗概，并作为前文加载到当前小节。`
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
      </dialog>
    </dialog>
  );
}
