import { useEffect, useMemo, useRef, useState } from 'react';
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
type ShelfTab = 'directory' | 'graph';

const firstSectionId = (book: Book) => book.chapters[0]?.sections[0]?.id ?? '';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function App() {
  const [library, setLibrary] = useState<BookIndexEntry[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [view, setView] = useState<ViewName>('write');
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

  const section = useMemo(() => book?.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === sectionId), [book, sectionId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('story-theme', theme);
  }, [theme]);

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
    const dialog = promptDialog.current;
    if (promptPlan && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-dialog-close]')?.focus();
    }
  }, [promptPlan]);

  const openBook = async (bookId: string) => {
    const loaded = await api.loadBook(bookId);
    setBook(loaded);
    setSectionId(firstSectionId(loaded));
    setSelectedCharacterId(loaded.characters[0]?.id ?? '');
    setDraft('');
    setDirty(false);
  };

  const changeBook = (recipe: (current: Book) => Book) => {
    setBook((current) => current ? recipe(current) : current);
    setDirty(true);
  };

  const saveCurrent = async () => {
    if (!book) throw new Error('请先打开一本书。');
    const saved = await api.saveBook(book);
    setBook(saved);
    setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
      ...items.filter((item) => item.id !== saved.id)]);
    setDirty(false);
    setStatus(api.runtime === 'cloud' ? '已保存到私有云端书库。' : '已保存到本机故事目录。');
    return saved;
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
      setSectionId(firstSectionId(created));
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

  const addSection = () => changeBook((current) => {
    const targetChapter = current.chapters[0];
    if (!targetChapter) return current;
    const next = { id: makeId('section'), title: `新段落 ${targetChapter.sections.length + 1}`, content: '' };
    setSectionId(next.id);
    return {
      ...current,
      chapters: current.chapters.map((chapter, index) => index === 0
        ? { ...chapter, sections: [...chapter.sections, next] }
        : chapter),
    };
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到正文</a>
      <header className="app-header">
        <div className="brand-group">
          <span className="brand-mark" aria-hidden="true">文</span>
          <span className="brand-name">Story-native</span>
          <span className="demo-badge">{api.runtime === 'cloud' ? 'Private Cloud DEMO' : 'Local DEMO'}</span>
        </div>
        <nav className="primary-tabs" aria-label="主要页面">
          <button type="button" aria-current={view === 'write' ? 'page' : undefined} onClick={() => setView('write')}>写作</button>
          <button type="button" aria-current={view === 'shelf' ? 'page' : undefined} onClick={() => setView('shelf')}>故事书架</button>
        </nav>
        <div className="header-actions">
          <button type="button" onClick={() => setTheme(theme === 'paper' ? 'manga' : 'paper')}>
            {theme === 'paper' ? '切到少女漫画' : '切到 Paper'}
          </button>
          <button type="button" className="save-button" onClick={() => void withBusy(async () => { await saveCurrent(); })}>
            {dirty ? '保存更改' : '已保存'}
          </button>
        </div>
      </header>

      <main id="main-content">
        {book && view === 'write' ? (
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
          />
        ) : book ? (
          <Bookshelf
            book={book}
            library={library}
            tab={shelfTab}
            newBookTitle={newBookTitle}
            selectedCharacterId={selectedCharacterId}
            onTabChange={setShelfTab}
            onOpenBook={(id) => void withBusy(async () => { await openBook(id); })}
            onOpenSection={(id) => { setSectionId(id); setView('write'); }}
            onNewBookTitleChange={setNewBookTitle}
            onCreateBook={createBook}
            onBookChange={changeBook}
            onSelectedCharacterChange={setSelectedCharacterId}
            onAddCharacter={addCharacter}
            onAddWorldRule={addWorldRule}
            onAddSection={addSection}
          />
        ) : (
          <p className="loading-copy">正在打开本地书库…</p>
        )}
      </main>

      <div className="status-line" role="status" aria-live="polite">{status}</div>

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
}

function Writer(props: WriterProps) {
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;

  return (
    <div className="writer-page">
      <header className="writer-heading">
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
            <button type="button" className="primary-action" onClick={props.onApplyDraft}>应用到正文</button>
            <button type="button" onClick={props.onDiscardDraft}>放弃预览</button>
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
          <button type="button" onClick={props.onShowPrompt} disabled={props.busy}>查看 Prompt</button>
          <button type="submit" className="primary-action" disabled={props.busy}>{props.busy ? '正在准备…' : '预览续写'}</button>
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
  onTabChange: (tab: ShelfTab) => void;
  onOpenBook: (id: string) => void;
  onOpenSection: (id: string) => void;
  onNewBookTitleChange: (value: string) => void;
  onCreateBook: (event: React.FormEvent) => void;
  onBookChange: (recipe: (current: Book) => Book) => void;
  onSelectedCharacterChange: (id: string) => void;
  onAddCharacter: () => void;
  onAddWorldRule: () => void;
  onAddSection: () => void;
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
        <form className="new-book-form" onSubmit={props.onCreateBook}>
          <label htmlFor="new-book-title">新 Book</label>
          <div>
            <input id="new-book-title" value={props.newBookTitle} onChange={(event) => props.onNewBookTitleChange(event.target.value)} placeholder="书名" />
            <button type="submit">新建</button>
          </div>
        </form>
        <div className="book-list">
          {props.library.map((entry) => (
            <button key={entry.id} type="button" aria-current={entry.id === props.book.id ? 'true' : undefined} onClick={() => props.onOpenBook(entry.id)}>
              <strong>{entry.title}</strong>
              <span>{new Date(entry.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="shelf-content">
        <header className="shelf-heading">
          <div>
            <p className="eyebrow">故事书架</p>
            <h1>{props.book.title}</h1>
          </div>
          <div className="content-tabs" role="group" aria-label="书架视图">
            <button type="button" aria-pressed={props.tab === 'directory'} onClick={() => props.onTabChange('directory')}>书籍目录</button>
            <button type="button" aria-pressed={props.tab === 'graph'} onClick={() => props.onTabChange('graph')}>关系图</button>
          </div>
        </header>

        {props.tab === 'directory' ? (
          <div className="directory-layout">
            <section className="directory-panel" aria-labelledby="directory-heading">
              <div className="section-heading-row">
                <h2 id="directory-heading">章节与正文</h2>
                <button type="button" onClick={props.onAddSection}>新建段落</button>
              </div>
              {props.book.chapters.map((chapter) => (
                <details key={chapter.id} open>
                  <summary>{chapter.title}</summary>
                  <div className="section-list">
                    {chapter.sections.map((section) => (
                      <button key={section.id} type="button" onClick={() => props.onOpenSection(section.id)}>
                        <span>{section.title}</span><small>{section.content.length} 字符</small>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </section>

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
          </div>
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
        <button type="button" data-dialog-close autoFocus onClick={closeDialog} aria-label="关闭 Prompt 计划">关闭</button>
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
