import { api } from './api';
import { importLegacyDraft, readDraftRecord, type DeviceDraftRecord } from './deviceDrafts';
import { normalizeBook } from './sectionMemory';
import type { Book } from './types';

export type BookLoadResolution = {
  stored: Book;
  loaded: Book;
  draft: DeviceDraftRecord | null;
  draftConflict: boolean;
  loadedDirty: boolean;
};

export const resolveBookForLoad = async (
  bookId: string,
  options: { ignoreDraft?: boolean; persistedOnly?: boolean } = {},
): Promise<BookLoadResolution> => {
  const stored = normalizeBook(await (options.persistedOnly && api.runtime === 'device'
    ? api.loadPersistedBook(bookId)
    : api.loadBook(bookId)));
  if (options.persistedOnly) {
    return {
      stored,
      loaded: stored,
      draft: null,
      draftConflict: false,
      loadedDirty: false,
    };
  }
  if (api.runtime === 'device') await importLegacyDraft(bookId);
  const draft = api.runtime === 'device' ? readDraftRecord(bookId) : null;
  const recoverDraft = !options.ignoreDraft && draft !== null;
  const draftConflict = recoverDraft && (draft!.legacy || draft!.baseUpdatedAt !== stored.updatedAt);
  const loaded = recoverDraft ? draft!.book : stored;
  return {
    stored,
    loaded,
    draft,
    draftConflict,
    loadedDirty: recoverDraft,
  };
};
