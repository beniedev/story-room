// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleBooks } from '../src/fixtures';
import { normalizeBook } from '../src/sectionMemory';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';
import { DEVICE_WRITER_LOCK_NAME } from '../src/deviceWriterLease';
import {
  bookCacheKey,
  cacheDraftBook,
  clearHostBookCaches,
  importLegacyDraft,
  readDraftRecord,
  removeDraftBook,
} from '../src/deviceDrafts';
import { resolveBookForLoad } from '../src/bookRecovery';

const fakeApi = vi.hoisted(() => ({
  runtime: 'device' as 'device' | 'local-host',
  loadBook: vi.fn(),
  loadPersistedBook: vi.fn(),
}));
vi.mock('../src/api', () => ({ api: fakeApi }));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const draftKey = (id: string) => `story-native:draft:${id}`;
const book = () => {
  const value = createExampleBooks()[0];
  value.updatedAt = '2026-01-01T00:00:00.000Z';
  value.chapters[0].sections[0].contextReferences = [];
  return value;
};
const failStorage = () => { throw new Error('synthetic storage failure'); };
let locks: ReturnType<typeof installFakeDeviceLocks>;

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  fakeApi.runtime = 'device';
  fakeApi.loadBook.mockReset().mockImplementation(async () => book());
  fakeApi.loadPersistedBook.mockReset().mockImplementation(async () => book());
  locks = installFakeDeviceLocks();
});

afterEach(() => {
  locks.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('device draft persistence', () => {
  it('round-trips an envelope in page storage without writing or removing persisted Books', () => {
    const value = book();
    localStorage.setItem(bookCacheKey(value.id), 'persisted book');
    const set = vi.spyOn(localStorage, 'setItem');
    const remove = vi.spyOn(localStorage, 'removeItem');
    expect(readDraftRecord(value.id)).toBeNull();
    expect(cacheDraftBook(value, value.updatedAt)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(draftKey(value.id))!)).toEqual({
      schemaVersion: 1, book: normalizeBook(value), baseUpdatedAt: value.updatedAt,
      draftEditedAt: expect.any(String),
    });
    expect(readDraftRecord(value.id)).toEqual({
      book: normalizeBook(value), baseUpdatedAt: value.updatedAt, legacy: false,
    });
    expect(readDraftRecord('other-book')).toBeNull();
    sessionStorage.setItem(draftKey('other-book'), 'other draft');
    removeDraftBook(value.id);
    expect(readDraftRecord(value.id)).toBeNull();
    expect(sessionStorage.getItem(draftKey('other-book'))).toBe('other draft');
    expect(localStorage.getItem(bookCacheKey(value.id))).toBe('persisted book');
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '{}', JSON.stringify({ schemaVersion: 2 }), JSON.stringify({ ...createExampleBooks()[0], id: 'other-book' })])(
    'treats malformed or mismatched data as no draft: %s', (raw) => {
      sessionStorage.setItem(draftKey(book().id), raw);
      expect(readDraftRecord(book().id)).toBeNull();
      expect(sessionStorage.getItem(draftKey(book().id))).toBe(raw);
    },
  );

  it('reads legacy raw Books with an unknown baseline', () => {
    const value = book();
    sessionStorage.setItem(draftKey(value.id), JSON.stringify(value));
    expect(readDraftRecord(value.id)).toEqual({ book: normalizeBook(value), baseUpdatedAt: null, legacy: true });
  });

  it('copies legacy data under the library gate before removing the shared draft', async () => {
    const value = book();
    const raw = JSON.stringify(value);
    localStorage.setItem(draftKey(value.id), raw);
    const originalSet = sessionStorage.setItem.bind(sessionStorage);
    const set = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, contents) => {
      expect(locks.locks.isHeld(DEVICE_WRITER_LOCK_NAME)).toBe(true);
      originalSet(key, contents);
    });
    const remove = vi.spyOn(localStorage, 'removeItem');
    await importLegacyDraft(value.id);
    expect(locks.locks.requests).toHaveLength(1);
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(sessionStorage.getItem(draftKey(value.id))).toBe(raw);
    expect(localStorage.getItem(draftKey(value.id))).toBeNull();
  });

  it('retains the legacy draft if copying to page storage fails', async () => {
    localStorage.setItem(draftKey(book().id), 'legacy bytes');
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(failStorage);
    await expect(importLegacyDraft(book().id)).rejects.toThrow('synthetic storage failure');
    expect(localStorage.getItem(draftKey(book().id))).toBe('legacy bytes');
  });

  it('keeps both drafts when a page draft already exists', async () => {
    localStorage.setItem(draftKey(book().id), 'legacy bytes');
    sessionStorage.setItem(draftKey(book().id), 'page bytes');
    await importLegacyDraft(book().id);
    expect(locks.locks.requests).toHaveLength(0);
    expect(localStorage.getItem(draftKey(book().id))).toBe('legacy bytes');
    expect(sessionStorage.getItem(draftKey(book().id))).toBe('page bytes');
  });

  it('preserves the different read, write, removal and migration failure boundaries', async () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(failStorage);
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(failStorage);
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(failStorage);
    expect(readDraftRecord(book().id)).toBeNull();
    expect(cacheDraftBook(book())).toBe(false);
    expect(() => removeDraftBook(book().id)).not.toThrow();
    localStorage.setItem(draftKey(book().id), 'legacy bytes');
    await expect(importLegacyDraft(book().id)).rejects.toThrow('synthetic storage failure');
  });

  it('does not clean shared caches in device mode and removes only host Book caches in host mode', () => {
    localStorage.setItem(bookCacheKey('one'), 'book');
    localStorage.setItem(draftKey('one'), 'draft');
    localStorage.setItem('unrelated-preference', 'keep');
    sessionStorage.setItem(draftKey('one'), 'page draft');
    clearHostBookCaches();
    expect(localStorage.length).toBe(3);
    fakeApi.runtime = 'local-host';
    clearHostBookCaches();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('unrelated-preference')).toBe('keep');
    expect(sessionStorage.getItem(draftKey('one'))).toBe('page draft');
  });

  it('continues host cleanup after one removal fails and tolerates an unreadable store', () => {
    fakeApi.runtime = 'local-host';
    localStorage.setItem(bookCacheKey('one'), 'book');
    localStorage.setItem(draftKey('two'), 'draft');
    const original = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === bookCacheKey('one')) failStorage();
      original(key);
    });
    expect(() => clearHostBookCaches()).not.toThrow();
    expect(localStorage.getItem(draftKey('two'))).toBeNull();
    vi.spyOn(localStorage, 'key').mockImplementation(failStorage);
    expect(() => clearHostBookCaches()).not.toThrow();
  });
});

