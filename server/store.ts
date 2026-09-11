import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type {
  Book,
  BookIndexEntry,
  CanonFact,
  CharacterCard,
  Chapter,
  Summary,
  WorldRule,
} from '../src/types.ts';
import {
  normalizeBook,
} from '../src/sectionMemory.ts';
import { createExampleBooks, createLegacyFixtureBook, upgradeExampleBookContent } from '../src/fixtures.ts';

type BookFile = Omit<Book, 'characters' | 'worldRules' | 'canonFacts' | 'summaries' | 'chapters'> & {
  characters: Array<Pick<CharacterCard, 'id'>>;
  worldRules: Array<Omit<WorldRule, 'content'>>;
  canonFacts: Array<Pick<CanonFact, 'id'>>;
  summaries: Array<Pick<Summary, 'id'>>;
  chapters: Array<Omit<Chapter, 'sections'> & { sections: Array<Omit<Chapter['sections'][number], 'content'>> }>;
};

export class StoreInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'StoreInputError';
  }
}

export class BookNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(bookId: string) {
    super(`找不到 Book：${bookId}`);
    this.name = 'BookNotFoundError';
  }
}

export class StoreConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = 'Book 已在其他页面更新，请重新载入后再保存。') {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreDataError extends Error {
  readonly statusCode = 500;

  constructor(message = '本地 Book 数据损坏。') {
    super(message);
    this.name = 'StoreDataError';
  }
}

class TransactionCleanupPendingError extends Error {
  constructor() {
    super('已提交事务将在下一次存储操作继续清理。');
    this.name = 'TransactionCleanupPendingError';
  }
}

export type SaveBookOptions = {
  expectedUpdatedAt?: string;
  createOnly?: boolean;
};

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

export type StoreFaultStage = 'after-sources' | 'after-manifest' | 'after-library';
export type StoreDeleteFaultStage = 'after-quarantine' | 'after-delete-library';

export type StoreRecoveryStage = 'before-restore' | 'after-restore';

const idPattern = /^[a-z0-9][a-z0-9-]*$/i;

const validId = (id: string) => {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new StoreInputError('无效的 Book 或资料 ID。');
  return id;
};

const storedId = (id: unknown) => {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new StoreDataError();
  return id;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new StoreInputError(`${label}必须是文本。`);
  return value;
};

const requiredBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new StoreInputError(`${label}必须是布尔值。`);
  return value;
};

const requiredArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new StoreInputError(`${label}必须是数组。`);
  return value;
};

const validateMemoryText = (value: unknown, label: string) => {
  if (typeof value !== 'string') {
    throw new StoreInputError(`${label}必须是文本。`);
  }
};

const validateMemoryTextList = (value: unknown, label: string) => {
  const items = requiredArray(value, label);
  for (const item of items) validateMemoryText(item, `${label}元素`);
};

const validateSectionPlan = (value: unknown) => {
  if (!isRecord(value)) throw new StoreInputError('Section 计划数据无效。');
  requiredString(value.goal, 'Section 计划目标');
  for (const beat of requiredArray(value.intendedBeats, 'Section 计划节拍')) {
    requiredString(beat, 'Section 计划节拍元素');
  }
  if (value.povCharacterId !== undefined) validId(requiredString(value.povCharacterId, 'Section 计划 POV 角色 ID'));
};

const validateSectionMemory = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new StoreInputError(`${label}数据无效。`);
  const fields = [
    'synopsis',
    'beats',
    'continuityFacts',
    'characterStateChanges',
    'foreshadowingCandidates',
    'sourceContentHash',
    'status',
    'provenance',
    'updatedAt',
  ];
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new StoreInputError(`${label}字段不完整或包含未知字段。`);
  }
  validateMemoryText(value.synopsis, `${label} synopsis`);
  validateMemoryTextList(value.beats, `${label} beats`);
  validateMemoryTextList(value.continuityFacts, `${label} continuityFacts`);
  validateMemoryTextList(value.characterStateChanges, `${label} characterStateChanges`);
  validateMemoryTextList(value.foreshadowingCandidates, `${label} foreshadowingCandidates`);
  if (typeof value.sourceContentHash !== 'string' || !/^[0-9a-f]{16}$/.test(value.sourceContentHash)) {
    throw new StoreInputError(`${label} sourceContentHash 无效。`);
  }
  if (value.status !== 'fresh' && value.status !== 'stale') {
    throw new StoreInputError(`${label} freshness 状态无效。`);
  }
  if (value.provenance !== 'manual' && value.provenance !== 'model-draft'
    && value.provenance !== 'model-confirmed' && value.provenance !== 'model-edited') {
    throw new StoreInputError(`${label} provenance 无效。`);
  }
  validateMemoryText(value.updatedAt, `${label} updatedAt`);
};

