import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText,
  BookPlus,
  Download,
  FileJson,
  FileText,
  Minus,
  Plus,
  ScrollText,
  Settings,
  X,
} from 'lucide-react';
import { api } from './api';
import { createBookExport, type BookExportFormat } from './bookExport';
import {
  buildContextPlan as composeContextPlan,
  hasManualReference,
  largestContextItems,
} from './contextPlan';
import {
  applyRegenerateBlockOutcome,
  makeRegenerateBlockRequest,
} from './generationRequests';
import {
  reconcileReferencesAfterMemoryDeletion,
} from './contextReferences';
import {
  deleteDirectorySelection,
  type DirectorySelection,
} from './directorySelection';
import {
  deleteSourceSelection,
  type SourceSelectionKind,
} from './sourceSelection';
import {
  readProviderProfiles,
  PROVIDER_PROFILES_STORAGE_KEY,
  upsertProviderProfile,
  type ProviderProfile,
} from './providerProfiles';
import {
  commitSectionMemoryDraft,
  clearPreviousSectionMemory,
  deleteCurrentSectionMemory,
  normalizeBook,
  parseSectionMemoryDraft,
  rollbackSectionMemory,
  sectionMemoryProvenanceAfterReview,
  sectionMemoryFreshness,
} from './sectionMemory';
import { ContextToolsDrawer } from './components/ContextToolsDrawer';
import { Writer } from './components/Writer';
import { Bookshelf } from './components/Bookshelf';
import { ProviderSettings } from './components/ProviderSettings';
import { makeId } from './components/shared/id';
import { blocksAsContent, sectionBlocks } from './components/shared/sectionContent';
import {
  DialogOperationStatus,
  idleDialogOperation,
  useDismissSuccessfulDialog,
  type DialogOperationState,
} from './components/shared/DialogOperationStatus';
import type {
  Book,
  BookIndexEntry,
  CharacterCard,
  ContextPlan,
  GenerationMode,
  GenerationRequest,
  SectionBlock,
  SectionMemoryDraft,
  SectionMemoryProvenance,
  ThemeName,
  WorldRule,
} from './types';

