import { memo, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  ArrowLeft,
  BookMarked,
  BookOpenText,
  BookPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FilePlus2,
  FolderPlus,
  Globe2,
  Layers3,
  ListChecks,
  ListTree,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { toggleChapterSelection, toggleSectionSelection, type DirectorySelection } from '../directorySelection';
import { toggleSourceSelection, type SourceSelectionKind } from '../sourceSelection';
import { countWords, estimateTokens } from '../textMetrics';
import { compactTokenCount } from './shared/text';
import { TextArea } from './shared/TextArea';
import { InlineTitle } from './shared/InlineTitle';
import {
  DialogOperationStatus,
  idleDialogOperation,
  useDismissSuccessfulDialog,
  type DialogOperationState,
} from './shared/DialogOperationStatus';
import type { Book, BookIndexEntry, CharacterCard, WorldRule } from '../types';

type SettingsSection = 'guidance' | 'characters' | 'world';

const SectionMetrics = memo(function SectionMetrics({ content }: { content: string }) {
  return <>{countWords(content).toLocaleString('zh-CN')} 字 | 约 {compactTokenCount(estimateTokens(content))} tokens</>;
});
type BookSettingsView =
  | { kind: 'root' }
  | { kind: 'outline' }
  | { kind: 'style' }
  | { kind: 'character'; id: string }
  | { kind: 'world'; id: string }
  | { kind: 'character-scope'; id: string }
  | { kind: 'world-scope'; id: string };

function GuideEditor({ id, title, description, placeholder, value, onSave, canEdit = true }: {
  id: string;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <article className="guide-editor-page">
      <header className="guide-editor-heading">
        <p className="eyebrow">全局指引 · 作用于本书全部章与节</p>
        <div className="source-editor-title-row">
          <h1>{title}</h1>
          <SaveAndLoadAction id={id} label={title} onConfirm={() => onSave(draft)} canEdit={canEdit} />
        </div>
        <p>{description}</p>
      </header>
      <label className="guide-editor-field">
        <span className="sr-only">{title}</span>
        <TextArea value={draft} readOnly={!canEdit} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} spellCheck />
      </label>
    </article>
  );
}

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

