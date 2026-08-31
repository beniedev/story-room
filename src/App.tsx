import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookMarked,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheckBig,
  Download,
  FilePlus2,
  FolderPlus,
  Globe2,
  KeyRound,
  Layers3,
  Library,
  ListChecks,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { api } from './api';
import { buildContextPlan as composeContextPlan } from './contextPlan';
import {
  deleteDirectorySelection,
  toggleChapterSelection,
  toggleSectionSelection,
  type DirectorySelection,
} from './directorySelection';
import {
  deleteSourceSelection,
  toggleSourceSelection,
  type SourceSelectionKind,
} from './sourceSelection';
import {
  readProviderProfiles,
  upsertProviderProfile,
  type ProviderProfile,
} from './providerProfiles';
import type {
  Book,
  BookIndexEntry,
  CharacterCard,
  ContextPlan,
  GenerationMode,
  PromptCacheBand,
  SectionBlock,
  ThemeName,
  WorldRule,
} from './types';

type ViewName = 'write' | 'shelf';
type SettingsSection = 'guidance' | 'characters' | 'world';
type BookSettingsView =
  | { kind: 'root' }
  | { kind: 'outline' }
  | { kind: 'style' }
  | { kind: 'character'; id: string }
  | { kind: 'world'; id: string };

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const bookCacheKey = (bookId: string) => `story-native:book:${bookId}`;
const providerProfilesKey = 'story-native:provider-profiles';
const activeProviderProfileKey = 'story-native:active-provider-profile';
const generalPromptOrder = [
  { id: 'template-contract', title: '正文合同', reason: '连续小说正文与 Book 隔离底线', cacheBand: 'stable' },
  { id: 'template-book', title: '当前书目', reason: '锁定本次写作所属的书', cacheBand: 'stable' },
  { id: 'template-style', title: '写作风格指导', reason: '全书共用的行文风格', cacheBand: 'stable' },
  { id: 'template-world', title: '世界观条例', reason: '本书已启用的世界规则', cacheBand: 'stable' },
  { id: 'template-characters', title: '角色卡', reason: '本书已启用或当前必需的角色资料', cacheBand: 'stable' },
  { id: 'template-outline', title: '剧情大纲', reason: '全书共用的剧情方向', cacheBand: 'stable' },
  { id: 'template-mode', title: '作者 / 角色模式', reason: '本次写作的权限与视角', cacheBand: 'session' },
  { id: 'template-note', title: '本节注释', reason: '只指导当前小节，位于正文前', cacheBand: 'dynamic' },
  { id: 'template-manuscript', title: '当前正文', reason: '选中小节的正文末尾', cacheBand: 'dynamic' },
  { id: 'template-instruction', title: '本轮指令', reason: '当前这一次的写作输入', cacheBand: 'dynamic' },
] satisfies Array<{ id: string; title: string; reason: string; cacheBand: PromptCacheBand }>;

const cacheBandLabel = (band: PromptCacheBand) => (
  band === 'stable' ? '稳定前缀' : band === 'session' ? '模式层' : '每轮变化'
);

const promptShareLabel = (share: number) => (
  share < 1 ? '<1%' : share < 10 ? `${share.toFixed(1)}%` : `${Math.round(share)}%`
);

const compactTokenCount = (value: number) => new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(value).toLowerCase();

const sectionBlocks = (section: Book['chapters'][number]['sections'][number]): SectionBlock[] => {
  if (section.blocks?.length) return section.blocks;
  return section.content.trim()
    ? [{ id: `${section.id}-legacy-block`, kind: 'assistant', content: section.content }]
    : [];
};

const blocksAsContent = (blocks: SectionBlock[]) => blocks
  .map((item) => item.content.trim())
  .filter(Boolean)
  .join('\n\n');

const isCachedBook = (value: unknown, bookId: string): value is Book => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Book>;
  return candidate.id === bookId
    && typeof candidate.title === 'string'
    && typeof candidate.updatedAt === 'string'
    && Array.isArray(candidate.characters)
    && Array.isArray(candidate.worldRules)
    && Array.isArray(candidate.canonFacts)
    && Array.isArray(candidate.summaries)
    && Array.isArray(candidate.chapters)
    && Array.isArray(candidate.branches);
};

const readCachedBook = (bookId: string) => {
  try {
    const value = localStorage.getItem(bookCacheKey(bookId));
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    return isCachedBook(parsed, bookId) ? parsed : null;
  } catch {
    return null;
  }
};

