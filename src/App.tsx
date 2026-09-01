import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  Download,
  Ellipsis,
  FileJson,
  FileText,
  FilePlus2,
  FolderPlus,
  Globe2,
  ListTree,
  KeyRound,
  Layers3,
  ListChecks,
  Menu,
  MessageSquareText,
  Minus,
  MousePointer2,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import {
  api,
  readHostAccessTokenSettings,
  saveHostAccessTokenSettings,
  type HostAccessTokenSettings,
} from './api';
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
import { parseProseFormatting } from './proseFormatting';
import {
  commitSectionMemoryDraft,
  draftFromSectionMemory,
  isEligibleSectionMemory,
  normalizeBook,
  parseSectionMemoryDraft,
} from './sectionMemory';
import { countWords, estimateTokens } from './textMetrics';
import type {
  Book,
  BookIndexEntry,
  CharacterCard,
  ContextPlan,
  GenerationMode,
  GenerationRequest,
  PromptCacheBand,
  PromptLayer,
  SectionBlock,
  SectionContextReferenceMode,
  SectionMemoryDraft,
  SectionMemoryProvenance,
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
const bookCachePrefix = 'story-native:book:';
const bookCacheKey = (bookId: string) => `${bookCachePrefix}${bookId}`;
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
type PromptCompositionItem = {
  id: string;
  layer: PromptLayer;
  title: string;
  reason: string;
  cacheBand: PromptCacheBand;
  estimatedTokens: number;
  includedNames?: string[];
};

type PromptCompositionGroup = {
  key: string;
  title: string;
  reason: string;
  estimatedTokens: number;
};

type SectionDraft = {
  instruction: string;
  authorNote: string;
};

const sectionDraftKey = (bookId: string, sectionId: string) => `${bookId}:${sectionId}`;
const emptySectionDraft = (): SectionDraft => ({ instruction: '', authorNote: '' });
const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
  || error instanceof Error && error.name === 'AbortError';
const abortGenerationError = () => {
  try {
    return new DOMException('生成已取消。', 'AbortError');
  } catch {
    const error = new Error('生成已取消。');
    error.name = 'AbortError';
    return error;
  }
};

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusFirstDrawerElement = (drawer: HTMLElement | null) => {
  const first = [...(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    .find((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
  first?.focus();
};

const trapDrawerFocus = (event: KeyboardEvent, drawer: HTMLElement) => {
  if (event.key !== 'Tab') return;
  const focusable = [...drawer.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (!drawer.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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

const promptCompositionGroup = (item: PromptCompositionItem): Omit<PromptCompositionGroup, 'estimatedTokens'> => {
  if (item.layer === 'system') return { key: 'rules', title: '写作规则', reason: '守住写作边界' };
  if (item.layer === 'summary' || item.title.startsWith('REFERENCE')) {
    return { key: 'references', title: '前文梗概/全文', reason: '带入已完成前文' };
  }
  if (item.layer === 'manuscript') return { key: 'writing', title: '正在写', reason: '衔接并完成当前小节' };
  if (item.layer === 'mode' || item.layer === 'note' || item.layer === 'instruction'
    || item.title.startsWith('TARGET SECTION PLAN') || item.title === '剧情大纲') {
    return { key: 'turn', title: '本节计划/本轮要求', reason: '帮助本轮推进当前小节' };
  }
  return { key: 'story', title: '故事设定', reason: '保持角色、世界和故事事实一致' };
};

export const groupPromptComposition = (items: PromptCompositionItem[]): PromptCompositionGroup[] => {
  const groups = new Map<string, PromptCompositionGroup>();
  items.forEach((item) => {
    const next = promptCompositionGroup(item);
    const existing = groups.get(next.key);
    if (existing) {
      existing.estimatedTokens += item.estimatedTokens;
      return;
    }
    groups.set(next.key, { ...next, estimatedTokens: item.estimatedTokens });
  });
  return [...groups.values()];
};

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
  if (api.runtime !== 'device') return null;
  try {
    const value = localStorage.getItem(bookCacheKey(bookId));
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    return isCachedBook(parsed, bookId) ? normalizeBook(parsed) : null;
  } catch {
    return null;
  }
};

const cacheBook = (book: Book) => {
  if (api.runtime !== 'device') return false;
  try {
    localStorage.setItem(bookCacheKey(book.id), JSON.stringify(normalizeBook(book)));
    return true;
  } catch {
    return false;
  }
};

const removeCachedBook = (bookId: string) => {
  if (api.runtime !== 'device') return;
  try {
    localStorage.removeItem(bookCacheKey(bookId));
  } catch {
    // Browser persistence is optional on the device runtime.
  }
};

const clearHostBookCaches = () => {
  if (api.runtime === 'device') return;
  const staleKeys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(bookCachePrefix)) staleKeys.push(key);
    }
  } catch {
    return;
  }
  for (const key of staleKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // A storage failure must not prevent the host app from starting.
    }
  }
};

const newerBook = (stored: Book, cached: Book | null) => {
  const normalizedStored = normalizeBook(stored);
  if (!cached) return normalizedStored;
  const normalizedCached = normalizeBook(cached);
  const storedTime = Date.parse(normalizedStored.updatedAt);
  const cachedTime = Date.parse(normalizedCached.updatedAt);
  return Number.isFinite(cachedTime) && (!Number.isFinite(storedTime) || cachedTime > storedTime)
    ? normalizedCached
    : normalizedStored;
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
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(() => api.runtime === 'device'
    ? readProviderProfiles(localStorage.getItem(providerProfilesKey))
    : []);
  const [activeProviderProfileId, setActiveProviderProfileId] = useState(() =>
    localStorage.getItem(activeProviderProfileKey) ?? 'provider-primary');
  const [hostAccessTokenSettings, setHostAccessTokenSettings] = useState<HostAccessTokenSettings>(() =>
    api.runtime === 'host' ? readHostAccessTokenSettings() : { enabled: false, token: '' });
  const [dirty, setDirty] = useState(false);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionDraft>>({});
  const [busy, setBusy] = useState(false);
  const [generationState, setGenerationState] = useState<'idle' | 'generating'>('idle');
  const [status, setStatus] = useState(api.runtime === 'device' ? '正在打开此设备的书库…' : '正在打开本机书库…');
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const exportTrigger = useRef<HTMLElement | null>(null);
  const contextCompositionTrigger = useRef<HTMLElement | null>(null);
  const [contextCompositionOpen, setContextCompositionOpen] = useState(false);
  const contextToolsTrigger = useRef<HTMLElement | null>(null);
  const [contextToolsOpen, setContextToolsOpen] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  const restoreShelfFocus = useRef(false);
  const restoreWriterFocus = useRef(false);
  const [bookSettingsRequest, setBookSettingsRequest] = useState(0);
  const [newBookRequest, setNewBookRequest] = useState(0);
  const [returnToWriterAfterSettings, setReturnToWriterAfterSettings] = useState(false);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sectionDraftsRef = useRef<Record<string, SectionDraft>>({});
  const generationAbort = useRef<AbortController | null>(null);
  const generationTarget = useRef<{ bookId: string; sectionId: string; targetBlockId?: string } | null>(null);
  const navigationState = useRef({ dirty: false, busy: false, instruction: '', authorNote: '', sectionDrafts: {} as Record<string, SectionDraft> });

  const section = useMemo(() => book?.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === sectionId), [book, sectionId]);
  const sectionChapter = useMemo(() => book?.chapters.find((chapter) =>
    chapter.sections.some((candidate) => candidate.id === sectionId)), [book, sectionId]);
  const activeProviderProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  const contextPreview = useMemo(() => {
    if (view !== 'write' || !book || !section) return { plan: null, error: '' };
    try {
      return { plan: composeContextPlan(book, {
        sectionId: section.id,
        mode,
        selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
        authorNote: mode === 'author' ? authorNote : undefined,
        instruction,
      }, activeProviderProfile ? {
        maxContext: activeProviderProfile.maxContext,
        maxOutput: activeProviderProfile.maxOutput,
      } : undefined), error: '' };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error
          ? `暂时无法预览当前上下文：${error.message} 请检查当前小节和连接方案后重试。`
          : '暂时无法预览当前上下文。请检查当前小节和连接方案后重试。',
      };
    }
  }, [activeProviderProfile, authorNote, book, instruction, mode, section, selectedCharacterId, view]);
  const promptPreview = contextPreview.plan;
  const promptPreviewError = contextPreview.error;
  useEffect(() => {
    clearHostBookCaches();
  }, []);

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
    if (api.runtime !== 'device') return;
    try {
      localStorage.setItem(providerProfilesKey, JSON.stringify(providerProfiles));
      localStorage.setItem(activeProviderProfileKey, activeProviderProfileId);
    } catch {
      // Settings still work for the current page when browser persistence is unavailable.
    }
  }, [activeProviderProfileId, providerProfiles]);

  useEffect(() => {
    sectionDraftsRef.current = sectionDrafts;
    navigationState.current = { dirty, busy, instruction, authorNote, sectionDrafts };
  }, [authorNote, busy, dirty, instruction, sectionDrafts]);

  useEffect(() => {
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      const current = navigationState.current;
      const hasDraft = Object.values(current.sectionDrafts).some((draft) => (
        draft.instruction.trim() || draft.authorNote.trim()
      ));
      if (!current.dirty && !current.busy && !current.instruction.trim() && !current.authorNote.trim() && !hasDraft) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsavedWork);
    return () => window.removeEventListener('beforeunload', protectUnsavedWork);
  }, []);

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

  const rememberCurrentSectionDraft = () => {
    if (!book || !sectionId) return;
    const key = sectionDraftKey(book.id, sectionId);
    const draft = { instruction, authorNote };
    const next = { ...sectionDraftsRef.current };
    if (!draft.instruction.trim() && !draft.authorNote.trim()) delete next[key];
    else next[key] = draft;
    sectionDraftsRef.current = next;
    navigationState.current = { ...navigationState.current, instruction, authorNote, sectionDrafts: next };
    setSectionDrafts(next);
  };

  const updateSectionDraft = (field: keyof SectionDraft, value: string) => {
    if (field === 'instruction') setInstruction(value);
    else setAuthorNote(value);
    if (!book || !sectionId) return;
    const key = sectionDraftKey(book.id, sectionId);
    const draft = { ...emptySectionDraft(), ...sectionDraftsRef.current[key], [field]: value };
    const next = { ...sectionDraftsRef.current };
    if (!draft.instruction.trim() && !draft.authorNote.trim()) delete next[key];
    else next[key] = draft;
    sectionDraftsRef.current = next;
    navigationState.current = {
      ...navigationState.current,
      instruction: field === 'instruction' ? value : navigationState.current.instruction,
      authorNote: field === 'authorNote' ? value : navigationState.current.authorNote,
      sectionDrafts: next,
    };
    setSectionDrafts(next);
  };

  const restoreSectionDraft = (bookId: string, nextSectionId: string) => {
    const draft = sectionDraftsRef.current[sectionDraftKey(bookId, nextSectionId)] ?? emptySectionDraft();
    setInstruction(draft.instruction);
    setAuthorNote(draft.authorNote);
  };

  const clearSectionDraft = (bookId: string, nextSectionId: string, sentInstruction: string, sentAuthorNote: string) => {
    const key = sectionDraftKey(bookId, nextSectionId);
    const current = sectionDraftsRef.current[key];
    if (!current || current.instruction !== sentInstruction || current.authorNote !== sentAuthorNote) return;
    const next = { ...sectionDraftsRef.current };
    delete next[key];
    sectionDraftsRef.current = next;
    setSectionDrafts(next);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [entries, profiles] = await Promise.all([
          api.listBooks(),
          api.listProviderProfiles(),
        ]);
        setProviderProfiles(profiles);
        setActiveProviderProfileId((current) => profiles.some((profile) => profile.id === current)
          ? current
          : profiles[0]?.id ?? '');
        setLibrary(entries);
        if (entries[0]) await openBook(entries[0].id);
        setStatus('');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '无法打开书库。');
      }
    })();
  }, []);

  useEffect(() => {
    if (!book || !dirty) return;
    const candidate = normalizeBook(book);
    const cachedLocally = api.runtime === 'device' ? cacheBook(candidate) : false;
    setLibrary((items) => [{ id: book.id, title: book.title, updatedAt: book.updatedAt },
      ...items.filter((item) => item.id !== book.id)]);
    setStatus(api.runtime === 'device'
      ? (cachedLocally ? '已自动保存到此设备。' : '当前设备的浏览器存储不可用。')
      : '正在保存到书库…');

    const revision = saveRevision.current;
    const timer = window.setTimeout(() => {
      const task = saveQueue.current.catch(() => undefined).then(() => api.saveBook(candidate));
      saveQueue.current = task.then(() => undefined, () => undefined);
      void task.then((saved) => {
        if (saveRevision.current !== revision) return;
        const normalizedSaved = normalizeBook(saved);
        if (api.runtime === 'device') cacheBook(normalizedSaved);
        setBook((current) => current?.id === normalizedSaved.id ? normalizedSaved : current);
        setLibrary((items) => [{ id: normalizedSaved.id, title: normalizedSaved.title, updatedAt: normalizedSaved.updatedAt },
          ...items.filter((item) => item.id !== saved.id)]);
        setDirty(false);
        setStatus(api.runtime === 'device'
          ? '已自动保存到此设备。'
          : '已自动保存。');
      }).catch((error) => {
        if (saveRevision.current === revision) {
          const recovery = api.runtime === 'device' && cachedLocally
            ? '当前设备缓存仍保留本次修改。'
            : '请立即复制正文或导出仍可访问的内容。';
          setStatus(`${error instanceof Error ? error.message : '保存失败。'} ${recovery}`);
        }
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [book, dirty]);

  const openBook = async (bookId: string) => {
    if (book && book.id !== bookId && dirty) await saveCurrent();
    rememberCurrentSectionDraft();
    const stored = normalizeBook(await api.loadBook(bookId));
    const cached = api.runtime === 'device' ? readCachedBook(bookId) : null;
    const loaded = normalizeBook(newerBook(stored, cached));
    if (api.runtime === 'device') cacheBook(loaded);
    saveRevision.current += 1;
    setBook(loaded);
    setSectionId('');
    setSelectedCharacterId(loaded.characters[0]?.id ?? '');
    restoreSectionDraft(loaded.id, '');
    setDirty(Boolean(cached && loaded.updatedAt !== stored.updatedAt));
    setView('shelf');
  };

  const updateHostAccessToken = async (enabled: boolean, token: string) => {
    const next = saveHostAccessTokenSettings(enabled, token);
    setHostAccessTokenSettings(next);
    setStatus('正在重新连接本机书库…');
    try {
      const [entries, profiles] = await Promise.all([
        api.listBooks(),
        api.listProviderProfiles(),
      ]);
      setLibrary(entries);
      setProviderProfiles(profiles);
      setActiveProviderProfileId((current) => profiles.some((profile) => profile.id === current)
        ? current
        : profiles[0]?.id ?? '');
      if (!book && entries[0]) await openBook(entries[0].id);
      setStatus('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法重新连接本机书库。';
      setStatus(message);
      throw new Error(message);
    }
  };

  const changeBook = (recipe: (current: Book) => Book) => {
    saveRevision.current += 1;
    setBook((current) => current
      ? normalizeBook({ ...recipe(current), updatedAt: new Date().toISOString() })
      : current);
    setDirty(true);
  };

  const queueBookSave = (candidate: Book) => {
    const task = saveQueue.current.catch(() => undefined).then(() => api.saveBook(candidate));
    saveQueue.current = task.then(() => undefined, () => undefined);
    return task;
  };

  const saveCurrent = async (candidateOverride?: Book) => {
    const currentBook = candidateOverride ?? book;
    if (!currentBook) throw new Error('请先打开一本书。');
    const candidate = normalizeBook(currentBook);
    const revision = saveRevision.current;
    setStatus(api.runtime === 'device' ? '正在保存到此设备…' : '正在保存到书库…');
    if (api.runtime === 'device') cacheBook(candidate);
    const saved = normalizeBook(await queueBookSave(candidate));
    if (saveRevision.current === revision) {
      if (api.runtime === 'device') cacheBook(saved);
      setBook(saved);
      setDirty(false);
    }
    setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
      ...items.filter((item) => item.id !== saved.id)]);
    setStatus(api.runtime === 'device'
      ? '已自动保存到此设备。'
      : '已自动保存。');
    return saved;
  };

  const ensureCurrentBookSaved = async () => {
    if (!book || !dirty) return book;
    return saveCurrent();
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
      const normalized = normalizeBook(book);
      if (api.runtime === 'device') cacheBook(normalized);
      const file = createBookExport(normalized, format);
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

  const generationRequest = (
    saved: Book,
    options: Pick<GenerationRequest, 'generationKind' | 'targetBlockId'> = {},
  ) => ({
    bookId: saved.id,
    sectionId,
    providerProfileId: activeProviderProfile?.id,
    mode,
    selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
    authorNote: mode === 'author' ? authorNote : undefined,
    instruction,
    ...options,
  });

  const assertGenerationBudget = (saved: Book, request: GenerationRequest) => {
    const { bookId: _bookId, ...planRequest } = request;
    const plan = composeContextPlan(saved, planRequest, activeProviderProfile ? {
      maxContext: activeProviderProfile.maxContext,
      maxOutput: activeProviderProfile.maxOutput,
    } : undefined);
    if (!plan.budget.overflow) return plan;
    const largest = [...plan.included]
      .sort((left, right) => right.estimatedTokens - left.estimatedTokens)
      .slice(0, 3)
      .map((item) => item.title)
      .join('、');
    throw new Error(`上下文预算不足：约超出 ${plan.budget.overflowTokens.toLocaleString()} tokens。占用较大的内容：${largest || '当前输入'}。`);
  };

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(isAbortError(error)
        ? '已取消生成；迟到结果未写入正文。'
        : error instanceof Error ? error.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  };

  const runGeneration = async (request: GenerationRequest, label: string) => {
    if (generationAbort.current) throw new Error('已有生成正在进行，请先完成或取消当前生成。');
    const controller = new AbortController();
    const target = {
      bookId: request.bookId,
      sectionId: request.sectionId,
      targetBlockId: request.targetBlockId,
    };
    generationAbort.current = controller;
    generationTarget.current = target;
    setGenerationState('generating');
    setStatus(label);
    try {
      const result = await api.generate(request, controller.signal);
      if (controller.signal.aborted
        || generationAbort.current !== controller
        || generationTarget.current !== target) throw abortGenerationError();
      return result;
    } finally {
      if (generationAbort.current === controller) {
        generationAbort.current = null;
        generationTarget.current = null;
        setGenerationState('idle');
      }
    }
  };

  const cancelGeneration = () => {
    if (!generationAbort.current) return;
    generationAbort.current.abort();
    setStatus('正在取消生成…');
  };

  const hasCharacterSelection = () => mode !== 'character'
    || Boolean(book?.characters.some((character) => character.id === selectedCharacterId));

  const generateContinuation = () => withBusy(async () => {
    if (!hasCharacterSelection()) {
      setStatus('角色模式需要先选择本书角色。');
      return;
    }
    const targetSectionId = sectionId;
    const inputSnapshot = instruction;
    const noteSnapshot = authorNote;
    const modeSnapshot = mode;
    const characterSnapshot = selectedCharacterId;
    const saved = await saveCurrent();
    const generation = {
      bookId: saved.id,
      sectionId: targetSectionId,
      providerProfileId: activeProviderProfile?.id,
      mode: modeSnapshot,
      selectedCharacterId: modeSnapshot === 'character' ? characterSnapshot : undefined,
      authorNote: modeSnapshot === 'author' ? noteSnapshot : undefined,
      instruction: inputSnapshot,
      generationKind: 'continue-section',
    } satisfies GenerationRequest;
    assertGenerationBudget(saved, generation);
    const result = await runGeneration(generation, '正在生成当前小节…');
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
    clearSectionDraft(saved.id, targetSectionId, inputSnapshot, noteSnapshot);
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
      const generation = generationRequest(saved, {
        generationKind: 'regenerate-block',
        targetBlockId: blockId,
      });
      assertGenerationBudget(saved, generation);
      const result = await runGeneration(generation, '正在重新生成所选正文片段…');
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
      await ensureCurrentBookSaved();
      rememberCurrentSectionDraft();
      const created = await api.createBook(title);
      const normalizedCreated = normalizeBook(created);
      setLibrary((items) => [{ id: normalizedCreated.id, title: normalizedCreated.title, updatedAt: normalizedCreated.updatedAt }, ...items]);
      setBook(normalizedCreated);
      if (api.runtime === 'device') cacheBook(normalizedCreated);
      saveRevision.current += 1;
      setSectionId('');
      setSelectedCharacterId('');
      restoreSectionDraft(normalizedCreated.id, '');
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
      await ensureCurrentBookSaved();
      saveRevision.current += 1;
      setDirty(false);
      try {
        await saveQueue.current.catch(() => undefined);
        await api.deleteBook(deletedBook.id);
        removeCachedBook(deletedBook.id);
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

  const referenceLocation = (current: Book, sourceSectionId: string) => {
    let ordinal = 0;
    for (const chapter of current.chapters) {
      const sectionIndex = chapter.sections.findIndex((item) => item.id === sourceSectionId);
      if (sectionIndex >= 0) return { chapter, section: chapter.sections[sectionIndex], sectionIndex, ordinal: ordinal + sectionIndex };
      ordinal += chapter.sections.length;
    }
    return undefined;
  };

  const updateContextReferences = (references: Book['chapters'][number]['sections'][number]['contextReferences']) => {
    if (!section) return;
    const targetSectionId = section.id;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          if (item.id !== targetSectionId) return item;
          if (!references?.length) {
            const { contextReferences: _removed, ...withoutReferences } = item;
            return withoutReferences;
          }
          const unique = new Map(references.map((reference) => [reference.sectionId, reference] as const));
          return { ...item, contextReferences: [...unique.values()] };
        }),
      })),
    }));
  };

  const updateContextReference = (sourceSectionId: string, mode: SectionContextReferenceMode | 'none') => {
    if (!book || !section) return;
    if (mode !== 'full' && mode !== 'none' && mode !== 'summary' && mode !== 'both') return;
    const source = referenceLocation(book, sourceSectionId);
    const targetOrdinal = book
      ? book.chapters.flatMap((chapter) => chapter.sections).findIndex((item) => item.id === section.id)
      : -1;
    if (!source || targetOrdinal < 0 || source.ordinal >= targetOrdinal) return;
    if ((mode === 'summary' || mode === 'both')
      && !isEligibleSectionMemory(source.section.memory, source.section.content)) return;
    const references = (section.contextReferences ?? [])
      .filter((reference) => reference.sectionId !== sourceSectionId);
    // mode: 'full' remains the default manual reference selection.
    if (mode !== 'none') references.push({ sectionId: sourceSectionId, mode, reason: 'manual' });
    updateContextReferences(references);
  };

  const generateSectionMemory = async (sourceSectionId: string) => {
    setBusy(true);
    try {
      if (!book || !section) throw new Error('请先选择一个小节。');
      const source = referenceLocation(book, sourceSectionId);
      if (!source) throw new Error('找不到要生成梗概的小节。');
      const targetOrdinal = book.chapters.flatMap((chapter) => chapter.sections)
        .findIndex((item) => item.id === section.id);
      if (targetOrdinal < 0 || source.ordinal >= targetOrdinal) throw new Error('只能为当前小节之前的内容生成梗概。');
      if (!source.section.content.trim()) throw new Error('这一节还没有正文，无法生成梗概。');
      const saved = await saveCurrent();
      const generation = {
        bookId: saved.id,
        sectionId: sourceSectionId,
        providerProfileId: activeProviderProfile?.id,
        mode: 'author',
        instruction: '',
        generationKind: 'summarize-section',
      } satisfies GenerationRequest;
      assertGenerationBudget(saved, generation);
      const result = await runGeneration(generation, '正在生成前文梗概…');
      const draft = parseSectionMemoryDraft(result.draft);
      setStatus(`已生成「${source.section.title}」的梗概草稿，请确认保存。`);
      return draft;
    } catch (error) {
      setStatus(isAbortError(error)
        ? '已取消生成；迟到结果未写入正文。'
        : error instanceof Error ? error.message : '梗概生成失败。');
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const saveSectionMemoryAndLoad = async (
    sourceSectionId: string,
    draft: SectionMemoryDraft,
    provenance: SectionMemoryProvenance,
  ) => {
    if (!book || !section) throw new Error('请先选择一个小节。');
    const targetSectionId = section.id;
    let sourceTitle = '';
    const source = referenceLocation(book, sourceSectionId);
    const targetOrdinal = book.chapters.flatMap((chapter) => chapter.sections)
      .findIndex((item) => item.id === targetSectionId);
    if (!source || targetOrdinal < 0 || source.ordinal >= targetOrdinal) {
      throw new Error('只能保存当前小节之前内容的梗概。');
    }
    sourceTitle = source.section.title;
    const committedSource = commitSectionMemoryDraft(source.section, draft, provenance);
    const candidate = normalizeBook({
      ...book,
      updatedAt: new Date().toISOString(),
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          if (item.id === sourceSectionId) return committedSource;
          if (item.id !== targetSectionId) return item;
          const references = (item.contextReferences ?? [])
            .filter((reference) => reference.sectionId !== sourceSectionId);
          references.push({ sectionId: sourceSectionId, mode: 'summary', reason: 'manual' });
          return { ...item, contextReferences: references };
        }),
      })),
    });
    saveRevision.current += 1;
    setBook(candidate);
    setDirty(true);
    await saveCurrent(candidate);
    setStatus(`已保存并加载「${sourceTitle}」的梗概。`);
  };

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

  const saveProviderProfile = async (profile: ProviderProfile, apiKey?: string) => {
    const saved = await api.saveProviderProfile(profile, apiKey);
    setProviderProfiles((current) => upsertProviderProfile(current, saved));
    setActiveProviderProfileId(saved.id);
    return saved;
  };

  const navigateFromHeader = () => {
    if (view === 'shelf') return;
    if (busy) {
      setStatus(generationState === 'generating' ? '生成进行中，请先取消或等待完成。' : '正在保存当前书目，请稍候。');
      return;
    }
    restoreShelfFocus.current = true;
    setView('shelf');
  };

  const openSettings = () => {
    if (document.activeElement instanceof HTMLElement) {
      settingsTrigger.current = document.activeElement;
    }
    settingsDialog.current?.showModal();
  };

  const closeContextComposition = () => {
    setContextCompositionOpen(false);
    const trigger = contextCompositionTrigger.current;
    contextCompositionTrigger.current?.focus();
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const closeContextTools = () => {
    setContextToolsOpen(false);
    const trigger = contextToolsTrigger.current;
    contextToolsTrigger.current?.focus();
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const openContextComposition = () => {
    if (contextCompositionOpen) {
      closeContextComposition();
      return;
    }
    if (document.activeElement instanceof HTMLElement) contextCompositionTrigger.current = document.activeElement;
    setContextToolsOpen(false);
    setContextCompositionOpen(true);
  };

  const openContextTools = () => {
    if (contextToolsOpen) {
      closeContextTools();
      return;
    }
    if (document.activeElement instanceof HTMLElement) contextToolsTrigger.current = document.activeElement;
    setContextCompositionOpen(false);
    setContextToolsOpen(true);
  };

  useEffect(() => {
    if (!contextCompositionOpen && !contextToolsOpen) return undefined;
    const closeOpenContextDrawer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (contextCompositionOpen) closeContextComposition();
      if (contextToolsOpen) closeContextTools();
    };
    document.addEventListener('keydown', closeOpenContextDrawer);
    return () => document.removeEventListener('keydown', closeOpenContextDrawer);
  }, [contextCompositionOpen, contextToolsOpen]);

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
            onClick={() => setNewBookRequest((current) => current + 1)}
            disabled={!book}
            aria-haspopup="dialog"
            aria-label="新建书目"
            title="新建书目"
          >
            <BookPlus aria-hidden="true" />
          </button>
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
            status={status}
            generationState={generationState}
            contextPlanError={promptPreviewError}
            contextPlan={promptPreview}
            contextCompositionOpen={contextCompositionOpen}
            contextToolsOpen={contextToolsOpen}
            providerName={activeProviderProfile?.name ?? '未选择方案'}
            modelId={activeProviderProfile?.modelId ?? '未选择模型'}
            onBack={navigateFromHeader}
            onOpenBookSettings={() => {
              setReturnToWriterAfterSettings(true);
              setView('shelf');
              setBookSettingsRequest((current) => current + 1);
            }}
            onOpenSettings={openSettings}
            onOpenContextComposition={openContextComposition}
            onOpenContextTools={openContextTools}
            onCancelGeneration={cancelGeneration}
            onModeChange={setMode}
            onCharacterChange={setSelectedCharacterId}
            onInstructionChange={(value) => updateSectionDraft('instruction', value)}
            onAuthorNoteChange={(value) => updateSectionDraft('authorNote', value)}
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
            openNewBookRequest={newBookRequest}
            onNewBookOpened={() => setNewBookRequest(0)}
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
              if (busy) return;
              rememberCurrentSectionDraft();
              if (id !== sectionId) {
                restoreSectionDraft(book.id, id);
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
        onTestProviderProfile={api.testProviderProfile}
        providerRuntime={api.runtime}
        hostAccessTokenSettings={hostAccessTokenSettings}
        onHostAccessTokenChange={updateHostAccessToken}
        onClose={() => settingsTrigger.current?.focus()}
      />

      {book && section && (
        <ContextToolsDrawer
          open={contextToolsOpen}
          book={book}
          section={section}
          onContextReferenceChange={updateContextReference}
          onContextReferencesChange={updateContextReferences}
          onGenerateMemory={generateSectionMemory}
          onSaveMemoryAndLoad={saveSectionMemoryAndLoad}
          busy={busy}
          onCancelGeneration={cancelGeneration}
          onClose={closeContextTools}
        />
      )}

      <ExportDialog
        bookTitle={book?.title ?? ''}
        dialogRef={exportDialog}
        onExport={exportCurrentBook}
        onClose={closeExport}
      />

    </div>
  );
}

