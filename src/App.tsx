import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  FileJson,
  FileText,
  FilePlus2,
  FolderPlus,
  Globe2,
  KeyRound,
  Layers3,
  ListChecks,
  Menu,
  MessageSquareText,
  Minus,
  Pencil,
  PlugZap,
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
import { createBookExport, type BookExportFormat } from './bookExport';
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
  PromptLayer,
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
const manuscriptFontSizeKey = 'story-native:manuscript-font-size';
const manuscriptFontFamilyKey = 'story-native:manuscript-font-family';
type ManuscriptFontFamily = 'sans' | 'wenkai';
const minManuscriptFontSize = 12;
const maxManuscriptFontSize = 24;
const defaultManuscriptFontSize = 16;
const clampManuscriptFontSize = (value: number) => Math.min(
  maxManuscriptFontSize,
  Math.max(minManuscriptFontSize, Math.round(value)),
);
const generalPromptOrder = [
  { id: 'template-contract', layer: 'system', title: '正文合同', reason: '连续小说正文与 Book 隔离底线', cacheBand: 'stable' },
  { id: 'template-book', layer: 'book', title: '当前书目', reason: '锁定本次写作所属的书', cacheBand: 'stable' },
  { id: 'template-style', layer: 'book', title: '写作风格指导', reason: '全书共用的行文风格', cacheBand: 'stable' },
  { id: 'template-world', layer: 'world', title: '世界观设定', reason: '当前小节加载的世界设定', cacheBand: 'stable' },
  { id: 'template-characters', layer: 'character', title: '角色卡', reason: '当前小节加载或当前扮演必需的角色设定', cacheBand: 'stable' },
  { id: 'template-outline', layer: 'book', title: '剧情大纲', reason: '全书共用的剧情方向', cacheBand: 'stable' },
  { id: 'template-mode', layer: 'mode', title: '作者 / 角色模式', reason: '本次写作的权限与视角', cacheBand: 'session' },
  { id: 'template-note', layer: 'note', title: '小节注释', reason: '只指导当前小节的下一次续写，位于正文前', cacheBand: 'dynamic' },
  { id: 'template-manuscript', layer: 'manuscript', title: '当前正文', reason: '选中小节的正文末尾', cacheBand: 'dynamic' },
  { id: 'template-instruction', layer: 'instruction', title: '本轮输入', reason: '作者接龙正文或角色输入', cacheBand: 'dynamic' },
] satisfies Array<{ id: string; layer: PromptLayer; title: string; reason: string; cacheBand: PromptCacheBand }>;

type PromptCompositionItem = {
  id: string;
  layer: PromptLayer;
  title: string;
  reason: string;
  cacheBand: PromptCacheBand;
  estimatedTokens: number;
  includedNames?: string[];
};

export const combinePromptSources = (items: PromptCompositionItem[]) => {
  const combined: PromptCompositionItem[] = [];
  const grouped = new Map<'character' | 'world', PromptCompositionItem>();

  items.forEach((item) => {
    if (item.layer !== 'character' && item.layer !== 'world') {
      combined.push(item);
      return;
    }

    const existing = grouped.get(item.layer);
    if (existing) {
      existing.estimatedTokens += item.estimatedTokens;
      existing.includedNames?.push(item.title);
      return;
    }

    const aggregate = {
      ...item,
      id: `combined-${item.layer}`,
      title: item.layer === 'character' ? '角色卡' : '世界观设定',
      reason: item.layer === 'character' ? '本次装入的角色设定' : '本次装入的世界设定',
      includedNames: item.id.startsWith('template-') ? undefined : [item.title],
    };
    grouped.set(item.layer, aggregate);
    combined.push(aggregate);
  });

  return combined;
};

const promptTone = (index: number) => `var(--prompt-tone-${index % 6 + 1})`;

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

const newerBook = (stored: Book, cached: Book | null) => {
  if (!cached) return stored;
  const storedTime = Date.parse(stored.updatedAt);
  const cachedTime = Date.parse(cached.updatedAt);
  return Number.isFinite(cachedTime) && (!Number.isFinite(storedTime) || cachedTime > storedTime)
    ? cached
    : stored;
};

