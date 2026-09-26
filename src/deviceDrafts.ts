import { api } from './api';
import { normalizeBook } from './sectionMemory';
import { withDeviceLibraryWrite } from './deviceWriterLease';
import type { Book } from './types';

export const bookCachePrefix = 'story-native:book:';
export const bookCacheKey = (bookId: string) => `${bookCachePrefix}${bookId}`;
const bookDraftPrefix = 'story-native:draft:';
const bookDraftKey = (bookId: string) => `${bookDraftPrefix}${bookId}`;

export const isCachedBook = (value: unknown, bookId: string): value is Book => {
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

type DeviceDraftEnvelope = {
  schemaVersion: 1;
  book: Book;
  baseUpdatedAt: string | null;
  draftEditedAt: string;
};

export type DeviceDraftRecord = {
  book: Book;
  baseUpdatedAt: string | null;
  legacy: boolean;
};

const isDraftEnvelope = (value: unknown, bookId: string): value is DeviceDraftEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeviceDraftEnvelope>;
  return candidate.schemaVersion === 1
    && (typeof candidate.baseUpdatedAt === 'string' || candidate.baseUpdatedAt === null)
    && typeof candidate.draftEditedAt === 'string'
    && isCachedBook(candidate.book, bookId);
};

export const readDraftRecord = (bookId: string): DeviceDraftRecord | null => {
  if (api.runtime !== 'device') return null;
  try {
    const value = sessionStorage.getItem(bookDraftKey(bookId));
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    if (isDraftEnvelope(parsed, bookId)) {
      return {
        book: normalizeBook(parsed.book),
        baseUpdatedAt: parsed.baseUpdatedAt,
        legacy: false,
      };
    }
    if (isCachedBook(parsed, bookId)) {
      return {
        book: normalizeBook(parsed),
        baseUpdatedAt: null,
        legacy: true,
      };
    }
    return null;
  } catch {
    return null;
  }
};

// Copy before removing a legacy shared draft, within the library write gate.
export const importLegacyDraft = async (bookId: string) => {
  if (api.runtime !== 'device') return;
  if (localStorage.getItem(bookDraftKey(bookId)) === null || sessionStorage.getItem(bookDraftKey(bookId))) return;
  await withDeviceLibraryWrite(() => {
    if (sessionStorage.getItem(bookDraftKey(bookId))) return;
    const legacy = localStorage.getItem(bookDraftKey(bookId));
    if (legacy === null) return;
    sessionStorage.setItem(bookDraftKey(bookId), legacy);
    localStorage.removeItem(bookDraftKey(bookId));
  });
};

export const cacheDraftBook = (book: Book, baseUpdatedAt: string | null = null) => {
  if (api.runtime !== 'device') return false;
  try {
    const envelope: DeviceDraftEnvelope = {
      schemaVersion: 1,
      book: normalizeBook(book),
      baseUpdatedAt,
      draftEditedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(bookDraftKey(book.id), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
};

export const removeDraftBook = (bookId: string) => {
  if (api.runtime !== 'device') return;
  try {
    sessionStorage.removeItem(bookDraftKey(bookId));
  } catch {
    // Browser persistence is optional on the device runtime.
  }
};

export const clearHostBookCaches = () => {
  if (api.runtime === 'device') return;
  const staleKeys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(bookCachePrefix) || key?.startsWith(bookDraftPrefix)) staleKeys.push(key);
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