function ContextCompositionDrawer({
  open,
  plan,
  error,
  onClose,
}: {
  open: boolean;
  plan: ContextPlan | null;
  error: string;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => focusFirstDrawerElement(drawerRef.current), 200);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (drawerRef.current) trapDrawerFocus(event, drawerRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);
  const compositionItems = plan ? groupPromptComposition(combinePromptSources(plan.included.map((item) => ({
    id: item.id,
    layer: item.layer,
    title: item.title,
    reason: item.reason,
    cacheBand: item.cacheBand,
    estimatedTokens: item.estimatedTokens,
  })))) : [];
  const totalPromptTokens = compositionItems.reduce((total, item) => total + item.estimatedTokens, 0);

  return (
    <section
      id="context-composition-drawer"
      ref={drawerRef}
      className="context-composition-drawer"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      aria-labelledby="context-composition-drawer-title"
    >
      <div className="context-composition-scroll">
        <header className="drawer-heading">
          <div>
            <h2 id="context-composition-drawer-title">本轮组合</h2>
          </div>
          <button type="button" className="icon-button" ref={closeButtonRef} onClick={onClose} aria-label="关闭本轮组合" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="prompt-composition-content">
          {error ? <p className="context-preview-error" role="alert">{error}</p> : plan && <div className="prompt-composition-chart">
            <div className="prompt-composition-map">
              <div className="prompt-proportion-bar" aria-hidden="true">
                {compositionItems.map((item, index) => {
                  const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                  return <span className="prompt-proportion-segment" key={item.key} style={{ '--prompt-color': promptTone(index), flexGrow: Math.max(item.estimatedTokens, 0.01) } as CSSProperties} />;
                })}
              </div>
              <ol className="prompt-composition-list" aria-label="本轮带入内容顺序">
                {compositionItems.map((item, index) => {
                  const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                  return <li key={item.key} style={{ '--prompt-color': promptTone(index) } as CSSProperties}>
                    <span className="prompt-composition-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="prompt-composition-copy"><span className="prompt-composition-title-row"><strong>{item.title}</strong><span className="prompt-composition-meta"><strong>{promptShareLabel(share)}</strong><small>约 {item.estimatedTokens.toLocaleString()} tokens</small></span></span><small>{item.reason}</small></span>
                  </li>;
                })}
              </ol>
            </div>
          </div>}
        </div>
      </div>
    </section>
  );
}