function App() {
  const [library, setLibrary] = useState<BookIndexEntry[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [view, setView] = useState<ViewName>('shelf');
  const [mode, setMode] = useState<GenerationMode>('author');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [authorNote, setAuthorNote] = useState('');
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem('story-theme');
    return stored === 'manga' || stored === 'gray' || stored === 'purple' ? stored : 'paper';
  });
  const [manuscriptFontFamily, setManuscriptFontFamily] = useState<ManuscriptFontFamily>(() =>
    localStorage.getItem(manuscriptFontFamilyKey) === 'wenkai' ? 'wenkai' : 'sans');
  const [manuscriptFontSize, setManuscriptFontSize] = useState(() => {
    const stored = localStorage.getItem(manuscriptFontSizeKey);
    if (stored === null) return defaultManuscriptFontSize;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampManuscriptFontSize(parsed) : defaultManuscriptFontSize;
  });
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(() =>
    readProviderProfiles(localStorage.getItem(providerProfilesKey)));
  const [activeProviderProfileId, setActiveProviderProfileId] = useState(() =>
    localStorage.getItem(activeProviderProfileKey) ?? 'provider-primary');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(api.runtime === 'device' ? '正在打开此设备的书库…' : '正在打开本机书库…');
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const exportTrigger = useRef<HTMLElement | null>(null);
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
        authorNote: mode === 'author' ? authorNote : undefined,
        instruction,
      });
    } catch {
      return null;
    }
  }, [authorNote, book, instruction, mode, section, selectedCharacterId, view]);
  const activeProviderProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('story-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--manuscript-font-size', `${manuscriptFontSize}px`);
    localStorage.setItem(manuscriptFontSizeKey, String(manuscriptFontSize));
  }, [manuscriptFontSize]);

  useEffect(() => {
    document.documentElement.dataset.manuscriptFont = manuscriptFontFamily;
    localStorage.setItem(manuscriptFontFamilyKey, manuscriptFontFamily);
  }, [manuscriptFontFamily]);

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
        setStatus(api.runtime === 'device' ? '此设备的书库已打开。' : '本机书库已打开。');
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
      ? (api.runtime === 'device' ? '已自动保存到此设备。' : '已自动保存到此设备，正在写入本机故事目录…')
      : '当前设备的浏览器存储不可用。');

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
        setStatus(api.runtime === 'device'
          ? '已自动保存到此设备。'
          : '已自动保存到此设备和本机故事目录。');
      }).catch((error) => {
        if (saveRevision.current === revision) {
          setStatus(`${error instanceof Error ? error.message : '保存失败。'} ${cachedLocally
            ? '当前设备缓存仍保留本次修改。'
            : '请立即复制正文或导出仍可访问的内容。'}`);
        }
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [book, dirty]);

  const openBook = async (bookId: string) => {
    const stored = await api.loadBook(bookId);
    const cached = readCachedBook(bookId);
    const loaded = newerBook(stored, cached);
    cacheBook(loaded);
    saveRevision.current += 1;
    setBook(loaded);
    setSectionId('');
    setSelectedCharacterId(loaded.characters[0]?.id ?? '');
    setInstruction('');
    setAuthorNote('');
    setDirty(loaded === cached && loaded.updatedAt !== stored.updatedAt);
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
    setStatus(api.runtime === 'device'
      ? '已自动保存到此设备。'
      : '已自动保存到此设备和本机故事目录。');
    return saved;
  };

  const closeExport = () => {
    exportDialog.current?.close();
    window.requestAnimationFrame(() => exportTrigger.current?.focus());
  };

  const openExport = () => {
    if (!book) return;
    if (document.activeElement instanceof HTMLElement) exportTrigger.current = document.activeElement;
    exportDialog.current?.showModal();
  };

  const exportCurrentBook = (format: BookExportFormat) => {
    if (!book) return;
    try {
      cacheBook(book);
      const file = createBookExport(book, format);
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      closeExport();
      const label = format === 'epub' ? 'EPUB 电子书'
        : format === 'markdown' ? 'Markdown 文档'
          : format === 'text' ? 'TXT 文档' : 'JSON 完整备份';
      setStatus(`已从当前设备导出《${book.title}》的${label}。`);
    } catch (error) {
      setStatus(error instanceof Error ? `导出失败：${error.message}` : '导出失败。');
    }
  };

  const generationRequest = (saved: Book) => ({
    bookId: saved.id,
    sectionId,
    mode,
    selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
    authorNote: mode === 'author' ? authorNote : undefined,
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

  const generateContinuation = () => withBusy(async () => {
    if (!hasCharacterSelection()) {
      setStatus('角色模式需要先选择当前 Book 的角色。');
      return;
    }
    const targetSectionId = sectionId;
    const inputSnapshot = instruction;
    const noteSnapshot = authorNote;
    const modeSnapshot = mode;
    const characterSnapshot = selectedCharacterId;
    const saved = await saveCurrent();
    const result = await api.generate({
      bookId: saved.id,
      sectionId: targetSectionId,
      mode: modeSnapshot,
      selectedCharacterId: modeSnapshot === 'character' ? characterSnapshot : undefined,
      authorNote: modeSnapshot === 'author' ? noteSnapshot : undefined,
      instruction: inputSnapshot,
    });
    const additions: SectionBlock[] = [
      ...(inputSnapshot.trim()
        ? [{ id: makeId('block'), kind: 'user' as const, content: inputSnapshot.trim() }]
        : []),
      { id: makeId('block'), kind: 'assistant', content: result.draft },
    ];
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === targetSectionId
          ? (() => {
              const blocks = [...sectionBlocks(item), ...additions];
              return { ...item, blocks, content: blocksAsContent(blocks) };
            })()
          : item),
        })),
    }));
    setInstruction((current) => current === inputSnapshot ? '' : current);
    setAuthorNote((current) => current === noteSnapshot ? '' : current);
    setStatus('续写已加入当前小节。');
  });

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
      setInstruction('');
      setAuthorNote('');
      setDirty(false);
      setView('shelf');
      setStatus(api.runtime === 'device' ? '新书目已建立在此设备。' : '新书目已建立在本机。');
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
    if (result.removedSectionIds.has(sectionId)) {
      setSectionId('');
      setInstruction('');
      setAuthorNote('');
    }
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
        <span className="header-leading-space" aria-hidden="true" />
        <div className="header-context" aria-live="polite">
          <strong>故事书架</strong>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={openExport}
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
            authorNote={authorNote}
            busy={busy}
            contextTokens={promptPreview?.estimatedTokens ?? 0}
            maxContext={activeProviderProfile?.maxContext ?? 0}
            providerName={activeProviderProfile?.name ?? '未选择方案'}
            modelId={activeProviderProfile?.modelId ?? '未选择模型'}
            onBack={navigateFromHeader}
            onOpenBookSettings={() => {
              setReturnToWriterAfterSettings(true);
              setView('shelf');
              setBookSettingsRequest((current) => current + 1);
            }}
            onExport={openExport}
            onOpenSettings={openSettings}
            onModeChange={setMode}
            onCharacterChange={setSelectedCharacterId}
            onInstructionChange={setInstruction}
            onAuthorNoteChange={setAuthorNote}
            onSectionBlocksChange={updateSectionBlocks}
            onRegenerateBlock={regenerateBlock}
            onSectionTitleChange={(title) => {
              if (sectionChapter && section) renameSection(sectionChapter.id, section.id, title);
            }}
            onGenerate={() => void generateContinuation()}
          />
        ) : book ? (
          <Bookshelf
            book={book}
            library={library}
            selectedSectionId={sectionId}
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
                setInstruction('');
                setAuthorNote('');
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
          />
        ) : (
          <p className="loading-copy">正在打开此设备的书库…</p>
        )}
      </main>

      <div className={view === 'write' ? 'sr-only' : 'status-line'} role="status" aria-live="polite">{status}</div>

      <SettingsDrawer
        dialogRef={settingsDialog}
        theme={theme}
        onThemeChange={setTheme}
        manuscriptFontFamily={manuscriptFontFamily}
        onManuscriptFontFamilyChange={setManuscriptFontFamily}
        manuscriptFontSize={manuscriptFontSize}
        onManuscriptFontSizeChange={setManuscriptFontSize}
        providerProfiles={providerProfiles}
        activeProviderProfileId={activeProviderProfileId}
        onSelectProviderProfile={setActiveProviderProfileId}
        onSaveProviderProfile={saveProviderProfile}
        promptPlan={promptPreview}
        onClose={() => settingsTrigger.current?.focus()}
      />

      <ExportDialog
        bookTitle={book?.title ?? ''}
        dialogRef={exportDialog}
        onExport={exportCurrentBook}
        onClose={closeExport}
      />

    </div>
  );
}

