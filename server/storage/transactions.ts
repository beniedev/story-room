import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { idPattern, isRecord } from '../bookValidation.ts';
import { BookNotFoundError, StoreDataError } from '../storeErrors.ts';
import type { BookIndexEntry } from '../../src/types.ts';
import {
  bookRoot as getBookRoot, collectManagedBookFiles, ensureBookFileParent, ensureStorageLayout,
  isManagedBookDirectory, isManagedBookRelative, pruneManagedEmptyDirectories,
} from './bookTree.ts';
import {
  assertSafeTree, atomicWrite, collectSnapshotFiles, ensureSafeDirectory, ensureSafeFile,
  isMissing, readJson, readSafeDirectory, safeDirectoryExists, unsafeBookTree,
} from './safePaths.ts';

class TransactionCleanupPendingError extends Error {
  constructor() {
    super('已提交事务将在下一次存储操作继续清理。');
    this.name = 'TransactionCleanupPendingError';
  }
}

type TransactionStatus = 'prepared' | 'committed';
type TransactionOperation = 'save' | 'delete';

type TransactionJournal = {
  schemaVersion: 1;
  id: string;
  bookId: string;
  operation: TransactionOperation;
  status: TransactionStatus;
  snapshotReady: boolean;
  bookExists: boolean;
  libraryExists: boolean;
  bookFiles: string[];
  createdAt: string;
};

export type StoreDeleteFaultStage = 'after-quarantine' | 'after-delete-library';

export type StoreRecoveryStage = 'before-restore' | 'after-restore';

const transactionRootName = '.story-transactions';
const saveInitializationNamePattern = /^save-initializing-tx-[a-z0-9-]+$/i;
const saveCleanupNamePattern = /^save-cleanup-tx-[a-z0-9-]+$/i;
const deleteInitializationNamePattern = /^delete-initializing-tx-[a-z0-9-]+$/i;
const deleteCleanupNamePattern = /^delete-cleanup-tx-[a-z0-9-]+$/i;
const transactionJournalTemporaryNamePattern = /^journal\.json\.tmp-\d+-[0-9a-f-]+$/i;

const transactionRelativePath = (relative: string) => relative.split(path.sep).join('/');

const fromTransactionRelativePath = (relative: string) => relative.split('/').join(path.sep);

const isSafeTransactionRelativePath = (relative: string) => {
  if (!relative || path.isAbsolute(relative)) return false;
  const parts = relative.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\\'));
};

type TransactionHooks = {
  recoveryCheckpoint: (stage: StoreRecoveryStage) => Promise<void>;
  deleteTransactionCheckpoint: (stage: StoreDeleteFaultStage) => Promise<void>;
  removeTransactionTree: (directory: string) => Promise<void>;
  removeBookTree: (directory: string) => Promise<void>;
};

// The caller owns serialization. This engine owns each transaction's journal and recovery context.
export class BookTransactions {
  private readonly root: string;
  private readonly hooks: TransactionHooks;

