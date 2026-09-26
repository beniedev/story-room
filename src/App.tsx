import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText,
  BookPlus,
  Download,
  FileJson,
  Settings,
  X,
} from 'lucide-react';
import { api } from './api';
import { useBookSession } from './application/useBookSession';
import { useGenerationSession } from './application/useGenerationSession';
import { isAbortError } from './application/generationStatus';
import { bookConflictMessage, isBookConflictError } from './application/bookSessionErrors';
import { deleteBookSectionBlock, editBookSectionMemory, referenceLocation, renameBookChapter, renameBookSection } from './application/bookRecipes';
import { parseBookBackup } from './bookImport';
import { createBookExport, type BookExportFormat } from './bookExport';
import {
  buildContextPlan as composeContextPlan,
} from './contextPlan';
import {
  adoptCandidate,
  deleteCandidate,
  editCandidate,
} from './answerCandidates';
import {
  applySummaryReferenceSelection,
} from './contextReferences';
import {
  deleteDirectorySelection,
  type DirectorySelection,
} from './directorySelection';
import { moveDirectoryItem, reverseDirectoryMove, type DirectoryMove } from './directoryOperations';
import type { ContextToolDraftSession } from './contextToolDrafts';
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
  normalizeBook,
  sectionMemoryProvenanceAfterReview,
  sectionMemoryFreshness,
} from './sectionMemory';
import { ContextToolsDrawer } from './components/ContextToolsDrawer';
import { Writer } from './components/Writer';
import { Bookshelf } from './components/Bookshelf';
import { EmptyLibraryActions } from './components/EmptyLibraryActions';
import { ExportDialog } from './components/ExportDialog';
import { SettingsDrawer } from './components/SettingsDrawer';
import { makeId } from './components/shared/id';

import { blocksAsContent, sectionBlocks } from './components/shared/sectionContent';
import { clampManuscriptFontSize, defaultManuscriptFontSize, type ManuscriptFontFamily } from './components/AppearanceSettings';
import type {
  Book,
  GenerationMode,
  SectionBlock,
  SectionMemoryDraft,
  SectionMemoryProvenance,
  ThemeName,
} from './types';

type ViewName = 'write' | 'shelf';
const activeProviderProfileKey = 'story-native:active-provider-profile';
const manuscriptFontSizeKey = 'story-native:manuscript-font-size';
const manuscriptFontFamilyKey = 'story-native:manuscript-font-family';
const streamingOutputKey = 'story-native:streaming-output';
type SectionDraft = {
  instruction: string;
};

const sectionDraftKey = (bookId: string, sectionId: string) => `${bookId}:${sectionId}`;
const emptySectionDraft = (): SectionDraft => ({ instruction: '' });