function ExportDialog({
  bookTitle,
  dialogRef,
  onExport,
  onClose,
}: {
  bookTitle: string;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onExport: (format: BookExportFormat) => void;
  onClose: () => void;
}) {
  const options: Array<{
    format: BookExportFormat;
    title: string;
    description: string;
    icon: typeof BookOpenText;
  }> = [
    { format: 'epub', title: 'EPUB 电子书', description: '自带书、章、节目录，适合阅读器与 Kindle', icon: BookOpenText },
    { format: 'markdown', title: 'Markdown 文档', description: '可编辑长文，自带章、节目录', icon: ScrollText },
    { format: 'text', title: 'TXT 纯文字', description: '最简兼容格式，保留目录与层级编号', icon: FileText },
    { format: 'json', title: 'JSON 完整备份', description: '保留角色卡、设定、加载范围与正文结构', icon: FileJson },
  ];

  return (
    <dialog
      className="export-dialog"
      ref={dialogRef}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      aria-labelledby="export-dialog-title"
    >
      <div className="export-dialog-body">
        <header className="dialog-heading">
          <div>
            <small>仅从当前设备生成文件</small>
            <h2 id="export-dialog-title">导出《{bookTitle}》</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭导出选项" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="export-option-list">
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                type="button"
                className="export-option"
                key={option.format}
                onClick={() => onExport(option.format)}
              >
                <OptionIcon aria-hidden="true" />
                <span><strong>{option.title}</strong><small>{option.description}</small></span>
                <Download aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="helper-copy">应用不会上传书稿；文档如何备份或同步由你选择。</p>
      </div>
    </dialog>
  );
}