function SaveAndLoadAction({ id, label, onConfirm, canEdit = true }: {
  id: string;
  label: string;
  onConfirm: () => Promise<void>;
  canEdit?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [operation, setOperation] = useState<DialogOperationState>(idleDialogOperation);

  useDismissSuccessfulDialog(operation.phase === 'success', () => dialogRef.current?.close());

  const closeDialog = () => {
    if (operation.phase === 'pending') return;
    dialogRef.current?.close();
  };

  const saveAndLoad = async () => {
    if (!canEdit) return;
    if (operation.phase === 'pending') return;
    setOperation({ phase: 'pending', title: `正在保存并加载${label}…` });
    try {
      await onConfirm();
      setOperation({ phase: 'success', title: `${label}保存并加载成功` });
    } catch (error) {
      setOperation({
        phase: 'error',
        title: `${label}保存并加载失败`,
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="primary-action icon-button source-save-load"
        onClick={() => {
          setOperation(idleDialogOperation);
          dialogRef.current?.showModal();
        }}
        aria-haspopup="dialog"
        disabled={!canEdit}
        aria-label={`保存并加载${label}`}
        title="保存并加载"
      >
        <Check aria-hidden="true" />
      </button>
      <dialog
        className="confirm-dialog"
        ref={dialogRef}
        onClose={(event) => {
          event.stopPropagation();
          setOperation(idleDialogOperation);
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }}
        aria-labelledby={`${id}-save-load-title`}
        aria-describedby={operation.phase === 'idle' ? `${id}-save-load-description` : undefined}
        aria-busy={operation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id={`${id}-save-load-title`}>保存并加载{label}</h2>
          <button type="button" className="icon-button" disabled={operation.phase === 'pending'} onClick={closeDialog} aria-label="取消保存并加载" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {operation.phase === 'idle' ? (
            <>
              <p id={`${id}-save-load-description`}>会保存当前编辑内容，并按当前加载范围进入后续生成的 Prompt；取消不会更改已保存内容。</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" autoFocus onClick={closeDialog}>取消</button>
                <button type="button" className="primary-action button-with-icon" onClick={() => void saveAndLoad()}><Check aria-hidden="true" />确认保存并加载</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={operation} onReturn={() => setOperation(idleDialogOperation)} />
          )}
        </div>
      </dialog>
    </>
  );
}

function CharacterEditor({ bookTitle, character, onSave, onOpenScope, canEdit = true }: {
  bookTitle: string;
  character: CharacterCard;
  onSave: (patch: Pick<CharacterCard, 'name' | 'role' | 'content'>) => Promise<void>;
  onOpenScope: () => void;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(() => ({
    name: character.name,
    role: character.role,
    content: character.content,
  }));
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 角色卡</p>
        <div className="source-editor-title-row">
          <h1>{draft.name || character.name}</h1>
          <div className="source-editor-actions">
            <button type="button" className="icon-button source-scope-open" onClick={onOpenScope} aria-label={`选择${draft.name || character.name}的加载范围`} title="加载角色卡">
              <ListTree aria-hidden="true" />
            </button>
            <SaveAndLoadAction id={`character-${character.id}`} label="角色卡" onConfirm={() => onSave(draft)} canEdit={canEdit} />
          </div>
        </div>
        <p>这里的资料只属于当前书目，并在生成时描述这个角色。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${draft.name || character.name}角色卡内容`}>
        <label>角色名<input value={draft.name} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>角色要点<input value={draft.role} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} /></label>
        <label>角色设定<TextArea value={draft.content} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} spellCheck /></label>
      </section>
    </article>
  );
}

function WorldRuleEditor({ bookTitle, rule, onSave, onOpenScope, canEdit = true }: {
  bookTitle: string;
  rule: WorldRule;
  onSave: (patch: Pick<WorldRule, 'title' | 'content'>) => Promise<void>;
  onOpenScope: () => void;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(() => ({ title: rule.title, content: rule.content }));
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 世界观设定</p>
        <div className="source-editor-title-row">
          <h1>{draft.title || rule.title}</h1>
          <div className="source-editor-actions">
            <button type="button" className="icon-button source-scope-open" onClick={onOpenScope} aria-label={`选择${draft.title || rule.title}的加载范围`} title="加载世界观设定">
              <ListTree aria-hidden="true" />
            </button>
            <SaveAndLoadAction id={`world-${rule.id}`} label="世界观设定" onConfirm={() => onSave(draft)} canEdit={canEdit} />
          </div>
        </div>
        <p>这条设定只属于当前书目，可按小节决定是否加载。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${draft.title || rule.title}世界观设定内容`}>
        <label>设定名称<input value={draft.title} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label>设定内容<TextArea value={draft.content} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} spellCheck /></label>
      </section>
    </article>
  );
}

function MissingSettingsItem({ label }: { label: string }) {
  return (
    <section className="source-editor-page empty-settings-item" aria-labelledby="missing-settings-item-title">
      <h1 id="missing-settings-item-title">找不到这条{label}</h1>
      <p>它可能已经被删除。请返回本书设定重新选择。</p>
    </section>
  );
}

interface BookshelfProps {
  settingsOnly?: boolean;
  canEdit?: boolean;
  book: Book;
  library: BookIndexEntry[];
  selectedSectionId: string;
  openNewBookRequest: number;
  onNewBookOpened: () => void;
  openBookSettingsRequest: number;
  onBookSettingsOpened: () => void;
  onBookSettingsClose: () => void;
  onOpenBook: (id: string) => void;
  onOpenSection: (id: string) => void;
  onCreateBook: (title: string) => Promise<void>;
  onDeleteBook: () => Promise<void>;
  onBookChange: (recipe: (current: Book) => Book) => Promise<void>;
  onAddCharacter: (name: string) => Promise<void>;
  onAddWorldRule: (title: string) => Promise<void>;
  onAddChapter: (title: string) => Promise<void>;
  onAddSection: (chapterId: string, title: string) => Promise<void>;
  onRenameChapter: (chapterId: string, title: string) => Promise<void>;
  onRenameSection: (chapterId: string, sectionId: string, title: string) => Promise<void>;
  onDeleteSelection: (selection: DirectorySelection) => Promise<void>;
  onDeleteSources: (kind: SourceSelectionKind, ids: Set<string>) => Promise<void>;
}

type NameDialogState =
  | { kind: 'new-book' | 'rename-book' | 'new-chapter' | 'new-character' | 'new-world'; value: string }
  | { kind: 'new-section'; value: string; chapterId: string; chapterTitle: string };

type DeleteDialogState =
  | { kind: 'book'; id: string; title: string }
  | { kind: 'selection'; chapterIds: string[]; sectionIds: string[]; chapterCount: number; sectionCount: number }
  | { kind: 'source-selection'; sourceKind: SourceSelectionKind; ids: string[] };

type DirectorySelectionState = 'checked' | 'mixed' | 'unchecked';

function DirectorySelectionIndicator({ state }: { state: DirectorySelectionState }) {
  return (
    <span className="directory-selection-checkbox" data-state={state} aria-hidden="true">
      {state === 'checked' && <Check />}
    </span>
  );
}

export function Bookshelf(props: BookshelfProps) {
  const canEdit = props.canEdit !== false;
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [nameOperation, setNameOperation] = useState<DialogOperationState>(idleDialogOperation);
  const [deleteOperation, setDeleteOperation] = useState<DialogOperationState>(idleDialogOperation);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<DirectorySelection>({
    chapterIds: new Set(),
    sectionIds: new Set(),
  });
  const [sourceSelectionMode, setSourceSelectionMode] = useState<SourceSelectionKind | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [openSettingsSections, setOpenSettingsSections] = useState<Set<SettingsSection>>(
    () => new Set(['guidance']),
  );
  const [bookSettingsView, setBookSettingsView] = useState<BookSettingsView>({ kind: 'root' });
  const nameDialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const nameDialogTrigger = useRef<HTMLElement | null>(null);
  const deleteDialogTrigger = useRef<HTMLElement | null>(null);
  const bookSettingsDialog = useRef<HTMLDialogElement>(null);
  const bookSettingsTrigger = useRef<HTMLButtonElement>(null);
  const bookSettingsPageTrigger = useRef<HTMLElement | null>(null);
  const sourceScopeTrigger = useRef<HTMLElement | null>(null);
  const bookSettingsScrollTop = useRef(0);
  const sourceScopeScrollTop = useRef(0);
  const bookSettingsBackButton = useRef<HTMLButtonElement>(null);
  const bookLibraryDrawer = useRef<HTMLDetailsElement>(null);
  const bookSelectorTrigger = useRef<HTMLElement>(null);
  const bookActionsMenu = useRef<HTMLDetailsElement>(null);
  const bookActionsTrigger = useRef<HTMLElement>(null);

  useDismissSuccessfulDialog(nameOperation.phase === 'success', () => nameDialogRef.current?.close());
  useDismissSuccessfulDialog(deleteOperation.phase === 'success', () => deleteDialogRef.current?.close());

  useEffect(() => {
    if (!nameDialog || !nameDialogRef.current || nameDialogRef.current.open) return undefined;
    nameDialogRef.current.showModal();
    const focusNameInput = () => {
      nameInputRef.current?.focus();
      if (nameDialog.kind === 'rename-book') nameInputRef.current?.select();
    };
    focusNameInput();
    const frame = window.requestAnimationFrame(focusNameInput);
    return () => window.cancelAnimationFrame(frame);
  }, [nameDialog]);

  useEffect(() => {
    if (deleteDialog && deleteDialogRef.current && !deleteDialogRef.current.open) {
      deleteDialogRef.current.showModal();
    }
  }, [deleteDialog]);

  useEffect(() => {
    if (!props.openBookSettingsRequest || !bookSettingsDialog.current || bookSettingsDialog.current.open) return;
    setBookSettingsView({ kind: 'root' });
    bookSettingsDialog.current.showModal();
    props.onBookSettingsOpened();
  }, [props.openBookSettingsRequest]);

  useEffect(() => {
    setSelectionMode(false);
    setSelection({ chapterIds: new Set(), sectionIds: new Set() });
    setSourceSelectionMode(null);
    setSelectedSourceIds(new Set());
  }, [props.book.id]);

  const rememberTrigger = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openNameDialog = (dialog: NameDialogState) => {
    if (!canEdit) return;
    nameDialogTrigger.current = rememberTrigger();
    setNameOperation(idleDialogOperation);
    setNameDialog(dialog);
  };
  const openDeleteDialog = (dialog: DeleteDialogState) => {
    if (!canEdit) return;
    deleteDialogTrigger.current = rememberTrigger();
    setDeleteOperation(idleDialogOperation);
    setDeleteDialog(dialog);
  };
  const openCurrentBookNameDialog = (dialog: NameDialogState) => {
    if (!canEdit) return;
    nameDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
    setNameOperation(idleDialogOperation);
    setNameDialog(dialog);
  };
  const openCurrentBookDeleteDialog = () => {
    if (!canEdit) return;
    deleteDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
    setDeleteOperation(idleDialogOperation);
    setDeleteDialog({ kind: 'book', id: props.book.id, title: props.book.title });
  };

  useEffect(() => {
    if (!props.openNewBookRequest) return;
    openNameDialog({ kind: 'new-book', value: '' });
    props.onNewBookOpened();
  }, [props.openNewBookRequest]);

  useEffect(() => {
    const closeBookMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (bookLibraryDrawer.current?.open && !bookLibraryDrawer.current.contains(event.target)) {
        bookLibraryDrawer.current.removeAttribute('open');
      }
      if (bookActionsMenu.current?.open && !bookActionsMenu.current.contains(event.target)) {
        bookActionsMenu.current.removeAttribute('open');
      }
    };
    const closeBookMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (bookActionsMenu.current?.open) {
        bookActionsMenu.current.removeAttribute('open');
        bookActionsTrigger.current?.focus();
        return;
      }
      if (bookLibraryDrawer.current?.open) {
        bookLibraryDrawer.current.removeAttribute('open');
        bookSelectorTrigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeBookMenus);
    document.addEventListener('keydown', closeBookMenuWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeBookMenus);
      document.removeEventListener('keydown', closeBookMenuWithKeyboard);
    };
  }, []);
  const restoreDialogFocus = (trigger: RefObject<HTMLElement | null>) => {
    const target = trigger.current;
    const focusTarget = () => {
      if (target?.isConnected) target.focus();
      else if (bookSettingsDialog.current?.open) bookSettingsDialog.current.querySelector<HTMLElement>('summary')?.focus();
      else document.querySelector<HTMLElement>('.directory-toolbar button, .book-selector-card')?.focus();
    };
    focusTarget();
    window.requestAnimationFrame(focusTarget);
  };

  const nameDialogCopy = (() => {
    switch (nameDialog?.kind) {
      case 'new-book': return { title: '新建书目', label: '书名', placeholder: '输入书名', action: '确认新建' };
      case 'rename-book': return { title: '修改书名', label: '书名', placeholder: '输入书名', action: '保存' };
      case 'new-chapter': return { title: '新建章节', label: '章节名称', placeholder: `第 ${props.book.chapters.length + 1} 章`, action: '确认新建' };
      case 'new-section': return { title: `在《${nameDialog.chapterTitle}》中新建小节`, label: '小节名称', placeholder: '输入小节名称', action: '确认新建' };
      case 'new-character': return { title: '新建角色卡', label: '角色名称', placeholder: '输入角色名称', action: '确认新建' };
      case 'new-world': return { title: '新建世界观设定', label: '设定名称', placeholder: '输入设定名称', action: '确认新建' };
      default: return { title: '命名', label: '名称', placeholder: '输入名称', action: '确认' };
    }
  })();

  const nameOperationCopy = (() => {
    switch (nameDialog?.kind) {
      case 'new-book': return { pending: '正在新建书目…', success: '新建书目成功', error: '新建书目失败' };
      case 'new-chapter': return { pending: '正在新建章节…', success: '新建章节成功', error: '新建章节失败' };
      case 'new-section': return { pending: '正在新建小节…', success: '新建小节成功', error: '新建小节失败' };
      case 'new-character': return { pending: '正在新建角色卡…', success: '新建角色卡成功', error: '新建角色卡失败' };
      case 'new-world': return { pending: '正在新建世界观设定…', success: '新建世界观设定成功', error: '新建世界观设定失败' };
      default: return { pending: '正在保存修改…', success: '保存成功', error: '保存失败' };
    }
  })();

  const deleteDialogCopy = (() => {
    if (!deleteDialog) return { title: '确认删除', message: '此操作无法撤销。', action: '确认删除' };
    if (deleteDialog.kind === 'selection') {
      const parts = [
        deleteDialog.chapterCount ? `${deleteDialog.chapterCount} 个章节` : '',
        deleteDialog.sectionCount ? `共 ${deleteDialog.sectionCount} 个小节` : '',
      ].filter(Boolean).join('和');
      return {
        title: '删除所选内容',
        message: `将删除${parts}。所选章节内的小节也会一起删除，此操作无法撤销。`,
        action: '删除所选内容',
      };
    }
    if (deleteDialog.kind === 'source-selection') {
      const label = deleteDialog.sourceKind === 'character' ? '角色卡' : '世界观设定';
      const count = deleteDialog.sourceKind === 'character'
        ? `${deleteDialog.ids.length} 张角色卡`
        : `${deleteDialog.ids.length} 条世界观设定`;
      return {
        title: `删除所选${label}`,
        message: `将删除 ${count}。此操作无法撤销。`,
        action: `删除${label}`,
      };
    }
    return {
      title: '删除书目',
      message: `确定删除“${deleteDialog.title}”吗？此操作无法撤销。`,
      action: '确认删除',
    };
  })();

  const closeNameDialog = () => {
    if (nameOperation.phase === 'pending') return;
    nameDialogRef.current?.close();
  };

  const closeDeleteDialog = () => {
    if (deleteOperation.phase === 'pending') return;
    deleteDialogRef.current?.close();
  };

  const submitNameDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !nameDialog || nameOperation.phase === 'pending') return;
    const value = nameDialog.value.trim();
    if (!value) return;
    setNameOperation({ phase: 'pending', title: nameOperationCopy.pending });
    try {
      switch (nameDialog.kind) {
        case 'new-book': await props.onCreateBook(value); break;
        case 'rename-book': await props.onBookChange((current) => ({ ...current, title: value })); break;
        case 'new-chapter': await props.onAddChapter(value); break;
        case 'new-section': await props.onAddSection(nameDialog.chapterId, value); break;
        case 'new-character': await props.onAddCharacter(value); break;
        case 'new-world': await props.onAddWorldRule(value); break;
      }
      setNameOperation({ phase: 'success', title: nameOperationCopy.success });
    } catch (error) {
      setNameOperation({
        phase: 'error',
        title: nameOperationCopy.error,
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  const confirmDelete = async () => {
    if (!canEdit || !deleteDialog || deleteOperation.phase === 'pending') return;
    setDeleteOperation({ phase: 'pending', title: '正在删除…' });
    try {
      if (deleteDialog.kind === 'book') await props.onDeleteBook();
      if (deleteDialog.kind === 'selection') {
        await props.onDeleteSelection({
          chapterIds: new Set(deleteDialog.chapterIds),
          sectionIds: new Set(deleteDialog.sectionIds),
        });
        setSelectionMode(false);
        setSelection({ chapterIds: new Set(), sectionIds: new Set() });
      }
      if (deleteDialog.kind === 'source-selection') {
        await props.onDeleteSources(deleteDialog.sourceKind, new Set(deleteDialog.ids));
        setSourceSelectionMode(null);
        setSelectedSourceIds(new Set());
      }
      setDeleteOperation({ phase: 'success', title: '删除成功' });
    } catch (error) {
      setDeleteOperation({
        phase: 'error',
        title: '删除失败',
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  const toggleSourceSelectionMode = (kind: SourceSelectionKind) => {
    if (!canEdit) return;
    setSourceSelectionMode((current) => current === kind ? null : kind);
    setSelectedSourceIds(new Set());
  };

  const openBookSettingsPage = (next: BookSettingsView) => {
    bookSettingsPageTrigger.current = rememberTrigger();
    bookSettingsScrollTop.current = bookSettingsDialog.current?.scrollTop ?? 0;
    setBookSettingsView(next);
    window.requestAnimationFrame(() => bookSettingsBackButton.current?.focus());
  };

  const openSourceScope = (next: Extract<BookSettingsView, { kind: 'character-scope' | 'world-scope' }>) => {
    sourceScopeTrigger.current = rememberTrigger();
    sourceScopeScrollTop.current = bookSettingsDialog.current?.scrollTop ?? 0;
    setBookSettingsView(next);
    window.requestAnimationFrame(() => bookSettingsBackButton.current?.focus());
  };

  const returnBookSettingsParent = () => {
    if (bookSettingsView.kind === 'character-scope' || bookSettingsView.kind === 'world-scope') {
      const trigger = sourceScopeTrigger.current;
      const parent: BookSettingsView = bookSettingsView.kind === 'character-scope'
        ? { kind: 'character', id: bookSettingsView.id }
        : { kind: 'world', id: bookSettingsView.id };
      setBookSettingsView(parent);
      window.requestAnimationFrame(() => {
        if (bookSettingsDialog.current) bookSettingsDialog.current.scrollTop = sourceScopeScrollTop.current;
        if (trigger?.isConnected) trigger.focus();
      });
      return;
    }
    const trigger = bookSettingsPageTrigger.current;
    setBookSettingsView({ kind: 'root' });
    window.requestAnimationFrame(() => {
      if (bookSettingsDialog.current) bookSettingsDialog.current.scrollTop = bookSettingsScrollTop.current;
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const closeBookSettings = () => bookSettingsDialog.current?.close();

  const resetBookSettings = () => {
    setBookSettingsView({ kind: 'root' });
    sourceScopeTrigger.current = null;
    bookSettingsTrigger.current?.focus();
    props.onBookSettingsClose();
  };

  const setSettingsSectionOpen = (section: SettingsSection, open: boolean) => {
    setOpenSettingsSections((current) => {
      const next = new Set(current);
      if (open) next.add(section);
      else next.delete(section);
      return next;
    });
  };

  const settingsCharacter = bookSettingsView.kind === 'character' || bookSettingsView.kind === 'character-scope'
    ? props.book.characters.find((character) => character.id === bookSettingsView.id)
    : undefined;
  const settingsWorldRule = bookSettingsView.kind === 'world' || bookSettingsView.kind === 'world-scope'
    ? props.book.worldRules.find((rule) => rule.id === bookSettingsView.id)
    : undefined;
  const bookSettingsTitle = bookSettingsView.kind === 'outline'
    ? '剧情大纲'
    : bookSettingsView.kind === 'style'
      ? '写作风格指导'
      : bookSettingsView.kind === 'character'
        ? settingsCharacter?.name ?? '角色卡'
        : bookSettingsView.kind === 'world'
          ? settingsWorldRule?.title ?? '世界观设定'
          : bookSettingsView.kind === 'character-scope'
            ? '加载角色卡'
            : bookSettingsView.kind === 'world-scope'
              ? '加载世界观设定'
          : '本书设定';
  return (
    <div className={props.settingsOnly ? undefined : 'shelf-page'}>
      {!props.settingsOnly && <section className="shelf-content">
        <aside className="book-rail" aria-label="书目选择">
          <div className="book-library-controls">
            <details
              ref={bookLibraryDrawer}
              className="book-library-drawer"
              onToggle={(event) => {
                if (event.currentTarget.open) bookActionsMenu.current?.removeAttribute('open');
              }}
            >
              <summary ref={bookSelectorTrigger} className="book-selector-card">
                <BookOpenText aria-hidden="true" />
                <strong>{props.book.title}</strong>
                <ChevronDown className="book-selector-chevron" aria-hidden="true" />
              </summary>
              <div className="book-library-panel">
                <p className="book-list-label">切换书目</p>
                <div className="book-list" aria-label="全部书目">
                  {props.library.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-current={entry.id === props.book.id ? 'true' : undefined}
                      onClick={() => {
                        bookLibraryDrawer.current?.removeAttribute('open');
                        if (entry.id !== props.book.id) props.onOpenBook(entry.id);
                      }}
                    >
                      <BookOpenText aria-hidden="true" />
                      <span>{entry.title}</span>
                      {entry.id === props.book.id && <Check aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            </details>
            <details
              ref={bookActionsMenu}
              className="book-actions-menu"
              onToggle={(event) => {
                if (event.currentTarget.open) bookLibraryDrawer.current?.removeAttribute('open');
              }}
            >
              <summary
                ref={bookActionsTrigger}
                className="icon-button book-actions-trigger"
                aria-label={`管理当前书目：${props.book.title}`}
                title="管理当前书目"
              ><Ellipsis aria-hidden="true" /></summary>
              <div className="book-actions-menu-panel" aria-label="当前书目操作">
                <button
                  type="button"
                  className="book-menu-action"
                  aria-haspopup="dialog"
                  disabled={!canEdit}
                  onClick={() => openCurrentBookNameDialog({ kind: 'rename-book', value: props.book.title })}
                ><Pencil aria-hidden="true" /><span>修改书名</span></button>
                <button
                  type="button"
                  className="book-menu-action danger-icon"
                  aria-haspopup="dialog"
                  disabled={!canEdit}
                  title={!canEdit ? '当前页面为只读' : undefined}
                  onClick={openCurrentBookDeleteDialog}
                ><Trash2 aria-hidden="true" /><span>删除书目</span></button>
              </div>
            </details>
          </div>
        </aside>
        <h1 className="sr-only">故事书屋</h1>
        <section className={`directory-panel${selectionMode ? ' selection-mode' : ''}`} aria-label="章节目录">
            <div className="directory-toolbar">
              <button
                ref={bookSettingsTrigger}
                type="button"
                className="book-settings-button icon-button"
                onClick={() => {
                  setBookSettingsView({ kind: 'root' });
                  bookSettingsDialog.current?.showModal();
                }}
                aria-label="打开本书设定"
                title="本书设定"
              ><BookMarked aria-hidden="true" /></button>
              {canEdit && !selectionMode && <p className="directory-title-hint">双击或双点名称改名</p>}
              <div className="directory-actions">
                <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-chapter', value: '' })} disabled={!canEdit} aria-label="新建章节" title="新建章节"><FolderPlus aria-hidden="true" /></button>
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={selectionMode}
                  disabled={!canEdit}
                  onClick={() => {
                    setSelectionMode((current) => !current);
                    setSelection({ chapterIds: new Set(), sectionIds: new Set() });
                  }}
                  aria-label={selectionMode ? '退出选择' : '选择章节或小节'}
                  title={selectionMode ? '退出选择' : '选择'}
                >{selectionMode ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                <button
                  type="button"
                  className="icon-button danger-icon"
                  aria-haspopup="dialog"
                  disabled={!canEdit || (selection.chapterIds.size === 0 && selection.sectionIds.size === 0)}
                  onClick={() => openDeleteDialog({
                    kind: 'selection',
                    chapterIds: [...selection.chapterIds],
                    sectionIds: [...selection.sectionIds],
                    chapterCount: selection.chapterIds.size,
                    sectionCount: selection.sectionIds.size,
                  })}
                  aria-label="删除所选章节或小节"
                  title={selection.chapterIds.size || selection.sectionIds.size ? '删除所选内容' : '请先选择章节或小节'}
                ><Trash2 aria-hidden="true" /></button>
              </div>
            </div>
            <ol className="chapter-list">
              {props.book.chapters.map((chapter, chapterIndex) => {
                const chapterSelectionState: DirectorySelectionState = selection.chapterIds.has(chapter.id)
                  ? 'checked'
                  : chapter.sections.some((section) => selection.sectionIds.has(section.id)) ? 'mixed' : 'unchecked';
                return (
                  <li className="chapter-card" data-selected={selection.chapterIds.has(chapter.id) || undefined} key={chapter.id}>
                    <details open>
                      <summary
                        role={selectionMode ? 'checkbox' : undefined}
                        aria-checked={selectionMode
                          ? chapterSelectionState === 'mixed' ? 'mixed' : chapterSelectionState === 'checked'
                          : undefined}
                        aria-label={selectionMode ? `${selection.chapterIds.has(chapter.id) ? '取消选择' : '选择'}章节${chapter.title}` : undefined}
                        onClickCapture={(event) => {
                          if (selectionMode) return;
                          const target = event.target;
                          if (target instanceof Element
                            && target.closest('.chapter-title-cell')
                            && !(target instanceof HTMLInputElement)) {
                            event.preventDefault();
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
                              disabled={!canEdit}
                              onSave={(title) => props.onRenameChapter(chapter.id, title)}
                              className="chapter-inline-title"
                            />}
                          </strong>
                        </span>
                        <span>{chapter.sections.length} 节</span>
                      </summary>
                    {!selectionMode && <div className="chapter-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-haspopup="dialog"
                        disabled={!canEdit}
                        onClick={() => openNameDialog({ kind: 'new-section', value: '', chapterId: chapter.id, chapterTitle: chapter.title })}
                        aria-label={`在${chapter.title}中新建小节`}
                        title="新建小节"
                      ><FilePlus2 aria-hidden="true" /></button>
                    </div>}
                    <ol className="section-list">
                      {chapter.sections.map((section, sectionIndex) => (
                        <li className="section-row" data-selected={selection.sectionIds.has(section.id) || undefined} key={section.id}>
                          <button
                            className="section-open"
                            type="button"
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
                                disabled={!canEdit}
                                onSave={(title) => props.onRenameSection(chapter.id, section.id, title)}
                                className="section-inline-title"
                              />}
                            </strong>
                            <small><SectionMetrics content={section.content} /></small>
                          </span>
                        </li>
                      ))}
                      {chapter.sections.length === 0 && <li className="empty-section">这一章还没有小节。</li>}
                    </ol>
                    </details>
                  </li>
                );
              })}
            </ol>
        </section>
      </section>}

      <dialog
        className="name-dialog"
        ref={nameDialogRef}
        onClose={() => {
          setNameDialog(null);
          setNameOperation(idleDialogOperation);
          restoreDialogFocus(nameDialogTrigger);
        }}
        onCancel={(event) => { event.preventDefault(); closeNameDialog(); }}
        aria-labelledby="name-dialog-title"
        aria-busy={nameOperation.phase === 'pending' || undefined}
      >
        <form onSubmit={submitNameDialog}>
          <header className="dialog-heading">
            <h2 id="name-dialog-title">{nameDialogCopy.title}</h2>
            <button type="button" className="icon-button" disabled={nameOperation.phase === 'pending'} onClick={closeNameDialog} aria-label={`取消${nameDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
          </header>
          {nameOperation.phase === 'idle' ? (
            <div className="name-dialog-body">
              <label htmlFor="name-dialog-input">{nameDialogCopy.label}</label>
              <input
                id="name-dialog-input"
                ref={nameInputRef}
                required
                name="item-name"
                autoComplete="off"
                value={nameDialog?.value ?? ''}
                onChange={(event) => setNameDialog((current) => current ? { ...current, value: event.target.value } : current)}
                placeholder={nameDialogCopy.placeholder}
              />
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={closeNameDialog}>取消</button>
                <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />{nameDialogCopy.action}</button>
              </div>
            </div>
          ) : (
            <div className="name-dialog-body dialog-operation-body">
              <DialogOperationStatus
                state={nameOperation}
                onReturn={() => {
                  setNameOperation(idleDialogOperation);
                  window.requestAnimationFrame(() => nameInputRef.current?.focus());
                }}
              />
            </div>
          )}
        </form>
      </dialog>

      <dialog
        className="confirm-dialog"
        ref={deleteDialogRef}
        onClose={() => {
          setDeleteDialog(null);
          setDeleteOperation(idleDialogOperation);
          restoreDialogFocus(deleteDialogTrigger);
        }}
        onCancel={(event) => { event.preventDefault(); closeDeleteDialog(); }}
        aria-labelledby="confirm-dialog-title"
        aria-describedby={deleteOperation.phase === 'idle' ? 'confirm-dialog-description' : undefined}
        aria-busy={deleteOperation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id="confirm-dialog-title">{deleteDialogCopy.title}</h2>
          <button type="button" className="icon-button" disabled={deleteOperation.phase === 'pending'} onClick={closeDeleteDialog} aria-label={`取消${deleteDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {deleteOperation.phase === 'idle' ? (
            <>
              <p id="confirm-dialog-description">{deleteDialogCopy.message}</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={closeDeleteDialog}>取消</button>
                <button type="button" className="danger-action button-with-icon" onClick={() => void confirmDelete()}><Trash2 aria-hidden="true" />{deleteDialogCopy.action}</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={deleteOperation} onReturn={() => setDeleteOperation(idleDialogOperation)} />
          )}
        </div>
      </dialog>

      <dialog
        className="book-settings-drawer"
        ref={bookSettingsDialog}
        onClick={(event) => { if (event.target === event.currentTarget) closeBookSettings(); }}
        onClose={resetBookSettings}
        onCancel={(event) => { event.preventDefault(); closeBookSettings(); }}
        aria-labelledby="book-settings-title"
      >
        <header className={`drawer-heading${bookSettingsView.kind !== 'root' ? ' compact-book-settings-heading' : ''}`}>
          {bookSettingsView.kind !== 'root' ? (
            <>
              <button
                ref={bookSettingsBackButton}
                type="button"
                className="icon-button"
                onClick={returnBookSettingsParent}
                aria-label="返回本书设定"
                title="返回本书设定"
              ><ArrowLeft aria-hidden="true" /></button>
              <h2 id="book-settings-title" className="sr-only">{bookSettingsTitle}</h2>
            </>
          ) : (
            <div className="drawer-title-row">
              <div>
                <p className="eyebrow">全局指引 · 角色 · 世界</p>
                <h2 id="book-settings-title">本书设定</h2>
              </div>
            </div>
          )}
          <button type="button" className="icon-button" autoFocus={bookSettingsView.kind === 'root'} onClick={closeBookSettings} aria-label="关闭本书设定" title="关闭本书设定"><X aria-hidden="true" /></button>
        </header>
        <div className="book-settings-content">
          {bookSettingsView.kind === 'root' ? (
            <section className="prompt-settings" aria-labelledby="prompt-settings-heading">
              <h2 id="prompt-settings-heading" className="sr-only">本书设定内容</h2>

              <details className="source-group-drawer global-guidance-drawer" open={openSettingsSections.has('guidance')} onToggle={(event) => setSettingsSectionOpen('guidance', event.currentTarget.open)}>
                <summary>
                  <ScrollText aria-hidden="true" />
                  <span><strong>全局指引</strong><small>作用于本书全部章与节</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="guide-link-list">
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'style' })}>
                    <span><strong>写作风格指导</strong><small>指定行文风格、语气和语言表达。</small></span>
                    <ChevronRight className="icon-directional" aria-hidden="true" />
                  </button>
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'outline' })}>
                    <span><strong>剧情大纲</strong><small>规划情节走向，生成时作为本书的长期指导。</small></span>
                    <ChevronRight className="icon-directional" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="source-group-drawer" open={openSettingsSections.has('characters')} onToggle={(event) => setSettingsSectionOpen('characters', event.currentTarget.open)}>
                <summary>
                  <UsersRound aria-hidden="true" />
                  <span><strong>角色卡</strong><small>{props.book.characters.length} 个角色</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="source-group-content">
                  <div className="source-group-actions">
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-character', value: '' })} disabled={!canEdit} aria-label="新建角色卡" title="新建角色卡"><Plus aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'character'}
                      disabled={!canEdit}
                      onClick={() => toggleSourceSelectionMode('character')}
                      aria-label={sourceSelectionMode === 'character' ? '退出角色卡选择' : '选择角色卡'}
                      title={sourceSelectionMode === 'character' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'character' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={!canEdit || sourceSelectionMode !== 'character' || selectedSourceIds.size === 0}
                      onClick={() => openDeleteDialog({ kind: 'source-selection', sourceKind: 'character', ids: [...selectedSourceIds] })}
                      aria-label="删除所选角色卡"
                      title={sourceSelectionMode === 'character' && selectedSourceIds.size ? '删除所选角色卡' : '请先选择角色卡'}
                    ><Trash2 aria-hidden="true" /></button>
                  </div>
                  <div className="source-list">
                    {props.book.characters.map((character) => (
                      <button
                        type="button"
                        className={`source-open-row${sourceSelectionMode === 'character' ? ' source-selection-row' : ''}`}
                        data-selected={selectedSourceIds.has(character.id) || undefined}
                        aria-pressed={sourceSelectionMode === 'character' ? selectedSourceIds.has(character.id) : undefined}
                        onClick={() => sourceSelectionMode === 'character'
                          ? setSelectedSourceIds((current) => toggleSourceSelection(current, character.id))
                          : openBookSettingsPage({ kind: 'character', id: character.id })}
                        aria-label={sourceSelectionMode === 'character'
                          ? `${selectedSourceIds.has(character.id) ? '取消选择' : '选择'}角色卡：${character.name}`
                          : `打开角色卡：${character.name}`}
                        key={character.id}
                      >
                        {sourceSelectionMode === 'character' && (
                          <DirectorySelectionIndicator state={selectedSourceIds.has(character.id) ? 'checked' : 'unchecked'} />
                        )}
                        <span className="source-card-name"><strong>{character.name}</strong><small>{character.role}</small></span>
                        {sourceSelectionMode !== 'character' && <ChevronRight className="icon-directional" aria-hidden="true" />}
                      </button>
                    ))}
                    {props.book.characters.length === 0 && <p className="empty-source">还没有角色卡。</p>}
                  </div>
                </div>
              </details>

              <details className="source-group-drawer" open={openSettingsSections.has('world')} onToggle={(event) => setSettingsSectionOpen('world', event.currentTarget.open)}>
                <summary>
                  <Globe2 aria-hidden="true" />
                  <span><strong>世界观设定</strong><small>{props.book.worldRules.length} 条设定</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="source-group-content">
                  <div className="source-group-actions">
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-world', value: '' })} disabled={!canEdit} aria-label="新建世界观设定" title="新建世界观设定"><Plus aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'world'}
                      disabled={!canEdit}
                      onClick={() => toggleSourceSelectionMode('world')}
                      aria-label={sourceSelectionMode === 'world' ? '退出世界观设定选择' : '选择世界观设定'}
                      title={sourceSelectionMode === 'world' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'world' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={!canEdit || sourceSelectionMode !== 'world' || selectedSourceIds.size === 0}
                      onClick={() => openDeleteDialog({ kind: 'source-selection', sourceKind: 'world', ids: [...selectedSourceIds] })}
                      aria-label="删除所选世界观设定"
                      title={sourceSelectionMode === 'world' && selectedSourceIds.size ? '删除所选世界观设定' : '请先选择世界观设定'}
                    ><Trash2 aria-hidden="true" /></button>
                  </div>
                  <div className="source-list">
                    {props.book.worldRules.map((rule) => (
                      <button
                        type="button"
                        className={`source-open-row${sourceSelectionMode === 'world' ? ' source-selection-row' : ''}`}
                        data-selected={selectedSourceIds.has(rule.id) || undefined}
                        aria-pressed={sourceSelectionMode === 'world' ? selectedSourceIds.has(rule.id) : undefined}
                        onClick={() => sourceSelectionMode === 'world'
                          ? setSelectedSourceIds((current) => toggleSourceSelection(current, rule.id))
                          : openBookSettingsPage({ kind: 'world', id: rule.id })}
                        aria-label={sourceSelectionMode === 'world'
                          ? `${selectedSourceIds.has(rule.id) ? '取消选择' : '选择'}世界观设定：${rule.title}`
                          : `打开世界观设定：${rule.title}`}
                        key={rule.id}
                      >
                        {sourceSelectionMode === 'world' && (
                          <DirectorySelectionIndicator state={selectedSourceIds.has(rule.id) ? 'checked' : 'unchecked'} />
                        )}
                        <span className="source-card-name"><strong>{rule.title}</strong><small>世界观</small></span>
                        {sourceSelectionMode !== 'world' && <ChevronRight className="icon-directional" aria-hidden="true" />}
                      </button>
                    ))}
                    {props.book.worldRules.length === 0 && <p className="empty-source">还没有世界观设定。</p>}
                  </div>
                </div>
              </details>

            </section>
          ) : bookSettingsView.kind === 'outline' ? (
            <GuideEditor
              key="outline"
              id="plot-outline"
              title="剧情大纲"
              description="记录本书的情节走向、阶段目标与关键转折；生成时会作为全书的长期指导。"
              placeholder="记录主要情节、阶段目标与关键转折……"
              value={props.book.plotOutline ?? ''}
              canEdit={canEdit}
              onSave={(value) => props.onBookChange((current) => ({ ...current, plotOutline: value }))}
            />
          ) : bookSettingsView.kind === 'style' ? (
            <GuideEditor
              key="style"
              id="global-guidance"
              title="写作风格指导"
              description="指定本书的行文风格、语气和语言表达；适用于书内全部章节与小节。"
              placeholder="例如：克制、清澈；少用解释性旁白……"
              value={props.book.writingBrief}
              canEdit={canEdit}
              onSave={(value) => props.onBookChange((current) => ({ ...current, writingBrief: value }))}
            />
          ) : bookSettingsView.kind === 'character' ? (
            settingsCharacter
              ? <CharacterEditor
                  key={settingsCharacter.id}
                  bookTitle={props.book.title}
                  character={settingsCharacter}
                  onSave={(patch) => props.onBookChange((current) => ({
                    ...current,
                    characters: current.characters.map((item) => item.id === settingsCharacter.id
                      ? { ...item, ...patch, title: patch.name }
                      : item),
                  }))}
                  onOpenScope={() => openSourceScope({ kind: 'character-scope', id: settingsCharacter.id })}
                  canEdit={canEdit}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : bookSettingsView.kind === 'world' ? (
            settingsWorldRule
              ? <WorldRuleEditor
                  key={settingsWorldRule.id}
                  bookTitle={props.book.title}
                  rule={settingsWorldRule}
                  onSave={(patch) => props.onBookChange((current) => ({
                    ...current,
                    worldRules: current.worldRules.map((item) => item.id === settingsWorldRule.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                  onOpenScope={() => openSourceScope({ kind: 'world-scope', id: settingsWorldRule.id })}
                  canEdit={canEdit}
                />
              : <MissingSettingsItem label="世界观设定" />
          ) : bookSettingsView.kind === 'character-scope' ? (
            settingsCharacter
              ? <SourceLoadScopePage
                  key={`character-scope-${settingsCharacter.id}`}
                  sourceId={settingsCharacter.id}
                  title="加载角色卡"
                  bookTitle={props.book.title}
                  enabled={settingsCharacter.includeInPrompt}
                  chapters={props.book.chapters}
                  loadedSectionIds={settingsCharacter.loadedSectionIds}
                  canEdit={canEdit}
                  onConfirm={(patch) => props.onBookChange((current) => ({
                    ...current,
                    characters: current.characters.map((item) => item.id === settingsCharacter.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : (
            settingsWorldRule
              ? <SourceLoadScopePage
                  key={`world-scope-${settingsWorldRule.id}`}
                  sourceId={settingsWorldRule.id}
                  title="加载世界观设定"
                  bookTitle={props.book.title}
                  enabled={settingsWorldRule.includeInPrompt}
                  chapters={props.book.chapters}
                  loadedSectionIds={settingsWorldRule.loadedSectionIds}
                  canEdit={canEdit}
                  onConfirm={(patch) => props.onBookChange((current) => ({
                    ...current,
                    worldRules: current.worldRules.map((item) => item.id === settingsWorldRule.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                />
              : <MissingSettingsItem label="世界观设定" />
          )}
        </div>
      </dialog>
    </div>
  );
}
