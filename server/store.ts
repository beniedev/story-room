import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
import { createExampleBooks, createLegacyFixtureBook } from '../src/fixtures.ts';

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
};

const validateBook = (book: Book) => {
  if (!isRecord(book)) throw new StoreInputError('Book 数据无效。');
  validId(requiredString(book.id, 'Book ID'));
  requiredString(book.title, 'Book 标题');
  requiredString(book.writingBrief, 'Book 写作约定');

  for (const character of requiredArray(book.characters, '角色卡')) {
    validateSource(character, '角色卡');
    if (!isRecord(character)) continue;
    requiredString(character.name, '角色名');
    requiredString(character.role, '角色身份');
  }
  for (const rule of requiredArray(book.worldRules, '世界观条例')) validateSource(rule, '世界观条例');
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
    for (const section of requiredArray(chapter.sections, 'Section')) {
      if (!isRecord(section)) throw new StoreInputError('Section 数据无效。');
      validId(requiredString(section.id, 'Section ID'));
      requiredString(section.title, 'Section 标题');
      requiredString(section.content, 'Section 正文');
    }
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

const sameBookIgnoringTimestamp = (left: Book, right: Book) => (
  isDeepStrictEqual({ ...left, updatedAt: '' }, { ...right, updatedAt: '' })
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
        if (!legacy) continue;
        const current = await this.loadBook(example.id);
        if (sameBookIgnoringTimestamp(current, legacy)) await this.saveBook(example);
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

    return { ...meta, characters, worldRules, canonFacts, summaries, chapters };
  }

  async saveBook(book: Book): Promise<Book> {
    validateBook(book);
    const operation = async () => {
      const root = this.bookRoot(book.id);
      const saved = { ...book, updatedAt: new Date().toISOString() };
      const meta: BookFile = {
        id: saved.id,
        title: saved.title,
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