const cacheBook = (book: Book) => {
  try {
    localStorage.setItem(bookCacheKey(book.id), JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
};

const newerBook = (remote: Book, cached: Book | null) => {
  if (!cached) return remote;
  const remoteTime = Date.parse(remote.updatedAt);
  const cachedTime = Date.parse(cached.updatedAt);
  return Number.isFinite(cachedTime) && (!Number.isFinite(remoteTime) || cachedTime > remoteTime)
    ? cached
    : remote;
};

function App() {
  const [library, setLibrary] = useState<BookIndexEntry[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [view, setView] = useState<ViewName>('shelf');
  const [mode, setMode] = useState<GenerationMode>('author');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [instruction, setInstruction] = useState('让观测站出现一个必须由人物回应的新变化。');
  const [draft, setDraft] = useState('');
  const [draftInstruction, setDraftInstruction] = useState('');
  const [theme, setTheme] = useState<ThemeName>(() =>
    localStorage.getItem('story-theme') === 'manga' ? 'manga' : 'paper');
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(() =>
    readProviderProfiles(localStorage.getItem(providerProfilesKey)));
  const [activeProviderProfileId, setActiveProviderProfileId] = useState(() =>
    localStorage.getItem(activeProviderProfileKey) ?? 'provider-primary');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(api.runtime === 'cloud' ? '正在打开私有云端书库…' : '正在打开本地书库…');
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const mainContent = useRef<HTMLElement>(null);
  const restoreShelfFocus = useRef(false);
  const restoreWriterFocus = useRef(false);
  const [bookSettingsRequest, setBookSettingsRequest] = useState(0);
  const [returnToWriterAfterSettings, setReturnToWriterAfterSettings] = useState(false);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const section = useMemo(() => book?.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === sectionId), [book, sectionId]);
  const sectionChapter = useMemo(() => book?.chapters.find((chapter) =>
    chapter.sections.some((candidate) => candidate.id === sectionId)), [book, sectionId]);
  const promptPreview = useMemo(() => {
    if (view !== 'write' || !book || !section) return null;
    try {
      return composeContextPlan(book, {
        sectionId: section.id,
        mode,
        selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
        instruction,
      });
    } catch {
      return null;
    }
  }, [book, instruction, mode, section, selectedCharacterId, view]);
  const activeProviderProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('story-theme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(providerProfilesKey, JSON.stringify(providerProfiles));
      localStorage.setItem(activeProviderProfileKey, activeProviderProfileId);
    } catch {
      // Settings still work for the current page when browser persistence is unavailable.
    }
  }, [activeProviderProfileId, providerProfiles]);

  useEffect(() => {
    document.title = view === 'write' && book && section
      ? `${section.title} · ${book.title} · Story-native`
      : '故事书架 · Story-native';
  }, [book, section, view]);

  useEffect(() => {
    if (view !== 'shelf' || !restoreShelfFocus.current) return;
    restoreShelfFocus.current = false;
    mainContent.current?.querySelector<HTMLElement>('button, summary, a[href], input, select, textarea')?.focus();
  }, [view]);

  useEffect(() => {
    if (view !== 'write' || !restoreWriterFocus.current) return;
    restoreWriterFocus.current = false;
    mainContent.current?.querySelector<HTMLElement>('.writer-book-settings-button')?.focus();
  }, [view]);

  useEffect(() => {
    void (async () => {
      try {
        const entries = await api.listBooks();
        setLibrary(entries);
        if (entries[0]) await openBook(entries[0].id);
        setStatus(api.runtime === 'cloud' ? '私有云端书库已打开。' : '本地书库已打开。');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '无法打开书库。');
      }
    })();
  }, []);

  useEffect(() => {
    if (!book || !dirty) return;
    const cachedLocally = cacheBook(book);
    setLibrary((items) => [{ id: book.id, title: book.title, updatedAt: book.updatedAt },
      ...items.filter((item) => item.id !== book.id)]);
    setStatus(cachedLocally
      ? '已自动保存到此设备，正在同步私有书库…'
      : '当前设备的浏览器存储不可用，正在尝试同步私有书库…');

    const revision = saveRevision.current;
    const timer = window.setTimeout(() => {
      const task = saveQueue.current.catch(() => undefined).then(() => api.saveBook(book));
      saveQueue.current = task.then(() => undefined, () => undefined);
      void task.then((saved) => {
        if (saveRevision.current !== revision) return;
        cacheBook(saved);
        setBook((current) => current?.id === saved.id ? saved : current);
        setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
          ...items.filter((item) => item.id !== saved.id)]);
        setDirty(false);
        setStatus(api.runtime === 'cloud'
          ? '已自动保存到此设备，并同步私有云端书库。'
          : '已自动保存到此设备和本机故事目录。');
      }).catch((error) => {
        if (saveRevision.current === revision) {
          setStatus(`${error instanceof Error ? error.message : '同步失败。'} 本机自动保存不受影响。`);
        }
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [book, dirty]);

  const openBook = async (bookId: string) => {
    const remote = await api.loadBook(bookId);
    const cached = readCachedBook(bookId);
    const loaded = newerBook(remote, cached);
    cacheBook(loaded);
    saveRevision.current += 1;
    setBook(loaded);
    setSectionId('');
    setSelectedCharacterId(loaded.characters[0]?.id ?? '');
    setDraft('');
    setDraftInstruction('');
    setDirty(loaded === cached && loaded.updatedAt !== remote.updatedAt);
    setView('shelf');
  };

  const changeBook = (recipe: (current: Book) => Book) => {
    saveRevision.current += 1;
    setBook((current) => current
      ? { ...recipe(current), updatedAt: new Date().toISOString() }
      : current);
    setDirty(true);
  };

  const queueBookSave = (candidate: Book) => {
    const task = saveQueue.current.catch(() => undefined).then(() => api.saveBook(candidate));
    saveQueue.current = task.then(() => undefined, () => undefined);
    return task;
  };

  const saveCurrent = async () => {
    if (!book) throw new Error('请先打开一本书。');
    const revision = saveRevision.current;
    cacheBook(book);
    const saved = await queueBookSave(book);
    if (saveRevision.current === revision) {
      cacheBook(saved);
      setBook(saved);
      setDirty(false);
    }
    setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
      ...items.filter((item) => item.id !== saved.id)]);
    setStatus(api.runtime === 'cloud'
      ? '已自动保存到此设备，并同步私有云端书库。'
      : '已自动保存到此设备和本机故事目录。');
    return saved;
  };

  const exportCurrentBook = () => {
    if (!book) return;
    cacheBook(book);
    const safeTitle = book.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'story-book';
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(book, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeTitle}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`已导出《${book.title}》的 JSON 文件。`);
  };

  const generationRequest = (saved: Book) => ({
    bookId: saved.id,
    sectionId,
    mode,
    selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
    instruction,
  });

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  };

  const hasCharacterSelection = () => mode !== 'character'
    || Boolean(book?.characters.some((character) => character.id === selectedCharacterId));

  const previewGeneration = () => withBusy(async () => {
    if (!hasCharacterSelection()) {
      setStatus('角色模式需要先选择当前 Book 的角色。');
      return;
    }
    const saved = await saveCurrent();
    const result = await api.generate(generationRequest(saved));
    setDraft(result.draft);
    setDraftInstruction(instruction);
    setStatus('Fake Provider 已生成待应用正文。');
  });

  const applyDraft = () => {
    if (!draft || !section) return;
    const additions: SectionBlock[] = [
      ...(draftInstruction.trim()
        ? [{ id: makeId('block'), kind: 'user' as const, content: draftInstruction.trim() }]
        : []),
      { id: makeId('block'), kind: 'assistant', content: draft },
    ];
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id
          ? (() => {
              const blocks = [...sectionBlocks(item), ...additions];
              return { ...item, blocks, content: blocksAsContent(blocks) };
            })()
          : item),
      })),
    }));
    setDraft('');
    setDraftInstruction('');
    setStatus('待应用正文已加入当前 Section；请保存。');
  };

  const updateSectionBlocks = (blocks: SectionBlock[]) => {
    if (!section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id
          ? { ...item, blocks, content: blocksAsContent(blocks) }
          : item),
      })),
    }));
  };

  const updateSectionNote = (note: string) => {
    if (!section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id ? { ...item, note } : item),
      })),
    }));
  };

  const regenerateBlock = (blockId: string) => {
    if (!section) return;
    const target = sectionBlocks(section).find((item) => item.id === blockId);
    if (!target || target.kind !== 'assistant') return;
    void withBusy(async () => {
      const saved = await saveCurrent();
      const result = await api.generate(generationRequest(saved));
      changeBook((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          sections: chapter.sections.map((item) => {
            if (item.id !== section.id) return item;
            const blocks = sectionBlocks(item).map((block) => block.id === blockId
              ? { ...block, content: result.draft }
              : block);
            return { ...item, blocks, content: blocksAsContent(blocks) };
          }),
        })),
      }));
      setStatus('已重新生成所选 AI 正文片段。');
    });
  };

  const createBook = (title: string) => {
    void withBusy(async () => {
      const created = await api.createBook(title);
      setLibrary((items) => [{ id: created.id, title: created.title, updatedAt: created.updatedAt }, ...items]);
      setBook(created);
      cacheBook(created);
      saveRevision.current += 1;
      setSectionId('');
      setSelectedCharacterId('');
      setDirty(false);
      setView('shelf');
      setStatus(api.runtime === 'cloud' ? '新 Book 已建立在私有云端书库。' : '新 Book 已建立在本机。');
    });
  };

  const deleteCurrentBook = () => {
    if (!book || library.length <= 1) {
      setStatus('书库至少需要保留一本书。');
      return;
    }
    const deletedBook = book;
    const nextBook = library.find((entry) => entry.id !== deletedBook.id);
    const wasDirty = dirty;
    void withBusy(async () => {
      saveRevision.current += 1;
      setDirty(false);
      try {
        await saveQueue.current.catch(() => undefined);
        await api.deleteBook(deletedBook.id);
        localStorage.removeItem(bookCacheKey(deletedBook.id));
        setLibrary((items) => items.filter((entry) => entry.id !== deletedBook.id));
        if (nextBook) await openBook(nextBook.id);
        setStatus(`已删除《${deletedBook.title}》。`);
      } catch (error) {
        setDirty(wasDirty);
        throw error;
      }
    });
  };

  const addCharacter = (name: string) => changeBook((current) => {
    const id = makeId('character');
    return {
      ...current,
      characters: [...current.characters, {
        id,
        name: name.trim(),
        title: name.trim(),
        role: '尚未填写',
        content: '',
        includeInPrompt: true,
      }],
    };
  });

  const addWorldRule = (title: string) => changeBook((current) => ({
    ...current,
    worldRules: [...current.worldRules, {
      id: makeId('world'),
      title: title.trim(),
      content: '',
      includeInPrompt: true,
    }],
  }));

  const addChapter = (title: string) => changeBook((current) => {
    const chapterId = makeId('chapter');
    const sectionId = makeId('section');
    return {
      ...current,
      chapters: [...current.chapters, {
        id: chapterId,
        title: title.trim() || `第 ${current.chapters.length + 1} 章`,
        sections: [{ id: sectionId, title: '新小节', content: '' }],
      }],
    };
  });

  const addSection = (chapterId: string, title: string) => changeBook((current) => {
    const targetChapter = current.chapters.find((chapter) => chapter.id === chapterId);
    if (!targetChapter) return current;
    const next = {
      id: makeId('section'),
      title: title.trim() || `第 ${targetChapter.sections.length + 1} 节`,
      content: '',
    };
    return {
      ...current,
      chapters: current.chapters.map((chapter) => chapter.id === chapterId
        ? { ...chapter, sections: [...chapter.sections, next] }
        : chapter),
    };
  });

  const renameChapter = (chapterId: string, title: string) => changeBook((current) => ({
    ...current,
    chapters: current.chapters.map((chapter) => chapter.id === chapterId
      ? { ...chapter, title: title.trim() }
      : chapter),
  }));

  const renameSection = (chapterId: string, targetSectionId: string, title: string) => changeBook((current) => ({
    ...current,
    chapters: current.chapters.map((chapter) => chapter.id === chapterId
      ? {
          ...chapter,
          sections: chapter.sections.map((item) => item.id === targetSectionId
            ? { ...item, title: title.trim() }
            : item),
        }
      : chapter),
  }));

  const deleteSelection = (selection: DirectorySelection) => {
    if (!book) return;
    const result = deleteDirectorySelection(book, selection);
    changeBook(() => result.book);
    if (result.removedSectionIds.has(sectionId)) setSectionId('');
  };

  const updateCharacter = (id: string, patch: Partial<CharacterCard>) => changeBook((current) => ({
    ...current,
    characters: current.characters.map((item) => item.id === id
      ? { ...item, ...patch, title: patch.name ?? item.name }
      : item),
  }));

  const updateWorldRule = (id: string, patch: Partial<WorldRule>) => changeBook((current) => ({
    ...current,
    worldRules: current.worldRules.map((item) => item.id === id ? { ...item, ...patch } : item),
  }));

  const deleteSources = (kind: SourceSelectionKind, ids: Set<string>) => {
    if (!book || ids.size === 0) return;
    const next = deleteSourceSelection(book, kind, ids);
    changeBook(() => next);
    if (kind === 'character' && ids.has(selectedCharacterId)) {
      setSelectedCharacterId(next.characters[0]?.id ?? '');
    }
  };

  const saveProviderProfile = (profile: ProviderProfile) => {
    setProviderProfiles((current) => upsertProviderProfile(current, profile));
    setActiveProviderProfileId(profile.id);
  };

  const navigateFromHeader = () => {
    if (view === 'shelf') return;
    restoreShelfFocus.current = true;
    setView('shelf');
  };

  const openSettings = () => {
    if (document.activeElement instanceof HTMLElement) {
      settingsTrigger.current = document.activeElement;
    }
    settingsDialog.current?.showModal();
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到正文</a>
      {view === 'shelf' && <header className="app-header">
        <button
          type="button"
          className="brand-home"
          onClick={navigateFromHeader}
          aria-label="故事书架主页"
          title="故事书架主页"
        >
          <span className="brand-mark" aria-hidden="true">
            <Library size={20} strokeWidth={2} />
          </span>
          <span className="brand-name">Story-native</span>
        </button>
        <div className="header-context" aria-live="polite">
          <strong>故事书架</strong>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={exportCurrentBook}
            disabled={!book}
            aria-label="导出当前书目"
            title="导出当前书目"
          >
            <Download aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={openSettings}
            aria-label="打开设置"
            title="设置"
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>}

      <main id="main-content" ref={mainContent}>
        {book && view === 'write' && section ? (
          <Writer
            book={book}
            section={section}
            chapterTitle={sectionChapter?.title ?? ''}
            mode={mode}
            selectedCharacterId={selectedCharacterId}
            instruction={instruction}
            draft={draft}
            busy={busy}
            contextTokens={promptPreview?.estimatedTokens ?? 0}
            maxContext={activeProviderProfile?.maxContext ?? 0}
            onBack={navigateFromHeader}
            onOpenBookSettings={() => {
              setReturnToWriterAfterSettings(true);
              setView('shelf');
              setBookSettingsRequest((current) => current + 1);
            }}
            onExport={exportCurrentBook}
            onOpenSettings={openSettings}
            onModeChange={setMode}
            onCharacterChange={setSelectedCharacterId}
            onInstructionChange={setInstruction}
            onSectionBlocksChange={updateSectionBlocks}
            onSectionNoteChange={updateSectionNote}
            onRegenerateBlock={regenerateBlock}
            onSectionTitleChange={(title) => {
              if (sectionChapter && section) renameSection(sectionChapter.id, section.id, title);
            }}
            onGenerate={() => void previewGeneration()}
            onApplyDraft={applyDraft}
            onDiscardDraft={() => {
              setDraft('');
              setDraftInstruction('');
            }}
          />
        ) : book ? (
          <Bookshelf
            book={book}
            library={library}
            selectedSectionId={sectionId}
            selectedCharacterId={selectedCharacterId}
            openBookSettingsRequest={bookSettingsRequest}
            onBookSettingsOpened={() => setBookSettingsRequest(0)}
            onBookSettingsClose={() => {
              if (!returnToWriterAfterSettings || !sectionId) return;
              setReturnToWriterAfterSettings(false);
              restoreWriterFocus.current = true;
              setView('write');
            }}
            onOpenBook={(id) => void withBusy(async () => { await openBook(id); })}
            onOpenSection={(id) => {
              if (id !== sectionId) {
                setDraft('');
                setDraftInstruction('');
              }
              setSectionId(id);
              setView('write');
            }}
            onCreateBook={createBook}
            onDeleteBook={deleteCurrentBook}
            onBookChange={changeBook}
            onAddCharacter={addCharacter}
            onAddWorldRule={addWorldRule}
            onAddChapter={addChapter}
            onAddSection={addSection}
            onRenameChapter={renameChapter}
            onDeleteSelection={deleteSelection}
            onDeleteSources={deleteSources}
            onPlotOutlineChange={(value) => changeBook((current) => ({ ...current, plotOutline: value }))}
            onWritingBriefChange={(value) => changeBook((current) => ({ ...current, writingBrief: value }))}
            onCharacterChange={updateCharacter}
            onWorldRuleChange={updateWorldRule}
            onSetActiveCharacter={setSelectedCharacterId}
          />
        ) : (
          <p className="loading-copy">正在打开本地书库…</p>
        )}
      </main>

      <div className={view === 'write' ? 'sr-only' : 'status-line'} role="status" aria-live="polite">{status}</div>

      <SettingsDrawer
        dialogRef={settingsDialog}
        theme={theme}
        onThemeChange={setTheme}
        providerProfiles={providerProfiles}
        activeProviderProfileId={activeProviderProfileId}
        onSelectProviderProfile={setActiveProviderProfileId}
        onSaveProviderProfile={saveProviderProfile}
        promptPlan={promptPreview}
        onClose={() => settingsTrigger.current?.focus()}
      />

    </div>
  );
}