  constructor(root: string, hooks: TransactionHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  private libraryFile() {
    return path.join(this.root, 'library.json');
  }

  private bookRoot(bookId: string) {
    return getBookRoot(this.root, bookId);
  }

  private transactionsRoot() {
    return path.join(this.root, transactionRootName);
  }

  private async ensureTransactionParent() {
    await ensureStorageLayout(this.root);
    await ensureSafeDirectory(this.transactionsRoot());
  }

  private transactionJournalFile(transactionRoot: string) {
    return path.join(transactionRoot, 'journal.json');
  }

  private async writeTransactionJournal(transactionRoot: string, journal: TransactionJournal) {
    await atomicWrite(this.transactionJournalFile(transactionRoot), `${JSON.stringify(journal, null, 2)}\n`);
  }

  private async assertSaveTransactionTree(directory: string, message: string) {
    const visitSnapshot = async (current: string, relativeRoot: string): Promise<void> => {
      const entries = await readSafeDirectory(current);
      if (!entries) throw new StoreDataError(message);
      for (const entry of entries) {
        const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await ensureSafeDirectory(fullPath);
          if (!isManagedBookDirectory(relative)) throw new StoreDataError(message);
          await visitSnapshot(fullPath, relative);
          continue;
        }
        await ensureSafeFile(fullPath);
        if (!isManagedBookRelative(relative)) throw new StoreDataError(message);
      }
    };

    const entries = await readSafeDirectory(directory);
    if (!entries) throw new StoreDataError(message);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.name === 'book') {
        if (!entry.isDirectory()) throw new StoreDataError(message);
        await ensureSafeDirectory(fullPath);
        await visitSnapshot(fullPath, '');
      } else if (entry.name === 'journal.json'
        || entry.name === 'library.json'
        || transactionJournalTemporaryNamePattern.test(entry.name)) {
        await ensureSafeFile(fullPath);
      } else {
        throw new StoreDataError(message);
      }
    }
  }

  private saveCleanupRoot(transactionRoot: string) {
    return path.join(this.transactionsRoot(), `save-cleanup-${path.basename(transactionRoot)}`);
  }

  private async removeInitializingSaveTransaction(initializingRoot: string) {
    await this.assertSaveTransactionTree(initializingRoot, '未开始的保存事务包含未知内容。');
    try {
      await this.hooks.removeTransactionTree(initializingRoot);
    } catch {
      throw new StoreDataError('未开始的保存事务清理失败。');
    }
  }

  private async removeSaveCleanupTransaction(cleanupRoot: string) {
    await this.assertSaveTransactionTree(cleanupRoot, '保存事务清理目录包含未知内容。');
    try {
      await this.hooks.removeTransactionTree(cleanupRoot);
    } catch {
      throw new StoreDataError('保存事务残留清理失败。');
    }
  }

  private async retireSaveTransaction(transactionRoot: string) {
    await this.assertSaveTransactionTree(transactionRoot, '已收敛保存事务包含未知内容。');
    const cleanupRoot = this.saveCleanupRoot(transactionRoot);
    if (await safeDirectoryExists(cleanupRoot)) {
      throw new StoreDataError('保存事务清理目录发生冲突。');
    }
    try {
      await rename(transactionRoot, cleanupRoot);
    } catch {
      throw new TransactionCleanupPendingError();
    }
    try {
      await this.assertSaveTransactionTree(cleanupRoot, '保存事务清理目录包含未知内容。');
      await this.hooks.removeTransactionTree(cleanupRoot);
    } catch (error) {
      if (error instanceof StoreDataError) throw error;
      throw new TransactionCleanupPendingError();
    }
  }

  private async beginTransaction(bookId: string) {
    await this.ensureTransactionParent();
    const id = `tx-${randomUUID()}`;
    const root = path.join(this.transactionsRoot(), id);
    const initializingRoot = path.join(this.transactionsRoot(), `save-initializing-${id}`);
    await mkdir(initializingRoot);
    try {
      const bookRoot = this.bookRoot(bookId);
      let bookExists = false;
      try {
        const stat = await lstat(bookRoot);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
        bookExists = true;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const bookFiles = bookExists ? await collectManagedBookFiles(bookRoot) : [];
      let libraryExists = false;
      try {
        const stat = await lstat(this.libraryFile());
        if (stat.isSymbolicLink() || !stat.isFile()) throw unsafeBookTree();
        libraryExists = true;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }

      const journal: TransactionJournal = {
        schemaVersion: 1,
        id,
        bookId,
        operation: 'save',
        status: 'prepared',
        snapshotReady: false,
        bookExists,
        libraryExists,
        bookFiles: bookFiles.map(transactionRelativePath),
        createdAt: new Date().toISOString(),
      };
      await this.writeTransactionJournal(initializingRoot, journal);
      const snapshotRoot = path.join(initializingRoot, 'book');
      for (const relative of bookFiles) {
        const source = path.join(bookRoot, relative);
        const target = path.join(snapshotRoot, relative);
        await ensureSafeFile(source);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      if (libraryExists) {
        await ensureSafeFile(this.libraryFile());
        await copyFile(this.libraryFile(), path.join(initializingRoot, 'library.json'));
      }
      journal.snapshotReady = true;
      await this.writeTransactionJournal(initializingRoot, journal);
      await this.assertSaveTransactionTree(initializingRoot, '保存事务初始化目录包含未知内容。');
      await this.validateTransactionSnapshot(journal, initializingRoot);
      await rename(initializingRoot, root);
      return { root, journal };
    } catch (error) {
      // A normal in-process preparation failure has not published any new
      // Book files yet. A process exit at this point leaves a recognizable
      // initializing marker for the next operation to clean safely.
      await this.removeInitializingSaveTransaction(initializingRoot).catch(() => undefined);
      throw error;
    }
  }

  private async beginDeleteTransaction(bookId: string) {
    await this.ensureTransactionParent();
    const id = `tx-${randomUUID()}`;
    const root = path.join(this.transactionsRoot(), id);
    const initializingRoot = path.join(this.transactionsRoot(), `delete-initializing-${id}`);
    await mkdir(initializingRoot);
    const journal: TransactionJournal = {
      schemaVersion: 1,
      id,
      bookId,
      operation: 'delete',
      status: 'prepared',
      snapshotReady: false,
      bookExists: true,
      libraryExists: true,
      bookFiles: [],
      createdAt: new Date().toISOString(),
    };
    try {
      await this.writeTransactionJournal(initializingRoot, journal);
      await ensureSafeFile(this.libraryFile());
      await copyFile(this.libraryFile(), path.join(initializingRoot, 'library.json'));
      journal.snapshotReady = true;
      await this.writeTransactionJournal(initializingRoot, journal);
      await this.readDeleteLibrarySnapshot(journal, initializingRoot);
      await rename(initializingRoot, root);
      return { root, journal };
    } catch (error) {
      // No Book path changes happen until the ready journal is durable.
      await this.hooks.removeTransactionTree(initializingRoot).catch(() => undefined);
      throw error;
    }
  }

  private async readTransactionJournal(transactionRoot: string): Promise<TransactionJournal> {
    let value: unknown;
    try {
      await ensureSafeFile(this.transactionJournalFile(transactionRoot));
      value = await readJson<unknown>(this.transactionJournalFile(transactionRoot));
    } catch {
      throw new StoreDataError('事务记录损坏。');
    }
    if (!isRecord(value)
      || value.schemaVersion !== 1
      || typeof value.id !== 'string'
      || value.id !== path.basename(transactionRoot)
      || typeof value.bookId !== 'string'
      || !idPattern.test(value.bookId)
      || (value.operation !== undefined && value.operation !== 'save' && value.operation !== 'delete')
      || (value.status !== 'prepared' && value.status !== 'committed')
      || typeof value.snapshotReady !== 'boolean'
      || typeof value.bookExists !== 'boolean'
      || typeof value.libraryExists !== 'boolean'
      || !Array.isArray(value.bookFiles)
      || value.bookFiles.some((file) => typeof file !== 'string'
        || !isSafeTransactionRelativePath(file)
        || !isManagedBookRelative(fromTransactionRelativePath(file)))
      || (value.operation === 'delete'
        && (value.bookExists !== true || value.libraryExists !== true || value.bookFiles.length !== 0))) {
      throw new StoreDataError('事务记录损坏。');
    }
    return {
      schemaVersion: 1,
      id: value.id,
      bookId: value.bookId,
      // Journals created before delete recovery existed were all save journals.
      operation: value.operation === 'delete' ? 'delete' : 'save',
      status: value.status,
      snapshotReady: value.snapshotReady,
      bookExists: value.bookExists,
      libraryExists: value.libraryExists,
      bookFiles: value.bookFiles,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    };
  }

  private async restoreTransaction(journal: TransactionJournal, transactionRoot: string) {
    await ensureStorageLayout(this.root);
    await this.hooks.recoveryCheckpoint('before-restore');
    await assertSafeTree(transactionRoot);
    const bookRoot = this.bookRoot(journal.bookId);
    const snapshotRoot = path.join(transactionRoot, 'book');
    const snapshotFiles = new Set(journal.bookFiles);
    const currentFiles = await collectManagedBookFiles(bookRoot);
    for (const relative of currentFiles) {
      if (!snapshotFiles.has(transactionRelativePath(relative))) {
        const target = path.join(bookRoot, relative);
        await ensureSafeFile(target);
        await unlink(target);
      }
    }
    for (const relative of journal.bookFiles) {
      const source = path.join(snapshotRoot, fromTransactionRelativePath(relative));
      await ensureSafeFile(source);
      const targetRelative = fromTransactionRelativePath(relative);
      const target = path.join(bookRoot, targetRelative);
      await ensureBookFileParent(this.root, bookRoot, targetRelative);
      await atomicWrite(target, await readFile(source));
    }

    if (journal.libraryExists) {
      const source = path.join(transactionRoot, 'library.json');
      await ensureSafeFile(source);
      await atomicWrite(this.libraryFile(), await readFile(source));
    } else {
      try {
        await ensureSafeFile(this.libraryFile());
        await unlink(this.libraryFile());
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    await pruneManagedEmptyDirectories(bookRoot);
    await this.hooks.recoveryCheckpoint('after-restore');
  }

  private deleteQuarantineRoot(transactionRoot: string) {
    return path.join(transactionRoot, 'book');
  }

  private deleteCleanupRoot(transactionRoot: string) {
    return path.join(this.transactionsRoot(), `delete-cleanup-${path.basename(transactionRoot)}`);
  }

  private async readDeleteLibrarySnapshot(journal: TransactionJournal, transactionRoot: string) {
    const snapshot = path.join(transactionRoot, 'library.json');
    await ensureSafeFile(snapshot);
    let value: unknown;
    try {
      value = await readJson<unknown>(snapshot);
    } catch {
      throw new StoreDataError('删除事务的 library 快照损坏。');
    }
    if (!Array.isArray(value)
      || value.some((entry) => !isRecord(entry)
        || typeof entry.id !== 'string'
        || typeof entry.title !== 'string'
        || typeof entry.updatedAt !== 'string')
      || value.filter((entry) => (entry as BookIndexEntry).id === journal.bookId).length !== 1
      || new Set(value.map((entry) => (entry as BookIndexEntry).id)).size !== value.length) {
      throw new StoreDataError('删除事务的 library 快照损坏。');
    }
    return snapshot;
  }

  private async validateDeleteTransaction(journal: TransactionJournal, transactionRoot: string) {
    if (journal.operation !== 'delete'
      || !journal.snapshotReady
      || !journal.bookExists
      || !journal.libraryExists
      || journal.bookFiles.length !== 0) {
      throw new StoreDataError('删除事务记录损坏。');
    }
    await assertSafeTree(transactionRoot);
    const entries = await readSafeDirectory(transactionRoot);
    if (!entries) throw new StoreDataError('删除事务记录损坏。');
    for (const entry of entries) {
      if (entry.name === 'journal.json' || entry.name === 'library.json') {
        if (!entry.isFile()) throw new StoreDataError('删除事务记录损坏。');
        continue;
      }
      if (transactionJournalTemporaryNamePattern.test(entry.name) && entry.isFile()) continue;
      if (entry.name === 'book' && entry.isDirectory()) continue;
      throw new StoreDataError('删除事务目录包含未知内容。');
    }
    return this.readDeleteLibrarySnapshot(journal, transactionRoot);
  }

  private async restoreDeleteTransaction(journal: TransactionJournal, transactionRoot: string) {
    const snapshot = await this.validateDeleteTransaction(journal, transactionRoot);
    await ensureStorageLayout(this.root);
    await this.hooks.recoveryCheckpoint('before-restore');
    const bookRoot = this.bookRoot(journal.bookId);
    const quarantineRoot = this.deleteQuarantineRoot(transactionRoot);
    const bookExists = await safeDirectoryExists(bookRoot);
    const quarantineExists = await safeDirectoryExists(quarantineRoot);
    if (bookExists === quarantineExists) {
      throw new StoreDataError('删除事务无法确定唯一的 Book 恢复来源。');
    }
    if (quarantineExists) {
      await assertSafeTree(quarantineRoot);
      await rename(quarantineRoot, bookRoot);
    } else {
      await assertSafeTree(bookRoot);
    }
    await atomicWrite(this.libraryFile(), await readFile(snapshot));
    await this.hooks.recoveryCheckpoint('after-restore');
  }

  private async finishCommittedDelete(journal: TransactionJournal, transactionRoot: string) {
    await this.validateDeleteTransaction(journal, transactionRoot);
    const library = await readJson<unknown>(this.libraryFile());
    if (!Array.isArray(library)
      || library.some((entry) => !isRecord(entry) || typeof entry.id !== 'string')
      || library.some((entry) => (entry as BookIndexEntry).id === journal.bookId)) {
      throw new StoreDataError('已提交删除事务与当前书库索引不一致。');
    }
    const bookRoot = this.bookRoot(journal.bookId);
    if (await safeDirectoryExists(bookRoot)) {
      throw new StoreDataError('已提交删除事务仍存在原 Book 目录。');
    }
    const quarantineRoot = this.deleteQuarantineRoot(transactionRoot);
    if (await safeDirectoryExists(quarantineRoot)) {
      await assertSafeTree(quarantineRoot);
      try {
        await this.hooks.removeBookTree(quarantineRoot);
      } catch {
        throw new TransactionCleanupPendingError();
      }
    }
  }

  private async assertDeleteMetadataTree(directory: string, message: string) {
    await assertSafeTree(directory);
    const entries = await readSafeDirectory(directory);
    if (!entries || entries.some((entry) => !entry.isFile()
      || (entry.name !== 'journal.json'
        && entry.name !== 'library.json'
        && !transactionJournalTemporaryNamePattern.test(entry.name)))) {
      throw new StoreDataError(message);
    }
  }

  private async retireDeleteTransaction(transactionRoot: string) {
    await this.assertDeleteMetadataTree(transactionRoot, '已收敛删除事务包含未知内容。');
    const cleanupRoot = this.deleteCleanupRoot(transactionRoot);
    if (await safeDirectoryExists(cleanupRoot)) {
      throw new StoreDataError('删除事务清理目录发生冲突。');
    }
    try {
      await rename(transactionRoot, cleanupRoot);
    } catch {
      throw new TransactionCleanupPendingError();
    }
    try {
      await assertSafeTree(cleanupRoot);
      await this.hooks.removeTransactionTree(cleanupRoot);
    } catch (error) {
      if (error instanceof StoreDataError) throw error;
      throw new TransactionCleanupPendingError();
    }
  }

  private async removeRetiredDeleteTransaction(cleanupRoot: string) {
    await this.assertDeleteMetadataTree(cleanupRoot, '删除事务清理目录包含未知内容。');
    try {
      await this.hooks.removeTransactionTree(cleanupRoot);
    } catch {
      throw new StoreDataError('删除事务残留清理失败。');
    }
  }

  private async removeInitializingDeleteTransaction(initializingRoot: string) {
    await this.assertDeleteMetadataTree(initializingRoot, '未开始的删除事务包含未知内容。');
    try {
      await this.hooks.removeTransactionTree(initializingRoot);
    } catch {
      throw new StoreDataError('未开始的删除事务清理失败。');
    }
  }

  async recover() {
    await this.ensureTransactionParent();
    const entries = await readSafeDirectory(this.transactionsRoot());
    if (!entries) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) throw new StoreDataError('事务目录结构异常。');
      const transactionRoot = path.join(this.transactionsRoot(), entry.name);
      if (saveInitializationNamePattern.test(entry.name)) {
        await this.removeInitializingSaveTransaction(transactionRoot);
        continue;
      }
      if (saveCleanupNamePattern.test(entry.name)) {
        await this.removeSaveCleanupTransaction(transactionRoot);
        continue;
      }
      if (deleteInitializationNamePattern.test(entry.name)) {
        await this.removeInitializingDeleteTransaction(transactionRoot);
        continue;
      }
      if (deleteCleanupNamePattern.test(entry.name)) {
        await this.removeRetiredDeleteTransaction(transactionRoot);
        continue;
      }
      const journal = await this.readTransactionJournal(transactionRoot);
      if (journal.operation === 'delete') {
        if (!journal.snapshotReady) {
          await this.retireDeleteTransaction(transactionRoot);
          continue;
        }
        if (journal.status === 'committed') {
          await this.finishCommittedDelete(journal, transactionRoot);
        } else {
          await this.restoreDeleteTransaction(journal, transactionRoot);
        }
        await this.retireDeleteTransaction(transactionRoot);
        continue;
      }
      if (journal.status === 'committed') {
        try {
          await this.retireSaveTransaction(transactionRoot);
        } catch (error) {
          if (error instanceof TransactionCleanupPendingError) {
            throw new StoreDataError('已提交事务清理失败。');
          }
          throw error;
        }
        continue;
      }
      if (!journal.snapshotReady) {
        try {
          await this.retireSaveTransaction(transactionRoot);
        } catch (error) {
          if (error instanceof TransactionCleanupPendingError) {
            throw new StoreDataError('未完成事务清理失败。');
          }
          throw error;
        }
        continue;
      }
      await this.validateTransactionSnapshot(journal, transactionRoot);
      await this.restoreTransaction(journal, transactionRoot);
      try {
        await this.retireSaveTransaction(transactionRoot);
      } catch (error) {
        if (error instanceof TransactionCleanupPendingError) {
          throw new StoreDataError('已恢复事务清理失败。');
        }
        throw error;
      }
    }
  }

  private async validateTransactionSnapshot(journal: TransactionJournal, transactionRoot: string) {
    await assertSafeTree(transactionRoot);
    const snapshotRoot = path.join(transactionRoot, 'book');
    const snapshotEntries = await readSafeDirectory(snapshotRoot);
    const snapshotFiles = snapshotEntries
      ? (await collectSnapshotFiles(snapshotRoot)).map(transactionRelativePath)
      : [];
    const expectedFiles = [...journal.bookFiles].sort();
    const actualFiles = [...snapshotFiles].sort();
    if (!isDeepStrictEqual(expectedFiles, actualFiles)
      || (!journal.bookExists && expectedFiles.length > 0)
      || (journal.bookExists && expectedFiles.length === 0)) {
      throw new StoreDataError('事务快照与记录不一致。');
    }

    const librarySnapshot = path.join(transactionRoot, 'library.json');
    const libraryEntries = (await readSafeDirectory(transactionRoot))?.some((entry) => entry.name === 'library.json') ?? false;
    if (journal.libraryExists !== libraryEntries) throw new StoreDataError('事务 library 快照与记录不一致。');
    if (journal.libraryExists) await ensureSafeFile(librarySnapshot);
  }

  async runSave(bookId: string, publish: () => Promise<void>): Promise<void> {
    const transaction = await this.beginTransaction(bookId);
    try {
      await publish();
      await this.writeTransactionJournal(transaction.root, { ...transaction.journal, status: 'committed' });
    } catch (error) {
      try {
        await this.restoreTransaction(transaction.journal, transaction.root);
        await this.retireSaveTransaction(transaction.root);
      } catch (cleanupError) {
        if (cleanupError instanceof TransactionCleanupPendingError) {
          throw new StoreDataError('保存失败，原 Book 已恢复，但保存事务记录清理失败。恢复材料已保留。');
        }
        throw new StoreDataError('保存失败，且无法恢复保存前的完整 Book。恢复材料已保留。');
      }
      throw error;
    }
    try {
      await this.retireSaveTransaction(transaction.root);
    } catch (error) {
      if (!(error instanceof TransactionCleanupPendingError)) throw error;
      // A committed journal is deliberately left in a cleanup marker for the
      // next operation. The new Book is already the durable state.
    }
  }

  async runDelete(bookId: string, library: BookIndexEntry[]): Promise<void> {
    const root = this.bookRoot(bookId);
    if (!await safeDirectoryExists(root)) throw new BookNotFoundError(bookId);
    await assertSafeTree(root);
    const transaction = await this.beginDeleteTransaction(bookId);
    const quarantine = this.deleteQuarantineRoot(transaction.root);
    const committedJournal = { ...transaction.journal, status: 'committed' as const };
    try {
      await rename(root, quarantine);
      await this.hooks.deleteTransactionCheckpoint('after-quarantine');
      const remaining = library.filter((entry) => entry.id !== bookId);
      await atomicWrite(this.libraryFile(), `${JSON.stringify(remaining, null, 2)}\n`);
      await this.hooks.deleteTransactionCheckpoint('after-delete-library');
      await this.writeTransactionJournal(transaction.root, committedJournal);
    } catch (error) {
      try {
        await this.restoreDeleteTransaction(transaction.journal, transaction.root);
      } catch {
        throw new StoreDataError('删除 Book 失败，且无法恢复删除前的完整数据。恢复材料已保留。');
      }
      try {
        await this.retireDeleteTransaction(transaction.root);
      } catch {
        throw new StoreDataError('删除 Book 失败；原数据已恢复，但删除事务记录清理失败。');
      }
      throw error;
    }
    try {
      await this.finishCommittedDelete(committedJournal, transaction.root);
      await this.retireDeleteTransaction(transaction.root);
    } catch (error) {
      if (!(error instanceof TransactionCleanupPendingError)) throw error;
      // The logical deletion is durable. Its committed journal remains so
      // the next store operation can finish physical cleanup safely.
    }
  }
}
