import { beforeEach, describe, expect, it } from 'vitest';
import { deviceLibrary } from '../src/deviceLibrary';
import { createExampleBooks } from '../src/fixtures';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('device-local library', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it('seeds examples and keeps creates, edits, and deletes on the current device', async () => {
    const seeded = await deviceLibrary.listBooks();
    expect(seeded).toHaveLength(3);

    const created = await deviceLibrary.createBook('本地新书');
    expect((await deviceLibrary.loadBook(created.id)).title).toBe('本地新书');

    const saved = await deviceLibrary.saveBook({ ...created, title: '本地改名' });
    expect((await deviceLibrary.listBooks())[0]).toMatchObject({ id: saved.id, title: '本地改名' });

    await deviceLibrary.deleteBook(saved.id);
    await expect(deviceLibrary.loadBook(saved.id)).rejects.toThrow('找不到 Book');
  });

  it('recovers pre-index device caches when upgrading from the previous demo', async () => {
    const cached = { ...createExampleBooks()[0], id: 'book-local-draft', title: '未导出的本地草稿' };
    localStorage.setItem(`story-native:book:${cached.id}`, JSON.stringify(cached));

    const library = await deviceLibrary.listBooks();
    expect(library).toContainEqual(expect.objectContaining({ id: cached.id, title: cached.title }));
    expect(await deviceLibrary.loadBook(cached.id)).toMatchObject({ id: cached.id, title: cached.title });
  });
});