interface WriterProps {
  book: Book;
  section: Book['chapters'][number]['sections'][number] | undefined;
  chapterTitle: string;
  mode: GenerationMode;
  selectedCharacterId: string;
  instruction: string;
  draft: string;
  busy: boolean;
  contextTokens: number;
  maxContext: number;
  onBack: () => void;
  onOpenBookSettings: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onSectionBlocksChange: (blocks: SectionBlock[]) => void;
  onSectionNoteChange: (note: string) => void;
  onRegenerateBlock: (blockId: string) => void;
  onSectionTitleChange: (value: string) => void;
  onGenerate: () => void;
  onApplyDraft: () => void;
  onDiscardDraft: () => void;
}

function Writer(props: WriterProps) {
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;
  const blocks = props.section ? sectionBlocks(props.section) : [];
  const [sectionTitle, setSectionTitle] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [blockDraft, setBlockDraft] = useState('');
  const titleDialog = useRef<HTMLDialogElement>(null);
  const titleTrigger = useRef<HTMLElement | null>(null);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const editBlockDialog = useRef<HTMLDialogElement>(null);
  const deleteBlockDialog = useRef<HTMLDialogElement>(null);
  const blockActionTrigger = useRef<HTMLElement | null>(null);
  const selectedBlock = blocks.find((item) => item.id === selectedBlockId);

  const contextPercent = props.maxContext > 0
    ? Math.round((props.contextTokens / props.maxContext) * 100)
    : 0;
  const progressMax = Math.max(1, props.maxContext);
  const progressValue = Math.min(props.contextTokens, progressMax);

  const openTitleDialog = () => {
    if (document.activeElement instanceof HTMLElement) {
      titleTrigger.current = document.activeElement;
    }
    setSectionTitle(props.section?.title ?? '');
    titleDialog.current?.showModal();
  };

  const closeActionMenu = (restoreFocus = false) => {
    if (!actionMenu.current) return;
    actionMenu.current.open = false;
    if (restoreFocus) actionMenu.current.querySelector('summary')?.focus();
  };

  const runMenuAction = (action: () => void) => {
    closeActionMenu(true);
    action();
  };

  const openEditBlockDialog = () => {
    if (!selectedBlock) return;
    blockActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBlockDraft(selectedBlock.content);
    editBlockDialog.current?.showModal();
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
    if (block.kind === 'user') return block.content;
    return block.content.split(/(“[^”]*”|"[^"\n]*")/g).map((part, index) => (
      /^“[^”]*”$|^"[^"\n]*"$/.test(part)
        ? <span className="manuscript-dialogue" key={`${block.id}-dialogue-${index}`}>{part}</span>
        : part
    ));
  };

  return (
    <div className="writer-page">
      <header className="writer-heading">
        <div className="writer-context-row">
          <button
            type="button"
            className="icon-button writer-back-button"
            onClick={props.onBack}
            aria-label="返回故事书架"
            title="返回故事书架"
          ><ArrowLeft aria-hidden="true" /></button>
          <progress
            className="writer-context-progress"
            max={progressMax}
            value={progressValue}
            aria-label={`当前 Context ${props.contextTokens}，模型上限 ${props.maxContext}`}
          />
          <span className="writer-context-count" data-over-limit={contextPercent > 100 || undefined}>
            {compactTokenCount(props.contextTokens)} / {compactTokenCount(props.maxContext)} · {contextPercent}%
          </span>
        </div>

        <div className="writer-tool-row" role="group" aria-label="写作工具">
          <button
            type="button"
            className="book-settings-button button-with-icon writer-book-settings-button"
            onClick={props.onOpenBookSettings}
            aria-label="打开本书设定"
            title="本书设定"
          ><BookMarked aria-hidden="true" /><span>设定</span></button>
          <div className="writer-tool-actions">
            <button
              type="button"
              className="icon-button"
              onClick={openTitleDialog}
              disabled={!props.section}
              aria-label="修改小节名称"
              title="修改小节名称"
            ><Pencil aria-hidden="true" /></button>
            <button
              type="button"
              className="icon-button"
              onClick={props.onExport}
              aria-label="导出当前书目"
              title="导出当前书目"
            ><Download aria-hidden="true" /></button>
            <button
              type="button"
              className="icon-button"
              onClick={props.onOpenSettings}
              aria-label="打开设置"
              title="设置"
            ><Settings aria-hidden="true" /></button>
          </div>
        </div>

        <p className="writer-section-title" title={`${props.chapterTitle} · ${props.section?.title ?? ''}`}>
          <strong>{props.chapterTitle}</strong>
          {props.section && <span> · {props.section.title}</span>}
        </p>
      </header>

      <section className="manuscript-wrap" aria-labelledby="manuscript-label">
        <h2 id="manuscript-label" className="sr-only">连续小说正文</h2>
        <div className="manuscript" aria-label="连续小说正文">
          {blocks.map((block) => (
            <button
              type="button"
              className="manuscript-block"
              data-kind={block.kind}
              aria-pressed={selectedBlockId === block.id}
              aria-label={`${block.kind === 'user' ? '用户输入' : 'AI 输出'}：${block.content}`}
              onClick={() => {
                actionMenu.current?.removeAttribute('open');
                setSelectedBlockId((current) => current === block.id ? '' : block.id);
              }}
              key={block.id}
            >
              <span className="sr-only">{block.kind === 'user' ? '用户输入：' : 'AI 输出：'}</span>
              <span className="manuscript-block-copy">{renderBlockContent(block)}</span>
            </button>
          ))}
          {blocks.length === 0 && <p className="empty-manuscript">本节还没有正文。</p>}
        </div>
      </section>

      {props.draft && (
        <section className="draft-preview" aria-labelledby="draft-heading">
          <div>
            <p className="eyebrow">Fake Provider</p>
            <h2 id="draft-heading">待应用正文</h2>
          </div>
          <p>{props.draft}</p>
          <div className="draft-actions">
            <button type="button" className="primary-action button-with-icon" onClick={props.onApplyDraft}><Check aria-hidden="true" />应用到正文</button>
            <button type="button" className="button-with-icon" onClick={props.onDiscardDraft}><X aria-hidden="true" />放弃预览</button>
          </div>
        </section>
      )}

      <form className="instruction-dock" onSubmit={(event) => { event.preventDefault(); props.onGenerate(); }}>
        {selectedBlock && (
          <div className="writer-block-actions" role="group" aria-label={`所选${selectedBlock.kind === 'user' ? '用户输入' : 'AI 输出'}操作`}>
            <button
              type="button"
              className="icon-button"
              onClick={() => props.onRegenerateBlock(selectedBlock.id)}
              disabled={props.busy || selectedBlock.kind !== 'assistant'}
              aria-label="重新生成所选 AI 输出"
              title={selectedBlock.kind === 'assistant' ? '重新生成' : '只有 AI 输出可以重新生成'}
            ><RefreshCw aria-hidden="true" /></button>
            <button
              type="button"
              className="icon-button"
              onClick={openEditBlockDialog}
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
        <details
          ref={actionMenu}
          className="writer-action-menu"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeActionMenu(true);
          }}
        >
          <summary className="icon-button writer-menu-trigger" title="写作操作" onClick={() => setSelectedBlockId('')}>
            <Menu aria-hidden="true" />
            <span className="sr-only">打开写作操作</span>
          </summary>
          <div className="writer-action-sheet" aria-label="写作操作">
            <div className="writer-menu-modes" role="group" aria-label="写作模式">
              <button
                type="button"
                className="writer-menu-action"
                aria-pressed={props.mode === 'author'}
                onClick={() => runMenuAction(() => props.onModeChange('author'))}
              ><BookOpenText aria-hidden="true" />作者模式</button>
              <button
                type="button"
                className="writer-menu-action"
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
                    ? '请选择当前 Book 的角色。'
                    : `以 ${selectedCharacter?.name ?? '所选角色'} 的第一人称连续正文生成。你控制该角色，AI 处理世界和其他角色。`}
                </p>
              </div>
            )}
            <label className="writer-section-note" htmlFor="section-note-input">
              <span><MessageSquareText aria-hidden="true" />本节注释</span>
              <textarea
                id="section-note-input"
                rows={4}
                value={props.section?.note ?? ''}
                onChange={(event) => props.onSectionNoteChange(event.target.value)}
                placeholder="只写给当前小节的续写提示……"
                spellCheck
              />
              <small>仅作用于本节；发送时排列在当前正文前。</small>
            </label>
          </div>
        </details>
        <label className="sr-only" htmlFor="writing-instruction">{props.mode === 'author' ? '写作指令' : '角色行动或台词'}</label>
        <textarea
          id="writing-instruction"
          rows={1}
          value={props.instruction}
          onChange={(event) => props.onInstructionChange(event.target.value)}
          placeholder={props.mode === 'author' ? '例如：让场景出现一个新的变化…' : '以当前角色输入行动、台词或选择…'}
        />
        <button
          type="submit"
          className="primary-action icon-button writer-send-button"
          disabled={props.busy || characterModeNeedsSelection}
          aria-label={props.busy ? '正在准备续写' : '预览续写'}
          title={props.busy ? '正在准备…' : '预览续写'}
        ><Sparkles aria-hidden="true" /></button>
      </form>

      <dialog
        className="name-dialog"
        ref={editBlockDialog}
        onClose={restoreBlockActionFocus}
        onCancel={(event) => { event.preventDefault(); editBlockDialog.current?.close(); }}
        aria-labelledby="edit-block-dialog-heading"
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          const content = blockDraft.trim();
          if (!content || !selectedBlock) return;
          props.onSectionBlocksChange(blocks.map((item) => item.id === selectedBlock.id
            ? { ...item, content }
            : item));
          editBlockDialog.current?.close();
        }}>
          <header className="dialog-heading">
            <h2 id="edit-block-dialog-heading">编辑{selectedBlock?.kind === 'user' ? '用户输入' : 'AI 输出'}</h2>
            <button type="button" className="icon-button" onClick={() => editBlockDialog.current?.close()} aria-label="取消编辑片段" title="取消"><X aria-hidden="true" /></button>
          </header>
          <div className="name-dialog-body">
            <label htmlFor="edit-block-input">片段内容</label>
            <textarea id="edit-block-input" autoFocus required value={blockDraft} onChange={(event) => setBlockDraft(event.target.value)} spellCheck />
            <div className="dialog-actions">
              <button type="button" className="quiet-action" onClick={() => editBlockDialog.current?.close()}>取消</button>
              <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />保存</button>
            </div>
          </div>
        </form>
      </dialog>

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
        onClose={() => titleTrigger.current?.focus()}
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
            <input id="section-title-input" autoFocus required autoComplete="off" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
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

