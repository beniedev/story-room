import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { bookCacheKey, bookCachePrefix, cacheDraftBook, clearHostBookCaches, isCachedBook, removeDraftBook } from '../deviceDrafts';
import { resolveBookForLoad, type BookLoadResolution } from '../bookRecovery';
import { normalizeBook } from '../sectionMemory';
import type { Book, BookIndexEntry } from '../types';
import { blockedBookConflictError, bookConflictMessage, isBookConflictError, staleSaveError } from './bookSessionErrors';
import type { BookOpenOptions, BookRevisionToken, BookSessionToken, BookSessionTransition } from './bookSessionTypes';

type BookSessionOptions<TBootstrap> = {
  bootstrap: { load: () => Promise<TBootstrap>; apply: (loaded: TBootstrap) => void };
  onStatus: (message: string) => void;
  onTransition: (transition: BookSessionTransition) => void;
  isBusy: () => boolean;
  hasLocalEditorDraft: (bookId: string) => boolean;
};

export function useBookSession<TBootstrap>(options: BookSessionOptions<TBootstrap>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const isDeviceRuntime = api.runtime === 'device';
  const setStatus = (message: string) => optionsRef.current.onStatus(message);
  const hasLocalEditorDraft = (bookId: string) => optionsRef.current.hasLocalEditorDraft(bookId);
  const [library, setLibrary] = useState<BookIndexEntry[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [dirty, setDirty] = useState(false);
  const [libraryReady, setLibraryReady] = useState(!isDeviceRuntime);
  const bookRef = useRef<Book | null>(null);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveFlights = useRef(new Map<number, Promise<Book>>());
  const persistedRevision = useRef<number | null>(null);
  const persistedUpdatedAt = useRef<string | null>(null);
  const draftBaseUpdatedAt = useRef<string | null | undefined>(undefined);
  const saveConflictRef = useRef(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const canEdit = libraryReady;
  const libraryLoadGenerationRef = useRef(0);
  const bookLoadGenerationRef = useRef(0);
  // Loading attempts can be superseded while the current Book is still saving.
  // Only adopting a Book (including a reload) starts a new save session.
  const bookSessionRef = useRef(0);
  const bookNavigationPending = useRef(false);

  const assertDeviceWriteAccess = () => {
    if (!libraryReady) throw new Error('书库仍在打开，请稍候。');
  };
  const advanceSaveRevision = () => {
    saveRevision.current += 1;
    saveFlights.current.clear();
    persistedRevision.current = null;
    return saveRevision.current;
  };

  const cacheCurrentDraft = (candidate: Book) => {
    if (api.runtime !== 'device') return false;
    if (draftBaseUpdatedAt.current === undefined) {
      draftBaseUpdatedAt.current = persistedUpdatedAt.current;
    }
    if (draftBaseUpdatedAt.current === null) {
      return cacheDraftBook(candidate);
    }
    return cacheDraftBook(candidate, draftBaseUpdatedAt.current ?? null);
  };

  const clearCurrentDraft = (bookId: string) => {
    removeDraftBook(bookId);
    draftBaseUpdatedAt.current = undefined;
  };
  useEffect(() => {
    bookRef.current = book;
  }, [book]);


  useEffect(() => () => {
    libraryLoadGenerationRef.current += 1;
    bookLoadGenerationRef.current += 1;
    bookSessionRef.current += 1;
  }, []);

  useEffect(() => { clearHostBookCaches(); }, []);
  useEffect(() => {
    if (!isDeviceRuntime) return undefined;
    const currentBookId = book?.id;
    const onStorage = (event: StorageEvent) => {
      const isLibraryUpdate = event.key === 'story-native:library';
      const isAnyBookUpdate = event.key === null || event.key?.startsWith(bookCachePrefix) === true;
      const isCurrentBookUpdate = Boolean(currentBookId && event.key === bookCacheKey(currentBookId));
      if (!isLibraryUpdate && !isAnyBookUpdate) return;
      if (isLibraryUpdate && api.runtime === 'device') {
        void api.listPersistedBooks().then(setLibrary)
          .catch((error) => setStatus(error instanceof Error ? error.message : '无法刷新书库。'));
      }
      if (!currentBookId || !isCurrentBookUpdate) return;
      const storedValue = localStorage.getItem(bookCacheKey(currentBookId));
      if (!storedValue) {
        saveConflictRef.current = true;
        setSaveConflict(true);
        setDirty(true);
        setStatus(bookConflictMessage);
        return;
      }
      try {
        const incoming = JSON.parse(storedValue) as unknown;
        if (!isCachedBook(incoming, book.id) || incoming.updatedAt === persistedUpdatedAt.current) return;
        if (persistedRevision.current === saveRevision.current && !optionsRef.current.isBusy() && !hasLocalEditorDraft(currentBookId)) {
          const loaded = normalizeBook(incoming);
          optionsRef.current.onTransition({ kind: 'external-refresh', book: loaded });
          bookRef.current = loaded;
          setBook(loaded);
          persistedUpdatedAt.current = loaded.updatedAt;
          persistedRevision.current = advanceSaveRevision();
        } else {
          saveConflictRef.current = true;
          setSaveConflict(true);
          setDirty(true);
          setStatus(bookConflictMessage);
        }
      } catch {
        // A malformed update is handled by the next explicit load; keep the local page intact.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [book?.id, isDeviceRuntime]);
  useEffect(() => {
    let active = true;
    const loadGeneration = ++libraryLoadGenerationRef.current;
    const isCurrent = () => active && loadGeneration === libraryLoadGenerationRef.current;

    setLibraryReady(false);
    setLibrary([]);
    setBook(null);
    bookRef.current = null;
    bookSessionRef.current += 1;
    optionsRef.current.onTransition({ kind: 'reset' });
    saveConflictRef.current = false;
    persistedUpdatedAt.current = null;
    draftBaseUpdatedAt.current = undefined;
    advanceSaveRevision();
    setDirty(false);
    setSaveConflict(false);
    setStatus(isDeviceRuntime ? '正在打开此设备的书库…' : '正在打开本机书库…');
    void (async () => {
      try {
        let libraryWarning = '';
        const readLibrary = async () => {
          try { return await api.listBooks(); }
          catch (error) {
            if (api.runtime !== 'device') throw error;
            // A failed coordinator must not hide already-saved Books or their
            // export path. Writes still go through the gate and report errors.
            libraryWarning = error instanceof Error ? error.message : '设备保存协调暂不可用。';
            return api.listPersistedBooks();
          }
        };
        const [entries, adjunct] = await Promise.all([
          readLibrary(),
          optionsRef.current.bootstrap.load(),
        ]);
        if (!isCurrent()) return;
        optionsRef.current.bootstrap.apply(adjunct);
        if (!isCurrent()) return;
        setLibrary(entries);
        const selectedBookId = entries[0]?.id;
        if (selectedBookId) {
          await openBook(selectedBookId);
        }
        if (!isCurrent()) return;
        setLibraryReady(true);
        if (!saveConflictRef.current) setStatus(libraryWarning);
      } catch (error) {
        if (!isCurrent()) return;
        setLibraryReady(true);
        setStatus(error instanceof Error ? error.message : '无法打开书库。');
      }
    })();
    return () => { active = false; };
  }, [isDeviceRuntime]);

  useEffect(() => {
    if (!book || !dirty || !canEdit) return;
    const candidate = normalizeBook(book);
    let cachedLocally = false;
    if (api.runtime === 'device') cachedLocally = cacheCurrentDraft(candidate);
    if (saveConflictRef.current) {
      setStatus(bookConflictMessage);
      return;
    }
    setLibrary((items) => [{ id: book.id, title: book.title, updatedAt: book.updatedAt },
      ...items.filter((item) => item.id !== book.id)]);
    setStatus(api.runtime === 'device'
      ? (cachedLocally ? '本页恢复草稿已保留，正在保存到此设备…' : '本页恢复草稿无法写入，正在尝试保存书目…')
      : '正在保存到书库…');

    const revision = saveRevision.current;
    const timer = window.setTimeout(() => {
      const task = queueBookSave(candidate, revision, revision);
      void task.then((saved) => {
        if (saveRevision.current !== revision) return;
        const normalizedSaved = normalizeBook(saved);
        if (api.runtime === 'device') {
          clearCurrentDraft(normalizedSaved.id);
        }
        bookRef.current = normalizedSaved;
        setBook((current) => current?.id === normalizedSaved.id ? normalizedSaved : current);
        setLibrary((items) => [{ id: normalizedSaved.id, title: normalizedSaved.title, updatedAt: normalizedSaved.updatedAt },
          ...items.filter((item) => item.id !== saved.id)]);
        setDirty(false);
        setStatus(api.runtime === 'device'
          ? '已自动保存到此设备。'
          : '已自动保存。');
      }).catch((error) => {
        if (saveRevision.current === revision) {
          if (isBookConflictError(error)) {
            setDirty(true);
            setStatus(bookConflictMessage);
          } else {
            const recovery = api.runtime === 'device' && cachedLocally
              ? '当前设备草稿仍保留本次修改。'
              : '请立即复制正文或导出仍可访问的内容。';
            setStatus(`${error instanceof Error ? error.message : '保存失败。'} ${recovery}`);
          }
        }
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [book, canEdit, dirty]);
  const openBook = async (bookId: string, options: BookOpenOptions = {}) => {
    const loadGeneration = ++bookLoadGenerationRef.current;
    const isCurrent = () => loadGeneration === bookLoadGenerationRef.current;
    const persistedOnly = options.persistedOnly ?? false;
    try {
      if (book && book.id !== bookId && dirty && !persistedOnly) await saveCurrent();
    } catch (error) { if (isCurrent()) throw error; return false; }
    if (!isCurrent()) return false;
    optionsRef.current.onTransition({ kind: 'before-switch' });
    let resolution: BookLoadResolution;
    try {
      resolution = await resolveBookForLoad(bookId, { ...options, persistedOnly });
    } catch (error) { if (isCurrent()) throw error; return false; }
    if (!isCurrent()) return false;
    const { stored, loaded, draft, draftConflict, loadedDirty } = resolution;
    bookSessionRef.current += 1;
    persistedUpdatedAt.current = stored.updatedAt;
    draftBaseUpdatedAt.current = !persistedOnly && !options.ignoreDraft && draft !== null ? draft.baseUpdatedAt : undefined;
    saveConflictRef.current = !persistedOnly && draftConflict;
    setSaveConflict(!persistedOnly && draftConflict);
    const revision = advanceSaveRevision();
    bookRef.current = loaded;
    setBook(loaded);
    optionsRef.current.onTransition({ kind: 'activated', book: loaded, reason: 'open' });
    persistedRevision.current = loadedDirty ? null : revision;
    setDirty(persistedOnly ? false : loadedDirty);
    if (!persistedOnly && draftConflict) setStatus(bookConflictMessage);
    return true;
  };
  const changeBook = (recipe: (current: Book) => Book) => {
    assertDeviceWriteAccess();
    advanceSaveRevision();
    const current = bookRef.current ?? book;
    if (!current) return;
    const next = normalizeBook({ ...recipe(current), updatedAt: new Date().toISOString() });
    bookRef.current = next;
    setBook(next);
    setDirty(true);
  };
  const navigateToBook = async (bookId: string) => {
    if (optionsRef.current.isBusy() && !bookNavigationPending.current) return;
    bookNavigationPending.current = true;
    optionsRef.current.onTransition({ kind: 'navigation-pending', pending: true });
    const task = openBook(bookId);
    const request = bookLoadGenerationRef.current;
    try { await task; }
    catch (error) {
      if (request === bookLoadGenerationRef.current) setStatus(isBookConflictError(error)
        ? bookConflictMessage : error instanceof Error ? error.message : '无法打开书目。');
    } finally {
      if (request === bookLoadGenerationRef.current) {
        bookNavigationPending.current = false;
        optionsRef.current.onTransition({ kind: 'navigation-pending', pending: false });
      }
    }
  };
  const queueBookSave = (candidate: Book, revision: number, autosaveRevision?: number): Promise<Book> => {
    assertDeviceWriteAccess();
    const owner = bookSessionRef.current;
    const ownsBook = () => owner === bookSessionRef.current && bookRef.current?.id === candidate.id;
    const existing = saveFlights.current.get(revision);
    if (existing) return existing;
    let persisted = false;
    const task = saveQueue.current.catch(() => undefined).then(() => {
      // A delayed autosave may already be behind a slow PUT. Skip its stale
      // snapshot before starting another full-book write; an already-started
      // request remains untouched and its response is still revision-guarded.
      if (autosaveRevision !== undefined && saveRevision.current !== autosaveRevision) {
        return candidate;
      }
      if (!ownsBook()) throw staleSaveError();
      if (saveConflictRef.current) throw blockedBookConflictError();
      if (!persistedUpdatedAt.current) throw new Error('缺少当前书目的服务端保存基线，请重新载入后再保存。');
      persisted = true;
      return api.saveBook(candidate, persistedUpdatedAt.current);
    });
    const tracked: Promise<Book> = task.then((saved) => {
      if (persisted && ownsBook()) {
        persistedUpdatedAt.current = saved.updatedAt;
        if (saveRevision.current === revision) persistedRevision.current = revision;
        else if (api.runtime === 'device' && bookRef.current) {
          // Newer edits extend this successful write. Their recovery baseline
          // must advance too, without clearing or replacing their draft.
          draftBaseUpdatedAt.current = saved.updatedAt;
          cacheCurrentDraft(bookRef.current);
        }
      }
      return saved;
    }, (error) => {
      if (ownsBook() && isBookConflictError(error)) {
        saveConflictRef.current = true;
        setSaveConflict(true);
        setDirty(true);
      }
      if (saveFlights.current.get(revision) === tracked) saveFlights.current.delete(revision);
      throw error;
    });
    saveFlights.current.set(revision, tracked);
    saveQueue.current = tracked.then(() => undefined, () => undefined);
    return tracked;
  };

  const saveCurrent = async (candidateOverride?: Book) => {
    assertDeviceWriteAccess();
    const owner = bookSessionRef.current;
    const currentBook = candidateOverride ?? bookRef.current ?? book;
    if (!currentBook) throw new Error('请先打开一本书。');
    const candidate = normalizeBook(currentBook);
    const revision = saveRevision.current;
    if (!candidateOverride
      && !dirty
      && persistedRevision.current === revision) return currentBook;
    const saveRevisionForCandidate = candidateOverride ? advanceSaveRevision() : revision;
    setStatus(api.runtime === 'device' ? '正在保存到此设备…' : '正在保存到书库…');
    if (api.runtime === 'device') cacheCurrentDraft(candidate);
    const saved = normalizeBook(await queueBookSave(candidate, saveRevisionForCandidate));
    if (owner !== bookSessionRef.current || bookRef.current?.id !== candidate.id || saveRevision.current !== saveRevisionForCandidate) throw staleSaveError();
    if (api.runtime === 'device') {
      clearCurrentDraft(saved.id);
    }
    bookRef.current = saved;
    setBook(saved);
    setDirty(false);
    persistedRevision.current = saveRevisionForCandidate;
    persistedUpdatedAt.current = saved.updatedAt;
    saveConflictRef.current = false;
    setSaveConflict(false);
    setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
      ...items.filter((item) => item.id !== saved.id)]);
    setStatus(api.runtime === 'device'
      ? '已自动保存到此设备。'
      : '已自动保存。');
    return saved;
  };

  const commitBookChange = async (recipe: (current: Book) => Book, deferCommit = false) => {
    assertDeviceWriteAccess();
    const currentBook = bookRef.current ?? book;
    if (!currentBook) throw new Error('请先打开一本书。');
    const owner = bookSessionRef.current;
    const candidate = normalizeBook({
      ...recipe(currentBook),
      updatedAt: new Date().toISOString(),
    });
    const revision = advanceSaveRevision();
    if (!deferCommit) {
      bookRef.current = candidate;
      setBook(candidate);
      setDirty(true);
      if (api.runtime === 'device') cacheCurrentDraft(candidate);
    }
    setStatus(api.runtime === 'device' ? '正在保存到此设备…' : '正在保存到书库…');
    try {
      const saved = normalizeBook(await queueBookSave(candidate, revision));
      // The write succeeded, but later edits still own the visible Book.
      if (owner !== bookSessionRef.current || bookRef.current?.id !== candidate.id || saveRevision.current !== revision) return saved;
      if (api.runtime === 'device') {
        clearCurrentDraft(saved.id);
      }
      bookRef.current = saved;
      setBook(saved);
      setDirty(false);
      persistedRevision.current = revision;
      persistedUpdatedAt.current = saved.updatedAt;
      saveConflictRef.current = false;
      setSaveConflict(false);
      setLibrary((items) => [{ id: saved.id, title: saved.title, updatedAt: saved.updatedAt },
        ...items.filter((item) => item.id !== saved.id)]);
      setStatus(api.runtime === 'device' ? '已保存到此设备。' : '已保存。');
      return saved;
    } catch (error) {
      if (owner !== bookSessionRef.current || bookRef.current?.id !== candidate.id || saveRevision.current !== revision) throw error;
      if (!deferCommit && !isBookConflictError(error)) {
        bookRef.current = currentBook;
        setBook(currentBook);
        setDirty(dirty);
        if (api.runtime === 'device') {
          if (dirty) cacheCurrentDraft(currentBook);
          else clearCurrentDraft(currentBook.id);
        }
      } else if (isBookConflictError(error)) {
        setDirty(true);
      }
      setStatus(isBookConflictError(error)
        ? bookConflictMessage
        : error instanceof Error ? error.message : '保存失败。');
      throw error;
    }
  };

  const ensureCurrentBookSaved = async () => {
    if (!book || !dirty) return book;
    return saveCurrent();
  };

  const createBook = async (title: string) => {
    assertDeviceWriteAccess();
    try {
      await ensureCurrentBookSaved();
      optionsRef.current.onTransition({ kind: 'before-switch' });
      const created = await api.createBook(title);
      const normalizedCreated = normalizeBook(created);
      bookSessionRef.current += 1;
      bookLoadGenerationRef.current += 1;
      bookRef.current = normalizedCreated;
      setLibrary((items) => [{ id: normalizedCreated.id, title: normalizedCreated.title, updatedAt: normalizedCreated.updatedAt }, ...items]);
      setBook(normalizedCreated);
      draftBaseUpdatedAt.current = undefined;
      persistedUpdatedAt.current = normalizedCreated.updatedAt;
      saveConflictRef.current = false;
      setSaveConflict(false);
      const revision = advanceSaveRevision();
      optionsRef.current.onTransition({ kind: 'activated', book: normalizedCreated, reason: 'created' });
      persistedRevision.current = revision;
      setDirty(false);
      setStatus(api.runtime === 'device' ? '新书目已建立在此设备。' : '新书目已建立在本机。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '新建书目失败。');
      throw error;
    }
  };
  const importBookBackup = async (imported: Book) => {
    assertDeviceWriteAccess();
    if (saveConflictRef.current) {
      optionsRef.current.onTransition({ kind: 'before-switch' });
    } else {
      await ensureCurrentBookSaved();
      optionsRef.current.onTransition({ kind: 'before-switch' });
    }
    const restored = normalizeBook(await api.importBook(imported));
    bookSessionRef.current += 1;
    bookLoadGenerationRef.current += 1;
    const revision = advanceSaveRevision();
    persistedUpdatedAt.current = restored.updatedAt;
    draftBaseUpdatedAt.current = undefined;
    saveConflictRef.current = false;
    setSaveConflict(false);
    bookRef.current = restored;
    setBook(restored);
    setLibrary((items) => [{
      id: restored.id,
      title: restored.title,
      updatedAt: restored.updatedAt,
    }, ...items.filter((item) => item.id !== restored.id)]);
    optionsRef.current.onTransition({ kind: 'activated', book: restored, reason: 'imported' });
    persistedRevision.current = revision;
    setDirty(false);
    setStatus(`已导入《${restored.title}》的恢复副本，原书目未覆盖。`);
  };

  const deleteCurrentBook = async () => {
    assertDeviceWriteAccess();
    if (!book) {
      const error = new Error('当前没有可删除的书目。');
      setStatus(error.message);
      throw error;
    }
    const deletedBook = book;
    const nextBook = library.find((entry) => entry.id !== deletedBook.id);
    const wasDirty = dirty;
    try {
      await ensureCurrentBookSaved();
      const nextResolution = nextBook ? await resolveBookForLoad(nextBook.id) : null;
      const revision = advanceSaveRevision();
      setDirty(false);
      await saveQueue.current.catch(() => undefined);
      await api.deleteBook(deletedBook.id);
      bookSessionRef.current += 1;
      bookLoadGenerationRef.current += 1;
      optionsRef.current.onTransition({ kind: 'deleted', bookId: deletedBook.id });
      removeDraftBook(deletedBook.id);
      setLibrary((items) => items.filter((entry) => entry.id !== deletedBook.id));
      if (nextResolution) {
        const {
          stored: storedNextBook,
          loaded: loadedNextBook,
          draft,
          draftConflict,
          loadedDirty,
        } = nextResolution;
        draftBaseUpdatedAt.current = draft?.baseUpdatedAt;
        persistedUpdatedAt.current = storedNextBook.updatedAt;
        saveConflictRef.current = draftConflict;
        setSaveConflict(draftConflict);
        bookRef.current = loadedNextBook;
        setBook(loadedNextBook);
        optionsRef.current.onTransition({ kind: 'activated', book: loadedNextBook, reason: 'deleted-next' });
        persistedRevision.current = loadedDirty ? null : revision;
        setDirty(loadedDirty);
      } else {
        bookRef.current = null;
        setBook(null);
        optionsRef.current.onTransition({ kind: 'empty' });
        draftBaseUpdatedAt.current = undefined;
        persistedUpdatedAt.current = null;
        persistedRevision.current = null;
        saveConflictRef.current = false;
        setSaveConflict(false);
        setDirty(false);
      }
      if (!saveConflictRef.current) setStatus(`已删除《${deletedBook.title}》。`);
    } catch (error) {
      setDirty(wasDirty);
      setStatus(error instanceof Error ? error.message : '删除书目失败。');
      throw error;
    }
  };

  const saveEditedSnapshot = (candidate: Book) => {
    assertDeviceWriteAccess();
    if (candidate.id !== bookRef.current?.id) throw staleSaveError();
    bookRef.current = candidate;
    setBook(candidate);
    setDirty(true);
    return saveCurrent(candidate);
  };

  const reloadBook = async (bookId: string) => {
    if (!await openBook(bookId, { ignoreDraft: true })) return false;
    clearCurrentDraft(bookId);
    return true;
  };

  const getSnapshot = () => ({
    book: bookRef.current,
    sessionId: bookSessionRef.current,
    revision: saveRevision.current,
  });
  const captureToken = (): BookRevisionToken => ({
    bookId: bookRef.current?.id ?? null,
    sessionId: bookSessionRef.current,
    revision: saveRevision.current,
  });
  const isCurrent = (token: BookSessionToken, checks: { revision?: number; sectionId?: string } = {}) => (
    token.sessionId === bookSessionRef.current && token.bookId === (bookRef.current?.id ?? null)
    && (checks.revision === undefined || checks.revision === saveRevision.current)
    && (checks.sectionId === undefined || Boolean(bookRef.current?.chapters.some((chapter) =>
      chapter.sections.some((section) => section.id === checks.sectionId))))
  );

  return {
    book, library, dirty, libraryReady, saveConflict, getSnapshot, captureToken, isCurrent,
    assertWriteAccess: assertDeviceWriteAccess, openBook, navigateToBook, changeBook,
    saveCurrent, commitBookChange, ensureCurrentBookSaved, createBook, importBookBackup,
    deleteCurrentBook, saveEditedSnapshot, reloadBook,
  };
}