const validateSource = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new StoreInputError(`${label}数据无效。`);
  validId(requiredString(value.id, `${label} ID`));
  requiredString(value.title, `${label}标题`);
  requiredString(value.content, `${label}正文`);
  requiredBoolean(value.includeInPrompt, `${label}启用状态`);
  if (value.loadedSectionIds !== undefined) {
    for (const sectionId of requiredArray(value.loadedSectionIds, `${label}加载范围`)) {
      validId(requiredString(sectionId, `${label}加载范围 Section ID`));
    }
  }
};

const validateSection = (value: unknown) => {
  if (!isRecord(value)) throw new StoreInputError('Section 数据无效。');
  validId(requiredString(value.id, 'Section ID'));
  requiredString(value.title, 'Section 标题');
  const sectionContent = requiredString(value.content, 'Section 正文');
  if (value.note !== undefined) requiredString(value.note, 'Section 注释');
  if (value.blocks !== undefined) {
    const blockIds = new Set<string>();
    const activeContents: string[] = [];
    let hasCandidateMetadata = false;
    for (const block of requiredArray(value.blocks, 'Section blocks')) {
      if (!isRecord(block)) throw new StoreInputError('Section block 数据无效。');
      const blockId = validId(requiredString(block.id, 'Section block ID'));
      if (blockIds.has(blockId)) throw new StoreInputError('同一 Section 的 block ID 不得重复。');
      blockIds.add(blockId);
      if (block.kind !== 'user' && block.kind !== 'assistant') {
        throw new StoreInputError('Section block kind 无效。');
      }
      const blockContent = requiredString(block.content, 'Section block 正文');
      if (block.candidates !== undefined || block.adoptedCandidateId !== undefined) {
        hasCandidateMetadata = true;
        if (block.kind !== 'assistant') throw new StoreInputError('只有 assistant block 可以保存回答候选。');
        const candidates = requiredArray(block.candidates, 'Section block candidates');
        const candidateIds = new Set<string>();
        const candidateRecords: Array<Record<string, unknown>> = [];
        for (const candidate of candidates) {
          if (!isRecord(candidate)) throw new StoreInputError('Section block candidate 数据无效。');
          candidateRecords.push(candidate);
          const candidateId = validId(requiredString(candidate.id, 'Section block candidate ID'));
          if (candidateIds.has(candidateId)) throw new StoreInputError('同一 assistant block 的 candidate ID 不得重复。');
          candidateIds.add(candidateId);
          requiredString(candidate.content, 'Section block candidate 正文');
          if (candidate.sourceSignature !== undefined
            && (typeof candidate.sourceSignature !== 'string' || !/^[0-9a-f]{16}$/.test(candidate.sourceSignature))) {
            throw new StoreInputError('Section block candidate sourceSignature 无效。');
          }
        }
        if (block.adoptedCandidateId !== undefined) {
          const adoptedId = validId(requiredString(block.adoptedCandidateId, 'Section adopted candidate ID'));
          if (!candidateIds.has(adoptedId)) throw new StoreInputError('Section adopted candidate 不属于当前 block。');
          const adopted = candidateRecords.find((candidate) => candidate.id === adoptedId);
          if (!adopted || blockContent !== adopted.content) {
            throw new StoreInputError('Section block.content 必须镜像 adopted candidate。');
          }
          activeContents.push(adopted.content as string);
        } else if (blockContent.trim()) {
          throw new StoreInputError('有回答候选但没有 adopted candidate 时，block 正文必须为空。');
        } else {
          activeContents.push('');
        }
      } else {
        activeContents.push(blockContent);
      }
    }
    if (hasCandidateMetadata && sectionContent !== activeContents.map((content) => content.trim()).filter(Boolean).join('\n\n')) {
      throw new StoreInputError('Section 正文必须镜像采用候选。');
    }
  }
  if (value.contextReferences !== undefined) {
    const referenceIds = new Set<string>();
    for (const reference of requiredArray(value.contextReferences, 'Section 前文参考')) {
      if (!isRecord(reference)) throw new StoreInputError('Section 前文参考数据无效。');
      const referenceId = validId(requiredString(reference.sectionId, 'Section 前文参考 Section ID'));
      if (referenceIds.has(referenceId)) throw new StoreInputError('Section 前文参考不得重复引用同一个 Section。');
      referenceIds.add(referenceId);
      if (reference.mode !== 'summary' && reference.mode !== 'full' && reference.mode !== 'both') {
        throw new StoreInputError('Section 前文参考模式无效。');
      }
      if (reference.reason !== 'manual' && reference.reason !== 'previous-section' && reference.reason !== 'chapter-preset') {
        throw new StoreInputError('Section 前文参考来源无效。');
      }
    }
  }
  if (value.plan !== undefined) validateSectionPlan(value.plan);
  if (value.memory !== undefined) validateSectionMemory(value.memory, 'Section memory');
  if (value.previousMemory !== undefined) validateSectionMemory(value.previousMemory, 'Section previousMemory');
};

