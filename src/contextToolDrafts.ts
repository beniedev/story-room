import type { SectionMemoryDraft } from './types';

export interface ContextToolDraftSession {
  bookId: string;
  sectionId: string;
  hasChanges: boolean;
  selectedSectionIds: string[];
  expandedSectionIds: string[];
  memoryDrafts: Record<string, SectionMemoryDraft>;
  generatedDrafts: Record<string, SectionMemoryDraft>;
  summaryErrors: Record<string, string>;
}

/**
 * Encode the two identities as a tuple so IDs such as "a:b" and "a"/"b"
 * cannot collide through delimiter concatenation.
 */
export const contextToolDraftKey = (bookId: string, sectionId: string): string => (
  JSON.stringify([bookId, sectionId])
);

export const hasPendingContextToolDrafts = (
  sessions: Map<string, ContextToolDraftSession>,
): boolean => [...sessions.values()].some((session) => session.hasChanges);

export const emptyContextToolMemoryDraft = (): SectionMemoryDraft => ({
  synopsis: '',
  beats: [],
  continuityFacts: [],
  characterStateChanges: [],
  foreshadowingCandidates: [],
});

export const initialContextToolDraftSession = (
  bookId: string,
  sectionId: string,
  selectedSectionIds: string[] = [],
): ContextToolDraftSession => ({
  bookId,
  sectionId,
  hasChanges: false,
  selectedSectionIds: [...selectedSectionIds],
  expandedSectionIds: [],
  memoryDrafts: {},
  generatedDrafts: {},
  summaryErrors: {},
});

export const copyContextToolDraftSession = (session: ContextToolDraftSession): ContextToolDraftSession => ({
  ...session,
  selectedSectionIds: [...session.selectedSectionIds],
  expandedSectionIds: [...session.expandedSectionIds],
  memoryDrafts: { ...session.memoryDrafts },
  generatedDrafts: { ...session.generatedDrafts },
  summaryErrors: { ...session.summaryErrors },
});

const filterContextToolDraftRecord = <T,>(
  record: Record<string, T>,
  validSourceSectionIds: Set<string>,
): Record<string, T> => Object.fromEntries(
  Object.entries(record).filter(([sourceSectionId]) => validSourceSectionIds.has(sourceSectionId)),
) as Record<string, T>;

export const sanitizeContextToolDraftSession = (
  session: ContextToolDraftSession,
  validSourceSectionIds: Set<string>,
  baselineSelectedSectionIds: string[],
): ContextToolDraftSession => {
  const next = copyContextToolDraftSession({
    ...session,
    selectedSectionIds: session.selectedSectionIds.filter((sourceSectionId) => validSourceSectionIds.has(sourceSectionId)),
    expandedSectionIds: session.expandedSectionIds.filter((sourceSectionId) => validSourceSectionIds.has(sourceSectionId)),
    memoryDrafts: filterContextToolDraftRecord(session.memoryDrafts, validSourceSectionIds),
    generatedDrafts: filterContextToolDraftRecord(session.generatedDrafts, validSourceSectionIds),
    summaryErrors: filterContextToolDraftRecord(session.summaryErrors, validSourceSectionIds),
  });
  const baseline = new Set(baselineSelectedSectionIds.filter((sourceSectionId) => validSourceSectionIds.has(sourceSectionId)));
  const selectedChanged = next.selectedSectionIds.length !== baseline.size
    || next.selectedSectionIds.some((sourceSectionId) => !baseline.has(sourceSectionId));
  const hasValidPendingState = selectedChanged
    || Object.keys(next.memoryDrafts).length > 0
    || Object.keys(next.generatedDrafts).length > 0
    || Object.keys(next.summaryErrors).length > 0;
  return {
    ...next,
    hasChanges: session.hasChanges && hasValidPendingState,
  };
};