function CharacterEditor({ bookTitle, character, isActiveRole, onChange, onSetActive }: {
  bookTitle: string;
  character: CharacterCard;
  isActiveRole: boolean;
  onChange: (patch: Partial<CharacterCard>) => void;
  onSetActive: () => void;
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
        <label>角色职责<input value={character.role} onChange={(event) => onChange({ role: event.target.value })} /></label>
        <label>角色资料<textarea value={character.content} onChange={(event) => onChange({ content: event.target.value })} spellCheck /></label>
        <label className="source-prompt-setting">
          <input type="checkbox" checked={character.includeInPrompt} onChange={(event) => onChange({ includeInPrompt: event.target.checked })} />
          <span><strong>生成时引用角色卡</strong><small>开启后，角色资料会进入本书的 Prompt。</small></span>
        </label>
        <button type="button" className="quiet-action" aria-pressed={isActiveRole} onClick={onSetActive}>
          {isActiveRole ? '当前扮演角色' : '设为扮演角色'}
        </button>
      </section>
    </article>
  );
}

function WorldRuleEditor({ bookTitle, rule, onChange }: {
  bookTitle: string;
  rule: WorldRule;
  onChange: (patch: Partial<WorldRule>) => void;
}) {
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 世界观条例</p>
        <h1>{rule.title}</h1>
        <p>这条设定只属于当前书目，并对书内全部章节与小节生效。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${rule.title}世界观条例内容`}>
        <label>条例名称<input value={rule.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
        <label>条例内容<textarea value={rule.content} onChange={(event) => onChange({ content: event.target.value })} spellCheck /></label>
        <label className="source-prompt-setting">
          <input type="checkbox" checked={rule.includeInPrompt} onChange={(event) => onChange({ includeInPrompt: event.target.checked })} />
          <span><strong>生成时引用世界观条例</strong><small>开启后，这条设定会进入本书的 Prompt。</small></span>
        </label>
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
  selectedCharacterId: string;
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
  onSetActiveCharacter: (id: string) => void;
}

type NameDialogState =
  | { kind: 'new-book' | 'rename-book' | 'new-chapter' | 'new-character' | 'new-world'; value: string }
  | { kind: 'new-section'; value: string; chapterId: string; chapterTitle: string }
  | { kind: 'rename-chapter'; value: string; chapterId: string };

type DeleteDialogState =
  | { kind: 'book'; id: string; title: string }
  | { kind: 'selection'; chapterIds: string[]; sectionIds: string[]; chapterCount: number; sectionCount: number }
  | { kind: 'source-selection'; sourceKind: SourceSelectionKind; ids: string[] };

function Bookshelf(props: BookshelfProps) {
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
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const nameDialogTrigger = useRef<HTMLElement | null>(null);
  const deleteDialogTrigger = useRef<HTMLElement | null>(null);
  const bookSettingsDialog = useRef<HTMLDialogElement>(null);
  const bookSettingsTrigger = useRef<HTMLButtonElement>(null);
  const bookSettingsPageTrigger = useRef<HTMLElement | null>(null);
  const bookSettingsScrollTop = useRef(0);
  const bookSettingsBackButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (nameDialog && nameDialogRef.current && !nameDialogRef.current.open) {
      nameDialogRef.current.showModal();
    }
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
  const restoreDialogFocus = (trigger: React.RefObject<HTMLElement | null>) => {
    const target = trigger.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else if (bookSettingsDialog.current?.open) bookSettingsDialog.current.querySelector<HTMLElement>('summary')?.focus();
      else document.querySelector<HTMLElement>('.directory-toolbar button, .book-selector-card')?.focus();
    });
  };

  const nameDialogCopy = (() => {
    switch (nameDialog?.kind) {
      case 'new-book': return { title: '新建书目', label: '书名', placeholder: '输入书名', action: '确认新建' };
      case 'rename-book': return { title: '修改书名', label: '书名', placeholder: '输入书名', action: '保存' };
      case 'new-chapter': return { title: '新建章节', label: '章节名称', placeholder: `第 ${props.book.chapters.length + 1} 章`, action: '确认新建' };
      case 'new-section': return { title: `在《${nameDialog.chapterTitle}》中新建小节`, label: '小节名称', placeholder: '输入小节名称', action: '确认新建' };
      case 'rename-chapter': return { title: '修改章节名称', label: '章节名称', placeholder: '输入章节名称', action: '保存' };
      case 'new-character': return { title: '新建角色卡', label: '角色名称', placeholder: '输入角色名称', action: '确认新建' };
      case 'new-world': return { title: '新建世界观条例', label: '条例名称', placeholder: '输入条例名称', action: '确认新建' };
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
      const label = deleteDialog.sourceKind === 'character' ? '角色卡' : '世界观条例';
      const count = deleteDialog.sourceKind === 'character'
        ? `${deleteDialog.ids.length} 张角色卡`
        : `${deleteDialog.ids.length} 条世界观条例`;
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

  const submitNameDialog = (event: React.FormEvent) => {
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
          ? settingsWorldRule?.title ?? '世界观条例'
          : '本书设定';
  const bookSettingsEyebrow = bookSettingsView.kind === 'root'
    ? '全局指引 · 角色 · 世界'
    : `本书设定 · ${props.book.title}`;

  return (
    <div className="shelf-page">
      <aside className="book-rail" aria-label="书目选择">
        <details className="book-library-drawer">
          <summary className="book-selector-card">
            <BookOpenText aria-hidden="true" />
            <span><small>书</small><strong>{props.book.title}</strong></span>
            <ChevronDown className="book-selector-chevron" aria-hidden="true" />
          </summary>
          <div className="book-library-panel">
            <div className="book-list" aria-label="全部书目">
              {props.library.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={entry.id === props.book.id ? 'true' : undefined}
                  onClick={() => props.onOpenBook(entry.id)}
                >
                  <BookOpenText aria-hidden="true" />
                  <span>{entry.title}</span>
                  {entry.id === props.book.id && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
            <div className="book-actions-row">
              <button
                type="button"
                className="book-settings-button button-with-icon"
                aria-haspopup="dialog"
                aria-label="新建书目"
                title="新建书目"
                onClick={() => openNameDialog({ kind: 'new-book', value: '' })}
              ><Plus aria-hidden="true" /></button>
              <button
                type="button"
                className="icon-button"
                aria-haspopup="dialog"
                aria-label={`修改书名${props.book.title}`}
                title="修改书名"
                onClick={() => openNameDialog({ kind: 'rename-book', value: props.book.title })}
              ><Pencil aria-hidden="true" /></button>
              <button
                type="button"
                className="icon-button danger-icon"
                aria-haspopup="dialog"
                aria-label={`删除书目${props.book.title}`}
                title={props.library.length <= 1 ? '书库至少保留一本书' : '删除书目'}
                disabled={props.library.length <= 1}
                onClick={() => openDeleteDialog({ kind: 'book', id: props.book.id, title: props.book.title })}
              ><Trash2 aria-hidden="true" /></button>
            </div>
          </div>
        </details>
      </aside>

      <section className="shelf-content">
        <h1 className="sr-only">故事书架</h1>
        <section className={`directory-panel${selectionMode ? ' selection-mode' : ''}`} aria-label="章节目录">
            <div className="directory-toolbar">
              <button
                ref={bookSettingsTrigger}
                type="button"
                className="icon-button"
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
                      <span><small>章</small><strong>{chapter.title}</strong></span>
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
                        aria-label={`修改章节名称${chapter.title}`}
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
                            <span><strong>{section.title}</strong><small>{section.content.length} 字符</small></span>
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
              autoFocus
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
        onClose={resetBookSettings}
        onCancel={(event) => { event.preventDefault(); closeBookSettings(); }}
        aria-labelledby="book-settings-title"
      >
        <header className="drawer-heading">
          <div className="drawer-title-row">
            {bookSettingsView.kind !== 'root' && (
              <button
                ref={bookSettingsBackButton}
                type="button"
                className="icon-button"
                onClick={returnBookSettingsRoot}
                aria-label="返回本书设定"
                title="返回本书设定"
              ><ArrowLeft aria-hidden="true" /></button>
            )}
            <div>
              <p className="eyebrow">{bookSettingsEyebrow}</p>
              <h2 id="book-settings-title">{bookSettingsTitle}</h2>
            </div>
          </div>
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
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'outline' })}>
                    <span><strong>剧情大纲</strong><small>规划情节走向，生成时作为本书的长期指导。</small></span>
                    <ChevronRight className="icon-directional" aria-hidden="true" />
                  </button>
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'style' })}>
                    <span><strong>写作风格指导</strong><small>指定行文风格、语气和语言表达。</small></span>
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
                          ? `${selectedSourceIds.has(character.id) ? '取消选择' : '选择'}角色卡${character.name}`
                          : `打开角色卡${character.name}`}
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
                  <span><strong>世界观条例</strong><small>{props.book.worldRules.length} 条设定</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="source-group-content">
                  <div className="source-group-actions">
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-world', value: '' })} aria-label="新建世界观条例" title="新建世界观条例"><Plus aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'world'}
                      onClick={() => toggleSourceSelectionMode('world')}
                      aria-label={sourceSelectionMode === 'world' ? '退出世界观条例选择' : '选择世界观条例'}
                      title={sourceSelectionMode === 'world' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'world' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={sourceSelectionMode !== 'world' || selectedSourceIds.size === 0}
                      onClick={() => openDeleteDialog({ kind: 'source-selection', sourceKind: 'world', ids: [...selectedSourceIds] })}
                      aria-label="删除所选世界观条例"
                      title={sourceSelectionMode === 'world' && selectedSourceIds.size ? '删除所选世界观条例' : '请先选择世界观条例'}
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
                          ? `${selectedSourceIds.has(rule.id) ? '取消选择' : '选择'}世界观条例${rule.title}`
                          : `打开世界观条例${rule.title}`}
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
                    {props.book.worldRules.length === 0 && <p className="empty-source">还没有世界观条例。</p>}
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
                  character={settingsCharacter}
                  isActiveRole={props.selectedCharacterId === settingsCharacter.id}
                  onChange={(patch) => props.onCharacterChange(settingsCharacter.id, patch)}
                  onSetActive={() => props.onSetActiveCharacter(settingsCharacter.id)}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : (
            settingsWorldRule
              ? <WorldRuleEditor
                  bookTitle={props.book.title}
                  rule={settingsWorldRule}
                  onChange={(patch) => props.onWorldRuleChange(settingsWorldRule.id, patch)}
                />
              : <MissingSettingsItem label="世界观条例" />
          )}
        </div>
      </dialog>
    </div>
  );
}

function SettingsDrawer({
  dialogRef,
  theme,
  onThemeChange,
  providerProfiles,
  activeProviderProfileId,
  onSelectProviderProfile,
  onSaveProviderProfile,
  promptPlan,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  providerProfiles: ProviderProfile[];
  activeProviderProfileId: string;
  onSelectProviderProfile: (id: string) => void;
  onSaveProviderProfile: (profile: ProviderProfile) => void;
  promptPlan: ContextPlan | null;
  onClose: () => void;
}) {
  const currentProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  const blankProfile = (): ProviderProfile => ({
    id: '',
    name: '',
    baseUrl: '',
    modelId: '',
    maxContext: 128000,
    maxOutput: 8192,
  });
  const [editingId, setEditingId] = useState(currentProfile?.id ?? '');
  const [profileDraft, setProfileDraft] = useState<ProviderProfile>(() => currentProfile ? { ...currentProfile } : blankProfile());
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const compositionItems = promptPlan?.included.map((item) => ({
    id: item.id,
    title: item.title,
    reason: item.reason,
    cacheBand: item.cacheBand,
    estimatedTokens: item.estimatedTokens,
  })) ?? generalPromptOrder.map((item) => ({ ...item, estimatedTokens: 0 }));
  const stablePrefixCount = compositionItems.filter((item) => item.cacheBand === 'stable').length;
  const stablePrefixTokens = promptPlan?.included
    .filter((item) => item.cacheBand === 'stable')
    .reduce((total, item) => total + item.estimatedTokens, 0) ?? 0;
  const totalPromptTokens = promptPlan?.estimatedTokens ?? 0;
  const closeDrawer = () => dialogRef.current?.close();
  const selectProfile = (profile: ProviderProfile) => {
    onSelectProviderProfile(profile.id);
    setEditingId(profile.id);
    setProfileDraft({ ...profile });
    setApiKeyDraft(sessionKeys[profile.id] ?? '');
    setConnectionStatus('');
  };
  const startNewProfile = () => {
    setEditingId('');
    setProfileDraft(blankProfile());
    setApiKeyDraft('');
    setConnectionStatus('');
  };
  const submitProfile = (event: React.FormEvent) => {
    event.preventDefault();
    const id = editingId || makeId('provider');
    const profile: ProviderProfile = {
      ...profileDraft,
      id,
      name: profileDraft.name.trim(),
      baseUrl: profileDraft.baseUrl.trim(),
      modelId: profileDraft.modelId.trim(),
      maxContext: Math.max(1, Number(profileDraft.maxContext)),
      maxOutput: Math.max(1, Number(profileDraft.maxOutput)),
    };
    onSaveProviderProfile(profile);
    setEditingId(id);
    setProfileDraft(profile);
    setSessionKeys((current) => ({ ...current, [id]: apiKeyDraft }));
    setConnectionStatus('连接方案已保存。API Key 只在当前页面临时保留。');
  };

  return (
    <dialog
      className="settings-drawer"
      ref={dialogRef}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); closeDrawer(); }}
      aria-labelledby="settings-title"
    >
      <header className="drawer-heading">
        <div>
          <p className="eyebrow">界面偏好</p>
          <h2 id="settings-title">设置</h2>
        </div>
        <button type="button" className="icon-button" autoFocus onClick={closeDrawer} aria-label="关闭设置" title="关闭设置"><X aria-hidden="true" /></button>
      </header>
      <section className="settings-section" aria-labelledby="theme-heading">
        <h3 id="theme-heading">皮肤</h3>
        <label className="sr-only" htmlFor="theme-select">选择皮肤</label>
        <select id="theme-select" value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>
          <option value="paper">Paper · 默认</option>
          <option value="manga">少女漫画</option>
        </select>
        <p className="compact-setting-note">{theme === 'paper' ? '类 Notion / Obsidian 的安静默认版。' : '沿用酒馆的粉紫交互语言。'}</p>
      </section>
      <section className="settings-section" aria-labelledby="provider-settings-heading">
        <h3 id="provider-settings-heading" className="sr-only">模型连接</h3>
        <details className="settings-subdrawer">
          <summary>
            <KeyRound aria-hidden="true" />
            <span><strong>模型连接</strong><small>{currentProfile ? `${currentProfile.name} · ${currentProfile.modelId}` : '保存并选择连接方案'}</small></span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="provider-settings-content">
            <div className="provider-profile-picker">
              <label htmlFor="provider-profile-select">连接方案</label>
              <div className="provider-profile-select-row">
                <select
                  id="provider-profile-select"
                  value={editingId}
                  onChange={(event) => {
                    const profile = providerProfiles.find((item) => item.id === event.target.value);
                    if (profile) selectProfile(profile);
                    else startNewProfile();
                  }}
                >
                  <option value="">新连接方案</option>
                  {providerProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.modelId}</option>)}
                </select>
                <button type="button" className="icon-button" onClick={startNewProfile} aria-label="新建连接方案" title="新建连接方案"><Plus aria-hidden="true" /></button>
              </div>
            </div>
            <form className="provider-profile-form" onSubmit={submitProfile}>
              <label htmlFor="provider-profile-name">方案名称</label>
              <input id="provider-profile-name" name="provider-profile-name" required autoComplete="off" value={profileDraft.name} onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：主要模型" />

              <label htmlFor="provider-api-key">API Key</label>
              <input id="provider-api-key" name="provider-api-key" type="password" autoComplete="off" spellCheck={false} value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder="sk-…" />

              <label htmlFor="provider-base-url">URL</label>
              <input id="provider-base-url" name="provider-base-url" type="url" required autoComplete="url" spellCheck={false} value={profileDraft.baseUrl} onChange={(event) => setProfileDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" />

              <label htmlFor="provider-model-id">模型 ID</label>
              <input id="provider-model-id" name="provider-model-id" required autoComplete="off" spellCheck={false} value={profileDraft.modelId} onChange={(event) => setProfileDraft((current) => ({ ...current, modelId: event.target.value }))} placeholder="model-id" />

              <div className="provider-number-grid">
                <label>最大上下文<input name="provider-max-context" type="number" inputMode="numeric" min="1" required value={profileDraft.maxContext} onChange={(event) => setProfileDraft((current) => ({ ...current, maxContext: Number(event.target.value) }))} /></label>
                <label>最大输出<input name="provider-max-output" type="number" inputMode="numeric" min="1" required value={profileDraft.maxOutput} onChange={(event) => setProfileDraft((current) => ({ ...current, maxOutput: Number(event.target.value) }))} /></label>
              </div>

              <p className="provider-secret-note">API Key 不会写入书稿、私有书库或浏览器持久化；刷新页面后需要重新输入。</p>
              <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />保存连接方案</button>
              <p className="provider-save-status" role="status" aria-live="polite">{connectionStatus}</p>
            </form>
          </div>
        </details>
        <details className="settings-subdrawer prompt-composition-drawer">
          <summary>
            <Layers3 aria-hidden="true" />
            <span>
              <strong>Prompt 组合</strong>
              <small>{promptPlan ? `${promptPlan.included.length} 个区块 · 稳定前缀约 ${stablePrefixTokens.toLocaleString()} tokens` : '通用顺序 · 选中小节后显示占比'}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="prompt-composition-content">
            <p className="prompt-composition-note">{promptPlan
              ? '当前小节 · 竖条按估算 tokens 比例显示，右侧按实际发送顺序排列。'
              : '主页概览 · 竖条等高表示通用顺序；进入小节后切换为当前 Prompt 占比。'}</p>
            <div className="prompt-composition-chart">
              <figure className="prompt-proportion-figure">
                <div className="prompt-proportion-bar" aria-hidden="true" data-template={!promptPlan}>
                  {compositionItems.map((item, index) => {
                    const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                    return (
                      <span
                        className="prompt-proportion-segment"
                        data-cache-band={item.cacheBand}
                        data-small={Boolean(promptPlan && share < 6)}
                        key={item.id}
                        style={{ flexGrow: promptPlan ? Math.max(item.estimatedTokens, 0.01) : 1 }}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                      </span>
                    );
                  })}
                </div>
                <figcaption>{promptPlan ? '段高 = 当前 tokens 占比' : '等高 = 通用拼接顺序'}</figcaption>
              </figure>
              <ol className="prompt-composition-list" aria-label="当前 Prompt 区块顺序">
                {compositionItems.map((item, index) => {
                  const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                  return (
                    <li key={item.id} data-cache-band={item.cacheBand}>
                      <span className="prompt-composition-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="prompt-composition-copy">
                        <strong>{item.title}</strong>
                        <small><span className="cache-band-label">{cacheBandLabel(item.cacheBand)}</span>{item.reason}</small>
                      </span>
                      <span className="prompt-composition-meta">
                        <strong>{promptPlan ? promptShareLabel(share) : '顺序'}</strong>
                        <small>{promptPlan ? `约 ${item.estimatedTokens.toLocaleString()} tokens` : `${index + 1} / ${compositionItems.length}`}</small>
                      </span>
                      {index === stablePrefixCount - 1 && <span className="cache-prefix-boundary">稳定前缀到这里</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
            <p className="prompt-composition-footnote">{promptPlan
              ? `${promptPlan.excluded.length > 0 ? `${promptPlan.excluded.length} 项关闭或为空，不会发送。` : '当前资料已全部装入。'}缓存是否命中仍由所选模型服务决定。`
              : '主页只显示结构，不计算虚假的 tokens 占比。'}</p>
          </div>
        </details>
      </section>
      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">当前存储</h3>
        <p className="helper-copy">正文和资料会先自动保存到当前设备。{api.runtime === 'cloud' ? '联网时同时同步到你的私有云端书库。' : '本机 host 同时写入故事目录。'}</p>
      </section>
    </dialog>
  );
}

export default App;
