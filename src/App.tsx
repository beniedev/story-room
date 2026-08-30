import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronRight,
  Download,
  FilePlus2,
  FolderPlus,
  Layers3,
  Library,
  Plus,
  Settings,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from './api';
import type {
  Book,
  BookIndexEntry,
  CharacterCard,
  ContextPlan,
  GenerationMode,
  PromptSource,
  ThemeName,
  WorldRule,
} from './types';

type ViewName = 'write' | 'shelf';
type ShelfTab = 'directory' | 'sources' | 'graph';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const bookCacheKey = (bookId: string) => `story-native:book:${bookId}`;

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
  const [shelfTab, setShelfTab] = useState<ShelfTab>('directory');
  const [mode, setMode] = useState<GenerationMode>('author');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [instruction, setInstruction] = useState('让观测站出现一个必须由人物回应的新变化。');
  const [draft, setDraft] = useState('');
  const [promptPlan, setPromptPlan] = useState<ContextPlan | null>(null);
  const [theme, setTheme] = useState<ThemeName>(() =>
    localStorage.getItem('story-theme') === 'manga' ? 'manga' : 'paper');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(api.runtime === 'cloud' ? '正在打开私有云端书库…' : '正在打开本地书库…');
  const [newBookTitle, setNewBookTitle] = useState('');
  const promptDialog = useRef<HTMLDialogElement>(null);
  const promptTrigger = useRef<HTMLElement | null>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const section = useMemo(() => book?.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === sectionId), [book, sectionId]);
  const sectionChapter = useMemo(() => book?.chapters.find((chapter) =>
    chapter.sections.some((candidate) => candidate.id === sectionId)), [book, sectionId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('story-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.title = view === 'write' && book && section
      ? `${section.title} · ${book.title} · Story-native`
      : '故事书架 · Story-native';
  }, [book, section, view]);

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

  useEffect(() => {
    const dialog = promptDialog.current;
    if (promptPlan && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-dialog-close]')?.focus();
    }
  }, [promptPlan]);

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
    setDirty(loaded === cached && loaded.updatedAt !== remote.updatedAt);
    setView('shelf');
    setShelfTab('directory');
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

  const showPrompt = () => withBusy(async () => {
    if (!hasCharacterSelection()) {
      setStatus('角色模式需要先选择当前 Book 的角色。');
      return;
    }
    promptTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const saved = await saveCurrent();
    setPromptPlan(await api.contextPlan(generationRequest(saved)));
    setStatus('Prompt 计划已按实际装入顺序生成。');
  });

  const previewGeneration = () => withBusy(async () => {
    if (!hasCharacterSelection()) {
      setStatus('角色模式需要先选择当前 Book 的角色。');
      return;
    }
    const saved = await saveCurrent();
    const result = await api.generate(generationRequest(saved));
    setPromptPlan(result.plan);
    setDraft(result.draft);
    promptDialog.current?.close();
    setPromptPlan(null);
    setStatus('Fake Provider 已生成待应用正文。');
  });

  const applyDraft = () => {
    if (!draft || !section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id
          ? { ...item, content: `${item.content.trimEnd()}\n\n${draft}` }
          : item),
      })),
    }));
    setDraft('');
    setStatus('待应用正文已加入当前 Section；请保存。');
  };

  const updateSection = (content: string) => {
    if (!section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id ? { ...item, content } : item),
      })),
    }));
  };

  const createBook = (event: React.FormEvent) => {
    event.preventDefault();
    void withBusy(async () => {
      const created = await api.createBook(newBookTitle);
      setLibrary((items) => [{ id: created.id, title: created.title, updatedAt: created.updatedAt }, ...items]);
      setBook(created);
      cacheBook(created);
      saveRevision.current += 1;
      setSectionId('');
      setSelectedCharacterId('');
      setNewBookTitle('');
      setDirty(false);
      setView('shelf');
      setStatus(api.runtime === 'cloud' ? '新 Book 已建立在私有云端书库。' : '新 Book 已建立在本机。');
    });
  };

  const addCharacter = () => changeBook((current) => {
    const id = makeId('character');
    return {
      ...current,
      characters: [...current.characters, {
        id,
        name: '新角色',
        title: '新角色',
        role: '尚未填写',
        content: '',
        includeInPrompt: true,
      }],
    };
  });

  const addWorldRule = () => changeBook((current) => ({
    ...current,
    worldRules: [...current.worldRules, {
      id: makeId('world'),
      title: '新世界观条例',
      content: '',
      includeInPrompt: true,
    }],
  }));

  const addChapter = () => changeBook((current) => {
    const chapterId = makeId('chapter');
    const sectionId = makeId('section');
    return {
      ...current,
      chapters: [...current.chapters, {
        id: chapterId,
        title: `第 ${current.chapters.length + 1} 章`,
        sections: [{ id: sectionId, title: '新小节', content: '' }],
      }],
    };
  });

  const addSection = (chapterId: string) => changeBook((current) => {
    const targetChapter = current.chapters.find((chapter) => chapter.id === chapterId);
    if (!targetChapter) return current;
    const next = { id: makeId('section'), title: `第 ${targetChapter.sections.length + 1} 节`, content: '' };
    return {
      ...current,
      chapters: current.chapters.map((chapter) => chapter.id === chapterId
        ? { ...chapter, sections: [...chapter.sections, next] }
        : chapter),
    };
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到正文</a>
      <header className="app-header">
        <button type="button" className="brand-home" onClick={() => { setView('shelf'); setShelfTab('directory'); }} aria-label="返回故事书架" title="返回故事书架">
          <span className="brand-mark" aria-hidden="true"><Library size={20} strokeWidth={2} /></span>
          <span className="brand-name">Story-native</span>
        </button>
        <div className="header-context" aria-live="polite">
          <strong>{view === 'write' && book ? book.title : '故事书架'}</strong>
          {view === 'write' && section && <span>{sectionChapter?.title} · {section.title}</span>}
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
            ref={settingsTrigger}
            type="button"
            className="icon-button"
            onClick={() => settingsDialog.current?.showModal()}
            aria-label="打开设置"
            title="设置"
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      <main id="main-content">
        {book && view === 'write' && section ? (
          <Writer
            book={book}
            section={section}
            mode={mode}
            selectedCharacterId={selectedCharacterId}
            instruction={instruction}
            draft={draft}
            busy={busy}
            onModeChange={setMode}
            onCharacterChange={setSelectedCharacterId}
            onInstructionChange={setInstruction}
            onSectionChange={updateSection}
            onShowPrompt={() => void showPrompt()}
            onGenerate={() => void previewGeneration()}
            onApplyDraft={applyDraft}
            onDiscardDraft={() => setDraft('')}
            onBackToDirectory={() => { setView('shelf'); setShelfTab('directory'); }}
          />
        ) : book ? (
          <Bookshelf
            book={book}
            library={library}
            tab={shelfTab}
            newBookTitle={newBookTitle}
            selectedCharacterId={selectedCharacterId}
            selectedSectionId={sectionId}
            onTabChange={setShelfTab}
            onOpenBook={(id) => void withBusy(async () => { await openBook(id); })}
            onOpenSection={(id) => { setSectionId(id); setView('write'); }}
            onNewBookTitleChange={setNewBookTitle}
            onCreateBook={createBook}
            onBookChange={changeBook}
            onSelectedCharacterChange={setSelectedCharacterId}
            onAddCharacter={addCharacter}
            onAddWorldRule={addWorldRule}
            onAddChapter={addChapter}
            onAddSection={addSection}
          />
        ) : (
          <p className="loading-copy">正在打开本地书库…</p>
        )}
      </main>

      <div className="status-line" role="status" aria-live="polite">{status}</div>

      <SettingsDrawer
        dialogRef={settingsDialog}
        theme={theme}
        onThemeChange={setTheme}
        onClose={() => settingsTrigger.current?.focus()}
      />

      <PromptDialog
        dialogRef={promptDialog}
        plan={promptPlan}
        onClose={() => {
          setPromptPlan(null);
          promptTrigger.current?.focus();
          promptTrigger.current = null;
        }}
      />
    </div>
  );
}