const validateBook = (book: Book) => {
  if (!isRecord(book)) throw new StoreInputError('Book 数据无效。');
  validId(requiredString(book.id, 'Book ID'));
  requiredString(book.title, 'Book 标题');
  if (book.plotOutline !== undefined) requiredString(book.plotOutline, 'Book 剧情大纲');
  requiredString(book.writingBrief, 'Book 写作约定');

  for (const character of requiredArray(book.characters, '角色卡')) {
    validateSource(character, '角色卡');
    if (!isRecord(character)) continue;
    requiredString(character.name, '角色名');
    requiredString(character.role, '角色身份');
  }
  for (const rule of requiredArray(book.worldRules, '世界观设定')) validateSource(rule, '世界观设定');
  for (const fact of requiredArray(book.canonFacts, 'Canon 事实')) validateSource(fact, 'Canon 事实');
  for (const summary of requiredArray(book.summaries, 'Summary')) {
    validateSource(summary, 'Summary');
    if (!isRecord(summary)) continue;
    for (const sectionId of requiredArray(summary.sourceSectionIds, 'Summary 来源 Section')) {
      validId(requiredString(sectionId, 'Summary 来源 Section ID'));
    }
  }
  for (const chapter of requiredArray(book.chapters, 'Chapter')) {
    if (!isRecord(chapter)) throw new StoreInputError('Chapter 数据无效。');
    validId(requiredString(chapter.id, 'Chapter ID'));
    requiredString(chapter.title, 'Chapter 标题');
    for (const section of requiredArray(chapter.sections, 'Section')) validateSection(section);
  }
  for (const branch of requiredArray(book.branches, 'Branch')) {
    if (!isRecord(branch)) throw new StoreInputError('Branch 数据无效。');
    validId(requiredString(branch.id, 'Branch ID'));
    requiredString(branch.title, 'Branch 标题');
    validId(requiredString(branch.fromSectionId, 'Branch 来源 Section ID'));
  }

  const assertUniqueIds = (items: Array<{ id: string }>, label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) throw new StoreInputError(`${label} ID 不得重复。`);
      ids.add(item.id);
    }
    return ids;
  };

  const characterIds = assertUniqueIds(book.characters, '角色卡');
  assertUniqueIds(book.worldRules, '世界观设定');
  assertUniqueIds(book.canonFacts, 'Canon 事实');
  assertUniqueIds(book.summaries, 'Summary');
  assertUniqueIds(book.chapters, 'Chapter');
  assertUniqueIds(book.branches, 'Branch');

  const sectionOrdinals = new Map<string, number>();
  let ordinal = 0;
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      if (sectionOrdinals.has(section.id)) throw new StoreInputError('Section ID 必须在整本 Book 内唯一。');
      sectionOrdinals.set(section.id, ordinal);
      ordinal += 1;
    }
  }

  const assertExistingSection = (sectionId: string, label: string) => {
    if (!sectionOrdinals.has(sectionId)) throw new StoreInputError(`${label}必须指向当前 Book 内存在的 Section。`);
  };

  for (const source of [...book.characters, ...book.worldRules, ...book.canonFacts, ...book.summaries]) {
    for (const sectionId of source.loadedSectionIds ?? []) {
      assertExistingSection(sectionId, '资料加载范围');
    }
  }
  for (const summary of book.summaries) {
    for (const sectionId of summary.sourceSectionIds) {
      assertExistingSection(sectionId, 'Summary 来源');
    }
  }
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      const targetOrdinal = sectionOrdinals.get(section.id)!;
      for (const reference of section.contextReferences ?? []) {
        const sourceOrdinal = sectionOrdinals.get(reference.sectionId);
        if (sourceOrdinal === undefined) throw new StoreInputError('Section 前文参考必须指向当前 Book 内存在的 Section。');
        if (sourceOrdinal >= targetOrdinal) throw new StoreInputError('Section 前文参考必须严格早于目标 Section。');
      }
      if (section.plan?.povCharacterId && !characterIds.has(section.plan.povCharacterId)) {
        throw new StoreInputError('Section 计划 POV 角色必须存在于当前 Book。');
      }
    }
  }
  for (const branch of book.branches) {
    assertExistingSection(branch.fromSectionId, 'Branch 来源');
  }
};

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;

