import { useEffect, useRef, useState } from 'react';
import {
  contextToolDraftKey,
  copyContextToolDraftSession,
  emptyContextToolMemoryDraft as emptyMemoryDraft,
  hasPendingContextToolDrafts,
  initialContextToolDraftSession,
  sanitizeContextToolDraftSession,
  type ContextToolDraftSession,
} from '../../contextToolDrafts';
import { draftFromSectionMemory, sectionMemoryProvenanceAfterReview } from '../../sectionMemory';
import type { Book, SectionMemoryDraft, SectionMemoryProvenance } from '../../types';

type ContextToolSection = Book['chapters'][number]['sections'][number];

interface ContextToolSessionOptions {
  book: Book;
  section: ContextToolSection;
  canEdit: boolean;
  sessionDrafts?: Map<string, ContextToolDraftSession>;
  onPendingDraftsChange?: (pending: boolean) => void;
  onGenerateMemory: (sourceSectionId: string) => Promise<SectionMemoryDraft>;
  onSaveMemoriesAndLoad: (
    items: Array<{
      sourceSectionId: string;
      draft: SectionMemoryDraft;
      provenance: SectionMemoryProvenance;
    }>,
    retainedInactiveSectionIds?: string[],
  ) => Promise<void>;
  onCancelGeneration: () => void;
}

