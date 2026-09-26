import { lstat, mkdir, readFile, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { idPattern, isRecord, storedId, validId, validateBook } from '../bookValidation.ts';
import { BookNotFoundError, StoreDataError } from '../storeErrors.ts';
import { normalizeBook } from '../../src/sectionMemory.ts';
import type { Book, CanonFact, CharacterCard, Chapter, Summary, WorldRule } from '../../src/types.ts';
import { ensureSafeDirectory, ensureSafeFile, isMissing, readJson, readSafeDirectory, safeDirectoryExists, unsafeBookTree } from './safePaths.ts';

type BookFile = Omit<Book, 'characters' | 'worldRules' | 'canonFacts' | 'summaries' | 'chapters'> & {
  characters: Array<Pick<CharacterCard, 'id'>>;
  worldRules: Array<Omit<WorldRule, 'content'>>;
  canonFacts: Array<Pick<CanonFact, 'id'>>;
  summaries: Array<Pick<Summary, 'id'>>;
  chapters: Array<Omit<Chapter, 'sections'> & { sections: Array<Omit<Chapter['sections'][number], 'content'>> }>;
};

const managedDirectories = ['characters', 'world', 'canon', 'summaries'] as const;
type ManagedDirectory = typeof managedDirectories[number];

const managedId = (name: string, extension: '.json' | '.md') => {
  if (!name.endsWith(extension)) return undefined;
  const id = name.slice(0, -extension.length);
  return idPattern.test(id) ? id : undefined;
};

export function bookRoot(storageRoot: string, bookId: string) {
  return path.join(storageRoot, 'books', validId(bookId));
}

export function isManagedBookRelative(relative: string) {
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

export function isManagedBookDirectory(relative: string) {
  const parts = relative.split(path.sep);
  const sourceDirectory = parts.length === 1
    && (managedDirectories.includes(parts[0] as ManagedDirectory) || parts[0] === 'manuscript');
  const chapterDirectory = parts.length === 2
    && parts[0] === 'manuscript'
    && idPattern.test(parts[1]!);
  return sourceDirectory || chapterDirectory;
}

export async function collectManagedBookFiles(root: string): Promise<string[]> {
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
        if (isManagedBookRelative(relative)) files.push(relative);
      } else {
        throw unsafeBookTree();
      }
    }
  };
  await visit(root, '');
  return files.sort();
}

export async function ensureStorageLayout(storageRoot: string) {
  // Validate every pre-existing boundary before creating any missing child.
  // In particular, never let mkdir follow a root/books junction or let an
  // atomic library write replace a non-file path.
  const rootExists = await safeDirectoryExists(storageRoot);
  const booksPath = path.join(storageRoot, 'books');
  const booksExists = rootExists ? await safeDirectoryExists(booksPath) : false;
  await ensureSafeFile(path.join(storageRoot, 'library.json'));

  if (!rootExists) {
    await mkdir(storageRoot, { recursive: true });
    await ensureSafeDirectory(storageRoot);
  }
  if (!booksExists) await mkdir(booksPath);
  await ensureSafeDirectory(booksPath);
}

export async function ensureBookFileParent(storageRoot: string, bookRoot: string, relative: string) {
  await ensureStorageLayout(storageRoot);
  await ensureSafeDirectory(bookRoot);
  const parts = path.dirname(relative).split(path.sep).filter(Boolean);
  let directory = bookRoot;
  for (const part of parts) {
    directory = path.join(directory, part);
    await ensureSafeDirectory(directory);
  }
}

export async function pruneManagedEmptyDirectories(bookRoot: string) {
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

export async function prepareBookTree(storageRoot: string, book: Book, root: string) {
  // The data directory is user-selected, so only the Book subtree gets the
  // strict no-link checks. Create each child directory one level at a time.
  await ensureStorageLayout(storageRoot);
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

async function reconcileManagedDirectory(
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

export async function reconcileBookTree(book: Book, root: string) {
  const expected: Record<ManagedDirectory, Set<string>> = {
    characters: new Set(book.characters.map((item) => item.id)),
    world: new Set(book.worldRules.map((item) => item.id)),
    canon: new Set(book.canonFacts.map((item) => item.id)),
    summaries: new Set(book.summaries.map((item) => item.id)),
  };
  for (const directory of managedDirectories) {
    await reconcileManagedDirectory(
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
        await reconcileManagedDirectory(
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

export function decodeBookManifest(value: unknown, bookId: string): BookFile {
  const meta = value as BookFile;
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
  return meta;
}

export async function loadBookTree(storageRoot: string, bookId: string): Promise<Book> {
  validId(bookId);
  const root = bookRoot(storageRoot, bookId);
  const manifestFile = path.join(root, 'book.json');
  let meta: BookFile;
  try {
    // A Book directory can be changed outside this process. Check every
    // directory on the path before reading the manifest so a link cannot
    // redirect a load into an unrelated tree.
    await readSafeDirectory(storageRoot);
    await readSafeDirectory(path.join(storageRoot, 'books'));
    await readSafeDirectory(root);
    await ensureSafeFile(manifestFile);
    meta = await readJson<BookFile>(manifestFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BookNotFoundError(bookId);
    throw error;
  }
  meta = decodeBookManifest(meta, bookId);

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

export async function inspectBookTree(storageRoot: string, bookId: string) {
  await readSafeDirectory(storageRoot);
  await readSafeDirectory(path.join(storageRoot, 'books'));
  const root = bookRoot(storageRoot, bookId);
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

export function encodeBookManifest(book: Book): BookFile {
  return {
    id: book.id,
    title: book.title,
    plotOutline: book.plotOutline ?? '',
    writingBrief: book.writingBrief,
    characters: book.characters.map(({ id }) => ({ id })),
    worldRules: book.worldRules.map(({ content: _content, ...item }) => item),
    canonFacts: book.canonFacts.map(({ id }) => ({ id })),
    summaries: book.summaries.map(({ id }) => ({ id })),
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      sections: chapter.sections.map(({ content: _content, ...section }) => section),
    })),
    branches: book.branches,
    updatedAt: book.updatedAt,
  };
}

type SourceWriteSpec = () => { file: string; content: string };

// Keep materialization inside each write callback and advance only after its batch settles.
export function* sourceWriteBatches(book: Book, root: string): Generator<SourceWriteSpec[]> {
  yield book.characters.map((item) => () => ({
    file: path.join(root, 'characters', `${validId(item.id)}.json`),
    content: `${JSON.stringify(item, null, 2)}\n`,
  }));
  yield book.worldRules.map((item) => () => ({
    file: path.join(root, 'world', `${validId(item.id)}.md`),
    content: item.content,
  }));
  yield book.canonFacts.map((item) => () => ({
    file: path.join(root, 'canon', `${validId(item.id)}.json`),
    content: `${JSON.stringify(item, null, 2)}\n`,
  }));
  yield book.summaries.map((item) => () => ({
    file: path.join(root, 'summaries', `${validId(item.id)}.json`),
    content: `${JSON.stringify(item, null, 2)}\n`,
  }));
  yield book.chapters.flatMap((chapter) => chapter.sections.map((section) => () => ({
    file: path.join(root, 'manuscript', validId(chapter.id), `${validId(section.id)}.md`),
    content: section.content,
  })));
}
