import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { requiredString, validId, validateBook } from './bookValidation.ts';
import { BookNotFoundError, StoreConflictError, StoreInputError } from './storeErrors.ts';
export { BookNotFoundError, StoreConflictError, StoreDataError, StoreInputError } from './storeErrors.ts';
import type {
  Book,
  BookIndexEntry,
} from '../src/types.ts';
import {
  normalizeBook,
} from '../src/sectionMemory.ts';
import { createExampleBooks, createLegacyFixtureBook, upgradeExampleBookContent } from '../src/fixtures.ts';
import {
  bookRoot as getBookRoot, encodeBookManifest, inspectBookTree, loadBookTree,
  prepareBookTree, reconcileBookTree, sourceWriteBatches,
} from './storage/bookTree.ts';
import { atomicWrite, atomicWriteIfChanged, readJson } from './storage/safePaths.ts';
import { BookTransactions, type StoreDeleteFaultStage, type StoreRecoveryStage } from './storage/transactions.ts';
export type { StoreDeleteFaultStage, StoreRecoveryStage } from './storage/transactions.ts';

export type SaveBookOptions = {
  expectedUpdatedAt?: string;
  createOnly?: boolean;
};

export type StoreFaultStage = 'after-sources' | 'after-manifest' | 'after-library';

const comparableBook = (book: Book) => ({
  ...book,
  plotOutline: book.plotOutline ?? '',
  updatedAt: '',
});

const sameBookIgnoringTimestamp = (left: Book, right: Book) => (
  isDeepStrictEqual(comparableBook(left), comparableBook(right))
);

export class StoryStore {
  readonly root: string;
  private seedPromise?: Promise<void>;
  private examplesPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly transactions: BookTransactions;

  constructor(root = process.env.STORY_DATA_DIR ?? path.resolve('.data')) {
    this.root = root;
    this.transactions = new BookTransactions(root, {
      recoveryCheckpoint: (stage) => this.recoveryCheckpoint(stage),
      deleteTransactionCheckpoint: (stage) => this.deleteTransactionCheckpoint(stage),
      removeTransactionTree: (directory) => this.removeTransactionTree(directory),
      removeBookTree: (directory) => this.removeBookTree(directory),
    });
  }

  private libraryFile() {
    return path.join(this.root, 'library.json');
  }