export function useContextToolSession({
  book,
  section,
  canEdit,
  sessionDrafts,
  onPendingDraftsChange,
  onGenerateMemory,
  onSaveMemoriesAndLoad,
  onCancelGeneration,
}: ContextToolSessionOptions) {
  const localSessionDraftsRef = useRef(new Map<string, ContextToolDraftSession>());
  const sessionDraftsRef = useRef<Map<string, ContextToolDraftSession>>(
    sessionDrafts ?? localSessionDraftsRef.current,
  );
  sessionDraftsRef.current = sessionDrafts ?? localSessionDraftsRef.current;
  const sourceSectionIdsByBookRef = useRef(new Map<string, Set<string>>());
  sourceSectionIdsByBookRef.current.set(book.id, new Set(book.chapters.flatMap((chapter) => (
    chapter.sections.map((sourceSection) => sourceSection.id)
  ))));
  const currentSectionRef = useRef(section);
  currentSectionRef.current = section;
  const onPendingDraftsChangeRef = useRef(onPendingDraftsChange);
  onPendingDraftsChangeRef.current = onPendingDraftsChange;
  const initialSessionKey = contextToolDraftKey(book.id, section.id);
  const initialSession = sessionDraftsRef.current.get(initialSessionKey)
    ? copyContextToolDraftSession(sessionDraftsRef.current.get(initialSessionKey)!)
    : initialContextToolDraftSession(
        book.id,
        section.id,
        (section.contextReferences ?? []).map((reference) => reference.sectionId),
      );
  const activeSessionKeyRef = useRef(initialSessionKey);
  const sessionStateRef = useRef(initialSession);
  const [sessionState, setSessionState] = useState<ContextToolDraftSession>(initialSession);
  sessionStateRef.current = sessionState;
  const generationSequenceRef = useRef(0);
  const generationOperationsRef = useRef(new Map<number, {
    key: string;
    bookId: string;
    epoch: number;
    sourceSectionId: string;
    invalidated: boolean;
    settled: boolean;
  }>());
  const sessionEpochsRef = useRef(new Map<string, number>());
  const sessionRevisionsRef = useRef(new Map<string, number>());
  const ownedSessionEntriesRef = useRef(new Map<string, ContextToolDraftSession>());
  const saveRequestSequenceRef = useRef(0);
  const activeSaveRequestsRef = useRef(new Map<string, number>());
  const [summaryBusyId, setSummaryBusyId] = useState('');
  const memoryDrafts = sessionState.memoryDrafts;

  const notifyPendingDrafts = () => {
    onPendingDraftsChangeRef.current?.(hasPendingContextToolDrafts(sessionDraftsRef.current));
  };

  const storeSession = (key: string, session: ContextToolDraftSession) => {
    sessionDraftsRef.current.set(key, session);
    ownedSessionEntriesRef.current.set(key, session);
  };

  // Instance-local epochs cannot detect another Drawer replacing the same key in the shared Map.
  const ownsSession = (key: string) => {
    const owned = ownedSessionEntriesRef.current.get(key);
    return owned !== undefined && sessionDraftsRef.current.get(key) === owned;
  };

  const sessionForKey = (key: string) => {
    const stored = sessionDraftsRef.current.get(key);
    if (stored) return stored;
    return activeSessionKeyRef.current === key ? sessionStateRef.current : undefined;
  };

  const updateSession = (
    key: string,
    patch: Partial<ContextToolDraftSession>,
    markChanges = false,
  ) => {
    const current = sessionForKey(key);
    if (!current) return undefined;
    if (!sessionDraftsRef.current.has(key)) {
      sessionEpochsRef.current.set(key, (sessionEpochsRef.current.get(key) ?? 0) + 1);
    }
    sessionRevisionsRef.current.set(key, (sessionRevisionsRef.current.get(key) ?? 0) + 1);
    const next = copyContextToolDraftSession({
      ...current,
      ...patch,
      hasChanges: markChanges || current.hasChanges,
    });
    storeSession(key, next);
    if (activeSessionKeyRef.current === key) {
      sessionStateRef.current = next;
      setSessionState(next);
    }
    notifyPendingDrafts();
    return next;
  };

  const latestGenerationForKey = (key: string) => [...generationOperationsRef.current.entries()]
    .filter(([, operation]) => operation.key === key && !operation.settled && !operation.invalidated)
    .sort(([left], [right]) => left - right)
    .at(-1)?.[1];

  const resetSession = (key: string, selectedIds: string[]) => {
    const next = initialContextToolDraftSession(book.id, section.id, selectedIds);
    sessionStateRef.current = next;
    if (activeSessionKeyRef.current === key) setSessionState(next);
    return next;
  };

  const clearSessionDraft = (key: string, selectedIds?: string[]) => {
    sessionDraftsRef.current.delete(key);
    ownedSessionEntriesRef.current.delete(key);
    sessionEpochsRef.current.set(key, (sessionEpochsRef.current.get(key) ?? 0) + 1);
    sessionRevisionsRef.current.set(key, (sessionRevisionsRef.current.get(key) ?? 0) + 1);
    if (activeSessionKeyRef.current === key) {
      resetSession(key, selectedIds
        ?? (currentSectionRef.current.contextReferences ?? []).map((reference) => reference.sectionId));
    }
    notifyPendingDrafts();
  };

  const referenceSignature = JSON.stringify((section.contextReferences ?? [])
    .map((reference) => [reference.sectionId, reference.mode, reference.reason]));
  useEffect(() => {
    activeSessionKeyRef.current = initialSessionKey;
    const baselineSelectedSectionIds = (section.contextReferences ?? []).map((reference) => reference.sectionId);
    const validSourceSectionIds = new Set(book.chapters.flatMap((chapter) => (
      chapter.sections.map((sourceSection) => sourceSection.id)
    )));
    const stored = sessionDraftsRef.current.get(initialSessionKey);
    const activeGeneration = latestGenerationForKey(initialSessionKey);
    const generationSourceExists = activeGeneration
      ? validSourceSectionIds.has(activeGeneration.sourceSectionId)
      : true;
    const next = stored
      ? sanitizeContextToolDraftSession(stored, validSourceSectionIds, baselineSelectedSectionIds)
      : initialContextToolDraftSession(book.id, section.id, baselineSelectedSectionIds);
    let restoredSession = next;
    if (stored) {
      const keepForGeneration = Boolean(activeGeneration && generationSourceExists);
      if (keepForGeneration || next.hasChanges || next.expandedSectionIds.length || Object.keys(next.memoryDrafts).length
        || Object.keys(next.generatedDrafts).length || Object.keys(next.summaryErrors).length) {
        restoredSession = keepForGeneration
          ? { ...next, hasChanges: true }
          : next;
        storeSession(initialSessionKey, restoredSession);
      } else {
        sessionDraftsRef.current.delete(initialSessionKey);
        ownedSessionEntriesRef.current.delete(initialSessionKey);
        sessionEpochsRef.current.set(initialSessionKey, (sessionEpochsRef.current.get(initialSessionKey) ?? 0) + 1);
        sessionRevisionsRef.current.set(initialSessionKey, (sessionRevisionsRef.current.get(initialSessionKey) ?? 0) + 1);
      }
    } else if (activeGeneration) {
      activeGeneration.invalidated = true;
    }
    if (activeGeneration && !generationSourceExists) {
      activeGeneration.invalidated = true;
      onCancelGeneration();
    }
    sessionStateRef.current = restoredSession;
    setSessionState(restoredSession);
    setSummaryBusyId(activeGeneration && !activeGeneration.invalidated ? activeGeneration.sourceSectionId : '');
    notifyPendingDrafts();
    return undefined;
  }, [book.chapters, initialSessionKey, referenceSignature, sessionDrafts]);

  const setSelectedSectionIds = (next: Set<string>) => {
    if (!canEdit) return;
    updateSession(activeSessionKeyRef.current, { selectedSectionIds: [...next] }, true);
  };

  const setExpandedSectionIds = (next: Set<string>) => {
    if (!canEdit) return;
    updateSession(activeSessionKeyRef.current, { expandedSectionIds: [...next] });
  };

  const flagMissingSummaries = (sourceSectionIds: string[]) => {
    if (!canEdit) return;
    const current = sessionForKey(activeSessionKeyRef.current);
    if (!current) return;
    updateSession(activeSessionKeyRef.current, {
      summaryErrors: {
        ...current.summaryErrors,
        ...Object.fromEntries(sourceSectionIds.map((sourceSectionId) => [
          sourceSectionId,
          '请先填写或生成梗概，或取消勾选；不会加载原文。',
        ])),
      },
      expandedSectionIds: [...new Set([...current.expandedSectionIds, ...sourceSectionIds])],
    }, true);
  };

  const memoryDraftFor = (source: ContextToolSection) => (
    memoryDrafts[source.id]
      ?? draftFromSectionMemory(source.memory)
      ?? emptyMemoryDraft()
  );
  const memoryDraftForSession = (
    session: ContextToolDraftSession,
    source: ContextToolSection,
  ) => (
    session.memoryDrafts[source.id]
      ?? draftFromSectionMemory(source.memory)
      ?? emptyMemoryDraft()
  );
  const updateSummary = (source: ContextToolSection, synopsis: string) => {
    if (!canEdit) return;
    const current = sessionForKey(activeSessionKeyRef.current);
    if (!current) return;
    updateSession(activeSessionKeyRef.current, {
      memoryDrafts: {
        ...current.memoryDrafts,
        [source.id]: { ...memoryDraftFor(source), synopsis },
      },
      summaryErrors: { ...current.summaryErrors, [source.id]: '' },
    }, true);
  };
  const generateSummary = async (source: ContextToolSection) => {
    if (!canEdit) return emptyMemoryDraft();
    const key = activeSessionKeyRef.current;
    const operationId = ++generationSequenceRef.current;
    const operation = {
      key,
      bookId: book.id,
      epoch: 0,
      sourceSectionId: source.id,
      invalidated: false,
      settled: false,
    };
    generationOperationsRef.current.set(operationId, operation);
    const current = sessionForKey(key);
    if (current) {
      updateSession(key, {
        summaryErrors: { ...current.summaryErrors, [source.id]: '' },
      }, true);
    }
    operation.epoch = sessionEpochsRef.current.get(key) ?? 0;
    if (activeSessionKeyRef.current === key) setSummaryBusyId(source.id);
    try {
      const draft = await onGenerateMemory(source.id);
      const completed = generationOperationsRef.current.get(operationId);
      if (completed && !completed.invalidated
        && (sessionEpochsRef.current.get(key) ?? 0) === completed.epoch
        && sourceSectionIdsByBookRef.current.get(completed.bookId)?.has(completed.sourceSectionId)
        && ownsSession(key)) {
        const stored = sessionDraftsRef.current.get(key)!;
        updateSession(key, {
          generatedDrafts: { ...stored.generatedDrafts, [source.id]: draft },
          memoryDrafts: { ...stored.memoryDrafts, [source.id]: draft },
        }, true);
      }
      return draft;
    } catch (error) {
      const failed = generationOperationsRef.current.get(operationId);
      if (failed && !failed.invalidated
        && (sessionEpochsRef.current.get(key) ?? 0) === failed.epoch
        && sourceSectionIdsByBookRef.current.get(failed.bookId)?.has(failed.sourceSectionId)
        && ownsSession(key)) {
        const stored = sessionDraftsRef.current.get(key)!;
        updateSession(key, {
          summaryErrors: {
            ...stored.summaryErrors,
            [source.id]: error instanceof Error ? error.message : '梗概生成失败。',
          },
        }, true);
      }
      throw error;
    } finally {
      const completed = generationOperationsRef.current.get(operationId);
      if (completed) completed.settled = true;
      if (activeSessionKeyRef.current === key) {
        const next = latestGenerationForKey(key);
        setSummaryBusyId(next?.sourceSectionId ?? '');
      }
      generationOperationsRef.current.delete(operationId);
    }
  };
  const saveSummariesAndLoad = async (sources: ContextToolSection[], inactiveExistingSectionIds: string[]) => {
    if (!canEdit) return;
    const key = activeSessionKeyRef.current;
    const session = sessionForKey(key);
    if (!session) throw new Error('当前前文草稿已失效，请重新打开。');
    if (!sessionDraftsRef.current.has(key)) {
      storeSession(key, copyContextToolDraftSession(session));
      sessionEpochsRef.current.set(key, (sessionEpochsRef.current.get(key) ?? 0) + 1);
      notifyPendingDrafts();
    }
    const sessionRevision = sessionRevisionsRef.current.get(key) ?? 0;
    const sessionEpoch = sessionEpochsRef.current.get(key) ?? 0;
    const saveRequest = ++saveRequestSequenceRef.current;
    activeSaveRequestsRef.current.set(key, saveRequest);
    const entries = sources.map((source) => {
      const draft = memoryDraftForSession(session, source);
      return {
        sourceSectionId: source.id,
        draft,
        provenance: sectionMemoryProvenanceAfterReview(
          source.memory,
          draft,
          session.generatedDrafts[source.id],
        ),
      };
    });
    const retainedInactiveSectionIds = inactiveExistingSectionIds
      .filter((sourceSectionId) => session.selectedSectionIds.includes(sourceSectionId));
    const savedSelectionIds = [...new Set([
      ...sources.map((source) => source.id),
      ...retainedInactiveSectionIds,
    ])];
    try {
      if (inactiveExistingSectionIds.length) {
        await onSaveMemoriesAndLoad(entries, retainedInactiveSectionIds);
      } else {
        await onSaveMemoriesAndLoad(entries);
      }
      if (!ownsSession(key)
        || (sessionEpochsRef.current.get(key) ?? 0) !== sessionEpoch
        || (sessionRevisionsRef.current.get(key) ?? 0) !== sessionRevision
        || activeSaveRequestsRef.current.get(key) !== saveRequest) return;
      clearSessionDraft(key, savedSelectionIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : '梗概保存失败，请重试。';
      const current = sessionDraftsRef.current.get(key);
      if (current
        && ownsSession(key)
        && (sessionEpochsRef.current.get(key) ?? 0) === sessionEpoch
        && (sessionRevisionsRef.current.get(key) ?? 0) === sessionRevision
        && activeSaveRequestsRef.current.get(key) === saveRequest) {
        updateSession(key, {
          summaryErrors: {
            ...current.summaryErrors,
            ...Object.fromEntries(sources.map((source) => [source.id, message])),
          },
        }, true);
      }
      throw error;
    } finally {
      if (activeSaveRequestsRef.current.get(key) === saveRequest) {
        activeSaveRequestsRef.current.delete(key);
      }
    }
  };
  return {
    sessionKey: initialSessionKey,
    referenceSignature,
    sessionState,
    summaryBusyId,
    setSelectedSectionIds,
    setExpandedSectionIds,
    flagMissingSummaries,
    memoryDraftFor,
    updateSummary,
    generateSummary,
    saveSummariesAndLoad,
  };
}