interface WriterProps {
  book: Book;
  section: Book['chapters'][number]['sections'][number] | undefined;
  chapterTitle: string;
  mode: GenerationMode;
  selectedCharacterId: string;
  instruction: string;
  authorNote: string;
  busy: boolean;
  contextTokens: number;
  maxContext: number;
  providerName: string;
  modelId: string;
  onBack: () => void;
  onOpenBookSettings: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: GenerationMode) => void;
  onCharacterChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onAuthorNoteChange: (value: string) => void;
  onSectionBlocksChange: (blocks: SectionBlock[]) => void;
  onRegenerateBlock: (blockId: string) => void;
  onSectionTitleChange: (value: string) => void;
  onGenerate: () => void;
}

function Writer(props: WriterProps) {
  const selectedCharacter = props.book.characters.find((character) => character.id === props.selectedCharacterId);
  const characterModeNeedsSelection = props.mode === 'character' && !selectedCharacter;
  const blocks = props.section ? sectionBlocks(props.section) : [];
  const [sectionTitle, setSectionTitle] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [editingBlockId, setEditingBlockId] = useState('');
  const titleDialog = useRef<HTMLDialogElement>(null);
  const titleTrigger = useRef<HTMLElement | null>(null);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const deleteBlockDialog = useRef<HTMLDialogElement>(null);
  const blockActionTrigger = useRef<HTMLElement | null>(null);
  const readerScrollPosition = useRef(0);
  const selectedBlock = blocks.find((item) => item.id === selectedBlockId);
  const editingBlock = blocks.find((item) => item.id === editingBlockId);

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

  const openBlockEditor = () => {
    if (!selectedBlock) return;
    readerScrollPosition.current = window.scrollY;
    setEditingBlockId(selectedBlock.id);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };

  const closeBlockEditor = () => {
    setEditingBlockId('');
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: readerScrollPosition.current });
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.manuscript-block[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
    });
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

  if (editingBlock) {
    const editorLabel = editingBlock.kind === 'user' ? '用户输入' : 'AI 输出';
    return (
      <article className="block-editor-page" aria-labelledby="block-editor-title">
        <header className="block-editor-header">
          <button
            type="button"
            className="icon-button"
            onClick={closeBlockEditor}
            aria-label="返回正文"
            title="返回正文"
          ><ArrowLeft aria-hidden="true" /></button>
          <div className="block-editor-heading">
            <h1 id="block-editor-title">编辑{editorLabel}</h1>
            <p title={`${props.book.title} · ${props.chapterTitle} · ${props.section?.title ?? ''}`}>
              {props.book.title} · {props.chapterTitle} · {props.section?.title ?? ''} · 自动保存
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={closeBlockEditor}
            aria-label="完成编辑并返回正文"
            title="完成"
          ><Check aria-hidden="true" /></button>
        </header>
        <main className="block-editor-body">
          <label className="sr-only" htmlFor="block-editor-textarea">{editorLabel}内容</label>
          <textarea
            id="block-editor-textarea"
            className="block-editor-textarea"
            data-kind={editingBlock.kind}
            autoFocus
            value={editingBlock.content}
            onChange={(event) => props.onSectionBlocksChange(blocks.map((item) => item.id === editingBlock.id
              ? { ...item, content: event.target.value }
              : item))}
            spellCheck
          />
        </main>
      </article>
    );
  }

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
          <small className="writer-provider-line">
            <span>{props.providerName}</span><span aria-hidden="true">|</span><span>{props.modelId}</span>
          </small>
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
            <div className="manuscript-block-group" data-selected={selectedBlockId === block.id || undefined} key={block.id}>
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
              >
                <span className="sr-only">{block.kind === 'user' ? '用户输入：' : 'AI 输出：'}</span>
                <span className="manuscript-block-copy">{renderBlockContent(block)}</span>
              </button>
              {selectedBlockId === block.id && (
                <div className="manuscript-block-actions" role="group" aria-label={`所选${block.kind === 'user' ? '用户输入' : 'AI 输出'}操作`}>
                  {block.kind === 'assistant' && <button
                    type="button"
                    className="icon-button"
                    onClick={() => props.onRegenerateBlock(block.id)}
                    disabled={props.busy}
                    aria-label="重新生成所选 AI 输出"
                    title="重新生成"
                  ><RefreshCw aria-hidden="true" /></button>}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={openBlockEditor}
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
            </div>
          ))}
          {blocks.length === 0 && <p className="empty-manuscript">本节还没有正文。</p>}
        </div>
      </section>

      <form className="instruction-dock" onSubmit={(event) => { event.preventDefault(); props.onGenerate(); }}>
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
                onClick={() => props.onModeChange('author')}
              ><BookOpenText aria-hidden="true" />作者模式 · 写作接龙</button>
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
            {props.mode === 'author' && (
              <label className="writer-section-note" htmlFor="author-note-input">
                <span><MessageSquareText aria-hidden="true" />小节注释</span>
                <textarea
                  id="author-note-input"
                  rows={4}
                  value={props.authorNote}
                  onChange={(event) => props.onAuthorNoteChange(event.target.value)}
                  placeholder="例如：跳过路程，直接写抵达后的重逢……"
                  spellCheck
                />
                <small>只指导当前小节的下一次续写，不进入正文；发送后自动清空。</small>
              </label>
            )}
          </div>
        </details>
        <label className="sr-only" htmlFor="writing-instruction">{props.mode === 'author' ? '接龙正文' : '角色行动或台词'}</label>
        <textarea
          id="writing-instruction"
          rows={1}
          value={props.instruction}
          onChange={(event) => props.onInstructionChange(event.target.value)}
          placeholder={props.mode === 'author' ? '写下一段正文，让 AI 从这里接着写……' : '以当前角色输入行动、台词或选择……'}
        />
        <button
          type="submit"
          className="primary-action icon-button writer-send-button"
          disabled={props.busy || characterModeNeedsSelection}
          aria-label={props.busy ? '正在续写' : '发送并续写'}
          title={props.busy ? '正在续写…' : '发送并续写'}
        ><Sparkles aria-hidden="true" /></button>
      </form>

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
          ? settingsWorldRule?.title ?? '世界观设定'
          : '本书设定';
  const bookSettingsEyebrow = bookSettingsView.kind === 'root'
    ? '全局指引 · 角色 · 世界'
    : `本书设定 · ${props.book.title}`;

  return (
    <div className="shelf-page">
      <section className="shelf-content">
        <aside className="book-rail" aria-label="书目选择">
          <details className="book-library-drawer">
            <summary className="book-selector-card">
              <BookOpenText aria-hidden="true" />
              <span><small>书</small><strong>{props.book.title}</strong></span>
              <ChevronDown className="book-selector-chevron" aria-hidden="true" />
            </summary>
            <div className="book-library-panel">
              <div className="book-actions-row">
                <button
                  type="button"
                  className="icon-button"
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
            </div>
          </details>
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
        onClick={(event) => { if (event.target === event.currentTarget) closeBookSettings(); }}
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
                          ? `${selectedSourceIds.has(rule.id) ? '取消选择' : '选择'}世界观设定${rule.title}`
                          : `打开世界观设定${rule.title}`}
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