  private bookRoot(bookId: string) {
    return getBookRoot(this.root, bookId);
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async transactionCheckpoint(_stage: StoreFaultStage): Promise<void> {
    // Narrow seam for storage fault-injection tests.
  }

  protected async deleteTransactionCheckpoint(_stage: StoreDeleteFaultStage): Promise<void> {
    // Narrow seam for delete fault-injection tests.
  }

  protected async recoveryCheckpoint(_stage: StoreRecoveryStage): Promise<void> {
    // Narrow seam for recovery fault-injection tests.
  }

  protected async removeTransactionTree(directory: string) {
    await rm(directory, { recursive: true, force: false });
  }

  private async settleSourceWrites(writes: Array<() => Promise<void>>) {
    const results = await Promise.allSettled(writes.map((write) => write()));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  protected async writeManagedSource(file: string, content: string) {
    await atomicWriteIfChanged(file, content);
  }

  private async ensureSeeded() {
    this.seedPromise ??= this.enqueue(async () => {
      await this.transactions.recover();
      try {
        await readFile(this.libraryFile(), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await atomicWrite(this.libraryFile(), '[]\n');
        for (const book of createExampleBooks()) await this.saveBookInternal(book);
      }
    });
    await this.seedPromise;
  }

  private async ensureExamples() {
    this.examplesPromise ??= (async () => {
      await this.ensureSeeded();
      await this.enqueue(async () => {
        await this.transactions.recover();
        const library = await readJson<BookIndexEntry[]>(this.libraryFile());
        const legacyExamples = new Map([
          ['the-observatory', createLegacyFixtureBook('the-observatory', 'The Observatory', 'Mira')],
          ['harbor-at-noon', createLegacyFixtureBook('harbor-at-noon', 'Harbor at Noon', 'Rowan')],
        ]);
        for (const example of createExampleBooks()) {
          const entry = library.find((item) => item.id === example.id);
          if (!entry) continue;
          const legacy = legacyExamples.get(example.id);
          const current = await this.loadBookFromDisk(example.id);
          if (legacy && sameBookIgnoringTimestamp(current, legacy)) {
            await this.saveBookInternal(example);
            continue;
          }
          const upgraded = upgradeExampleBookContent(current, example);
          if (upgraded) await this.saveBookInternal(upgraded);
        }
      });
    })();
    await this.examplesPromise;
  }

  async listBooks(): Promise<BookIndexEntry[]> {
    await this.ensureSeeded();
    await this.ensureExamples();
    return this.enqueue(async () => {
      await this.transactions.recover();
      return readJson<BookIndexEntry[]>(this.libraryFile());
    });
  }

  private async loadBookFromDisk(bookId: string): Promise<Book> {
    return loadBookTree(this.root, bookId);
  }

  async loadBook(bookId: string): Promise<Book> {
    validId(bookId);
    await this.ensureSeeded();
    return this.enqueue(async () => {
      await this.transactions.recover();
      return this.loadBookFromDisk(bookId);
    });
  }

  private nextUpdatedAt(previous: string | undefined) {
    const now = Date.now();
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    return new Date(Math.max(now, Number.isFinite(previousMs) ? previousMs + 1 : now)).toISOString();
  }

  private async saveBookInternal(normalizedBook: Book, options: SaveBookOptions = {}) {
    await this.transactions.recover();
    if (options.expectedUpdatedAt !== undefined
      && (typeof options.expectedUpdatedAt !== 'string' || !options.expectedUpdatedAt.trim())) {
      throw new StoreInputError('expectedUpdatedAt 必须是非空文本。');
    }
    if (options.expectedUpdatedAt !== undefined && options.createOnly) {
      throw new StoreInputError('expectedUpdatedAt 与 createOnly 不能同时使用。');
    }

    let library: BookIndexEntry[] = [];
    try {
      library = await readJson<BookIndexEntry[]>(this.libraryFile());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // First seed write creates the library immediately below.
    }

    const current = await inspectBookTree(this.root, normalizedBook.id);
    if (options.createOnly && (current.rootExists || current.manifestExists
      || library.some((item) => item.id === normalizedBook.id))) {
      throw new StoreConflictError('这个 Book 已存在，恢复备份必须创建为新副本。');
    }
    if (options.expectedUpdatedAt !== undefined) {
      if (!current.manifestExists) throw new BookNotFoundError(normalizedBook.id);
      if (current.updatedAt !== options.expectedUpdatedAt) {
        throw new StoreConflictError();
      }
    }

    const root = this.bookRoot(normalizedBook.id);
    const saved = { ...normalizedBook, updatedAt: this.nextUpdatedAt(current.updatedAt) };
    const meta = encodeBookManifest(saved);

    await this.transactions.runSave(saved.id, async () => {
      await prepareBookTree(this.root, saved, root);

      // Source files are written before the manifest. The transaction keeps a
      // complete old set available if any one write fails.
      for (const batch of sourceWriteBatches(saved, root)) {
        await this.settleSourceWrites(batch.map((source) => () => {
          const { file, content } = source();
          return this.writeManagedSource(file, content);
        }));
      }
      await this.transactionCheckpoint('after-sources');

      await atomicWrite(path.join(root, 'book.json'), `${JSON.stringify(meta, null, 2)}\n`);
      await this.transactionCheckpoint('after-manifest');

      // Stale managed files are removed only after the new manifest is
      // published. Library visibility follows cleanup.
      await reconcileBookTree(saved, root);

      const entry = { id: saved.id, title: saved.title, updatedAt: saved.updatedAt };
      const next = [...library.filter((item) => item.id !== saved.id), entry]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await atomicWrite(this.libraryFile(), `${JSON.stringify(next, null, 2)}\n`);
      await this.transactionCheckpoint('after-library');

    });
    return saved;
  }

  async saveBook(book: Book, options: SaveBookOptions = {}): Promise<Book> {
    // Validate the caller's graph before normalization. normalizeBook is
    // intentionally tolerant of deleted references for the UI, but storage
    // must reject those references rather than persist a silently altered
    // Book.
    validateBook(book);
    const normalizedBook = normalizeBook(book);
    validateBook(normalizedBook);
    return this.enqueue(() => this.saveBookInternal(normalizedBook, options));
  }

  async importBook(book: Book): Promise<Book> {
    validateBook(book);
    const restored = { ...book, id: `book-${randomUUID()}` };
    return this.saveBook(restored, { createOnly: true });
  }

  async createBook(title: string): Promise<Book> {
    const cleanTitle = requiredString(title, 'Book 标题').trim() || 'Untitled Book';
    const id = `book-${randomUUID()}`;
    const book: Book = {
      id,
      title: cleanTitle,
      plotOutline: '',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{
        id: `chapter-${randomUUID()}`,
        title: '第一章',
        sections: [{ id: `section-${randomUUID()}`, title: '新段落', content: '' }],
      }],
      branches: [],
      updatedAt: new Date().toISOString(),
    };
    return this.saveBook(book);
  }

  // Kept as a narrow seam for storage fault-injection tests. The production
  // path still uses the standard-library recursive removal below.
  protected async removeBookTree(directory: string) {
    await rm(directory, { recursive: true, force: true });
  }

  async deleteBook(bookId: string): Promise<{ id: string }> {
    validId(bookId);
    await this.ensureSeeded();
    const operation = async () => {
      await this.transactions.recover();
      const library = await readJson<BookIndexEntry[]>(this.libraryFile());
      if (!library.some((entry) => entry.id === bookId)) throw new BookNotFoundError(bookId);

      await this.transactions.runDelete(bookId, library);
      return { id: bookId };
    };
    return this.enqueue(operation);
  }
}