type ViewName = 'write' | 'shelf';
const bookCachePrefix = 'story-native:book:';
const bookCacheKey = (bookId: string) => `${bookCachePrefix}${bookId}`;
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
    ? readProviderProfiles(localStorage.getItem(PROVIDER_PROFILES_STORAGE_KEY))
    : []);
  const [activeProviderProfileId, setActiveProviderProfileId] = useState(() =>
    localStorage.getItem(activeProviderProfileKey) ?? 'provider-primary');
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
      localStorage.setItem(PROVIDER_PROFILES_STORAGE_KEY, JSON.stringify(providerProfiles));
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

  const commitBookChange = async (recipe: (current: Book) => Book) => {
    if (!book) throw new Error('请先打开一本书。');
    const candidate = normalizeBook({
      ...recipe(book),
      updatedAt: new Date().toISOString(),
    });
    const revision = ++saveRevision.current;
    setStatus(api.runtime === 'device' ? '正在保存到此设备…' : '正在保存到书库…');
    try {
      const saved = normalizeBook(await queueBookSave(candidate));
      if (saveRevision.current === revision) {
        if (api.runtime === 'device') cacheBook(saved);
        setBook(saved);
        setDirty(false);
      }
      setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
        ...items.filter((item) => item.id !== saved.id)]);
      setStatus(api.runtime === 'device' ? '已保存到此设备。' : '已保存。');
      return saved;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败。');
      throw error;
    }
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

  const assertGenerationBudget = (saved: Book, request: GenerationRequest) => {
    const { bookId: _bookId, ...planRequest } = request;
    const plan = composeContextPlan(saved, planRequest, activeProviderProfile ? {
      maxContext: activeProviderProfile.maxContext,
      maxOutput: activeProviderProfile.maxOutput,
    } : undefined);
    if (!plan.budget.overflow) return plan;
    const largest = largestContextItems(plan.included)
      .map((item) => `${item.title}（约 ${item.estimatedTokens.toLocaleString()} tokens）`)
      .join('、');
    const label = hasManualReference(plan.included) ? '手选前文' : '内容';
    throw new Error(`上下文预算不足：约超出 ${plan.budget.overflowTokens.toLocaleString()} tokens。占用较大的${label}：${largest || '当前输入'}。`);
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
    const writerDraft = { instruction, authorNote };
    void withBusy(async () => {
      const saved = await saveCurrent();
      const generation = makeRegenerateBlockRequest({
        bookId: saved.id,
        sectionId: section.id,
        providerProfileId: activeProviderProfile?.id,
        mode,
        selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
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
            return applyRegenerateBlockOutcome({
              section: item,
              targetBlockId: blockId,
              writerDraft,
              outcome: { status: 'success', content: result.draft },
            }).section;
          }),
        })),
      }));
      setStatus('已重新生成所选 AI 正文片段。');
    });
  };

  const createBook = async (title: string) => {
    setBusy(true);
    try {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '新建书目失败。');
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrentBook = async () => {
    if (!book || library.length <= 1) {
      const error = new Error('书库至少需要保留一本书。');
      setStatus(error.message);
      throw error;
    }
    const deletedBook = book;
    const nextBook = library.find((entry) => entry.id !== deletedBook.id);
    const wasDirty = dirty;
    setBusy(true);
    try {
      await ensureCurrentBookSaved();
      const storedNextBook = nextBook ? normalizeBook(await api.loadBook(nextBook.id)) : null;
      const cachedNextBook = nextBook && api.runtime === 'device' ? readCachedBook(nextBook.id) : null;
      const loadedNextBook = storedNextBook ? normalizeBook(newerBook(storedNextBook, cachedNextBook)) : null;
      saveRevision.current += 1;
      setDirty(false);
      await saveQueue.current.catch(() => undefined);
      await api.deleteBook(deletedBook.id);
      removeCachedBook(deletedBook.id);
      setLibrary((items) => items.filter((entry) => entry.id !== deletedBook.id));
      if (loadedNextBook) {
        if (api.runtime === 'device') cacheBook(loadedNextBook);
        setBook(loadedNextBook);
        setSectionId('');
        setSelectedCharacterId(loadedNextBook.characters[0]?.id ?? '');
        restoreSectionDraft(loadedNextBook.id, '');
        setDirty(Boolean(cachedNextBook && loadedNextBook.updatedAt !== storedNextBook?.updatedAt));
        setView('shelf');
      }
      setStatus(`已删除《${deletedBook.title}》。`);
    } catch (error) {
      setDirty(wasDirty);
      setStatus(error instanceof Error ? error.message : '删除书目失败。');
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const addCharacter = (name: string) => commitBookChange((current) => {
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

  const addWorldRule = (title: string) => commitBookChange((current) => ({
    ...current,
    worldRules: [...current.worldRules, {
      id: makeId('world'),
      title: title.trim(),
      content: '',
      includeInPrompt: true,
    }],
  }));

  const addChapter = (title: string) => commitBookChange((current) => {
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

  const addSection = (chapterId: string, title: string) => commitBookChange((current) => {
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

  const renameChapter = (chapterId: string, title: string) => commitBookChange((current) => ({
    ...current,
    chapters: current.chapters.map((chapter) => chapter.id === chapterId
      ? { ...chapter, title: title.trim() }
      : chapter),
  }));

  const renameSection = (chapterId: string, targetSectionId: string, title: string) => commitBookChange((current) => ({
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

  const deleteSectionBlock = async (blockId: string) => {
    if (!section) throw new Error('找不到当前小节。');
    const targetSectionId = section.id;
    await commitBookChange((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          if (item.id !== targetSectionId) return item;
          const blocks = sectionBlocks(item).filter((block) => block.id !== blockId);
          return { ...item, blocks, content: blocksAsContent(blocks) };
        }),
      })),
    }));
  };

  const updateContextReference = (sourceSectionId: string, selected: boolean) => {
    if (!book || !section) return;
    const source = referenceLocation(book, sourceSectionId);
    const targetOrdinal = book
      ? book.chapters.flatMap((chapter) => chapter.sections).findIndex((item) => item.id === section.id)
      : -1;
    if (!source || targetOrdinal < 0 || source.ordinal >= targetOrdinal) return;
    if (!source.section.content.trim() && selected) return;
    const references = (section.contextReferences ?? [])
      .filter((reference) => reference.sectionId !== sourceSectionId);
    if (selected) references.push({ sectionId: sourceSectionId, mode: 'full', reason: 'manual' });
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

  const saveSectionMemoriesAndLoad = async (entries: Array<{
    sourceSectionId: string;
    draft: SectionMemoryDraft;
    provenance: SectionMemoryProvenance;
  }>) => {
    if (!book || !section) throw new Error('请先选择一个小节。');
    const targetSectionId = section.id;
    const targetOrdinal = book.chapters.flatMap((chapter) => chapter.sections)
      .findIndex((item) => item.id === targetSectionId);
    const committedSources = new Map<string, Book['chapters'][number]['sections'][number]>();
    const sourceTitles: string[] = [];
    for (const { sourceSectionId, draft, provenance } of entries) {
      const source = referenceLocation(book, sourceSectionId);
      if (!source || targetOrdinal < 0 || source.ordinal >= targetOrdinal) {
        throw new Error('只能保存当前小节之前内容的梗概。');
      }
      sourceTitles.push(source.section.title);
      committedSources.set(sourceSectionId, commitSectionMemoryDraft(source.section, draft, provenance));
    }
    const candidate = normalizeBook({
      ...book,
      updatedAt: new Date().toISOString(),
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          const committedSource = committedSources.get(item.id);
          if (committedSource) return committedSource;
          if (item.id !== targetSectionId) return item;
          const references = (item.contextReferences ?? [])
            .filter((reference) => !committedSources.has(reference.sectionId));
          for (const sourceSectionId of committedSources.keys()) {
            references.push({ sectionId: sourceSectionId, mode: 'summary', reason: 'manual' });
          }
          return { ...item, contextReferences: references };
        }),
      })),
    });
    saveRevision.current += 1;
    setBook(candidate);
    setDirty(true);
    await saveCurrent(candidate);
    setStatus(sourceTitles.length === 1
      ? `已保存并加载「${sourceTitles[0]}」的梗概。`
      : `已保存并加载 ${sourceTitles.length} 节梗概。`);
  };

  const deleteSectionMemory = async (sourceSectionId: string) => {
    if (!book) throw new Error('请先打开一本书。');
    const source = referenceLocation(book, sourceSectionId);
    if (!source?.section.memory) throw new Error('当前小节没有可删除的 Memory。');
    const references = book.chapters.flatMap((chapter) => chapter.sections)
      .flatMap((item) => item.contextReferences ?? [])
      .filter((reference) => reference.sectionId === sourceSectionId);
    const reconciled = reconcileReferencesAfterMemoryDeletion(book, sourceSectionId);
    const candidate = normalizeBook({
      ...reconciled,
      updatedAt: new Date().toISOString(),
      chapters: reconciled.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === sourceSectionId
          ? deleteCurrentSectionMemory(item)
          : item),
      })),
    });
    saveRevision.current += 1;
    setBook(candidate);
    setDirty(true);
    await saveCurrent(candidate);
    const summaryRemoved = references.filter((reference) => reference.mode === 'summary').length;
    const bothDowngraded = references.filter((reference) => reference.mode === 'both').length;
    const changes = [
      summaryRemoved ? `已移除 ${summaryRemoved} 个梗概引用` : '',
      bothDowngraded ? `已将 ${bothDowngraded} 个梗概＋全文引用改为全文` : '',
    ].filter(Boolean);
    setStatus(`已删除「${source.section.title}」的当前 Memory。${changes.length ? ` ${changes.join('，')}。` : ''}${candidate.chapters.flatMap((chapter) => chapter.sections).find((item) => item.id === sourceSectionId)?.previousMemory ? ' 上一版本仍保留。' : ''}`);
  };

  const rollbackMemory = async (sourceSectionId: string) => {
    if (!book) throw new Error('请先打开一本书。');
    const source = referenceLocation(book, sourceSectionId);
    if (!source?.section.previousMemory) throw new Error('没有可回滚的上一版本。');
    const candidate = normalizeBook({
      ...book,
      updatedAt: new Date().toISOString(),
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === sourceSectionId
          ? rollbackSectionMemory(item)
          : item),
      })),
    });
    saveRevision.current += 1;
    setBook(candidate);
    setDirty(true);
    await saveCurrent(candidate);
    setStatus(`已回滚「${source.section.title}」的 Memory。`);
  };

  const clearPreviousMemory = async (sourceSectionId: string) => {
    if (!book) throw new Error('请先打开一本书。');
    const source = referenceLocation(book, sourceSectionId);
    if (!source?.section.previousMemory) throw new Error('没有可清除的上一版本。');
    const candidate = normalizeBook({
      ...book,
      updatedAt: new Date().toISOString(),
      chapters: book.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === sourceSectionId
          ? clearPreviousSectionMemory(item)
          : item),
      })),
    });
    saveRevision.current += 1;
    setBook(candidate);
    setDirty(true);
    await saveCurrent(candidate);
    setStatus(`已清除「${source.section.title}」的上一版本 Memory。`);
  };

  const deleteSelection = async (selection: DirectorySelection) => {
    if (!book) throw new Error('请先打开一本书。');
    const result = deleteDirectorySelection(book, selection);
    await commitBookChange(() => result.book);
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

  const deleteSources = async (kind: SourceSelectionKind, ids: Set<string>) => {
    if (!book || ids.size === 0) throw new Error('请先选择要删除的内容。');
    const next = deleteSourceSelection(book, kind, ids);
    await commitBookChange(() => next);
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
    if (!contextCompositionOpen) return undefined;
    const closeOpenContextDrawer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeContextComposition();
    };
    document.addEventListener('keydown', closeOpenContextDrawer);
    return () => document.removeEventListener('keydown', closeOpenContextDrawer);
  }, [contextCompositionOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到正文</a>
      {view === 'shelf' && <header className="app-header">
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
            onDeleteSectionBlock={deleteSectionBlock}
            onRegenerateBlock={regenerateBlock}
            onSectionTitleChange={async (title) => {
              if (!sectionChapter || !section) throw new Error('找不到当前小节。');
              await renameSection(sectionChapter.id, section.id, title);
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
            onBookChange={async (recipe) => { await commitBookChange(recipe); }}
            onAddCharacter={async (name) => { await addCharacter(name); }}
            onAddWorldRule={async (title) => { await addWorldRule(title); }}
            onAddChapter={async (title) => { await addChapter(title); }}
            onAddSection={async (chapterId, title) => { await addSection(chapterId, title); }}
            onRenameChapter={async (chapterId, title) => { await renameChapter(chapterId, title); }}
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
          onSaveMemoriesAndLoad={saveSectionMemoriesAndLoad}
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
  const [discardOperation, setDiscardOperation] = useState<DialogOperationState>(idleDialogOperation);
  const discardChangesDialog = useRef<HTMLDialogElement>(null);
  const [pendingSettingsAction, setPendingSettingsAction] = useState<'close' | 'new' | ProviderProfile | null>(null);
  useEffect(() => {
    if (!currentProfile || editingId) return;
    setEditingId(currentProfile.id);
    setProfileDraft({ ...currentProfile });
    setProfileBaseline({ profile: { ...currentProfile }, key: sessionKeys[currentProfile.id] ?? '' });
  }, [currentProfile, editingId]);
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
    setDiscardOperation(idleDialogOperation);
    discardChangesDialog.current?.showModal();
  };
  const finishDiscardAction = () => {
    const action = pendingSettingsAction;
    discardChangesDialog.current?.close();
    if (action) applySettingsAction(action);
  };
  useDismissSuccessfulDialog(discardOperation.phase === 'success', finishDiscardAction);
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
      <ProviderSettings
        currentProfile={currentProfile}
        providerProfiles={providerProfiles}
        editingId={editingId}
        connectionState={connectionState}
        profileDraft={profileDraft}
        apiKeyDraft={apiKeyDraft}
        providerRuntime={providerRuntime}
        connectionStatus={connectionStatus}
        onRequestSettingsAction={(action) => requestSettingsAction(action)}
        onClearConnectionResult={clearConnectionResult}
        onProfileDraftChange={(recipe) => setProfileDraft(recipe)}
        onApiKeyDraftChange={setApiKeyDraft}
        onSubmitProfile={submitProfile}
        onTestProfileConnection={() => void testProfileConnection()}
      />

      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">保存位置</h3>
        <p className="helper-copy">{api.runtime === 'device'
          ? '正文和资料只保存在这个浏览器中，不会自动上传。请按需导出备份。'
          : '正文和资料保存在运行书库的电脑上，不会自动上传。请自行备份。'}</p>
      </section>
      <dialog
        className="confirm-dialog"
        ref={discardChangesDialog}
        onClose={() => setDiscardOperation(idleDialogOperation)}
        onCancel={(event) => {
          event.preventDefault();
          if (discardOperation.phase === 'success') finishDiscardAction();
          else discardChangesDialog.current?.close();
        }}
        aria-labelledby="discard-provider-dialog-title"
        aria-describedby={discardOperation.phase === 'idle' ? 'discard-provider-dialog-description' : undefined}
      >
        <header className="dialog-heading">
          <h2 id="discard-provider-dialog-title">放弃未保存修改？</h2>
          <button type="button" className="icon-button" onClick={() => discardChangesDialog.current?.close()} aria-label="取消放弃修改" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {discardOperation.phase === 'idle' ? (
            <>
              <p id="discard-provider-dialog-description">当前连接方案有未保存的修改；放弃后才会继续下一步。</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={() => discardChangesDialog.current?.close()}>继续编辑</button>
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => {
                    restoreProfileBaseline();
                    setDiscardOperation({ phase: 'success', title: '已放弃修改' });
                  }}
                >放弃并继续</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={discardOperation} />
          )}
        </div>
      </dialog>
    </dialog>
  );
}

export default App;