function SettingsDrawer({
  dialogRef,
  theme,
  onThemeChange,
  manuscriptFontFamily,
  onManuscriptFontFamilyChange,
  manuscriptFontSize,
  onManuscriptFontSizeChange,
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
  manuscriptFontFamily: ManuscriptFontFamily;
  onManuscriptFontFamilyChange: (font: ManuscriptFontFamily) => void;
  manuscriptFontSize: number;
  onManuscriptFontSizeChange: (size: number) => void;
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
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const compositionItems = combinePromptSources(promptPlan?.included.map((item) => ({
    id: item.id,
    layer: item.layer,
    title: item.title,
    reason: item.reason,
    cacheBand: item.cacheBand,
    estimatedTokens: item.estimatedTokens,
  })) ?? generalPromptOrder.map((item) => ({ ...item, estimatedTokens: 0 })));
  const stablePrefixCount = compositionItems.filter((item) => item.cacheBand === 'stable').length;
  const stablePrefixTokens = promptPlan?.included
    .filter((item) => item.cacheBand === 'stable')
    .reduce((total, item) => total + item.estimatedTokens, 0) ?? 0;
  const totalPromptTokens = promptPlan?.estimatedTokens ?? 0;
  const promptWeights = compositionItems.map((item) => (
    totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens : 1 / compositionItems.length
  ));
  let promptWeightCursor = 0;
  const promptSegmentCenters = promptWeights.map((weight) => {
    const center = (promptWeightCursor + weight / 2) * 100;
    promptWeightCursor += weight;
    return center;
  });
  const closeDrawer = () => dialogRef.current?.close();
  const clearConnectionResult = () => {
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const selectProfile = (profile: ProviderProfile) => {
    onSelectProviderProfile(profile.id);
    setEditingId(profile.id);
    setProfileDraft({ ...profile });
    setApiKeyDraft(sessionKeys[profile.id] ?? '');
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const startNewProfile = () => {
    setEditingId('');
    setProfileDraft(blankProfile());
    setApiKeyDraft('');
    setConnectionStatus('');
    setConnectionState('idle');
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
    setConnectionState('idle');
  };
  const testProfileConnection = async () => {
    const baseUrl = profileDraft.baseUrl.trim().replace(/\/+$/, '');
    const modelId = profileDraft.modelId.trim();
    if (!baseUrl || !modelId || !apiKeyDraft.trim()) {
      setConnectionState('error');
      setConnectionStatus('请先填写 URL、模型 ID 和 API Key。');
      return;
    }

    let endpoint: URL;
    try {
      endpoint = new URL(`${baseUrl}/models`);
      if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') throw new Error();
    } catch {
      setConnectionState('error');
      setConnectionStatus('请填写以 http:// 或 https:// 开头的有效 URL。');
      return;
    }

    setConnectionState('testing');
    setConnectionStatus('正在测试连接…');
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKeyDraft.trim()}`,
        },
      });
      if (!response.ok) {
        setConnectionState('error');
        setConnectionStatus(response.status === 401 || response.status === 403
          ? '连接失败：API Key 无效或没有权限。'
          : `连接失败：服务返回 HTTP ${response.status}。`);
        return;
      }

      const payload = await response.json() as { data?: Array<{ id?: unknown }> };
      const modelIds = Array.isArray(payload.data)
        ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
        : [];
      if (modelIds.length > 0 && !modelIds.includes(modelId)) {
        setConnectionState('error');
        setConnectionStatus('连接成功，但模型列表中没有这个模型 ID。');
        return;
      }

      setConnectionState('success');
      setConnectionStatus('连接有效，模型 ID 可用。');
    } catch {
      setConnectionState('error');
      setConnectionStatus('无法连接。请检查地址，或确认服务允许浏览器访问 /models。');
    }
  };

  return (
    <dialog
      className="settings-drawer"
      ref={dialogRef}
      onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}
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
          <option value="paper">蓝雪 · 默认</option>
          <option value="manga">粉漫</option>
          <option value="gray">灰度</option>
          <option value="purple">紫雅</option>
        </select>
        <p className="compact-setting-note">{{
          paper: '白色内容页、灰蓝边缘与分级标题色。',
          manga: '沿用酒馆的粉紫交互语言。',
          gray: '冷灰纸面配酒红、赭金与墨蓝标题。',
          purple: '白色正文配淡紫边缘与深紫层级。',
        }[theme]}</p>
        <label className="font-family-setting" htmlFor="manuscript-font-select">
          <span>正文字体</span>
          <select
            id="manuscript-font-select"
            value={manuscriptFontFamily}
            onChange={(event) => onManuscriptFontFamilyChange(event.target.value as ManuscriptFontFamily)}
          >
            <option value="sans">无衬线 · 默认</option>
            <option value="wenkai">霞鹜文楷</option>
          </select>
        </label>
        <div className="font-size-setting" role="group" aria-labelledby="font-size-setting-label">
          <span id="font-size-setting-label">字号大小</span>
          <div className="font-size-stepper">
            <button
              type="button"
              className="icon-button"
              onClick={() => onManuscriptFontSizeChange(clampManuscriptFontSize(manuscriptFontSize - 1))}
              disabled={manuscriptFontSize <= minManuscriptFontSize}
              aria-label="减小正文字号"
              title="减小正文字号"
            ><Minus aria-hidden="true" /></button>
            <output aria-live="polite" aria-label={`当前正文字号 ${manuscriptFontSize} 像素`}>{manuscriptFontSize}</output>
            <button
              type="button"
              className="icon-button"
              onClick={() => onManuscriptFontSizeChange(clampManuscriptFontSize(manuscriptFontSize + 1))}
              disabled={manuscriptFontSize >= maxManuscriptFontSize}
              aria-label="增大正文字号"
              title="增大正文字号"
            ><Plus aria-hidden="true" /></button>
          </div>
        </div>
        <p className="compact-setting-note">正文 12–24 px；手机编辑器最低保持 16 px。</p>
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
              <input id="provider-profile-name" name="provider-profile-name" required autoComplete="off" value={profileDraft.name} onChange={(event) => { clearConnectionResult(); setProfileDraft((current) => ({ ...current, name: event.target.value })); }} placeholder="例如：主要模型" />

              <label htmlFor="provider-api-key">API Key</label>
              <input id="provider-api-key" name="provider-api-key" type="password" autoComplete="off" spellCheck={false} value={apiKeyDraft} onChange={(event) => { clearConnectionResult(); setApiKeyDraft(event.target.value); }} placeholder="sk-…" />

              <label htmlFor="provider-base-url">URL</label>
              <input id="provider-base-url" name="provider-base-url" type="url" required autoComplete="url" spellCheck={false} value={profileDraft.baseUrl} onChange={(event) => { clearConnectionResult(); setProfileDraft((current) => ({ ...current, baseUrl: event.target.value })); }} placeholder="https://api.example.com/v1" />

              <label htmlFor="provider-model-id">模型 ID</label>
              <input id="provider-model-id" name="provider-model-id" required autoComplete="off" spellCheck={false} value={profileDraft.modelId} onChange={(event) => { clearConnectionResult(); setProfileDraft((current) => ({ ...current, modelId: event.target.value })); }} placeholder="model-id" />

              <div className="provider-number-grid">
                <label>最大上下文<input name="provider-max-context" type="number" inputMode="numeric" min="1" required value={profileDraft.maxContext} onChange={(event) => { clearConnectionResult(); setProfileDraft((current) => ({ ...current, maxContext: Number(event.target.value) })); }} /></label>
                <label>最大输出<input name="provider-max-output" type="number" inputMode="numeric" min="1" required value={profileDraft.maxOutput} onChange={(event) => { clearConnectionResult(); setProfileDraft((current) => ({ ...current, maxOutput: Number(event.target.value) })); }} /></label>
              </div>

              <p className="provider-secret-note">API Key 不会写入书稿、私有书库或浏览器持久化；测试时只会直接发送到你填写的 URL。</p>
              <div className="provider-form-actions">
                <button
                  type="button"
                  className="quiet-action button-with-icon provider-test-button"
                  onClick={() => void testProfileConnection()}
                  disabled={connectionState === 'testing'}
                  aria-label="测试连接"
                ><PlugZap aria-hidden="true" />{connectionState === 'testing' ? '测试中' : '测试'}</button>
                <button type="submit" className="primary-action button-with-icon"><Check aria-hidden="true" />保存连接方案</button>
              </div>
              <p className="provider-save-status" data-state={connectionState} role="status" aria-live="polite">
                {connectionStatus && <><span className="provider-status-dot" aria-hidden="true" />{connectionStatus}</>}
              </p>
            </form>
          </div>
        </details>
        <details className="settings-subdrawer prompt-composition-drawer">
          <summary>
            <Layers3 aria-hidden="true" />
            <span>
              <strong>Prompt 组合</strong>
              <small>{promptPlan ? `${compositionItems.length} 组 · 稳定前缀约 ${stablePrefixTokens.toLocaleString()} tokens` : '通用顺序 · 选中小节后显示占比'}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="prompt-composition-content">
            <p className="prompt-composition-note">{promptPlan
              ? '当前小节 · 竖条按估算 tokens 比例显示，右侧按实际发送顺序排列。'
              : '主页概览 · 竖条等高表示通用顺序；进入小节后切换为当前 Prompt 占比。'}</p>
            <div
              className="prompt-composition-chart"
              style={{ '--prompt-item-count': compositionItems.length } as CSSProperties}
            >
              <div className="prompt-composition-map">
                <div className="prompt-proportion-bar" aria-hidden="true" data-template={!promptPlan}>
                  {compositionItems.map((item, index) => {
                    const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                    const tone = promptTone(index);
                    return (
                      <span
                        className="prompt-proportion-segment"
                        data-cache-band={item.cacheBand}
                        data-small={Boolean(promptPlan && share < 6)}
                        key={item.id}
                        style={{
                          '--prompt-color': tone,
                          flexGrow: promptPlan ? Math.max(item.estimatedTokens, 0.01) : 1,
                        } as CSSProperties}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                      </span>
                    );
                  })}
                </div>
                <svg className="prompt-connector-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {compositionItems.map((item, index) => (
                    <line
                      key={item.id}
                      x1="8"
                      y1={promptSegmentCenters[index]}
                      x2="25"
                      y2={(index + 0.5) / compositionItems.length * 100}
                      style={{ stroke: promptTone(index) }}
                    />
                  ))}
                </svg>
                <ol className="prompt-composition-list" aria-label="当前 Prompt 区块顺序">
                  {compositionItems.map((item, index) => {
                    const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                    return (
                      <li
                        key={item.id}
                        data-cache-band={item.cacheBand}
                        style={{ '--prompt-color': promptTone(index) } as CSSProperties}
                      >
                        <span className="prompt-composition-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="prompt-composition-copy">
                          <span className="prompt-composition-title-row">
                            <strong>{item.title}</strong>
                            <span className="prompt-composition-meta">
                              <strong>{promptPlan ? promptShareLabel(share) : '顺序'}</strong>
                              <small>{promptPlan ? `约 ${item.estimatedTokens.toLocaleString()} tokens` : `${index + 1} / ${compositionItems.length}`}</small>
                            </span>
                          </span>
                          <small>{cacheBandLabel(item.cacheBand)} · {item.reason}</small>
                          {item.includedNames?.length ? <small className="prompt-included-names">包含：{item.includedNames.join('、')}</small> : null}
                          {index === stablePrefixCount - 1 && <small className="cache-prefix-boundary">稳定前缀到这里</small>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <p className="prompt-map-caption">{promptPlan ? '段高 = 当前 tokens 占比' : '等高 = 通用拼接顺序'}</p>
            </div>
            <p className="prompt-composition-footnote">{promptPlan
              ? `${promptPlan.excluded.length > 0 ? `${promptPlan.excluded.length} 项关闭或为空，不会发送。` : '当前资料已全部装入。'}缓存是否命中仍由所选模型服务决定。`
              : '主页只显示结构，不计算虚假的 tokens 占比。'}</p>
          </div>
        </details>
      </section>
      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">当前存储</h3>
        <p className="helper-copy">{api.runtime === 'device'
          ? '正文和资料只保存在当前浏览器设备，不上传书稿。请按需导出备份，并自行选择同步方式。'
          : '正文和资料保存在本机 host 的故事目录；请自行选择文件同步方式。'}</p>
      </section>
    </dialog>
  );
}

export default App;