describe('Book load recovery', () => {
  it('loads a normalized stored Book without creating a draft when none exists', async () => {
    const result = await resolveBookForLoad(book().id);
    expect(result).toEqual({ stored: normalizeBook(book()), loaded: normalizeBook(book()), draft: null, draftConflict: false, loadedDirty: false });
    expect(result.stored.chapters[0].sections[0]).not.toHaveProperty('contextReferences');
    expect(sessionStorage.length).toBe(0);
  });

  it.each([['matching', false], ['older', true], [null, true]] as const)(
    'recovers a draft with baseline %s and reports its conflict', async (baseline, conflict) => {
      const stored = book();
      const draft = { ...stored, title: 'Synthetic edited title' };
      cacheDraftBook(draft, baseline === 'matching' ? stored.updatedAt : baseline);
      const result = await resolveBookForLoad(stored.id);
      expect(result.stored).toEqual(normalizeBook(stored));
      expect(result.loaded).toEqual(normalizeBook(draft));
      expect(result.loadedDirty).toBe(true);
      expect(result.draftConflict).toBe(conflict);
    },
  );

  it('reports legacy recovery as a conflict and leaves persisted content intact', async () => {
    const stored = book();
    const draft = { ...stored, title: 'Synthetic legacy draft' };
    localStorage.setItem(draftKey(stored.id), JSON.stringify(draft));
    const result = await resolveBookForLoad(stored.id);
    expect(result.loaded.title).toBe(draft.title);
    expect(result.stored.title).toBe(stored.title);
    expect(result.draftConflict).toBe(true);
    expect(result.draft?.legacy).toBe(true);
  });

  it('ignoreDraft still migrates and reports the draft without loading it', async () => {
    const stored = book();
    localStorage.setItem(draftKey(stored.id), JSON.stringify({ ...stored, title: 'Synthetic legacy draft' }));
    const result = await resolveBookForLoad(stored.id, { ignoreDraft: true });
    expect(result.loaded).toEqual(normalizeBook(stored));
    expect(result.draft?.book.title).toBe('Synthetic legacy draft');
    expect(result.draftConflict).toBe(false);
    expect(result.loadedDirty).toBe(false);
    expect(localStorage.getItem(draftKey(stored.id))).toBeNull();
  });

  it('persistedOnly bypasses draft storage and normalizes the persisted API result', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(failStorage);
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(failStorage);
    const result = await resolveBookForLoad(book().id, { persistedOnly: true });
    expect(fakeApi.loadPersistedBook).toHaveBeenCalledWith(book().id);
    expect(fakeApi.loadBook).not.toHaveBeenCalled();
    expect(result).toEqual({ stored: normalizeBook(book()), loaded: normalizeBook(book()), draft: null, draftConflict: false, loadedDirty: false });
  });

  it('host mode uses the host API and never accesses page drafts', async () => {
    fakeApi.runtime = 'local-host';
    vi.spyOn(localStorage, 'getItem').mockImplementation(failStorage);
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(failStorage);
    expect(cacheDraftBook(book())).toBe(false);
    expect(readDraftRecord(book().id)).toBeNull();
    expect(() => removeDraftBook(book().id)).not.toThrow();
    await expect(importLegacyDraft(book().id)).resolves.toBeUndefined();
    for (const options of [{}, { persistedOnly: true }]) {
      expect((await resolveBookForLoad(book().id, options)).loaded).toEqual(normalizeBook(book()));
    }
    expect(fakeApi.loadBook).toHaveBeenCalledTimes(2);
    expect(fakeApi.loadPersistedBook).not.toHaveBeenCalled();
  });

  it('preserves load failures without migrating or consuming a draft', async () => {
    fakeApi.loadBook.mockRejectedValueOnce(new Error('synthetic load failure'));
    localStorage.setItem(draftKey(book().id), 'legacy bytes');
    await expect(resolveBookForLoad(book().id)).rejects.toThrow('synthetic load failure');
    expect(localStorage.getItem(draftKey(book().id))).toBe('legacy bytes');
    expect(sessionStorage.length).toBe(0);
  });
});
