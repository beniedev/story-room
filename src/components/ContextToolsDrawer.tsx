import { Fragment, useEffect, useRef, useState } from 'react';
import { BookOpenText, Check, ChevronRight, Sparkles, X } from 'lucide-react';
import { countWords } from '../textMetrics';
import {
  referenceModeFor,
  sectionReferenceModes,
  selectAllUnsetReferences,
  type SectionReferenceMode,
} from '../contextReferences';
import {
  draftFromSectionMemory,
  isEligibleSectionMemory,
  sectionMemoryFreshness,
  sectionMemoryProvenanceAfterReview,
} from '../sectionMemory';
import { focusFirstDrawerElement } from './shared/dialogFocus';
import { SectionMemoryEditor, type ContextReferenceSection, type MemorySummaryAction } from './SectionMemoryEditor';
import type { Book, SectionMemoryDraft, SectionMemoryProvenance } from '../types';

export function ContextToolsDrawer({
  open,
  book,
  section,
  onContextReferenceChange,
  onContextReferencesChange,
  onGenerateMemory,
  onSaveMemoryAndLoad,
  onDeleteMemory,
  onRollbackMemory,
  onClearPreviousMemory,
  busy,
  onCancelGeneration,
  onClose,
}: {
  open: boolean;
  book: Book;
  section: Book['chapters'][number]['sections'][number];
  onContextReferenceChange: (sourceSectionId: string, mode: SectionReferenceMode) => void;
  onContextReferencesChange: (references: Book['chapters'][number]['sections'][number]['contextReferences']) => void;
  onGenerateMemory: (sourceSectionId: string) => Promise<SectionMemoryDraft>;
  onSaveMemoryAndLoad: (
    sourceSectionId: string,
    draft: SectionMemoryDraft,
    provenance: SectionMemoryProvenance,
  ) => Promise<void>;
  onDeleteMemory: (sourceSectionId: string) => Promise<void>;
  onRollbackMemory: (sourceSectionId: string) => Promise<void>;
  onClearPreviousMemory: (sourceSectionId: string) => Promise<void>;
  busy: boolean;
  onCancelGeneration: () => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const memoryBackRef = useRef<HTMLButtonElement>(null);
  const memoryRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const summaryConfirmDialog = useRef<HTMLDialogElement>(null);
  const summaryActionTrigger = useRef<HTMLElement | null>(null);
  const summaryActionAccepted = useRef(false);
  const [memoryEditorSectionId, setMemoryEditorSectionId] = useState('');
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [summaryBusyId, setSummaryBusyId] = useState('');
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [pendingSummarySectionId, setPendingSummarySectionId] = useState('');
  const [pendingSummaryAction, setPendingSummaryAction] = useState<'generate' | 'save' | 'delete' | 'rollback' | 'clear-history' | ''>('');
  const memoryScrollTop = useRef(0);
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
    setMemoryEditorSectionId('');
    setMemoryDrafts({});
    setGeneratedDrafts({});
    setSummaryBusyId('');
    setSummaryErrors({});
    summaryConfirmDialog.current?.close();
    setPendingSummarySectionId('');
    setPendingSummaryAction('');
  }, [open, section.id]);

  useEffect(() => {
    if (!memoryEditorSectionId) return undefined;
    const frame = window.requestAnimationFrame(() => memoryBackRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [memoryEditorSectionId]);

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
  const selectedReferenceCount = selectableReferenceSections.filter((item) => currentReferences.has(item.section.id)).length;
  const allSelected = selectableReferenceSections.length > 0
    && selectableReferenceSections.every((item) => currentReferences.has(item.section.id));

  const toggleAll = () => {
    if (allSelected) return;
    onContextReferencesChange(selectAllUnsetReferences(section.contextReferences, referenceSections.map((item) => item.section)));
  };
  const clearAll = () => onContextReferencesChange(undefined);
  const emptyMemoryDraft = (): SectionMemoryDraft => ({
    synopsis: '',
    beats: [],
    continuityFacts: [],
    characterStateChanges: [],
    foreshadowingCandidates: [],
  });
  const memoryItem = referenceSections.find((item) => item.section.id === memoryEditorSectionId);
  const summaryBusy = Boolean(memoryItem && summaryBusyId === memoryItem.section.id);
  const memoryDraftFor = (item: typeof referenceSections[number]) => (
    memoryDrafts[item.section.id]
      ?? draftFromSectionMemory(item.section.memory)
      ?? emptyMemoryDraft()
  );
  const setMemoryDraft = (sourceSectionId: string, draft: SectionMemoryDraft) => {
    setMemoryDrafts((current) => ({ ...current, [sourceSectionId]: draft }));
    setSummaryErrors((current) => ({ ...current, [sourceSectionId]: '' }));
  };
  const updateMemorySynopsis = (item: typeof referenceSections[number], synopsis: string) => {
    setMemoryDraft(item.section.id, { ...memoryDraftFor(item), synopsis });
  };
  const updateMemoryArrayItem = (
    item: typeof referenceSections[number],
    field: keyof Omit<SectionMemoryDraft, 'synopsis'>,
    index: number,
    value: string,
  ) => {
    const values = [...memoryDraftFor(item)[field]];
    values[index] = value;
    setMemoryDraft(item.section.id, { ...memoryDraftFor(item), [field]: values });
  };
  const addMemoryArrayItem = (
    item: typeof referenceSections[number],
    field: keyof Omit<SectionMemoryDraft, 'synopsis'>,
  ) => setMemoryDraft(item.section.id, { ...memoryDraftFor(item), [field]: [...memoryDraftFor(item)[field], ''] });
  const removeMemoryArrayItem = (
    item: typeof referenceSections[number],
    field: keyof Omit<SectionMemoryDraft, 'synopsis'>,
    index: number,
  ) => setMemoryDraft(item.section.id, { ...memoryDraftFor(item), [field]: memoryDraftFor(item)[field].filter((_, itemIndex) => itemIndex !== index) });
  const openMemoryEditor = (item: typeof referenceSections[number]) => {
    memoryScrollTop.current = scrollRef.current?.scrollTop ?? 0;
    setMemoryEditorSectionId(item.section.id);
    setMemoryDrafts((current) => current[item.section.id]
      ? current
      : { ...current, [item.section.id]: memoryDraftFor(item) });
  };
  const closeMemoryEditor = () => {
    const previousSectionId = memoryEditorSectionId;
    setMemoryEditorSectionId('');
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = memoryScrollTop.current;
      if (previousSectionId) memoryRowRefs.current[previousSectionId]?.focus();
    });
  };
  const memoryStatus = (item: typeof referenceSections[number]) => {
    if (!item.section.memory) return '未建立';
    if (item.section.memory.provenance === 'model-draft') return '待确认';
    return sectionMemoryFreshness(item.section.memory, item.section.content) === 'fresh' ? '已确认' : '已过期';
  };
  const referenceModeLabel = (value: SectionReferenceMode) => (
    value === 'none' ? '不使用' : value === 'full' ? '全文' : value === 'summary' ? '梗概' : '梗概＋全文'
  );
  const summaryPreview = (item: typeof referenceSections[number]) => {
    const value = item.section.memory?.synopsis?.trim() || '尚无摘要';
    return value.length > 96 ? `${value.slice(0, 96)}…` : value;
  };
  const generateSummary = async (item: typeof referenceSections[number]) => {
    setSummaryBusyId(item.section.id);
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
    try {
      const draft = await onGenerateMemory(item.section.id);
      setGeneratedDrafts((current) => ({ ...current, [item.section.id]: draft }));
      setMemoryDraft(item.section.id, draft);
    } catch (error) {
      setSummaryErrors((current) => ({
        ...current,
        [item.section.id]: error instanceof Error ? error.message : '梗概生成失败。',
      }));
    } finally {
      setSummaryBusyId('');
      window.setTimeout(() => document.getElementById(`context-memory-synopsis-${item.section.id}`)?.focus(), 0);
    }
  };
  const requestSummaryAction = (
    item: typeof referenceSections[number],
    action: 'generate' | 'save' | 'delete' | 'rollback' | 'clear-history',
  ) => {
    summaryActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSummarySectionId(item.section.id);
    setPendingSummaryAction(action);
    summaryConfirmDialog.current?.showModal();
  };
  const closeSummaryConfirmation = () => {
    const trigger = summaryActionTrigger.current;
    summaryConfirmDialog.current?.close();
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
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
      window.setTimeout(() => document.getElementById(`context-memory-synopsis-${item.section.id}`)?.focus(), 0);
      return;
    }
    const callback = action === 'delete' ? onDeleteMemory
      : action === 'rollback' ? onRollbackMemory
        : onClearPreviousMemory;
    setSummaryBusyId(item.section.id);
    void callback(item.section.id)
      .then(() => {
        setMemoryDrafts((current) => {
          const next = { ...current };
          delete next[item.section.id];
          return next;
        });
        setGeneratedDrafts((current) => {
          const next = { ...current };
          delete next[item.section.id];
          return next;
        });
      })
      .catch((error: unknown) => setSummaryErrors((current) => ({
        ...current,
        [item.section.id]: error instanceof Error ? error.message : 'Memory 操作失败，请重试。',
      })))
      .finally(() => setSummaryBusyId(''));
  };
  const pendingSummarySection = referenceSections.find((item) => item.section.id === pendingSummarySectionId);
  const saveSummaryAndLoad = async (item: typeof referenceSections[number]) => {
    const draft = memoryDraftFor(item);
    if (!draft.synopsis.trim()) {
      setSummaryErrors((current) => ({ ...current, [item.section.id]: '请先填写或生成摘要。' }));
      return;
    }
    const generated = generatedDrafts[item.section.id];
    const provenance: SectionMemoryProvenance = sectionMemoryProvenanceAfterReview(item.section.memory, draft, generated);
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
      <div className="context-tools-drawer-scroll" ref={scrollRef}>
        <header className="drawer-heading">
          <h2 id="context-tools-drawer-title">前文选择</h2>
          <button type="button" className="icon-button" ref={closeButtonRef} autoFocus onClick={onClose} aria-label="关闭前文选择" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>

        <section className="context-reference-section" aria-label="加载前文">
          {memoryItem ? (
            <SectionMemoryEditor
              item={memoryItem}
              memoryStatus={memoryStatus(memoryItem)}
              memoryDraft={memoryDraftFor(memoryItem)}
              summaryError={summaryErrors[memoryItem.section.id]}
              summaryBusy={summaryBusy}
              busy={busy}
              memoryBackRef={memoryBackRef}
              onBack={closeMemoryEditor}
              onSynopsisChange={(value) => updateMemorySynopsis(memoryItem, value)}
              onArrayItemChange={(field, index, value) => updateMemoryArrayItem(memoryItem, field, index, value)}
              onAddArrayItem={(field) => addMemoryArrayItem(memoryItem, field)}
              onRemoveArrayItem={(field, index) => removeMemoryArrayItem(memoryItem, field, index)}
              onRequestAction={(action: MemorySummaryAction) => requestSummaryAction(memoryItem, action)}
              onCancelGeneration={onCancelGeneration}
            />
          ) : referenceSections.length === 0 ? <p className="helper-copy">这是第一节，暂无前文可选。</p> : (
            <div className="source-scope-drawer context-reference-scope" data-open>
              <div className="source-load-tab">
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
                <button
                  type="button"
                  className="quiet-action"
                  onClick={clearAll}
                  disabled={busy || currentReferences.size === 0}
                >清空全部</button>
              </div>
              <div className="source-scope-content">
                <div className="source-scope-chapters" aria-label="可加载的前文">
                  {referenceChapters.map((chapterItem) => (
                    <fieldset key={chapterItem.chapter.id}>
                      <legend>{chapterItem.chapter.title}</legend>
                      {chapterItem.sections.map((item) => {
                        const mode = referenceModeFor(section.contextReferences, item.section.id);
                        const hasContent = Boolean(item.section.content.trim());
                        const summaryBusy = summaryBusyId === item.section.id;
                        return (
                          <Fragment key={item.section.id}>
                            <div className="context-reference-row" data-reference-mode={mode} data-invalid={!hasContent || (mode !== 'none' && (mode === 'summary' || mode === 'both') && !isEligibleSectionMemory(item.section.memory, item.section.content)) || undefined}>
                              <button
                                type="button"
                                className="context-reference-disclosure"
                                ref={(node) => { memoryRowRefs.current[item.section.id] = node; }}
                                aria-label={`编辑${item.section.title} Memory`}
                                onClick={() => openMemoryEditor(item)}
                              >
                                <span>
                                  <small>{item.chapter.title} · 第 {item.sectionIndex + 1} 节</small>
                                  <span>{item.section.title}</span>
                                  <small>{hasContent ? `${countWords(item.section.content).toLocaleString()} 字` : '尚无正文'} · {referenceModeLabel(mode)} · Memory {memoryStatus(item)}</small>
                                  <small>摘要预览：{summaryPreview(item)}</small>
                                </span>
                                <ChevronRight aria-hidden="true" />
                              </button>
                              <label className="context-reference-mode">
                                <span className="sr-only">设置{item.section.title}的前文模式</span>
                                <select
                                  value={mode}
                                  onChange={(event) => onContextReferenceChange(item.section.id, event.target.value as SectionReferenceMode)}
                                  disabled={busy || (!hasContent && mode === 'none')}
                                  aria-label={`设置${item.section.title}的前文模式`}
                                >
                                  {sectionReferenceModes.map((option) => (
                                    <option
                                      key={option}
                                      value={option}
                                      disabled={(option === 'full' && !hasContent) || ((option === 'summary' || option === 'both') && !isEligibleSectionMemory(item.section.memory, item.section.content))}
                                    >
                                      {option === 'none' ? '不使用' : option === 'full' ? '全文' : option === 'summary' ? '梗概' : '梗概＋全文'}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
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
            {pendingSummaryAction === 'save' ? '保存并加载 Memory'
              : pendingSummaryAction === 'generate' ? '生成该节 Memory'
                : pendingSummaryAction === 'delete' ? '删除当前 Memory'
                  : pendingSummaryAction === 'rollback' ? '回滚上一版本'
                    : '清除上一版本'}
          </h2>
          <button type="button" className="icon-button" onClick={closeSummaryConfirmation} aria-label="关闭确认" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="confirm-dialog-body">
          <p id="summary-confirm-dialog-description">
            {pendingSummaryAction === 'save'
              ? `会保存「${pendingSummarySection?.section.title ?? ''}」的五个 Memory 字段，并作为前文梗概加载到当前小节。`
              : pendingSummaryAction === 'generate'
                ? `会用 AI 生成的五个字段替换「${pendingSummarySection?.section.title ?? ''}」的本地草稿；确认保存前不会写入书目。`
                : pendingSummaryAction === 'delete'
                  ? `会删除「${pendingSummarySection?.section.title ?? ''}」的当前 Memory，并按规则处理已有梗概引用；上一版本仍会保留。`
                  : pendingSummaryAction === 'rollback'
                    ? `会让「${pendingSummarySection?.section.title ?? ''}」恢复到上一版本，并把当前版本保留为上一版本。`
                    : `会永久清除「${pendingSummarySection?.section.title ?? ''}」的上一版本 Memory，当前版本不受影响。`}
          </p>
          <div className="dialog-actions">
            <button type="button" className="quiet-action" onClick={closeSummaryConfirmation}>取消</button>
            <button type="button" className="primary-action button-with-icon" onClick={confirmSummaryAction}>
              {pendingSummaryAction === 'save'
                ? <><Check aria-hidden="true" />确认保存并加载</>
                : pendingSummaryAction === 'generate'
                  ? <><Sparkles aria-hidden="true" />确认生成</>
                  : <>确认执行</>}
            </button>
          </div>
        </div>
      </dialog>
    </dialog>
  );
}
