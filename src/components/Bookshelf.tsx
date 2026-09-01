import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  ArrowLeft,
  BookMarked,
  BookOpenText,
  BookPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheckBig,
  Ellipsis,
  FilePlus2,
  FolderPlus,
  Globe2,
  Layers3,
  ListChecks,
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
import type { Book, BookIndexEntry, CharacterCard, WorldRule } from '../types';

type SettingsSection = 'guidance' | 'characters' | 'world';
type BookSettingsView =
  | { kind: 'root' }
  | { kind: 'outline' }
  | { kind: 'style' }
  | { kind: 'character'; id: string }
  | { kind: 'world'; id: string };

function GuideEditor({ title, description, placeholder, value, onChange }: {
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <article className="guide-editor-page">
      <header className="guide-editor-heading">
        <p className="eyebrow">全局指引 · 作用于本书全部章与节</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <label className="guide-editor-field">
        <span className="sr-only">{title}</span>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck />
      </label>
    </article>
  );
}

function SourceLoadScope({
  sourceId,
  title,
  enabled,
  chapters,
  loadedSectionIds,
  onEnabledChange,
  onScopeChange,
}: {
  sourceId: string;
  title: string;
  enabled: boolean;
  chapters: Book['chapters'];
  loadedSectionIds?: string[];
  onEnabledChange: (enabled: boolean) => void;
  onScopeChange: (loadedSectionIds: string[] | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const sectionIds = chapters.flatMap((chapter) => chapter.sections.map((section) => section.id));
  const validSectionIds = new Set(sectionIds);
  const loadsEverywhere = loadedSectionIds === undefined;
  const selectedIds = new Set((loadedSectionIds ?? sectionIds).filter((id) => validSectionIds.has(id)));
  const scopeSummary = `${selectedIds.size}/${sectionIds.length} 小节`;

  const toggleSection = (sectionId: string, selected: boolean) => {
    const nextIds = new Set(selectedIds);
    if (selected) nextIds.add(sectionId);
    else nextIds.delete(sectionId);
    const next = sectionIds.filter((id) => nextIds.has(id));
    onScopeChange(next.length === sectionIds.length ? undefined : next);
  };

  const panelId = `${sourceId}-load-scope`;

  return (
    <div className="source-scope-drawer" data-open={open || undefined} data-enabled={enabled || undefined}>
      <div className="source-load-tab">
        <label className="source-load-toggle" title={title}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span className="sr-only">{title}</span>
        </label>
        <button
          type="button"
          className="source-scope-disclosure"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <span><strong>{title}</strong><small>加载范围 · {scopeSummary}</small></span>
          <ChevronDown aria-hidden="true" />
        </button>
        <button
          type="button"
          className="source-scope-all"
          aria-pressed={loadsEverywhere}
          aria-label="全书全部小节"
          title="全书全部小节"
          onClick={() => onScopeChange(loadsEverywhere ? [] : undefined)}
        >
          <BookOpenText aria-hidden="true" />
          <span>全书</span>
        </button>
      </div>
      {open && (
        <div className="source-scope-content" id={panelId}>
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
                    />
                    <span>{section.title}</span>
                  </label>
                ))}
                {chapter.sections.length === 0 && <small className="source-scope-empty">这一章还没有小节。</small>}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterEditor({ bookTitle, chapters, character, onChange }: {
  bookTitle: string;
  chapters: Book['chapters'];
  character: CharacterCard;
  onChange: (patch: Partial<CharacterCard>) => void;
}) {
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 角色卡</p>
        <h1>{character.name}</h1>
        <p>这里的资料只属于当前书目，并在生成时描述这个角色。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${character.name}角色卡内容`}>
        <label>角色名<input value={character.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
        <label>角色要点<input value={character.role} onChange={(event) => onChange({ role: event.target.value })} /></label>
        <label>角色设定<textarea value={character.content} onChange={(event) => onChange({ content: event.target.value })} spellCheck /></label>
        <SourceLoadScope
          sourceId={character.id}
          title="加载角色卡"
          enabled={character.includeInPrompt}
          chapters={chapters}
          loadedSectionIds={character.loadedSectionIds}
          onEnabledChange={(includeInPrompt) => onChange({ includeInPrompt })}
          onScopeChange={(loadedSectionIds) => onChange({ loadedSectionIds })}
        />
      </section>
    </article>
  );
}

function WorldRuleEditor({ bookTitle, chapters, rule, onChange }: {
  bookTitle: string;
  chapters: Book['chapters'];
  rule: WorldRule;
  onChange: (patch: Partial<WorldRule>) => void;
}) {
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 世界观设定</p>
        <h1>{rule.title}</h1>
        <p>这条设定只属于当前书目，可按小节决定是否加载。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${rule.title}世界观设定内容`}>
        <label>设定名称<input value={rule.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
        <label>设定内容<textarea value={rule.content} onChange={(event) => onChange({ content: event.target.value })} spellCheck /></label>
        <SourceLoadScope
          sourceId={rule.id}
          title="加载世界观设定"
          enabled={rule.includeInPrompt}
          chapters={chapters}
          loadedSectionIds={rule.loadedSectionIds}
          onEnabledChange={(includeInPrompt) => onChange({ includeInPrompt })}
          onScopeChange={(loadedSectionIds) => onChange({ loadedSectionIds })}
        />
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
  onCreateBook: (title: string) => void;
  onDeleteBook: () => void;
  onBookChange: (recipe: (current: Book) => Book) => void;
  onAddCharacter: (name: string) => void;
  onAddWorldRule: (title: string) => void;
  onAddChapter: (title: string) => void;
  onAddSection: (chapterId: string, title: string) => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  onDeleteSelection: (selection: DirectorySelection) => void;
  onDeleteSources: (kind: SourceSelectionKind, ids: Set<string>) => void;
  onPlotOutlineChange: (value: string) => void;
  onWritingBriefChange: (value: string) => void;
  onCharacterChange: (id: string, patch: Partial<CharacterCard>) => void;
  onWorldRuleChange: (id: string, patch: Partial<WorldRule>) => void;
}

type NameDialogState =
  | { kind: 'new-book' | 'rename-book' | 'new-chapter' | 'new-character' | 'new-world'; value: string }
  | { kind: 'new-section'; value: string; chapterId: string; chapterTitle: string }
  | { kind: 'rename-chapter'; value: string; chapterId: string };

type DeleteDialogState =
  | { kind: 'book'; id: string; title: string }
  | { kind: 'selection'; chapterIds: string[]; sectionIds: string[]; chapterCount: number; sectionCount: number }
  | { kind: 'source-selection'; sourceKind: SourceSelectionKind; ids: string[] };

export function Bookshelf(props: BookshelfProps) {
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
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
  const bookSettingsScrollTop = useRef(0);
  const bookSettingsBackButton = useRef<HTMLButtonElement>(null);
  const bookLibraryDrawer = useRef<HTMLDetailsElement>(null);
  const bookSelectorTrigger = useRef<HTMLElement>(null);
  const bookActionsMenu = useRef<HTMLDetailsElement>(null);
  const bookActionsTrigger = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!nameDialog || !nameDialogRef.current || nameDialogRef.current.open) return undefined;
    nameDialogRef.current.showModal();
    const focusNameInput = () => {
      nameInputRef.current?.focus();
      if (nameDialog.kind === 'rename-book' || nameDialog.kind === 'rename-chapter') nameInputRef.current?.select();
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
    nameDialogTrigger.current = rememberTrigger();
    setNameDialog(dialog);
  };
  const openDeleteDialog = (dialog: DeleteDialogState) => {
    deleteDialogTrigger.current = rememberTrigger();
    setDeleteDialog(dialog);
  };
  const openCurrentBookNameDialog = (dialog: NameDialogState) => {
    nameDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
    setNameDialog(dialog);
  };
  const openCurrentBookDeleteDialog = () => {
    deleteDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
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
      case 'rename-chapter': return { title: '修改章节名称', label: '章节名称', placeholder: '输入章节名称', action: '保存' };
      case 'new-character': return { title: '新建角色卡', label: '角色名称', placeholder: '输入角色名称', action: '确认新建' };
      case 'new-world': return { title: '新建世界观设定', label: '设定名称', placeholder: '输入设定名称', action: '确认新建' };
      default: return { title: '命名', label: '名称', placeholder: '输入名称', action: '确认' };
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

  const submitNameDialog = (event: FormEvent) => {
    event.preventDefault();
    if (!nameDialog) return;
    const value = nameDialog.value.trim();
    if (!value) return;
    switch (nameDialog.kind) {
      case 'new-book': props.onCreateBook(value); break;
      case 'rename-book': props.onBookChange((current) => ({ ...current, title: value })); break;
      case 'new-chapter': props.onAddChapter(value); break;
      case 'new-section': props.onAddSection(nameDialog.chapterId, value); break;
      case 'rename-chapter': props.onRenameChapter(nameDialog.chapterId, value); break;
      case 'new-character': props.onAddCharacter(value); break;
      case 'new-world': props.onAddWorldRule(value); break;
    }
    nameDialogRef.current?.close();
  };

  const confirmDelete = () => {
    if (!deleteDialog) return;
    if (deleteDialog.kind === 'book') props.onDeleteBook();
    if (deleteDialog.kind === 'selection') {
      props.onDeleteSelection({
        chapterIds: new Set(deleteDialog.chapterIds),
        sectionIds: new Set(deleteDialog.sectionIds),
      });
      setSelectionMode(false);
      setSelection({ chapterIds: new Set(), sectionIds: new Set() });
    }
    if (deleteDialog.kind === 'source-selection') {
      props.onDeleteSources(deleteDialog.sourceKind, new Set(deleteDialog.ids));
      setSourceSelectionMode(null);
      setSelectedSourceIds(new Set());
    }
    deleteDialogRef.current?.close();
  };

  const toggleSourceSelectionMode = (kind: SourceSelectionKind) => {
    setSourceSelectionMode((current) => current === kind ? null : kind);
    setSelectedSourceIds(new Set());
  };

  const openBookSettingsPage = (next: BookSettingsView) => {
    bookSettingsPageTrigger.current = rememberTrigger();
    bookSettingsScrollTop.current = bookSettingsDialog.current?.scrollTop ?? 0;
    setBookSettingsView(next);
    window.requestAnimationFrame(() => bookSettingsBackButton.current?.focus());
  };

  const returnBookSettingsRoot = () => {
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

  const settingsCharacter = bookSettingsView.kind === 'character'
    ? props.book.characters.find((character) => character.id === bookSettingsView.id)
    : undefined;
  const settingsWorldRule = bookSettingsView.kind === 'world'
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
          : '本书设定';
  return (
    <div className="shelf-page">
      <section className="shelf-content">
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
                  onClick={() => openCurrentBookNameDialog({ kind: 'rename-book', value: props.book.title })}
                ><Pencil aria-hidden="true" /><span>修改书名</span></button>
                <button
                  type="button"
                  className="book-menu-action danger-icon"
                  aria-haspopup="dialog"
                  disabled={props.library.length <= 1}
                  title={props.library.length <= 1 ? '书库至少保留一本书' : undefined}
                  onClick={openCurrentBookDeleteDialog}
                ><Trash2 aria-hidden="true" /><span>删除书目</span></button>
              </div>
            </details>
          </div>
        </aside>
        <h1 className="sr-only">故事书架</h1>
        <section className={`directory-panel${selectionMode ? ' selection-mode' : ''}`} aria-label="章节目录">
            <div className="directory-toolbar">
              <button
                ref={bookSettingsTrigger}
                type="button"
                className="book-settings-button button-with-icon"
                onClick={() => {
                  setBookSettingsView({ kind: 'root' });
                  bookSettingsDialog.current?.showModal();
                }}
                aria-label="打开本书设定"
                title="本书设定"
              ><BookMarked aria-hidden="true" /><span>设定</span></button>
              <div className="directory-actions">
                <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-chapter', value: '' })} aria-label="新建章节" title="新建章节"><FolderPlus aria-hidden="true" /></button>
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={selectionMode}
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
                  disabled={selection.chapterIds.size === 0 && selection.sectionIds.size === 0}
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
              {props.book.chapters.map((chapter, chapterIndex) => (
                <li className="chapter-card" data-selected={selection.chapterIds.has(chapter.id) || undefined} key={chapter.id}>
                  <details open>
                    <summary
                      role={selectionMode ? 'checkbox' : undefined}
                      aria-checked={selectionMode ? selection.chapterIds.has(chapter.id) : undefined}
                      aria-label={selectionMode ? `${selection.chapterIds.has(chapter.id) ? '取消选择' : '选择'}章节${chapter.title}` : undefined}
                      onClick={(event) => {
                        if (!selectionMode) return;
                        event.preventDefault();
                        setSelection((current) => toggleChapterSelection(props.book, current, chapter.id));
                      }}
                    >
                      <span className="chapter-index">
                        {selectionMode
                          ? selection.chapterIds.has(chapter.id) ? <CircleCheckBig aria-hidden="true" /> : <Circle aria-hidden="true" />
                          : String(chapterIndex + 1).padStart(2, '0')}
                      </span>
                      <span><strong>{chapter.title}</strong></span>
                      <span>{chapter.sections.length} 节</span>
                    </summary>
                    {!selectionMode && <div className="chapter-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-haspopup="dialog"
                        onClick={() => openNameDialog({ kind: 'new-section', value: '', chapterId: chapter.id, chapterTitle: chapter.title })}
                        aria-label={`在${chapter.title}中新建小节`}
                        title="新建小节"
                      ><FilePlus2 aria-hidden="true" /></button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-haspopup="dialog"
                        onClick={() => openNameDialog({ kind: 'rename-chapter', value: chapter.title, chapterId: chapter.id })}
                        aria-label={`修改章节名称：${chapter.title}`}
                        title="修改章节名称"
                      ><Pencil aria-hidden="true" /></button>
                    </div>}
                    <ol className="section-list">
                      {chapter.sections.map((section, sectionIndex) => (
                        <li className="section-row" data-selected={selection.sectionIds.has(section.id) || undefined} key={section.id}>
                          <button
                            className="section-open"
                            type="button"
                            aria-current={!selectionMode && section.id === props.selectedSectionId ? 'true' : undefined}
                            aria-pressed={selectionMode ? selection.sectionIds.has(section.id) : undefined}
                            onClick={() => selectionMode
                              ? setSelection((current) => toggleSectionSelection(props.book, current, section.id))
                              : props.onOpenSection(section.id)}
                            aria-label={selectionMode ? `${selection.sectionIds.has(section.id) ? '取消选择' : '选择'}小节${section.title}` : undefined}
                          >
                            <span className="section-index">
                              {selectionMode
                                ? selection.sectionIds.has(section.id) ? <CircleCheckBig aria-hidden="true" /> : <Circle aria-hidden="true" />
                                : `${chapterIndex + 1}.${sectionIndex + 1}`}
                            </span>
                            <span><strong>{section.title}</strong><small>
                              {countWords(section.content).toLocaleString('zh-CN')} 字 | 约 {compactTokenCount(estimateTokens(section.content))} tokens
                            </small></span>
                            {!selectionMode && <ChevronRight className="icon-directional" aria-hidden="true" />}
                          </button>
                        </li>
                      ))}
                      {chapter.sections.length === 0 && <li className="empty-section">这一章还没有小节。</li>}
                    </ol>
                  </details>
                </li>
              ))}
            </ol>
        </section>
      </section>

      <dialog
        className="name-dialog"
        ref={nameDialogRef}
        onClose={() => {
          setNameDialog(null);
          restoreDialogFocus(nameDialogTrigger);
        }}
        onCancel={(event) => { event.preventDefault(); nameDialogRef.current?.close(); }}
        aria-labelledby="name-dialog-title"
      >
        <form onSubmit={submitNameDialog}>
          <header className="dialog-heading">
            <h2 id="name-dialog-title">{nameDialogCopy.title}</h2>
            <button type="button" className="icon-button" onClick={() => nameDialogRef.current?.close()} aria-label={`取消${nameDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
          </header>
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
              <button type="button" className="quiet-action" onClick={() => nameDialogRef.current?.close()}>取消</button>
              <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />{nameDialogCopy.action}</button>
            </div>
          </div>
        </form>
      </dialog>

      <dialog
        className="confirm-dialog"
        ref={deleteDialogRef}
        onClose={() => {
          setDeleteDialog(null);
          restoreDialogFocus(deleteDialogTrigger);
        }}
        onCancel={(event) => { event.preventDefault(); deleteDialogRef.current?.close(); }}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <header className="dialog-heading">
          <h2 id="confirm-dialog-title">{deleteDialogCopy.title}</h2>
          <button type="button" className="icon-button" onClick={() => deleteDialogRef.current?.close()} aria-label={`取消${deleteDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          <p id="confirm-dialog-description">{deleteDialogCopy.message}</p>
          <div className="dialog-actions">
            <button type="button" className="quiet-action" onClick={() => deleteDialogRef.current?.close()}>取消</button>
            <button type="button" className="danger-action button-with-icon" onClick={confirmDelete}><Trash2 aria-hidden="true" />{deleteDialogCopy.action}</button>
          </div>
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
                onClick={returnBookSettingsRoot}
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
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-character', value: '' })} aria-label="新建角色卡" title="新建角色卡"><Plus aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'character'}
                      onClick={() => toggleSourceSelectionMode('character')}
                      aria-label={sourceSelectionMode === 'character' ? '退出角色卡选择' : '选择角色卡'}
                      title={sourceSelectionMode === 'character' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'character' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={sourceSelectionMode !== 'character' || selectedSourceIds.size === 0}
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
                          <span className="source-selection-icon">
                            {selectedSourceIds.has(character.id) ? <CircleCheckBig aria-hidden="true" /> : <Circle aria-hidden="true" />}
                          </span>
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
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-world', value: '' })} aria-label="新建世界观设定" title="新建世界观设定"><Plus aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'world'}
                      onClick={() => toggleSourceSelectionMode('world')}
                      aria-label={sourceSelectionMode === 'world' ? '退出世界观设定选择' : '选择世界观设定'}
                      title={sourceSelectionMode === 'world' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'world' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={sourceSelectionMode !== 'world' || selectedSourceIds.size === 0}
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
                          <span className="source-selection-icon">
                            {selectedSourceIds.has(rule.id) ? <CircleCheckBig aria-hidden="true" /> : <Circle aria-hidden="true" />}
                          </span>
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
              title="剧情大纲"
              description="记录本书的情节走向、阶段目标与关键转折；生成时会作为全书的长期指导。"
              placeholder="记录主要情节、阶段目标与关键转折……"
              value={props.book.plotOutline ?? ''}
              onChange={props.onPlotOutlineChange}
            />
          ) : bookSettingsView.kind === 'style' ? (
            <GuideEditor
              title="写作风格指导"
              description="指定本书的行文风格、语气和语言表达；适用于书内全部章节与小节。"
              placeholder="例如：克制、清澈；少用解释性旁白……"
              value={props.book.writingBrief}
              onChange={props.onWritingBriefChange}
            />
          ) : bookSettingsView.kind === 'character' ? (
            settingsCharacter
              ? <CharacterEditor
                  bookTitle={props.book.title}
                  chapters={props.book.chapters}
                  character={settingsCharacter}
                  onChange={(patch) => props.onCharacterChange(settingsCharacter.id, patch)}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : (
            settingsWorldRule
              ? <WorldRuleEditor
                  bookTitle={props.book.title}
                  chapters={props.book.chapters}
                  rule={settingsWorldRule}
                  onChange={(patch) => props.onWorldRuleChange(settingsWorldRule.id, patch)}
                />
              : <MissingSettingsItem label="世界观设定" />
          )}
        </div>
      </dialog>
    </div>
  );
}
