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