interface WriterProps {
  book: Book;
  section: Book['chapters'][number]['sections'][number] | undefined;
  mode: GenerationMode;
  selectedCharacterId: string;
  instruction: string;
  draft: string;
  busy: boolean;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onSectionChange: (value: string) => void;
  onShowPrompt: () => void;
  onGenerate: () => void;
  onApplyDraft: () => void;
  onDiscardDraft: () => void;
  onBackToDirectory: () => void;
}

function Writer(props: WriterProps) {
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;

  return (
    <div className="writer-page">
      <header className="writer-heading">
        <button type="button" className="back-to-directory" onClick={props.onBackToDirectory}>
          <ArrowLeft aria-hidden="true" />
          返回目录
        </button>
        <p className="breadcrumb">{props.book.title} <span aria-hidden="true">/</span> {props.section?.title}</p>
        <h1>{props.section?.title ?? '尚无正文'}</h1>
        <div className="mode-row">
          <fieldset className="segmented-control">
            <legend className="sr-only">写作模式</legend>
            <button type="button" aria-pressed={props.mode === 'author'} onClick={() => props.onModeChange('author')}>作者模式</button>
            <button type="button" aria-pressed={props.mode === 'character'} onClick={() => props.onModeChange('character')}>角色模式 · 第一视角</button>
          </fieldset>
          {props.mode === 'character' && (
            <div className="character-select">
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
                  : `以 ${selectedCharacter?.name ?? '当前角色'} 的第一人称连续正文生成；你控制该角色，AI 处理世界和其他角色。`}
              </p>
            </div>
          )}
        </div>
      </header>

      <section className="manuscript-wrap" aria-labelledby="manuscript-label">
        <h2 id="manuscript-label" className="sr-only">连续小说正文</h2>
        <textarea
          className="manuscript"
          value={props.section?.content ?? ''}
          onChange={(event) => props.onSectionChange(event.target.value)}
          aria-label="连续小说正文"
          spellCheck
        />
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
        <label htmlFor="writing-instruction">{props.mode === 'author' ? '写作指令' : '角色行动或台词'}</label>
        <textarea
          id="writing-instruction"
          value={props.instruction}
          onChange={(event) => props.onInstructionChange(event.target.value)}
          placeholder={props.mode === 'author' ? '例如：让场景出现一个新的变化…' : '以当前角色输入行动、台词或选择…'}
        />
        <div className="instruction-actions">
          <button type="button" className="button-with-icon" onClick={props.onShowPrompt} disabled={props.busy}><Layers3 aria-hidden="true" />查看 Prompt</button>
          <button type="submit" className="primary-action button-with-icon" disabled={props.busy}><Sparkles aria-hidden="true" />{props.busy ? '正在准备…' : '预览续写'}</button>
        </div>
      </form>
    </div>
  );
}