function ContextToolsDrawer({
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
  onContextReferenceChange: (sourceSectionId: string, mode: SectionContextReferenceMode | 'none') => void;
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
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const summaryConfirmDialog = useRef<HTMLDialogElement>(null);
  const summaryActionTrigger = useRef<HTMLElement | null>(null);
  const summaryActionAccepted = useRef(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>({});
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<string, SectionMemoryDraft>>({});
  const [summaryBusyId, setSummaryBusyId] = useState('');
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [pendingSummarySectionId, setPendingSummarySectionId] = useState('');
  const [pendingSummaryAction, setPendingSummaryAction] = useState<'generate' | 'save' | ''>('');
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => focusFirstDrawerElement(drawerRef.current), 200);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (drawerRef.current) trapDrawerFocus(event, drawerRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);
  useEffect(() => {
    setExpandedSections(new Set());
    setSummaryDrafts({});
    setGeneratedDrafts({});
    setSummaryBusyId('');
    setSummaryErrors({});
    summaryConfirmDialog.current?.close();
    setPendingSummarySectionId('');
    setPendingSummaryAction('');
  }, [section.id]);

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
  const selectedReferenceCount = currentReferences.size;
  const allSelected = referenceSections.length > 0
    && referenceSections.every((item) => currentReferences.has(item.section.id));
  const someSelected = selectedReferenceCount > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      onContextReferencesChange(undefined);
      return;
    }
    onContextReferencesChange(referenceSections.map((item) => ({
      sectionId: item.section.id,
      mode: currentReferences.get(item.section.id) ?? 'full',
      reason: 'manual' as const,
    })));
  };
  const toggleSection = (sourceSectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sourceSectionId)) next.delete(sourceSectionId);
      else next.add(sourceSectionId);
      return next;
    });
  };
  const summaryValue = (item: typeof referenceSections[number]) => (
    Object.prototype.hasOwnProperty.call(summaryDrafts, item.section.id)
      ? summaryDrafts[item.section.id]!
      : item.section.memory?.synopsis ?? ''
  );
  const updateSummary = (sourceSectionId: string, value: string) => {
    setSummaryDrafts((current) => ({ ...current, [sourceSectionId]: value }));
    setSummaryErrors((current) => ({ ...current, [sourceSectionId]: '' }));
  };
  const generateSummary = async (item: typeof referenceSections[number]) => {
    setSummaryBusyId(item.section.id);
    setSummaryErrors((current) => ({ ...current, [item.section.id]: '' }));
    try {
      const draft = await onGenerateMemory(item.section.id);
      setGeneratedDrafts((current) => ({ ...current, [item.section.id]: draft }));
      setSummaryDrafts((current) => ({ ...current, [item.section.id]: draft.synopsis }));
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
    void saveSummaryAndLoad(item);
    window.setTimeout(() => document.getElementById(`context-summary-textarea-${item.section.id}`)?.focus(), 0);
  };
  const pendingSummarySection = referenceSections.find((item) => item.section.id === pendingSummarySectionId);
  const saveSummaryAndLoad = async (item: typeof referenceSections[number]) => {
    const synopsis = summaryValue(item).trim();
    if (!synopsis) {
      setSummaryErrors((current) => ({ ...current, [item.section.id]: '请先填写或生成梗概。' }));
      return;
    }
    const generated = generatedDrafts[item.section.id];
    const existing = draftFromSectionMemory(item.section.memory);
    const draft: SectionMemoryDraft = {
      ...(generated ?? existing ?? {
        synopsis: '',
        beats: [],
        continuityFacts: [],
        characterStateChanges: [],
        foreshadowingCandidates: [],
      }),
      synopsis,
    };
    const provenance: SectionMemoryProvenance = generated
      ? generated.synopsis.trim() === synopsis ? 'model-confirmed' : 'model-edited'
      : item.section.memory?.provenance.startsWith('model-') ? 'model-edited' : 'manual';
    try {
      await onSaveMemoryAndLoad(item.section.id, draft, provenance);
      setSummaryDrafts((current) => ({ ...current, [item.section.id]: synopsis }));
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
    <aside
      id="context-tools-drawer"
      ref={drawerRef}
      className="context-tools-drawer"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      aria-labelledby="context-tools-drawer-title"
    >
      <div className="context-tools-drawer-scroll">
        <header className="drawer-heading">
          <h2 id="context-tools-drawer-title">前文选择</h2>
          <button type="button" className="icon-button" ref={closeButtonRef} onClick={onClose} aria-label="关闭前文选择" title="关闭">
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
                  <small>已选 {selectedReferenceCount}/{referenceSections.length} 小节</small>
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
                        const mode = currentReferences.get(item.section.id);
                        const selected = Boolean(mode);
                        const expanded = expandedSections.has(item.section.id);
                        const panelId = `context-summary-${item.section.id}`;
                        const value = summaryValue(item);
                        const summaryBusy = summaryBusyId === item.section.id;
                        return (
                          <Fragment key={item.section.id}>
                            <div className="context-reference-row">
                              <label className="context-reference-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => onContextReferenceChange(item.section.id, selected ? 'none' : 'full')}
                                  disabled={busy}
                                />
                                <span className="sr-only">加载{item.section.title}全文</span>
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
                                    onChange={(event) => updateSummary(item.section.id, event.target.value)}
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
                                    disabled={(busy && !summaryBusy) || !item.section.content.trim()}
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
                                  <p className="context-summary-error" id={`context-summary-error-${item.section.id}`} role="alert">{summaryErrors[item.section.id]}</p>
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
        onClose={() => {
          setPendingSummarySectionId('');
          setPendingSummaryAction('');
          if (!summaryActionAccepted.current) {
            window.requestAnimationFrame(() => summaryActionTrigger.current?.focus());
          }
          summaryActionAccepted.current = false;
        }}
        onCancel={(event) => { event.preventDefault(); summaryConfirmDialog.current?.close(); }}
        aria-labelledby="summary-confirm-dialog-title"
        aria-describedby="summary-confirm-dialog-description"
      >
        <header className="dialog-heading">
          <h2 id="summary-confirm-dialog-title">
            {pendingSummaryAction === 'save' ? '保存并加载梗概' : '生成该节梗概'}
          </h2>
          <button type="button" className="icon-button" onClick={() => summaryConfirmDialog.current?.close()} aria-label="关闭确认" title="关闭">
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
            <button type="button" className="quiet-action" onClick={() => summaryConfirmDialog.current?.close()}>取消</button>
            <button type="button" className="primary-action button-with-icon" onClick={confirmSummaryAction}>
              {pendingSummaryAction === 'save'
                ? <><Check aria-hidden="true" />确认保存并加载</>
                : <><Sparkles aria-hidden="true" />确认生成</>}
            </button>
          </div>
        </div>
      </dialog>
    </aside>
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
  status: string;
  generationState: 'idle' | 'generating';
  contextPlan: ContextPlan | null;
  contextPlanError: string;
  contextCompositionOpen: boolean;
  contextToolsOpen: boolean;
  providerName: string;
  modelId: string;
  onBack: () => void;
  onOpenBookSettings: () => void;
  onOpenSettings: () => void;
  onOpenContextComposition: () => void;
  onOpenContextTools: () => void;
  onCancelGeneration: () => void;
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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleTrigger = useRef<HTMLElement | null>(null);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const deleteBlockDialog = useRef<HTMLDialogElement>(null);
  const blockActionTrigger = useRef<HTMLElement | null>(null);
  const readerScrollPosition = useRef(0);
  const manuscriptWrapRef = useRef<HTMLElement>(null);
  const instructionDockRef = useRef<HTMLFormElement>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const resizePressTimer = useRef<number | null>(null);
  const resizeGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const resizeGestureActive = useRef(false);
  const [instructionInputHeight, setInstructionInputHeight] = useState<number | null>(null);
  const [instructionDockHeight, setInstructionDockHeight] = useState(0);
  const [isResizingInstruction, setIsResizingInstruction] = useState(false);
  const selectedBlock = blocks.find((item) => item.id === selectedBlockId);
  const editingBlock = blocks.find((item) => item.id === editingBlockId);
  const manuscriptText = blocksAsContent(blocks);
  const manuscriptWordCount = countWords(manuscriptText);
  const manuscriptTokenCount = estimateTokens(manuscriptText);

  const contextTokens = props.contextPlan?.budget.estimatedInput ?? 0;
  const availableInput = props.contextPlan?.budget.availableInput ?? 0;
  const contextPercent = availableInput > 0
    ? Math.round((contextTokens / availableInput) * 100)
    : 0;
  const progressMax = Math.max(1, availableInput);
  const progressValue = Math.min(contextTokens, progressMax);

  useEffect(() => () => {
    if (resizePressTimer.current !== null) window.clearTimeout(resizePressTimer.current);
  }, []);

  useEffect(() => {
    const dock = instructionDockRef.current;
    if (!dock) return undefined;
    const updateDockHeight = () => setInstructionDockHeight(dock.getBoundingClientRect().height);
    updateDockHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateDockHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [instructionInputHeight, props.authorNote, props.mode]);

  const clampInstructionHeight = (height: number) => Math.min(
    Math.max(44, height),
    Math.min(window.innerHeight * 0.45, 320),
  );

  const finishInstructionResize = (pointerId?: number, target?: HTMLButtonElement) => {
    if (resizePressTimer.current !== null) {
      window.clearTimeout(resizePressTimer.current);
      resizePressTimer.current = null;
    }
    if (pointerId !== undefined && target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    resizeGesture.current = null;
    resizeGestureActive.current = false;
    setIsResizingInstruction(false);
  };

  const openTitleDialog = () => {
    if (document.activeElement instanceof HTMLElement) {
      titleTrigger.current = document.activeElement;
    }
    setSectionTitle(props.section?.title ?? '');
    titleDialog.current?.showModal();
    const focusTitleInput = () => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    };
    focusTitleInput();
    window.requestAnimationFrame(focusTitleInput);
  };

  const restoreTitleTriggerFocus = () => {
    const trigger = titleTrigger.current;
    const focusTrigger = () => {
      if (trigger?.isConnected) trigger.focus();
    };
    focusTrigger();
    window.requestAnimationFrame(focusTrigger);
  };

  const closeActionMenu = (restoreFocus = false) => {
    if (!actionMenu.current) return;
    actionMenu.current.open = false;
    if (restoreFocus) actionMenu.current.querySelector('summary')?.focus();
  };

  const openBlockEditor = () => {
    if (!selectedBlock) return;
    readerScrollPosition.current = manuscriptWrapRef.current?.scrollTop ?? 0;
    blockActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingBlockId(selectedBlock.id);
  };

  const closeBlockEditor = () => {
    setEditingBlockId('');
    window.requestAnimationFrame(() => {
      if (manuscriptWrapRef.current) manuscriptWrapRef.current.scrollTop = readerScrollPosition.current;
      window.requestAnimationFrame(() => {
        if (blockActionTrigger.current?.isConnected) {
          blockActionTrigger.current.focus({ preventScroll: true });
          return;
        }
        document.querySelector<HTMLElement>(`.manuscript-block-group[data-selected="true"] .manuscript-block-actions button`)?.focus({ preventScroll: true });
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
    const renderDialogue = (text: string, segmentIndex: number) => block.kind === 'assistant'
      ? text.split(/(“[^”]*”|"[^"\n]*")/g).map((part, dialogueIndex) => (
        /^“[^”]*”$|^"[^"\n]*"$/.test(part)
          ? <span className="manuscript-dialogue" key={`${block.id}-${segmentIndex}-dialogue-${dialogueIndex}`}>{part}</span>
          : part
      ))
      : text;

    return parseProseFormatting(block.content).map((segment, index) => (
      segment.emphasized
        ? <em key={`${block.id}-emphasis-${index}`}>{renderDialogue(segment.text, index)}</em>
        : <Fragment key={`${block.id}-text-${index}`}>{renderDialogue(segment.text, index)}</Fragment>
    ));
  };

  const selectManuscriptBlock = (blockId: string) => {
    actionMenu.current?.removeAttribute('open');
    setSelectedBlockId((current) => current === blockId ? '' : blockId);
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
        <div className="block-editor-body">
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
        </div>
      </article>
    );
  }

  return (
    <div className="writer-page" style={instructionDockHeight > 0 ? { '--instruction-dock-height': `${instructionDockHeight}px` } as CSSProperties : undefined}>
      <header className="writer-heading">
        <div className="writer-context-row">
          <button
            type="button"
            className="icon-button writer-back-button"
            onClick={props.onBack}
            disabled={props.busy}
            aria-label="返回故事书架"
            title="返回故事书架"
          ><ArrowLeft aria-hidden="true" /></button>
          <button
            type="button"
            className="writer-context-trigger"
            onClick={props.onOpenContextComposition}
            disabled={props.busy}
            aria-expanded={props.contextCompositionOpen}
            aria-controls="context-composition-drawer"
            aria-label={props.contextPlanError
              ? `查看当前上下文：${props.contextPlanError}`
              : `查看当前上下文：已估算 ${contextTokens} tokens，可用输入 ${availableInput} tokens`}
          >
            <progress
              className="writer-context-progress"
              max={progressMax}
              value={progressValue}
              aria-hidden="true"
            />
            <span className="writer-context-count" data-over-limit={contextPercent > 100 || undefined}>
              {props.contextPlanError ? '无法预览' : `${compactTokenCount(contextTokens)} / ${compactTokenCount(availableInput)} · ${contextPercent}%`}
            </span>
            <small className="writer-provider-line">
              <span>{props.providerName}</span><span aria-hidden="true">|</span><span>{props.modelId}</span>
            </small>
            <span className="writer-manuscript-count">
              字数 <strong>{manuscriptWordCount.toLocaleString('zh-CN')}</strong>
              <span aria-hidden="true"> | </span>
              token <strong>{compactTokenCount(manuscriptTokenCount)}</strong>
            </span>
          </button>
        </div>

        {(props.contextPlan || props.contextPlanError) && (
          <ContextCompositionDrawer
            open={props.contextCompositionOpen}
            plan={props.contextPlan}
            error={props.contextPlanError}
            onClose={props.onOpenContextComposition}
          />
        )}

        <div className="writer-tool-row" role="group" aria-label="写作工具">
          <div className="writer-tool-leading">
            <button
              type="button"
              className="book-settings-button button-with-icon writer-book-settings-button"
              onClick={props.onOpenBookSettings}
              disabled={props.busy}
              aria-label="打开本书设定"
              title="本书设定"
            ><BookMarked aria-hidden="true" /><span>设定</span></button>
            <button
              type="button"
              className="icon-button writer-context-tools-button"
              onClick={props.onOpenContextTools}
              disabled={props.busy}
              aria-expanded={props.contextToolsOpen}
              aria-controls="context-tools-drawer"
              aria-label="选择前文"
              title="选择前文"
            ><ListTree aria-hidden="true" /></button>
          </div>
          <div className="writer-tool-actions">
            <button
              type="button"
              className="icon-button"
              onClick={openTitleDialog}
              disabled={!props.section || props.busy}
              aria-label="修改小节名称"
              title="修改小节名称"
            ><Pencil aria-hidden="true" /></button>
            <button
              type="button"
              className="icon-button"
              onClick={props.onOpenSettings}
              disabled={props.busy}
              aria-label="打开设置"
              title="设置"
            ><Settings aria-hidden="true" /></button>
          </div>
        </div>

        <p className="writer-section-title" title={`${props.chapterTitle} · ${props.section?.title ?? ''}`}>
          <strong>{props.chapterTitle}</strong>
          {props.section && <span> · {props.section.title}</span>}
        </p>
      <div className="writer-status-row">
        <p className="writer-status" role="status" aria-live="polite" aria-atomic="true">{props.status}</p>
        {props.generationState === 'generating' && (
          <button type="button" className="quiet-action writer-cancel-button" onClick={props.onCancelGeneration}>
            取消生成
          </button>
        )}
      </div>
      </header>

      <section className="manuscript-wrap" ref={manuscriptWrapRef} aria-labelledby="manuscript-label">
        <h2 id="manuscript-label" className="sr-only">连续小说正文</h2>
        <div className="manuscript" aria-label="连续小说正文">
          {blocks.map((block) => (
            <div className="manuscript-block-group" data-selected={selectedBlockId === block.id || undefined} key={block.id}>
              <div
                className="manuscript-block"
                data-kind={block.kind}
                onClick={() => selectManuscriptBlock(block.id)}
              >
                <span className="manuscript-block-copy">{renderBlockContent(block)}</span>
              </div>
              <button
                type="button"
                className="manuscript-block-select icon-button"
                aria-pressed={selectedBlockId === block.id}
                aria-label={`${selectedBlockId === block.id ? '取消选择' : '选择'} ${block.kind === 'user' ? '用户输入' : 'AI 输出'}片段`}
                title={`${selectedBlockId === block.id ? '取消选择' : '选择'}片段`}
                onClick={() => selectManuscriptBlock(block.id)}
              >
                <MousePointer2 aria-hidden="true" />
              </button>
              {selectedBlockId === block.id && (
                <div className="manuscript-block-actions" data-block-id={block.id} role="group" aria-label={`所选${block.kind === 'user' ? '用户输入' : 'AI 输出'}操作`}>
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

      <form ref={instructionDockRef} className="instruction-dock" onSubmit={(event) => { event.preventDefault(); props.onGenerate(); }}>
        <details
          ref={actionMenu}
          className="writer-action-menu"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeActionMenu(true);
          }}
        >
          <summary className="icon-button writer-menu-trigger" title="写作操作" aria-disabled={props.busy || undefined} onClick={(event) => { if (props.busy) { event.preventDefault(); return; } setSelectedBlockId(''); }}>
            <Menu aria-hidden="true" />
            <span className="sr-only">打开写作操作</span>
          </summary>
          <div className="writer-action-sheet" aria-label="写作操作">
            <div className="writer-menu-modes" role="group" aria-label="写作模式">
              <button
                type="button"
                className="writer-menu-action"
                disabled={props.busy}
                aria-pressed={props.mode === 'author'}
                onClick={() => props.onModeChange('author')}
              ><BookOpenText aria-hidden="true" />作者模式 · 写作接龙</button>
              <button
                type="button"
                className="writer-menu-action"
                disabled={props.busy}
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
                  disabled={props.busy}
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
                    ? '请选择本书角色后再发送。'
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
                  disabled={props.busy}
                  onChange={(event) => props.onAuthorNoteChange(event.target.value)}
                  placeholder="例如：跳过路程，直接写抵达后的重逢……"
                  spellCheck
                />
                <small>只指导当前小节的下一次续写，不进入正文；发送后自动清空。</small>
              </label>
            )}
          </div>
        </details>
        <div className="instruction-input-wrap">
          <button
            type="button"
            className="instruction-resize-handle"
            data-resizing={isResizingInstruction || undefined}
            aria-label="调整输入框高度：电脑上下拖动，手机长按后拖动"
            title="上下拖动调整高度；手机请先长按"
            onPointerDown={(event) => {
              const textarea = instructionInput.current;
              if (!textarea) return;
              resizeGesture.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: textarea.getBoundingClientRect().height,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              if (event.pointerType === 'mouse') {
                resizeGestureActive.current = true;
                setIsResizingInstruction(true);
                return;
              }
              resizePressTimer.current = window.setTimeout(() => {
                resizeGestureActive.current = true;
                setIsResizingInstruction(true);
              }, 300);
            }}
            onPointerMove={(event) => {
              const gesture = resizeGesture.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              const distance = gesture.startY - event.clientY;
              if (!resizeGestureActive.current) {
                if (Math.abs(distance) > 8) finishInstructionResize(event.pointerId, event.currentTarget);
                return;
              }
              event.preventDefault();
              setInstructionInputHeight(clampInstructionHeight(gesture.startHeight + distance));
            }}
            onPointerUp={(event) => finishInstructionResize(event.pointerId, event.currentTarget)}
            onPointerCancel={(event) => finishInstructionResize(event.pointerId, event.currentTarget)}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const currentHeight = instructionInputHeight
                ?? instructionInput.current?.getBoundingClientRect().height
                ?? 44;
              setInstructionInputHeight(clampInstructionHeight(currentHeight + (event.key === 'ArrowUp' ? 16 : -16)));
            }}
          ><span aria-hidden="true" /></button>
          <label className="sr-only" htmlFor="writing-instruction">{props.mode === 'author' ? '接龙正文' : '角色行动或台词'}</label>
          <textarea
            ref={instructionInput}
            id="writing-instruction"
            rows={1}
            value={props.instruction}
            style={instructionInputHeight === null ? undefined : { height: instructionInputHeight }}
            onChange={(event) => props.onInstructionChange(event.target.value)}
            placeholder={props.mode === 'author' ? '写下一段正文，让 AI 从这里接着写……' : '以当前角色输入行动、台词或选择……'}
          />
        </div>
        {characterModeNeedsSelection && (
          <p className="writer-send-hint" id="character-mode-send-hint" role="alert">
            角色模式需要先选择本书角色，选择后才能发送。
          </p>
        )}
        <button
            type="submit"
            className="primary-action icon-button writer-send-button"
            disabled={props.busy || characterModeNeedsSelection}
            aria-busy={props.busy || undefined}
            aria-label={props.busy ? '正在续写' : '发送并续写'}
            title={props.busy ? '正在续写…' : '发送并续写'}
            aria-describedby={characterModeNeedsSelection ? 'character-mode-send-hint' : undefined}
        ><Send aria-hidden="true" /></button>
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
        onClose={restoreTitleTriggerFocus}
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
            <input id="section-title-input" ref={titleInputRef} required autoComplete="off" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
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
  const restoreDialogFocus = (trigger: React.RefObject<HTMLElement | null>) => {
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
                              {countWords(section.content).toLocaleString('zh-CN')} 字 | {compactTokenCount(estimateTokens(section.content))} tokens
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
  onTestProviderProfile,
  providerRuntime,
  hostAccessTokenSettings,
  onHostAccessTokenChange,
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
  onSaveProviderProfile: (profile: ProviderProfile, apiKey?: string) => Promise<ProviderProfile>;
  onTestProviderProfile: (profile: ProviderProfile, apiKey?: string) => Promise<{ ok: true; modelId: string }>;
  providerRuntime: 'host' | 'device';
  hostAccessTokenSettings: HostAccessTokenSettings;
  onHostAccessTokenChange: (enabled: boolean, token: string) => Promise<void>;
  onClose: () => void;
}) {
  const currentProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  const blankProfile = (): ProviderProfile => ({
    id: '',
    name: '',
    kind: 'openai-compatible',
    baseUrl: '',
    modelId: '',
    maxContext: 128000,
    maxOutput: 8192,
  });
  const [editingId, setEditingId] = useState(currentProfile?.id ?? '');
  const [profileDraft, setProfileDraft] = useState<ProviderProfile>(() => currentProfile ? { ...currentProfile } : blankProfile());
  const [profileBaseline, setProfileBaseline] = useState<{ profile: ProviderProfile; key: string }>(() => ({
    profile: currentProfile ? { ...currentProfile } : blankProfile(),
    key: '',
  }));
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>('idle');
  const [hostAccessEnabled, setHostAccessEnabled] = useState(hostAccessTokenSettings.enabled);
  const [hostAccessTokenDraft, setHostAccessTokenDraft] = useState(hostAccessTokenSettings.token);
  const [hostAccessStatus, setHostAccessStatus] = useState('');
  const [hostAccessState, setHostAccessState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const discardChangesDialog = useRef<HTMLDialogElement>(null);
  const [pendingSettingsAction, setPendingSettingsAction] = useState<'close' | 'new' | ProviderProfile | null>(null);
  useEffect(() => {
    if (!currentProfile || editingId) return;
    setEditingId(currentProfile.id);
    setProfileDraft({ ...currentProfile });
    setProfileBaseline({ profile: { ...currentProfile }, key: sessionKeys[currentProfile.id] ?? '' });
  }, [currentProfile, editingId]);
  useEffect(() => {
    setHostAccessEnabled(hostAccessTokenSettings.enabled);
    setHostAccessTokenDraft(hostAccessTokenSettings.token);
  }, [hostAccessTokenSettings]);
  const performCloseDrawer = () => dialogRef.current?.close();
  const clearConnectionResult = () => {
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const selectProfile = (profile: ProviderProfile) => {
    onSelectProviderProfile(profile.id);
    setEditingId(profile.id);
    setProfileDraft({ ...profile });
    setApiKeyDraft(sessionKeys[profile.id] ?? '');
    setProfileBaseline({ profile: { ...profile }, key: sessionKeys[profile.id] ?? '' });
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const startNewProfile = () => {
    setEditingId('');
    setProfileDraft(blankProfile());
    setApiKeyDraft('');
    setProfileBaseline({ profile: blankProfile(), key: '' });
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const restoreProfileBaseline = () => {
    setEditingId(profileBaseline.profile.id);
    setProfileDraft({ ...profileBaseline.profile });
    setApiKeyDraft(profileBaseline.key);
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const providerDraftChanged = () => {
    return JSON.stringify({ ...profileDraft, id: editingId }) !== JSON.stringify({ ...profileBaseline.profile, id: editingId })
      || apiKeyDraft !== profileBaseline.key;
  };
  const applySettingsAction = (action: 'close' | 'new' | ProviderProfile) => {
    setPendingSettingsAction(null);
    if (action === 'close') {
      performCloseDrawer();
      return;
    }
    if (action === 'new') {
      startNewProfile();
      return;
    }
    selectProfile(action);
  };
  const requestSettingsAction = (action: 'close' | 'new' | ProviderProfile) => {
    if (!providerDraftChanged()) {
      applySettingsAction(action);
      return;
    }
    setPendingSettingsAction(action);
    discardChangesDialog.current?.showModal();
  };
  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (connectionState === 'saving' || connectionState === 'testing') return;
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
    setConnectionState('saving');
    setConnectionStatus('正在保存连接方案…');
    try {
      const saved = await onSaveProviderProfile(profile, apiKeyDraft || undefined);
      setEditingId(saved.id);
      setProfileDraft(saved);
      setProfileBaseline({ profile: { ...saved }, key: providerRuntime === 'device' ? apiKeyDraft : '' });
      if (providerRuntime === 'device') {
        setSessionKeys((current) => ({ ...current, [saved.id]: apiKeyDraft }));
      } else {
        setApiKeyDraft('');
      }
      setConnectionStatus(providerRuntime === 'host'
        ? '连接方案已保存到本机私有配置。'
        : '连接方案已保存。API Key 只在当前页面临时保留。');
      setConnectionState('success');
    } catch (error) {
      setConnectionState('error');
      setConnectionStatus(error instanceof Error ? error.message : '连接方案保存失败。');
    }
  };
  const testProfileConnection = async () => {
    if (connectionState === 'saving' || connectionState === 'testing') return;
    const baseUrl = profileDraft.baseUrl.trim().replace(/\/+$/, '');
    const modelId = profileDraft.modelId.trim();
    if (!baseUrl || !modelId) {
      setConnectionState('error');
      setConnectionStatus('请先填写 URL 和模型 ID。');
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
      await onTestProviderProfile({ ...profileDraft, baseUrl, modelId }, apiKeyDraft || undefined);
      setConnectionState('success');
      setConnectionStatus('连接有效，模型 ID 可用。');
    } catch (error) {
      setConnectionState('error');
      setConnectionStatus(error instanceof Error ? error.message : '无法连接。');
    }
  };
  const applyHostAccessToken = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = hostAccessTokenDraft.trim();
    if (!token) {
      setHostAccessState('error');
      setHostAccessStatus('请填写访问密码。');
      return;
    }
    setHostAccessState('saving');
    setHostAccessStatus('正在重新连接…');
    try {
      await onHostAccessTokenChange(true, token);
      setHostAccessState('success');
      setHostAccessStatus('访问密码仅保存于当前浏览器会话。');
    } catch (error) {
      setHostAccessState('error');
      setHostAccessStatus(error instanceof Error ? error.message : '无法使用这个访问密码连接。');
    }
  };
  const disableHostAccessToken = async () => {
    setHostAccessEnabled(false);
    setHostAccessTokenDraft('');
    setHostAccessState('saving');
    setHostAccessStatus('正在关闭…');
    try {
      await onHostAccessTokenChange(false, '');
      setHostAccessState('success');
      setHostAccessStatus('访问密码已关闭。');
    } catch (error) {
      setHostAccessState('error');
      setHostAccessStatus(error instanceof Error ? error.message : '已关闭访问密码，但无法重新连接书库。');
    }
  };

  return (
    <dialog
      className="settings-drawer"
      ref={dialogRef}
      onClick={(event) => { if (event.target === event.currentTarget) requestSettingsAction('close'); }}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); requestSettingsAction('close'); }}
      aria-labelledby="settings-title"
    >
      <header className="drawer-heading">
        <div>
          <p className="eyebrow">界面偏好</p>
          <h2 id="settings-title">设置</h2>
        </div>
        <button type="button" className="icon-button" autoFocus onClick={() => requestSettingsAction('close')} aria-label="关闭设置" title="关闭设置"><X aria-hidden="true" /></button>
      </header>
      <section className="settings-section" aria-labelledby="theme-heading">
        <h3 id="theme-heading">皮肤</h3>
        <label className="sr-only" htmlFor="theme-select">选择皮肤</label>
        <select id="theme-select" value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>
          <option value="paper">蓝雪</option>
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
          <span>全局字体</span>
          <select
            id="manuscript-font-select"
            value={manuscriptFontFamily}
            onChange={(event) => onManuscriptFontFamilyChange(event.target.value as ManuscriptFontFamily)}
          >
            <option value="sans">无衬线</option>
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
                  disabled={connectionState === 'saving' || connectionState === 'testing'}
                  onChange={(event) => {
                    const profile = providerProfiles.find((item) => item.id === event.target.value);
                    if (profile) requestSettingsAction(profile);
                    else requestSettingsAction('new');
                  }}
                >
                  <option value="">新连接方案</option>
                  {providerProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.modelId}</option>)}
                </select>
                <button type="button" className="icon-button" onClick={() => requestSettingsAction('new')} disabled={connectionState === 'saving' || connectionState === 'testing'} aria-label="新建连接方案" title="新建连接方案"><Plus aria-hidden="true" /></button>
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

              <p className="provider-secret-note">{providerRuntime === 'host'
                ? 'API Key 会以明文保存在本机配置文件（默认 .data/private/providers.json）中；不会写入书稿或浏览器。只有在你信任本机和 Provider 端点时才使用；留空可继续使用已保存的 Key。'
                : '仅在你信任当前页面和目标 URL 时输入 API Key；测试时临时 Key 会直接发送到填写的 URL，当前页面脚本可读取且不会持久化。'}</p>
              <div className="provider-form-actions">
                <button
                  type="button"
                  className="quiet-action button-with-icon provider-test-button"
                  onClick={() => void testProfileConnection()}
                  disabled={connectionState === 'testing' || connectionState === 'saving'}
                  aria-busy={connectionState === 'testing' || undefined}
                  aria-label="测试连接"
                ><PlugZap aria-hidden="true" />{connectionState === 'testing' ? '测试中' : '测试'}</button>
                <button type="submit" className="primary-action button-with-icon" disabled={connectionState === 'saving' || connectionState === 'testing'} aria-busy={connectionState === 'saving' || undefined}>
                  <Check aria-hidden="true" />{connectionState === 'saving' ? '保存中…' : '保存连接方案'}
                </button>
              </div>
              <p className="provider-save-status" data-state={connectionState} role="status" aria-live="polite">
                {connectionStatus && <><span className="provider-status-dot" aria-hidden="true" />{connectionStatus}</>}
              </p>
            </form>
          </div>
        </details>
      </section>
      {providerRuntime === 'host' && (
        <section className="settings-section" aria-labelledby="host-access-heading">
          <h3 id="host-access-heading" className="sr-only">访问保护</h3>
          <details className="settings-subdrawer">
            <summary>
              <ShieldCheck aria-hidden="true" />
              <span><strong>访问密码（可选）</strong><small>{hostAccessTokenSettings.enabled ? '已启用' : '关闭'}</small></span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="host-access-settings">
              <label className="toggle-setting" htmlFor="host-access-toggle">
                <span><strong>启用访问密码</strong><small>默认关闭。只在需要密码才能打开书库时开启。</small></span>
                <input
                  id="host-access-toggle"
                  type="checkbox"
                  role="switch"
                  checked={hostAccessEnabled}
                  disabled={hostAccessState === 'saving'}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setHostAccessEnabled(true);
                      setHostAccessState('idle');
                      setHostAccessStatus('');
                    } else {
                      void disableHostAccessToken();
                    }
                  }}
                />
              </label>
              {hostAccessEnabled && (
                <form className="host-access-form" onSubmit={applyHostAccessToken}>
                  <label htmlFor="host-access-token">访问密码</label>
                  <div className="host-access-input-row">
                    <input
                      id="host-access-token"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={hostAccessTokenDraft}
                      onChange={(event) => {
                        setHostAccessTokenDraft(event.target.value);
                        setHostAccessState('idle');
                        setHostAccessStatus('');
                      }}
                      placeholder="输入访问密码"
                    />
                    <button type="submit" className="primary-action" disabled={hostAccessState === 'saving'}>
                      {hostAccessState === 'saving' ? '连接中…' : '保存并连接'}
                    </button>
                  </div>
                </form>
              )}
              <p className="host-access-status" data-state={hostAccessState} role="status" aria-live="polite">
                {hostAccessStatus}
              </p>
            </div>
          </details>
        </section>
      )}
      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">保存位置</h3>
        <p className="helper-copy">{api.runtime === 'device'
          ? '正文和资料只保存在这个浏览器中，不会自动上传。请按需导出备份。'
          : '正文和资料保存在运行书库的电脑上，不会自动上传。请自行备份。'}</p>
      </section>
      <dialog
        className="confirm-dialog"
        ref={discardChangesDialog}
        onCancel={(event) => { event.preventDefault(); discardChangesDialog.current?.close(); }}
        aria-labelledby="discard-provider-dialog-title"
        aria-describedby="discard-provider-dialog-description"
      >
        <header className="dialog-heading">
          <h2 id="discard-provider-dialog-title">放弃未保存修改？</h2>
          <button type="button" className="icon-button" onClick={() => discardChangesDialog.current?.close()} aria-label="取消放弃修改" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          <p id="discard-provider-dialog-description">当前连接方案有未保存的修改；放弃后才会继续下一步。</p>
          <div className="dialog-actions">
            <button type="button" className="quiet-action" onClick={() => discardChangesDialog.current?.close()}>继续编辑</button>
            <button
              type="button"
              className="danger-action"
              onClick={() => {
                const action = pendingSettingsAction;
                discardChangesDialog.current?.close();
                if (action) {
                  restoreProfileBaseline();
                  applySettingsAction(action);
                }
              }}
            >放弃并继续</button>
          </div>
        </div>
      </dialog>
    </dialog>
  );
}

export default App;
