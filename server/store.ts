import { randomUUID } from 'node:crypto';
import {
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

export class StoreDataError extends Error {
  readonly statusCode = 500;

  constructor(message = '本地 Book 数据损坏。') {
    super(message);
    this.name = 'StoreDataError';
  }
}

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
  requiredString(value.content, 'Section 正文');
  if (value.note !== undefined) requiredString(value.note, 'Section 注释');
  if (value.blocks !== undefined) {
    for (const block of requiredArray(value.blocks, 'Section blocks')) {
      if (!isRecord(block)) throw new StoreInputError('Section block 数据无效。');
      validId(requiredString(block.id, 'Section block ID'));
      if (block.kind !== 'user' && block.kind !== 'assistant') {
        throw new StoreInputError('Section block kind 无效。');
      }
      requiredString(block.content, 'Section block 正文');
    }
  }
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
};

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;

const atomicWrite = async (file: string, content: string) => {
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

  private async prepareBookTree(book: Book, root: string) {
    // The data directory is user-selected, so only the Book subtree gets the
    // strict no-link checks. Create each child directory one level at a time.
    await mkdir(this.root, { recursive: true });
    await ensureSafeDirectory(path.join(this.root, 'books'));
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

  private async ensureSeeded() {
    this.seedPromise ??= (async () => {
      try {
        await readFile(this.libraryFile(), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await atomicWrite(this.libraryFile(), '[]\n');
        for (const book of createExampleBooks()) await this.saveBook(book);
      }
    })();
    await this.seedPromise;
  }

  private async ensureExamples() {
    this.examplesPromise ??= (async () => {
      const library = await readJson<BookIndexEntry[]>(this.libraryFile());
      const legacyExamples = new Map([
        ['the-observatory', createLegacyFixtureBook('the-observatory', 'The Observatory', 'Mira')],
        ['harbor-at-noon', createLegacyFixtureBook('harbor-at-noon', 'Harbor at Noon', 'Rowan')],
      ]);
      for (const example of createExampleBooks()) {
        const entry = library.find((item) => item.id === example.id);
        if (!entry) continue;
        const legacy = legacyExamples.get(example.id);
        const current = await this.loadBook(example.id);
        if (legacy && sameBookIgnoringTimestamp(current, legacy)) {
          await this.saveBook(example);
          continue;
        }
        const upgraded = upgradeExampleBookContent(current, example);
        if (upgraded) await this.saveBook(upgraded);
      }
    })();
    await this.examplesPromise;
  }

  async listBooks(): Promise<BookIndexEntry[]> {
    await this.ensureSeeded();
    await this.ensureExamples();
    return readJson<BookIndexEntry[]>(this.libraryFile());
  }

  async loadBook(bookId: string): Promise<Book> {
    validId(bookId);
    await this.ensureSeeded();
    const root = this.bookRoot(bookId);
    let meta: BookFile;
    try {
      meta = await readJson<BookFile>(path.join(root, 'book.json'));
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
    const characters = await Promise.all(meta.characters.map(({ id }) =>
      readJson<CharacterCard>(path.join(root, 'characters', `${validId(id)}.json`))));
    const worldRules = await Promise.all(meta.worldRules.map(async (item) => ({
      ...item,
      content: await readFile(path.join(root, 'world', `${validId(item.id)}.md`), 'utf8'),
    })));
    const canonFacts = await Promise.all(meta.canonFacts.map(({ id }) =>
      readJson<CanonFact>(path.join(root, 'canon', `${validId(id)}.json`))));
    const summaries = await Promise.all(meta.summaries.map(({ id }) =>
      readJson<Summary>(path.join(root, 'summaries', `${validId(id)}.json`))));
    const chapters = await Promise.all(meta.chapters.map(async (chapter) => ({
      ...chapter,
      sections: await Promise.all(chapter.sections.map(async (section) => ({
        ...section,
        content: await readFile(path.join(root, 'manuscript', chapter.id, `${validId(section.id)}.md`), 'utf8'),
      }))),
    })));

    const loaded = { ...meta, characters, worldRules, canonFacts, summaries, chapters };
    validateBook(loaded);
    return loaded;
  }

  async saveBook(book: Book): Promise<Book> {
    validateBook(book);
    const operation = async () => {
      const root = this.bookRoot(book.id);
      const saved = { ...book, updatedAt: new Date().toISOString() };
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

      let library: BookIndexEntry[] = [];
      try {
        library = await readJson<BookIndexEntry[]>(this.libraryFile());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // First seed write creates the library immediately below.
      }

      await this.prepareBookTree(saved, root);

      // Publish the manifest last so an interrupted save keeps the previous
      // manifest pointing at a complete set of source files.
      await Promise.all(saved.characters.map((item) =>
        atomicWrite(path.join(root, 'characters', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await Promise.all(saved.worldRules.map((item) =>
        atomicWrite(path.join(root, 'world', `${validId(item.id)}.md`), item.content)));
      await Promise.all(saved.canonFacts.map((item) =>
        atomicWrite(path.join(root, 'canon', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await Promise.all(saved.summaries.map((item) =>
        atomicWrite(path.join(root, 'summaries', `${validId(item.id)}.json`), `${JSON.stringify(item, null, 2)}\n`)));
      await Promise.all(saved.chapters.flatMap((chapter) => chapter.sections.map((section) =>
        atomicWrite(path.join(root, 'manuscript', validId(chapter.id), `${validId(section.id)}.md`), section.content))));
      await atomicWrite(path.join(root, 'book.json'), `${JSON.stringify(meta, null, 2)}\n`);

      // Stale managed files are removed only after the new manifest is
      // published. Library visibility follows cleanup; cleanup errors reject
      // the save and never become a successful library update.
      await this.reconcileBookTree(saved, root);

      const entry = { id: saved.id, title: saved.title, updatedAt: saved.updatedAt };
      const next = [...library.filter((item) => item.id !== saved.id), entry]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await atomicWrite(this.libraryFile(), `${JSON.stringify(next, null, 2)}\n`);
      return saved;
    };
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
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

  async deleteBook(bookId: string): Promise<{ id: string }> {
    validId(bookId);
    await this.ensureSeeded();
    const operation = async () => {
      const library = await readJson<BookIndexEntry[]>(this.libraryFile());
      if (!library.some((entry) => entry.id === bookId)) throw new BookNotFoundError(bookId);

      const root = this.bookRoot(bookId);
      const quarantine = `${root}.deleting-${randomUUID()}`;
      try {
        await rename(root, quarantine);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BookNotFoundError(bookId);
        throw error;
      }

      try {
        const remaining = library.filter((entry) => entry.id !== bookId);
        await atomicWrite(this.libraryFile(), `${JSON.stringify(remaining, null, 2)}\n`);
      } catch (error) {
        await rename(quarantine, root);
        throw error;
      }
      await rm(quarantine, { recursive: true, force: true });
      return { id: bookId };
    };
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