function App() {
  const isDeviceRuntime = api.runtime === 'device';

  const [sectionId, setSectionId] = useState('');
  const [view, setView] = useState<ViewName>('shelf');
  const [mode, setMode] = useState<GenerationMode>('author');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [instruction, setInstruction] = useState('');
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
  const [streamingOutput, setStreamingOutput] = useState(() => localStorage.getItem(streamingOutputKey) === 'true');
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(() => api.runtime === 'device'
    ? readProviderProfiles(localStorage.getItem(PROVIDER_PROFILES_STORAGE_KEY))
    : []);
  const [activeProviderProfileId, setActiveProviderProfileId] = useState(() =>
    localStorage.getItem(activeProviderProfileKey) ?? 'provider-primary');

  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionDraft>>({});
  const [busy, setBusy] = useState(false);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [directoryUndo, setDirectoryUndo] = useState<{ bookId: string; move: DirectoryMove } | null>(null);
  const directoryBusyRef = useRef(false);
  const contextToolDrafts = useRef(new Map<string, ContextToolDraftSession>());
  const pendingContextDrafts = useRef(false);
  const [status, setStatus] = useState(isDeviceRuntime ? '正在打开此设备的书库…' : '正在打开本机书库…');

  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const exportTrigger = useRef<HTMLElement | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const contextCompositionTrigger = useRef<HTMLElement | null>(null);
  const [contextCompositionOpen, setContextCompositionOpen] = useState(false);
  const contextToolsTrigger = useRef<HTMLElement | null>(null);
  const [contextToolsOpen, setContextToolsOpen] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  const restoreShelfFocus = useRef(false);
  const [bookSettingsRequest, setBookSettingsRequest] = useState(0);
  const [newBookRequest, setNewBookRequest] = useState(0);
  const [emptyBookDialogOpen, setEmptyBookDialogOpen] = useState(false);
  const [writerBookSettingsOpen, setWriterBookSettingsOpen] = useState(false);
  const [manuscriptEditorOpen, setManuscriptEditorOpen] = useState(false);

  const busyRef = useRef(false);
  const sectionDraftsRef = useRef<Record<string, SectionDraft>>({});
  const navigationState = useRef({ dirty: false, busy: false, instruction: '', sectionDrafts: {} as Record<string, SectionDraft> });

  const selectionRef = useRef({ sectionId, view });
  selectionRef.current = { sectionId, view };

  const bookSession = useBookSession({
    bootstrap: {
      load: () => api.listProviderProfiles(),
      apply: (profiles) => {
        setProviderProfiles(profiles);
        if (profiles.length > 0) {
          setActiveProviderProfileId((current) => profiles.some((profile) => profile.id === current)
            ? current : profiles[0]?.id ?? current);
        }
      },
    },
    onStatus: setStatus,
    isBusy: () => busyRef.current,
    hasLocalEditorDraft: (bookId): boolean => hasLocalEditorDraft(bookId),
    onTransition: (transition) => {
      switch (transition.kind) {
        case 'reset':
          setSectionId('');
          setInstruction('');
          sectionDraftsRef.current = {};
          setSectionDrafts({});
          setView('shelf');
          return;
        case 'before-switch':
          rememberCurrentSectionDraft();
          return;
        case 'activated':
          setSectionId('');
          setSelectedCharacterId(transition.reason === 'created' ? '' : transition.book.characters[0]?.id ?? '');
          restoreSectionDraft(transition.book.id, '');
          setView('shelf');
          if (transition.reason === 'created') setEmptyBookDialogOpen(false);
          return;
        case 'empty':
          setSectionId('');
          setSelectedCharacterId('');
          setInstruction('');
          sectionDraftsRef.current = {};
          setSectionDrafts({});
          setView('shelf');
          return;
        case 'deleted':
          removeContextDraftSessions(transition.bookId);
          return;
        case 'external-refresh': {
          const loaded = transition.book;
          const selected = selectionRef.current.sectionId;
          if (selected && !loaded.chapters.some((chapter) => chapter.sections.some((item) => item.id === selected))) {
            setSectionId('');
            setInstruction('');
            setContextToolsOpen(false);
            setContextCompositionOpen(false);
            setWriterBookSettingsOpen(false);
            removeContextDraftSessions(loaded.id, new Set([selected]));
            setView('shelf');
            restoreShelfFocus.current = true;
            setStatus('这个小节已在另一页删除，已返回本书目录。');
          }
          return;
        }
        case 'navigation-pending':
          busyRef.current = transition.pending;
          setBusy(transition.pending);
          return;
      }
    },
  });
  const {
    book, library, dirty, libraryReady, saveConflict, openBook, navigateToBook,
    changeBook, saveCurrent, commitBookChange, ensureCurrentBookSaved,
    assertWriteAccess: assertDeviceWriteAccess,
  } = bookSession;

  const canEdit = libraryReady;


  const section = useMemo(() => book?.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === sectionId), [book, sectionId]);
  const sectionChapter = useMemo(() => book?.chapters.find((chapter) =>
    chapter.sections.some((candidate) => candidate.id === sectionId)), [book, sectionId]);
  useEffect(() => { setDirectoryUndo(null); }, [book?.id]);

  const removeContextDraftSessions = (bookId: string, removedSectionIds?: Set<string>) => {
    for (const [key, session] of contextToolDrafts.current) {
      if (session.bookId === bookId && (!removedSectionIds || removedSectionIds.has(session.sectionId))) {
        contextToolDrafts.current.delete(key);
      }
    }
    pendingContextDrafts.current = [...contextToolDrafts.current.values()].some((session) => session.hasChanges);
  };
  const authorNote = section?.note ?? '';
  const activeProviderProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  const previewVisible = view === 'write' && !manuscriptEditorOpen;
  const contextPreviewInput = useMemo(() => ({
    activeProviderProfile, authorNote, book, instruction, mode, section, selectedCharacterId, previewVisible,
  }), [activeProviderProfile, authorNote, book, instruction, mode, section, selectedCharacterId, previewVisible]);
  const deferredContextInput = useDeferredValue(contextPreviewInput);
  const contextPreview = useMemo(() => {
    const { activeProviderProfile, authorNote, book, instruction, mode, section, selectedCharacterId, previewVisible } = deferredContextInput;
    if (!previewVisible || !book || !section) return { plan: null, error: '' };
    try {
      return { plan: composeContextPlan(book, {
        sectionId: section.id,
        mode,
        selectedCharacterId: mode === 'character' ? selectedCharacterId : undefined,
        authorNote: authorNote || undefined,
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
  }, [deferredContextInput]);
  const previewMatchesTarget = deferredContextInput.book?.id === book?.id
    && deferredContextInput.section?.id === section?.id;
  const promptPreview = previewMatchesTarget ? contextPreview.plan : null;
  const promptPreviewError = previewMatchesTarget ? contextPreview.error : '';

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
      if (api.runtime === 'device') {
        localStorage.setItem(PROVIDER_PROFILES_STORAGE_KEY, JSON.stringify(providerProfiles));
      }
      localStorage.setItem(activeProviderProfileKey, activeProviderProfileId);
    } catch {
      // Settings still work for the current page when browser persistence is unavailable.
    }
  }, [activeProviderProfileId, providerProfiles]);

  useEffect(() => {
    try {
      localStorage.setItem(streamingOutputKey, String(streamingOutput));
    } catch {
      // Streaming remains available for the current page when browser persistence is unavailable.
    }
  }, [streamingOutput]);

  useEffect(() => {
    sectionDraftsRef.current = sectionDrafts;
    navigationState.current = { dirty, busy, instruction, sectionDrafts };
  }, [busy, dirty, instruction, sectionDrafts]);

  const hasLocalEditorDraft = (bookId: string): boolean => {
    const active = document.activeElement;
    // Native composition/selection and local forms may not have reached Book yet.
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      || Boolean(mainContent.current?.querySelector('.inline-title-input, .block-editor-page, .source-editor-page, dialog[open]'))
      || [...contextToolDrafts.current.values()].some((session) => session.bookId === bookId && session.hasChanges)
      || Boolean(navigationState.current.instruction.trim())
      || Boolean(bookSession.getSnapshot().book?.chapters.some((chapter) => chapter.sections.some((section) =>
        sectionDraftsRef.current[sectionDraftKey(bookId, section.id)]?.instruction.trim())));
  };

  useEffect(() => {
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      const current = navigationState.current;
      const hasDraft = Object.values(current.sectionDrafts).some((draft) => draft.instruction.trim());
      if (!current.dirty && !current.busy && !current.instruction.trim() && !hasDraft && !pendingContextDrafts.current) return;
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

  const rememberCurrentSectionDraft = () => {
    if (isDeviceRuntime && !canEdit) return;
    if (!book || !sectionId) return;
    const key = sectionDraftKey(book.id, sectionId);
    const draft = { instruction };
    const next = { ...sectionDraftsRef.current };
    if (!draft.instruction.trim()) delete next[key];
    else next[key] = draft;
    sectionDraftsRef.current = next;
    navigationState.current = { ...navigationState.current, instruction, sectionDrafts: next };
    setSectionDrafts(next);
  };

  const updateInstructionDraft = (value: string) => {
    if (isDeviceRuntime && !canEdit) return;
    setInstruction(value);
    if (!book || !sectionId) return;
    const key = sectionDraftKey(book.id, sectionId);
    const draft = { ...emptySectionDraft(), ...sectionDraftsRef.current[key], instruction: value };
    const next = { ...sectionDraftsRef.current };
    if (!draft.instruction.trim()) delete next[key];
    else next[key] = draft;
    sectionDraftsRef.current = next;
    navigationState.current = {
      ...navigationState.current,
      instruction: value,
      sectionDrafts: next,
    };
    setSectionDrafts(next);
  };

  const restoreSectionDraft = (bookId: string, nextSectionId: string) => {
    const draft = sectionDraftsRef.current[sectionDraftKey(bookId, nextSectionId)] ?? emptySectionDraft();
    setInstruction(draft.instruction);
  };

  const clearSectionDraft = (bookId: string, nextSectionId: string, sentInstruction: string) => {
    const key = sectionDraftKey(bookId, nextSectionId);
    const current = sectionDraftsRef.current[key];
    if (!current || current.instruction !== sentInstruction) return;
    const next = { ...sectionDraftsRef.current };
    delete next[key];
    sectionDraftsRef.current = next;
    setSectionDrafts(next);
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


  const withBusy = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(isAbortError(error)
        ? '已取消生成；迟到结果未写入正文。'
        : isBookConflictError(error) ? bookConflictMessage
        : error instanceof Error ? error.message : '操作失败。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const generationSession = useGenerationSession({
    bookSession,
    getSelection: () => selectionRef.current,
    withBusy,
    onStatus: setStatus,
    onSummaryBusyChange: setBusy,
    onContinuationApplied: ({ bookId, sectionId, instruction: inputSnapshot }) => {
      setInstruction((current) => current === inputSnapshot ? '' : current);
      clearSectionDraft(bookId, sectionId, inputSnapshot);
    },
  });
  const { generationState, streamingDraft, cancelGeneration } = generationSession;
  const generationInput = {
    sectionId, mode, selectedCharacterId,
    providerProfileId: activeProviderProfile?.id,
    streamingOutput,
  };
  const generateContinuation = () => generationSession.generateContinuation({
    ...generationInput, instruction, authorNote,
  });
  const respondToInput = (blockId: string) => generationSession.respondToInput(blockId, generationInput);
  const regenerateBlock = (blockId: string) => generationSession.regenerateBlock(blockId, generationInput);
  const generateSectionMemory = (sourceSectionId: string) =>
    generationSession.generateSectionMemory(sourceSectionId, generationInput);

  const updateSectionNote = (value: string) => {
    if (!section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          if (item.id !== section.id) return item;
          if (value) return { ...item, note: value };
          const { note: _removed, ...withoutNote } = item;
          return withoutNote;
        }),
      })),
    }));
  };

  const updateSectionBlocks = (blocks: SectionBlock[]) => {
    if (!section) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === section.id
          ? (() => {
              const previousBlocks = new Map(sectionBlocks(item).map((block) => [block.id, block]));
              const nextBlocks = blocks.map((block) => {
                const previous = previousBlocks.get(block.id);
                if (block.kind !== 'assistant'
                  || !block.adoptedCandidateId
                  || !previous
                  || previous.content === block.content) return block;
                return editCandidate(block, block.adoptedCandidateId, block.content);
              });
              return { ...item, blocks: nextBlocks, content: blocksAsContent(nextBlocks) };
            })()
          : item),
      })),
    }));
  };


  const selectBlockCandidate = (blockId: string, candidateId: string) => {
    const targetSectionId = section?.id;
    if (!targetSectionId) return;
    const currentBook = bookSession.getSnapshot().book ?? book;
    const currentSection = currentBook?.chapters.flatMap((chapter) => chapter.sections)
      .find((item) => item.id === targetSectionId);
    const currentBlock = currentSection && sectionBlocks(currentSection).find((item) => item.id === blockId);
    if (!currentBlock || currentBlock.kind !== 'assistant' || currentBlock.adoptedCandidateId === candidateId) return;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => item.id === targetSectionId
          ? (() => {
              const blocks = sectionBlocks(item).map((block) => block.id === blockId
                ? adoptCandidate(block, candidateId)
                : block);
              return { ...item, blocks, content: blocksAsContent(blocks) };
            })()
          : item),
      })),
    }));
  };

  const removeAdoptedBlockCandidate = async (blockId: string, candidateId: string, replacementId: string): Promise<void> => {
    if (!section) throw new Error('找不到当前小节。');
    const targetSectionId = section.id;
    changeBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((item) => {
          if (item.id !== targetSectionId) return item;
          const blocks = sectionBlocks(item).map((block) => {
            if (block.id !== blockId) return block;
            const adopted = adoptCandidate(block, replacementId);
            return deleteCandidate(adopted, candidateId);
          });
          return { ...item, blocks, content: blocksAsContent(blocks) };
        }),
      })),
    }));
    // Candidate deletion follows the same autosave path as candidate
    // selection.  The in-memory replacement is immediate; the ordinary
    // queued save reports any persistence failure without locking the writer.
  };

  const createBook = async (title: string) => {
    assertDeviceWriteAccess();
    setBusy(true);
    try { await bookSession.createBook(title); }
    finally { setBusy(false); }
  };

  const importBookBackup = async (file: File) => {
    assertDeviceWriteAccess();
    const imported = parseBookBackup(await file.text());
    await bookSession.importBookBackup(imported);
  };

  const deleteCurrentBook = async () => {
    assertDeviceWriteAccess();
    if (!book) {
      const error = new Error('当前没有可删除的书目。');
      setStatus(error.message);
      throw error;
    }
    setBusy(true);
    try { await bookSession.deleteCurrentBook(); }
    finally { setBusy(false); }
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

  const withDirectorySave = async (action: (current: Book) => Promise<void>) => {
    assertDeviceWriteAccess();
    if (directoryBusyRef.current || busyRef.current) throw new Error('请等待当前目录操作完成。');
    const bookId = bookSession.getSnapshot().book?.id;
    if (!bookId) throw new Error('请先打开一本书。');
    directoryBusyRef.current = true;
    busyRef.current = true;
    setDirectoryBusy(true);
    setBusy(true);
    try {
      await ensureCurrentBookSaved();
      const current = bookSession.getSnapshot().book;
      if (!current || current.id !== bookId) throw new Error('当前书目已经改变，请重新选择。');
      await action(current);
    } finally {
      directoryBusyRef.current = false;
      busyRef.current = false;
      setDirectoryBusy(false);
      setBusy(false);
    }
  };

  const addSection = (chapterId: string, title: string, afterSectionId?: string) => withDirectorySave(async () => {
    await commitBookChange((current) => {
      const targetChapter = current.chapters.find((chapter) => chapter.id === chapterId);
      if (!targetChapter) throw new Error('目标章节已经不存在，请重新选择。');
      const insertionIndex = afterSectionId === undefined ? targetChapter.sections.length
        : targetChapter.sections.findIndex((item) => item.id === afterSectionId) + 1;
      if (afterSectionId !== undefined && insertionIndex === 0) throw new Error('目标小节已经改变，请重新选择新建位置。');
      const next = {
        id: makeId('section'),
        title: title.trim() || `第 ${targetChapter.sections.length + 1} 节`,
        content: '',
      };
      return {
        ...current,
        chapters: current.chapters.map((chapter) => chapter.id === chapterId
          ? { ...chapter, sections: [...chapter.sections.slice(0, insertionIndex), next, ...chapter.sections.slice(insertionIndex)] }
          : chapter),
      };
    }, true);
  });

  const commitDirectoryMove = (move: DirectoryMove, undo = false) => withDirectorySave(async (current) => {
    if (moveDirectoryItem(current, move) === current) return;
    const inverse = reverseDirectoryMove(current, move);
    await commitBookChange((latest) => {
      if (latest.id !== current.id) throw new Error('当前书目已经改变，请重新选择。');
      return moveDirectoryItem(latest, move);
    }, true);
    setDirectoryUndo(undo ? null : { bookId: current.id, move: inverse });
    setStatus(undo ? '已撤销移动；后续正文修改已保留。' : '已移动，可撤销最近一次移动。');
  });

  const undoDirectoryMove = async () => {
    if (!directoryUndo || directoryUndo.bookId !== bookSession.getSnapshot().book?.id) throw new Error('当前书目没有可撤销的移动。');
    await commitDirectoryMove(directoryUndo.move, true);
  };

  const renameChapter = (chapterId: string, title: string) =>
    commitBookChange((current) => renameBookChapter(current, chapterId, title));

  const renameSection = (chapterId: string, targetSectionId: string, title: string) =>
    commitBookChange((current) => renameBookSection(current, chapterId, targetSectionId, title));

  const deleteSectionBlock = async (blockId: string) => {
    if (!section) throw new Error('找不到当前小节。');
    const targetSectionId = section.id;
    await commitBookChange((current) => deleteBookSectionBlock(current, targetSectionId, blockId));
  };


  const saveSectionMemoriesAndLoad = async (entries: Array<{
    sourceSectionId: string;
    draft: SectionMemoryDraft;
    provenance: SectionMemoryProvenance;
  }>, retainedInactiveSectionIds?: string[]) => {
    if (!book || !section) throw new Error('请先选择一个小节。');
    const targetSectionId = section.id;
    await commitBookChange((current) => applySummaryReferenceSelection(current, targetSectionId, entries, retainedInactiveSectionIds));
    setStatus(entries.length
      ? `已保存并加载 ${entries.length} 节前文梗概。`
      : '已取消加载前文梗概。');
  };

  const deleteSectionMemory = async (sourceSectionId: string) => {
    if (!book) throw new Error('请先打开一本书。');
    const source = referenceLocation(book, sourceSectionId);
    if (!source?.section.memory) throw new Error('当前小节没有可删除的 Memory。');
    const references = book.chapters.flatMap((chapter) => chapter.sections)
      .flatMap((item) => item.contextReferences ?? [])
      .filter((reference) => reference.sectionId === sourceSectionId);
    const candidate = editBookSectionMemory(book, sourceSectionId, 'delete', new Date().toISOString());
    await bookSession.saveEditedSnapshot(candidate);
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
    const candidate = editBookSectionMemory(book, sourceSectionId, 'rollback', new Date().toISOString());
    await bookSession.saveEditedSnapshot(candidate);
    setStatus(`已回滚「${source.section.title}」的 Memory。`);
  };

  const clearPreviousMemory = async (sourceSectionId: string) => {
    if (!book) throw new Error('请先打开一本书。');
    const source = referenceLocation(book, sourceSectionId);
    if (!source?.section.previousMemory) throw new Error('没有可清除的上一版本。');
    const candidate = editBookSectionMemory(book, sourceSectionId, 'clear-previous', new Date().toISOString());
    await bookSession.saveEditedSnapshot(candidate);
    setStatus(`已清除「${source.section.title}」的上一版本 Memory。`);
  };

  const deleteSelection = async (selection: DirectorySelection) => {
    if (!book) throw new Error('请先打开一本书。');
    const result = deleteDirectorySelection(book, selection);
    await commitBookChange(() => result.book);
    removeContextDraftSessions(book.id, result.removedSectionIds);
    if (result.removedSectionIds.has(sectionId)) {
      setSectionId('');
      setInstruction('');
    }
  };

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

  const reloadCurrentBook = async () => {
    if (!book) return;
    if (dirty && !(globalThis.confirm?.('重新载入会放弃当前页面尚未保存的本地内容；如需保留，请先导出 JSON 备份。继续吗？') ?? true)) return;
    if (!await bookSession.reloadBook(book.id)) return;
    setStatus('已重新载入当前书目。');
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
          <strong>故事书屋</strong>
        </div>
        <div className="header-actions">
          <input
            ref={importInput}
            className="sr-only"
            type="file"
            disabled={busy || !canEdit}
            accept="application/json,.json"
            aria-label="导入 JSON 备份"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void withBusy(async () => { await importBookBackup(file); });
            }}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => importInput.current?.click()}
            disabled={busy || !canEdit}
            aria-label="导入 JSON 备份"
            title="导入 JSON 备份"
          >
            <FileJson aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => book
              ? setNewBookRequest((current) => current + 1)
              : setEmptyBookDialogOpen(true)}
            disabled={busy || !canEdit}
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
          {saveConflict && <button
            type="button"
            className="icon-button"
            onClick={() => void withBusy(reloadCurrentBook)}
            disabled={!book || busy}
            aria-label="重新载入当前书目"
            title="重新载入当前书目"
          >
            <BookOpenText aria-hidden="true" />
          </button>}
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
        {book && libraryReady && view === 'write' && section && (
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
            streamingDraft={streamingDraft && streamingDraft.bookId === book.id && streamingDraft.sectionId === section.id
              ? streamingDraft
              : null}
            contextPlanError={promptPreviewError}
            contextPlan={promptPreview}
            contextPlanPending={deferredContextInput !== contextPreviewInput}
            contextCompositionOpen={contextCompositionOpen}
            contextToolsOpen={contextToolsOpen}
            providerName={activeProviderProfile?.name ?? '未选择方案'}
            modelId={activeProviderProfile?.modelId ?? '未选择模型'}
            canEdit={canEdit}
            onBack={navigateFromHeader}
            onOpenBookSettings={() => {
              setWriterBookSettingsOpen(true);
              setBookSettingsRequest((current) => current + 1);
            }}
            onOpenSettings={openSettings}
            onOpenContextComposition={openContextComposition}
            onOpenContextTools={openContextTools}
            onCancelGeneration={cancelGeneration}
            onModeChange={setMode}
            onCharacterChange={setSelectedCharacterId}
            onInstructionChange={updateInstructionDraft}
            onEditorOpenChange={setManuscriptEditorOpen}
            onAuthorNoteChange={updateSectionNote}
            onSectionBlocksChange={updateSectionBlocks}
            onDeleteSectionBlock={deleteSectionBlock}
            onRegenerateBlock={regenerateBlock}
            onGenerateForBlock={respondToInput}
            onSelectCandidate={selectBlockCandidate}
            onDeleteAdoptedCandidate={removeAdoptedBlockCandidate}
            onSectionTitleChange={async (title) => {
              if (!sectionChapter || !section) throw new Error('找不到当前小节。');
              await renameSection(sectionChapter.id, section.id, title);
            }}
            onChapterTitleChange={async (title) => {
              if (!sectionChapter) return;
              await renameChapter(sectionChapter.id, title);
            }}
            onGenerate={() => void generateContinuation()}
          />
        )}
        {book && libraryReady && (view !== 'write' || writerBookSettingsOpen) && (
          <Bookshelf
            settingsOnly={view === 'write'}
            canEdit={canEdit}
            book={book}
            library={library}
            selectedSectionId={sectionId}
            openNewBookRequest={newBookRequest}
            onNewBookOpened={() => setNewBookRequest(0)}
            openBookSettingsRequest={bookSettingsRequest}
            onBookSettingsOpened={() => setBookSettingsRequest(0)}
            onBookSettingsClose={() => {
              if (!writerBookSettingsOpen) return;
              setWriterBookSettingsOpen(false);
              window.requestAnimationFrame(() => {
                mainContent.current?.querySelector<HTMLElement>('.writer-book-settings-button')?.focus();
              });
            }}
            onOpenBook={(id) => void navigateToBook(id)}
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
            onAddSection={async (chapterId, title, afterSectionId) => { await addSection(chapterId, title, afterSectionId); }}
            onMoveDirectoryItem={commitDirectoryMove}
            onUndoDirectoryMove={undoDirectoryMove}
            canUndoDirectoryMove={directoryUndo?.bookId === book.id}
            directoryBusy={directoryBusy}
            onRenameChapter={async (chapterId, title) => { await renameChapter(chapterId, title); }}
            onRenameSection={async (chapterId, sectionId, title) => { await renameSection(chapterId, sectionId, title); }}
            onDeleteSelection={deleteSelection}
            onDeleteSources={deleteSources}
          />
        )}
        {!book && !libraryReady && <p className="loading-copy">正在打开此设备的书库…</p>}
        {!book && libraryReady && canEdit && (
          <EmptyLibraryActions
            open={emptyBookDialogOpen}
            busy={busy}
            onOpenChange={setEmptyBookDialogOpen}
            onCreateBook={createBook}
            onImport={() => importInput.current?.click()}
          />
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
        streamingOutput={streamingOutput}
        onStreamingOutputChange={setStreamingOutput}
        providerProfiles={providerProfiles}
        activeProviderProfileId={activeProviderProfileId}
        onSelectProviderProfile={setActiveProviderProfileId}
        onSaveProviderProfile={saveProviderProfile}
        onTestProviderProfile={api.testProviderProfile}
        providerRuntime={api.runtime}
        onLoadStorageLocation={api.storageLocation}
        onClose={() => settingsTrigger.current?.focus()}
      />

      {book && section && (
        <ContextToolsDrawer
          open={contextToolsOpen}
          book={book}
          section={section}
          onGenerateMemory={generateSectionMemory}
          onSaveMemoriesAndLoad={saveSectionMemoriesAndLoad}
          busy={busy}
          onCancelGeneration={cancelGeneration}
          onClose={closeContextTools}
          canEdit={canEdit}
          sessionDrafts={contextToolDrafts.current}
          onPendingDraftsChange={(pending) => { pendingContextDrafts.current = pending; }}
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

export default App;