interface BookshelfProps {
  book: Book;
  library: BookIndexEntry[];
  tab: ShelfTab;
  newBookTitle: string;
  selectedCharacterId: string;
  selectedSectionId: string;
  onTabChange: (tab: ShelfTab) => void;
  onOpenBook: (id: string) => void;
  onOpenSection: (id: string) => void;
  onNewBookTitleChange: (value: string) => void;
  onCreateBook: (event: React.FormEvent) => void;
  onBookChange: (recipe: (current: Book) => Book) => void;
  onSelectedCharacterChange: (id: string) => void;
  onAddCharacter: () => void;
  onAddWorldRule: () => void;
  onAddChapter: () => void;
  onAddSection: (chapterId: string) => void;
}

function Bookshelf(props: BookshelfProps) {
  const updateSource = <T extends PromptSource>(key: 'worldRules' | 'canonFacts' | 'summaries', id: string, patch: Partial<T>) => {
    props.onBookChange((current) => ({
      ...current,
      [key]: current[key].map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  };

  const updateCharacter = (id: string, patch: Partial<CharacterCard>) => props.onBookChange((current) => ({
    ...current,
    characters: current.characters.map((item) => item.id === id
      ? { ...item, ...patch, title: patch.name ?? item.name }
      : item),
  }));

  const updateWorld = (id: string, patch: Partial<WorldRule>) => updateSource<WorldRule>('worldRules', id, patch);

  return (
    <div className="shelf-page">
      <aside className="book-rail" aria-label="Book 列表">
        <div className="book-picker">
          <label htmlFor="book-select">当前书目</label>
          <select id="book-select" value={props.book.id} onChange={(event) => props.onOpenBook(event.target.value)}>
            {props.library.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
        </div>
        <form className="new-book-form" onSubmit={props.onCreateBook}>
          <label htmlFor="new-book-title">新建书目</label>
          <div>
            <input id="new-book-title" value={props.newBookTitle} onChange={(event) => props.onNewBookTitleChange(event.target.value)} placeholder="书名" />
            <button type="submit" className="button-with-icon"><Plus aria-hidden="true" />新建</button>
          </div>
        </form>
      </aside>

      <section className="shelf-content">
        <header className="shelf-heading">
          <div>
            <p className="eyebrow">当前书目</p>
            <h1>{props.book.title}</h1>
          </div>
          <nav className="content-tabs" aria-label="书目视图">
            <button type="button" aria-current={props.tab === 'directory' ? 'page' : undefined} onClick={() => props.onTabChange('directory')}><BookOpenText aria-hidden="true" />目录</button>
            <button type="button" aria-current={props.tab === 'sources' ? 'page' : undefined} onClick={() => props.onTabChange('sources')}><Layers3 aria-hidden="true" />资料</button>
            <button type="button" aria-current={props.tab === 'graph' ? 'page' : undefined} onClick={() => props.onTabChange('graph')}><Share2 aria-hidden="true" />关系</button>
          </nav>
        </header>

        {props.tab === 'directory' ? (
          <section className="directory-panel" aria-labelledby="directory-heading">
            <div className="directory-title-row">
              <div>
                <p className="eyebrow">书 · 章 · 节</p>
                <h2 id="directory-heading">电子书目录</h2>
              </div>
              <button type="button" className="icon-button" onClick={props.onAddChapter} aria-label="新建章节" title="新建章节"><FolderPlus aria-hidden="true" /></button>
            </div>
            <div className="book-directory-root">
              <BookOpenText aria-hidden="true" />
              <span><small>书</small><strong>{props.book.title}</strong></span>
              <span>{props.book.chapters.length} 章 · {props.book.chapters.reduce((count, chapter) => count + chapter.sections.length, 0)} 节</span>
            </div>
            <ol className="chapter-list">
              {props.book.chapters.map((chapter, chapterIndex) => (
                <li className="chapter-card" key={chapter.id}>
                  <details open>
                    <summary>
                      <span className="chapter-index">{String(chapterIndex + 1).padStart(2, '0')}</span>
                      <span><small>章</small><strong>{chapter.title}</strong></span>
                      <span>{chapter.sections.length} 节</span>
                    </summary>
                    <div className="chapter-actions">
                      <button type="button" className="icon-button" onClick={() => props.onAddSection(chapter.id)} aria-label={`在${chapter.title}中新建小节`} title="新建小节"><FilePlus2 aria-hidden="true" /></button>
                    </div>
                    <ol className="section-list">
                      {chapter.sections.map((section, sectionIndex) => (
                        <li key={section.id}>
                          <button type="button" aria-current={section.id === props.selectedSectionId ? 'true' : undefined} onClick={() => props.onOpenSection(section.id)}>
                            <span className="section-index">{chapterIndex + 1}.{sectionIndex + 1}</span>
                            <span><strong>{section.title}</strong><small>{section.content.length} 字符</small></span>
                            <ChevronRight className="icon-directional" aria-hidden="true" />
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
        ) : props.tab === 'sources' ? (
            <section className="prompt-settings" aria-labelledby="prompt-settings-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">Prompt 管理</p>
                  <h2 id="prompt-settings-heading">本书写作约定</h2>
                </div>
                <span className="scope-badge">只影响当前 Book</span>
              </div>
              <label>
                书名
                <input value={props.book.title} onChange={(event) => props.onBookChange((current) => ({ ...current, title: event.target.value }))} />
              </label>
              <label>
                长期写作约定
                <textarea value={props.book.writingBrief} onChange={(event) => props.onBookChange((current) => ({ ...current, writingBrief: event.target.value }))} />
              </label>
              <p className="helper-copy">系统正文合同与作者/角色权限策略可以在 Prompt 计划中查看，但不能在这里改写。</p>

              <div className="source-heading"><h3>角色卡</h3><button type="button" onClick={props.onAddCharacter}>添加角色</button></div>
              {props.book.characters.map((character) => (
                <div className="source-card" key={character.id}>
                  <details>
                    <summary><span>{character.name}</span></summary>
                    <div className="source-fields">
                      <label>角色名<input value={character.name} onChange={(event) => updateCharacter(character.id, { name: event.target.value })} /></label>
                      <label>角色职责<input value={character.role} onChange={(event) => updateCharacter(character.id, { role: event.target.value })} /></label>
                      <label>角色资料<textarea value={character.content} onChange={(event) => updateCharacter(character.id, { content: event.target.value })} /></label>
                      <button type="button" className="quiet-action" aria-pressed={props.selectedCharacterId === character.id} onClick={() => props.onSelectedCharacterChange(character.id)}>
                        {props.selectedCharacterId === character.id ? '当前扮演角色' : '设为扮演角色'}
                      </button>
                    </div>
                  </details>
                  <label className="source-toggle source-card-toggle">
                    <span>装入 Prompt</span>
                    <input type="checkbox" checked={character.includeInPrompt} onChange={(event) => updateCharacter(character.id, { includeInPrompt: event.target.checked })} />
                  </label>
                </div>
              ))}

              <div className="source-heading"><h3>世界观条例</h3><button type="button" onClick={props.onAddWorldRule}>添加条例</button></div>
              {props.book.worldRules.map((rule) => (
                <div className="source-card" key={rule.id}>
                  <details>
                    <summary><span>{rule.title}</span></summary>
                    <div className="source-fields">
                      <label>条例名称<input value={rule.title} onChange={(event) => updateWorld(rule.id, { title: event.target.value })} /></label>
                      <label>条例内容<textarea value={rule.content} onChange={(event) => updateWorld(rule.id, { content: event.target.value })} /></label>
                    </div>
                  </details>
                  <label className="source-toggle source-card-toggle">
                    <span>装入 Prompt</span>
                    <input type="checkbox" checked={rule.includeInPrompt} onChange={(event) => updateWorld(rule.id, { includeInPrompt: event.target.checked })} />
                  </label>
                </div>
              ))}

              <div className="source-heading"><h3>Canon 与摘要</h3></div>
              {[...props.book.canonFacts.map((source) => ({ ...source, key: 'canonFacts' as const })),
                ...props.book.summaries.map((source) => ({ ...source, key: 'summaries' as const }))].map((source) => (
                <label className="source-toggle" key={source.id}>
                  <span><strong>{source.title}</strong><small>{source.key === 'canonFacts' ? 'Canon' : 'Summary'}</small></span>
                  <input type="checkbox" checked={source.includeInPrompt} onChange={(event) => updateSource(source.key, source.id, { includeInPrompt: event.target.checked })} />
                  装入
                </label>
              ))}
            </section>
        ) : (
          <StoryGraph book={props.book} onOpenSection={props.onOpenSection} />
        )}
      </section>
    </div>
  );
}

function StoryGraph({ book, onOpenSection }: { book: Book; onOpenSection: (id: string) => void }) {
  return (
    <section className="graph-view" aria-labelledby="graph-heading">
      <div className="graph-intro">
        <p className="eyebrow">Book 隔离视图</p>
        <h2 id="graph-heading">{book.title} 的资料与正文</h2>
        <p>角色卡和世界观条例是不同资料类型，只在这本书的生成计划中出现。</p>
      </div>
      <div className="graph-flow">
        <div className="graph-node graph-root"><small>Book</small><strong>{book.title}</strong></div>
        <div className="graph-branch">
          <div className="graph-column">
            <p>角色卡</p>
            {book.characters.map((item) => <div className="graph-node" key={item.id}><small>角色</small><strong>{item.name}</strong></div>)}
          </div>
          <div className="graph-column">
            <p>世界观条例</p>
            {book.worldRules.map((item) => <div className="graph-node" key={item.id}><small>条例</small><strong>{item.title}</strong></div>)}
          </div>
        </div>
        {book.chapters.map((chapter) => (
          <div className="graph-column graph-manuscript" key={chapter.id}>
            <div className="graph-node"><small>章节</small><strong>{chapter.title}</strong></div>
            {chapter.sections.map((section) => (
              <button className="graph-node" type="button" key={section.id} onClick={() => onOpenSection(section.id)}>
                <small>正文</small><strong>{section.title}</strong>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsDrawer({ dialogRef, theme, onThemeChange, onClose }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  onClose: () => void;
}) {
  const closeDrawer = () => dialogRef.current?.close();

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
        <h3 id="theme-heading">主题</h3>
        <div className="theme-options">
          <label className="theme-option">
            <input type="radio" name="theme" value="paper" checked={theme === 'paper'} onChange={() => onThemeChange('paper')} />
            <span><strong>Paper</strong><small>类 Notion / Obsidian 的安静默认版</small></span>
          </label>
          <label className="theme-option manga-option">
            <input type="radio" name="theme" value="manga" checked={theme === 'manga'} onChange={() => onThemeChange('manga')} />
            <span><strong>少女漫画</strong><small>沿用你现在酒馆的粉紫交互语言</small></span>
          </label>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">当前存储</h3>
        <p className="helper-copy">正文和资料会先自动保存到当前设备。{api.runtime === 'cloud' ? '联网时同时同步到你的私有云端书库。' : '本机 host 同时写入故事目录。'}</p>
      </section>
    </dialog>
  );
}

function PromptDialog({ dialogRef, plan, onClose }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  plan: ContextPlan | null;
  onClose: () => void;
}) {
  const closeDialog = () => dialogRef.current?.close();

  return (
    <dialog
      className="prompt-dialog"
      ref={dialogRef}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDialog();
        }
      }}
      aria-labelledby="prompt-dialog-title"
      aria-describedby="prompt-dialog-description"
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">将发送给 Provider 的输入</p>
          <h2 id="prompt-dialog-title">Prompt 计划</h2>
        </div>
        <button type="button" className="icon-button" data-dialog-close autoFocus onClick={closeDialog} aria-label="关闭 Prompt 计划" title="关闭 Prompt 计划"><X aria-hidden="true" /></button>
      </div>
      {plan && (
        <div className="prompt-plan">
          <div className="plan-summary">
            <span>{plan.included.length} 个已装入区块</span>
            <strong>约 {plan.estimatedTokens.toLocaleString()} tokens</strong>
          </div>
          <div className="plan-context" aria-label="本次 Prompt 上下文">
            <span><strong>Book</strong>{plan.bookId}</span>
            <span><strong>模式</strong>{plan.mode === 'author' ? '作者模式' : '角色模式 · 第一视角'}</span>
            {plan.mode === 'character' && <span><strong>视角角色</strong>{plan.included.find((item) => item.sourceId === plan.selectedCharacterId)?.title ?? '未选择'}</span>}
          </div>
          <p id="prompt-dialog-description" className="helper-copy">这里显示的是本次 Provider 输入和粗略容量估算，不是模型隐藏推理或计费记录。区块按实际装入顺序排列。</p>
          <ol className="prompt-blocks">
            {plan.included.map((item, index) => (
              <li key={item.id}>
                <details>
                  <summary>
                    <span className="layer-index" aria-label={`第 ${index + 1} 个区块，${item.layer}`}>
                      <strong>{String(index + 1).padStart(2, '0')}</strong>
                      <small>{item.layer}</small>
                    </span>
                    <span><strong>{item.title}</strong><small>{item.reason}</small></span>
                    <span className="block-size">{item.charCount} 字符 · 约 {item.estimatedTokens} tokens</span>
                  </summary>
                  <dl>
                    <div><dt>Book</dt><dd>{item.bookId}</dd></div>
                    <div><dt>来源</dt><dd>{item.sourceId}</dd></div>
                    <div><dt>权限</dt><dd>{item.readOnly ? '系统只读' : '本书可管理'}</dd></div>
                  </dl>
                  <pre>{item.content}</pre>
                </details>
              </li>
            ))}
          </ol>
          {plan.excluded.length > 0 && (
            <details className="excluded-sources">
              <summary>{plan.excluded.length} 项未装入资料</summary>
              <ul>
                {plan.excluded.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.reason}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </dialog>
  );
}

export default App;