const atomicWrite = async (file: string, content: string | Uint8Array) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

const managedDirectories = ['characters', 'world', 'canon', 'summaries'] as const;
type ManagedDirectory = typeof managedDirectories[number];

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

const unsafeBookTree = () => new StoreDataError('Book 文件结构异常。');

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

const ensureSafeDirectory = async (directory: string) => {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(directory);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
};

const safeDirectoryExists = async (directory: string) => {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

const readSafeDirectory = async (directory: string) => {
  let entries;
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw unsafeBookTree();
  }
  return entries;
};

const ensureSafeFile = async (file: string) => {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw unsafeBookTree();
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

const atomicWriteIfChanged = async (file: string, content: string) => {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw unsafeBookTree();
    if (Buffer.from(await readFile(file)).equals(Buffer.from(content, 'utf8'))) return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await atomicWrite(file, content);
};

const managedId = (name: string, extension: '.json' | '.md') => {
  if (!name.endsWith(extension)) return undefined;
  const id = name.slice(0, -extension.length);
  return idPattern.test(id) ? id : undefined;
};

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

  constructor(root = process.env.STORY_DATA_DIR ?? path.resolve('.data')) {
    this.root = root;
  }

  private libraryFile() {
    return path.join(this.root, 'library.json');
  }

  private bookRoot(bookId: string) {
    return path.join(this.root, 'books', validId(bookId));
  }

  private transactionsRoot() {
    return path.join(this.root, transactionRootName);
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private isManagedBookRelative(relative: string) {
    const parts = relative.split(path.sep);
    if (parts.length === 1) return parts[0] === 'book.json';
    if (parts[0] === undefined) return false;
    if (managedDirectories.includes(parts[0] as ManagedDirectory) && parts.length === 2) {
      const extension = parts[0] === 'world' ? '.md' : '.json';
      return managedId(parts[1]!, extension) !== undefined;
    }
    return parts.length === 3
      && parts[0] === 'manuscript'
      && idPattern.test(parts[1]!)
      && managedId(parts[2]!, '.md') !== undefined;
  }

  private async collectManagedBookFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string, relativeRoot: string) => {
      const entries = await readSafeDirectory(directory);
      if (!entries) return;
      for (const entry of entries) {
        const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath, relative);
        } else if (entry.isFile()) {
          if (this.isManagedBookRelative(relative)) files.push(relative);
        } else {
          throw unsafeBookTree();
        }
      }
    };
    await visit(root, '');
    return files.sort();
  }

  private async collectSnapshotFiles(root: string, relativeRoot = ''): Promise<string[]> {
    const entries = await readSafeDirectory(root);
    if (!entries) return [];
    const files: string[] = [];
    for (const entry of entries) {
      const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.collectSnapshotFiles(fullPath, relative));
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        throw unsafeBookTree();
      }
    }
    return files.sort();
  }

  private async assertSafeTree(directory: string) {
    const entries = await readSafeDirectory(directory);
    if (!entries) return;
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.assertSafeTree(fullPath);
      } else if (!entry.isFile()) {
        throw unsafeBookTree();
      }
    }
  }

  private async ensureTransactionParent() {
    await this.ensureStorageLayout();
    await ensureSafeDirectory(this.transactionsRoot());
  }

  private async ensureStorageLayout() {
    // Validate every pre-existing boundary before creating any missing child.
    // In particular, never let mkdir follow a root/books junction or let an
    // atomic library write replace a non-file path.
    const rootExists = await safeDirectoryExists(this.root);
    const booksPath = path.join(this.root, 'books');
    const booksExists = rootExists ? await safeDirectoryExists(booksPath) : false;
    await ensureSafeFile(this.libraryFile());

    if (!rootExists) {
      await mkdir(this.root, { recursive: true });
      await ensureSafeDirectory(this.root);
    }
    if (!booksExists) await mkdir(booksPath);
    await ensureSafeDirectory(booksPath);
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
          const parts = relative.split(path.sep);
          const allowedDirectory = parts.length === 1
            && (managedDirectories.includes(parts[0] as ManagedDirectory) || parts[0] === 'manuscript');
          const allowedChapterDirectory = parts.length === 2
            && parts[0] === 'manuscript'
            && idPattern.test(parts[1]!);
          if (!allowedDirectory && !allowedChapterDirectory) throw new StoreDataError(message);
          await visitSnapshot(fullPath, relative);
          continue;
        }
        await ensureSafeFile(fullPath);
        if (!this.isManagedBookRelative(relative)) throw new StoreDataError(message);
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
      await this.removeTransactionTree(initializingRoot);
    } catch {
      throw new StoreDataError('未开始的保存事务清理失败。');
    }
  }

  private async removeSaveCleanupTransaction(cleanupRoot: string) {
    await this.assertSaveTransactionTree(cleanupRoot, '保存事务清理目录包含未知内容。');
    try {
      await this.removeTransactionTree(cleanupRoot);
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
      await this.removeTransactionTree(cleanupRoot);
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
      const bookFiles = bookExists ? await this.collectManagedBookFiles(bookRoot) : [];
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
      await this.removeTransactionTree(initializingRoot).catch(() => undefined);
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
        || !this.isManagedBookRelative(fromTransactionRelativePath(file)))
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

  private async ensureBookFileParent(bookRoot: string, relative: string) {
    await this.ensureStorageLayout();
    await ensureSafeDirectory(bookRoot);
    const parts = path.dirname(relative).split(path.sep).filter(Boolean);
    let directory = bookRoot;
    for (const part of parts) {
      directory = path.join(directory, part);
      await ensureSafeDirectory(directory);
    }
  }

  private async pruneManagedEmptyDirectories(bookRoot: string) {
    const prune = async (directory: string) => {
      const entries = await readSafeDirectory(directory);
      if (entries?.length === 0) await rmdir(directory);
    };
    for (const directory of managedDirectories) {
      await prune(path.join(bookRoot, directory));
    }
    const manuscriptRoot = path.join(bookRoot, 'manuscript');
    const chapters = await readSafeDirectory(manuscriptRoot);
    if (chapters) {
      for (const chapter of chapters) {
        if (chapter.isDirectory() && idPattern.test(chapter.name)) {
          await prune(path.join(manuscriptRoot, chapter.name));
        }
      }
    }
    await prune(manuscriptRoot);
    await prune(bookRoot);
  }

  private async restoreTransaction(journal: TransactionJournal, transactionRoot: string) {
    await this.ensureStorageLayout();
    await this.recoveryCheckpoint('before-restore');
    await this.assertSafeTree(transactionRoot);
    const bookRoot = this.bookRoot(journal.bookId);
    const snapshotRoot = path.join(transactionRoot, 'book');
    const snapshotFiles = new Set(journal.bookFiles);
    const currentFiles = await this.collectManagedBookFiles(bookRoot);
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
      await this.ensureBookFileParent(bookRoot, targetRelative);
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
    await this.pruneManagedEmptyDirectories(bookRoot);
    await this.recoveryCheckpoint('after-restore');
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
    await this.assertSafeTree(transactionRoot);
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
    await this.ensureStorageLayout();
    await this.recoveryCheckpoint('before-restore');
    const bookRoot = this.bookRoot(journal.bookId);
    const quarantineRoot = this.deleteQuarantineRoot(transactionRoot);
    const bookExists = await safeDirectoryExists(bookRoot);
    const quarantineExists = await safeDirectoryExists(quarantineRoot);
    if (bookExists === quarantineExists) {
      throw new StoreDataError('删除事务无法确定唯一的 Book 恢复来源。');
    }
    if (quarantineExists) {
      await this.assertSafeTree(quarantineRoot);
      await rename(quarantineRoot, bookRoot);
    } else {
      await this.assertSafeTree(bookRoot);
    }
    await atomicWrite(this.libraryFile(), await readFile(snapshot));
    await this.recoveryCheckpoint('after-restore');
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
      await this.assertSafeTree(quarantineRoot);
      try {
        await this.removeBookTree(quarantineRoot);
      } catch {
        throw new TransactionCleanupPendingError();
      }
    }
  }

  private async assertDeleteMetadataTree(directory: string, message: string) {
    await this.assertSafeTree(directory);
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
      await this.assertSafeTree(cleanupRoot);
      await this.removeTransactionTree(cleanupRoot);
    } catch (error) {
      if (error instanceof StoreDataError) throw error;
      throw new TransactionCleanupPendingError();
    }
  }

  private async removeRetiredDeleteTransaction(cleanupRoot: string) {
    await this.assertDeleteMetadataTree(cleanupRoot, '删除事务清理目录包含未知内容。');
    try {
      await this.removeTransactionTree(cleanupRoot);
    } catch {
      throw new StoreDataError('删除事务残留清理失败。');
    }
  }

  private async removeInitializingDeleteTransaction(initializingRoot: string) {
    await this.assertDeleteMetadataTree(initializingRoot, '未开始的删除事务包含未知内容。');
    try {
      await this.removeTransactionTree(initializingRoot);
    } catch {
      throw new StoreDataError('未开始的删除事务清理失败。');
    }
  }

  private async recoverTransactions() {
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

  private async validateTransactionSnapshot(journal: TransactionJournal, transactionRoot: string) {
    await this.assertSafeTree(transactionRoot);
    const snapshotRoot = path.join(transactionRoot, 'book');
    const snapshotEntries = await readSafeDirectory(snapshotRoot);
    const snapshotFiles = snapshotEntries
      ? (await this.collectSnapshotFiles(snapshotRoot)).map(transactionRelativePath)
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

  private async prepareBookTree(book: Book, root: string) {
    // The data directory is user-selected, so only the Book subtree gets the
    // strict no-link checks. Create each child directory one level at a time.
    await this.ensureStorageLayout();
    await ensureSafeDirectory(root);
    await readSafeDirectory(root);
    await ensureSafeFile(path.join(root, 'book.json'));

    for (const directory of managedDirectories) {
      await readSafeDirectory(path.join(root, directory));
    }

    const manuscriptRoot = path.join(root, 'manuscript');
    const manuscriptEntries = await readSafeDirectory(manuscriptRoot);
    if (manuscriptEntries) {
      for (const entry of manuscriptEntries) {
        if (entry.isDirectory()) {
          await readSafeDirectory(path.join(manuscriptRoot, entry.name));
        } else if (idPattern.test(entry.name)) {
          throw unsafeBookTree();
        }
      }
    }

    const sources: Array<[ManagedDirectory, string[]]> = [
      ['characters', book.characters.map((item) => item.id)],
      ['world', book.worldRules.map((item) => item.id)],
      ['canon', book.canonFacts.map((item) => item.id)],
      ['summaries', book.summaries.map((item) => item.id)],
    ];
    for (const [directory, ids] of sources) {
      if (ids.length === 0) continue;
      const directoryPath = path.join(root, directory);
      await ensureSafeDirectory(directoryPath);
      const extension = directory === 'world' ? '.md' : '.json';
      for (const id of ids) await ensureSafeFile(path.join(directoryPath, `${validId(id)}${extension}`));
    }

    const chaptersWithSections = book.chapters.filter((chapter) => chapter.sections.length > 0);
    if (chaptersWithSections.length > 0) {
      await ensureSafeDirectory(manuscriptRoot);
      for (const chapter of chaptersWithSections) {
        const chapterRoot = path.join(manuscriptRoot, validId(chapter.id));
        await ensureSafeDirectory(chapterRoot);
        for (const section of chapter.sections) {
          await ensureSafeFile(path.join(chapterRoot, `${validId(section.id)}.md`));
        }
      }
    }
  }

  private async reconcileManagedDirectory(
    directory: string,
    extension: '.json' | '.md',
    keep: Set<string>,
  ) {
    const entries = await readSafeDirectory(directory);
    if (!entries) return;
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isDirectory()) throw unsafeBookTree();
      const id = managedId(entry.name, extension);
      if (entry.isDirectory()) {
        if (id) throw unsafeBookTree();
        continue;
      }
      if (id && !keep.has(id)) await unlink(path.join(directory, entry.name));
    }
    const remaining = await readSafeDirectory(directory);
    if (remaining?.length === 0) await rmdir(directory);
  }

  private async reconcileBookTree(book: Book, root: string) {
    const expected: Record<ManagedDirectory, Set<string>> = {
      characters: new Set(book.characters.map((item) => item.id)),
      world: new Set(book.worldRules.map((item) => item.id)),
      canon: new Set(book.canonFacts.map((item) => item.id)),
      summaries: new Set(book.summaries.map((item) => item.id)),
    };
    for (const directory of managedDirectories) {
      await this.reconcileManagedDirectory(
        path.join(root, directory),
        directory === 'world' ? '.md' : '.json',
        expected[directory],
      );
    }

    const chapterSections = new Map(
      book.chapters.map((chapter) => [chapter.id, new Set(chapter.sections.map((section) => section.id))]),
    );
    const manuscriptRoot = path.join(root, 'manuscript');
    const manuscriptEntries = await readSafeDirectory(manuscriptRoot);
    if (!manuscriptEntries) return;
    for (const entry of manuscriptEntries) {
      if (entry.isDirectory()) {
        if (idPattern.test(entry.name)) {
          await this.reconcileManagedDirectory(
            path.join(manuscriptRoot, entry.name),
            '.md',
            chapterSections.get(entry.name) ?? new Set<string>(),
          );
        }
      } else if (idPattern.test(entry.name)) {
        throw unsafeBookTree();
      }
    }
    const remaining = await readSafeDirectory(manuscriptRoot);
    if (remaining?.length === 0) await rmdir(manuscriptRoot);
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
      await this.recoverTransactions();
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
        await this.recoverTransactions();
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
      await this.recoverTransactions();
      return readJson<BookIndexEntry[]>(this.libraryFile());
    });
  }

  private async loadBookFromDisk(bookId: string): Promise<Book> {
    validId(bookId);
    const root = this.bookRoot(bookId);
    const manifestFile = path.join(root, 'book.json');
    let meta: BookFile;
    try {
      // A Book directory can be changed outside this process. Check every
      // directory on the path before reading the manifest so a link cannot
      // redirect a load into an unrelated tree.
      await readSafeDirectory(this.root);
      await readSafeDirectory(path.join(this.root, 'books'));
      await readSafeDirectory(root);
      await ensureSafeFile(manifestFile);
      meta = await readJson<BookFile>(manifestFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BookNotFoundError(bookId);
      throw error;
    }
    if (!isRecord(meta) || meta.id !== bookId || !Array.isArray(meta.characters)
      || !Array.isArray(meta.worldRules) || !Array.isArray(meta.canonFacts)
      || !Array.isArray(meta.summaries) || !Array.isArray(meta.chapters)) {
      throw new StoreDataError();
    }
    for (const item of meta.characters) storedId(item?.id);
    for (const item of meta.worldRules) storedId(item?.id);
    for (const item of meta.canonFacts) storedId(item?.id);
    for (const item of meta.summaries) storedId(item?.id);
    for (const chapter of meta.chapters) {
      storedId(chapter?.id);
      if (!Array.isArray(chapter?.sections)) throw new StoreDataError();
      for (const section of chapter.sections) storedId(section?.id);
    }

    // Validate directory entries as well as the specific files below. This
    // makes a symlink anywhere in a managed source directory fail closed,
    // including links that are not referenced by the manifest.
    for (const directory of managedDirectories) {
      await readSafeDirectory(path.join(root, directory));
    }
    const manuscriptRoot = path.join(root, 'manuscript');
    await readSafeDirectory(manuscriptRoot);
    for (const chapter of meta.chapters) {
      await readSafeDirectory(path.join(manuscriptRoot, chapter.id));
    }

    const characters = await Promise.all(meta.characters.map(({ id }) =>
      (async () => {
        const file = path.join(root, 'characters', `${validId(id)}.json`);
        await ensureSafeFile(file);
        return readJson<CharacterCard>(file);
      })()));
    const worldRules = await Promise.all(meta.worldRules.map(async (item) => ({
      ...item,
      content: await (async () => {
        const file = path.join(root, 'world', `${validId(item.id)}.md`);
        await ensureSafeFile(file);
        return readFile(file, 'utf8');
      })(),
    })));
    const canonFacts = await Promise.all(meta.canonFacts.map(({ id }) =>
      (async () => {
        const file = path.join(root, 'canon', `${validId(id)}.json`);
        await ensureSafeFile(file);
        return readJson<CanonFact>(file);
      })()));
    const summaries = await Promise.all(meta.summaries.map(({ id }) =>
      (async () => {
        const file = path.join(root, 'summaries', `${validId(id)}.json`);
        await ensureSafeFile(file);
        return readJson<Summary>(file);
      })()));
    const chapters = await Promise.all(meta.chapters.map(async (chapter) => ({
      ...chapter,
      sections: await Promise.all(chapter.sections.map(async (section) => ({
        ...section,
        content: await (async () => {
          const file = path.join(root, 'manuscript', chapter.id, `${validId(section.id)}.md`);
          await ensureSafeFile(file);
          return readFile(file, 'utf8');
        })(),
      }))),
    })));

    const loaded = { ...meta, characters, worldRules, canonFacts, summaries, chapters };
    // Do not let normalizeBook silently discard broken references before the
    // storage boundary validates them.
    validateBook(loaded);
    const normalized = normalizeBook(loaded);
    validateBook(normalized);
    return normalized;
  }

  async loadBook(bookId: string): Promise<Book> {
    validId(bookId);
    await this.ensureSeeded();
    return this.enqueue(async () => {
      await this.recoverTransactions();
      return this.loadBookFromDisk(bookId);
    });
  }

  private async inspectBook(bookId: string) {
    await readSafeDirectory(this.root);
    await readSafeDirectory(path.join(this.root, 'books'));
    const root = this.bookRoot(bookId);
    let rootExists = false;
    try {
      const stat = await lstat(root);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
      rootExists = true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (!rootExists) return { rootExists: false, manifestExists: false, updatedAt: undefined as string | undefined };
    const manifestFile = path.join(root, 'book.json');
    try {
      await ensureSafeFile(manifestFile);
      const meta = await readJson<unknown>(manifestFile);
      if (!isRecord(meta) || meta.id !== bookId || typeof meta.updatedAt !== 'string') {
        throw new StoreDataError();
      }
      return { rootExists: true, manifestExists: true, updatedAt: meta.updatedAt };
    } catch (error) {
      if (isMissing(error)) return { rootExists: true, manifestExists: false, updatedAt: undefined };
      throw error;
    }
  }

  private nextUpdatedAt(previous: string | undefined) {
    const now = Date.now();
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    return new Date(Math.max(now, Number.isFinite(previousMs) ? previousMs + 1 : now)).toISOString();
  }

  private async saveBookInternal(normalizedBook: Book, options: SaveBookOptions = {}) {
    await this.recoverTransactions();
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

    const current = await this.inspectBook(normalizedBook.id);
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
    const meta: BookFile = {
      id: saved.id,
      title: saved.title,
      plotOutline: saved.plotOutline ?? '',
      writingBrief: saved.writingBrief,
      characters: saved.characters.map(({ id }) => ({ id })),
      worldRules: saved.worldRules.map(({ content: _content, ...item }) => item),
      canonFacts: saved.canonFacts.map(({ id }) => ({ id })),
      summaries: saved.summaries.map(({ id }) => ({ id })),
      chapters: saved.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        sections: chapter.sections.map(({ content: _content, ...section }) => section),
      })),
      branches: saved.branches,
      updatedAt: saved.updatedAt,
    };

    const transaction = await this.beginTransaction(saved.id);
    try {
      await this.prepareBookTree(saved, root);

      // Source files are written before the manifest. The transaction keeps a
      // complete old set available if any one write fails.
      await this.settleSourceWrites(saved.characters.map((item) => () =>
        this.writeManagedSource(path.join(root, 'characters', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await this.settleSourceWrites(saved.worldRules.map((item) => () =>
        this.writeManagedSource(path.join(root, 'world', `${validId(item.id)}.md`), item.content)));
      await this.settleSourceWrites(saved.canonFacts.map((item) => () =>
        this.writeManagedSource(path.join(root, 'canon', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await this.settleSourceWrites(saved.summaries.map((item) => () =>
        this.writeManagedSource(path.join(root, 'summaries', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await this.settleSourceWrites(saved.chapters.flatMap((chapter) => chapter.sections.map((section) => () =>
        this.writeManagedSource(path.join(root, 'manuscript', validId(chapter.id), `${validId(section.id)}.md`), section.content))));
      await this.transactionCheckpoint('after-sources');

      await atomicWrite(path.join(root, 'book.json'), `${JSON.stringify(meta, null, 2)}\n`);
      await this.transactionCheckpoint('after-manifest');

      // Stale managed files are removed only after the new manifest is
      // published. Library visibility follows cleanup.
      await this.reconcileBookTree(saved, root);

      const entry = { id: saved.id, title: saved.title, updatedAt: saved.updatedAt };
      const next = [...library.filter((item) => item.id !== saved.id), entry]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await atomicWrite(this.libraryFile(), `${JSON.stringify(next, null, 2)}\n`);
      await this.transactionCheckpoint('after-library');

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
      await this.recoverTransactions();
      const library = await readJson<BookIndexEntry[]>(this.libraryFile());
      if (!library.some((entry) => entry.id === bookId)) throw new BookNotFoundError(bookId);

      const root = this.bookRoot(bookId);
      if (!await safeDirectoryExists(root)) throw new BookNotFoundError(bookId);
      await this.assertSafeTree(root);
      const transaction = await this.beginDeleteTransaction(bookId);
      const quarantine = this.deleteQuarantineRoot(transaction.root);
      const committedJournal = { ...transaction.journal, status: 'committed' as const };
      try {
        await rename(root, quarantine);
        await this.deleteTransactionCheckpoint('after-quarantine');
        const remaining = library.filter((entry) => entry.id !== bookId);
        await atomicWrite(this.libraryFile(), `${JSON.stringify(remaining, null, 2)}\n`);
        await this.deleteTransactionCheckpoint('after-delete-library');
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
      return { id: bookId };
    };
    return this.enqueue(operation);
  }
}
