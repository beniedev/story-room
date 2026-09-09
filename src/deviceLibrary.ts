import { createExampleBooks } from './fixtures';
import { makeId } from './components/shared/id';
import { buildContextPlan, toContextPlanPreview } from './contextPlan';
import {
  normalizeBook,
  serializeSectionMemoryDraft,
  syntheticSectionMemoryDraft,
} from './sectionMemory';
import type {
  Book,
  BookIndexEntry,
  ContextPlanPreview,
  GenerationRequest,
  GenerationResult,
} from './types';

const libraryKey = 'story-native:library';
const bookKey = (bookId: string) => `story-native:book:${bookId}`;

const readJson = <T>(key: string): T | null => {
  const value = localStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('当前设备的书库索引已损坏，请导入备份恢复。');
  }
};

const writeLibrary = (entries: BookIndexEntry[]) => {
  localStorage.setItem(libraryKey, JSON.stringify(entries));
};

const indexEntry = (book: Book): BookIndexEntry => ({
  id: book.id,
  title: book.title,
  updatedAt: book.updatedAt,
});

const isBook = (value: unknown): value is Book => {
  if (!value || typeof value !== 'object') return false;
  const book = value as Partial<Book>;
  return typeof book.id === 'string'
    && typeof book.title === 'string'
    && typeof book.updatedAt === 'string'
    && Array.isArray(book.characters)
    && Array.isArray(book.worldRules)
    && Array.isArray(book.canonFacts)
    && Array.isArray(book.summaries)
    && Array.isArray(book.chapters)
    && Array.isArray(book.branches);
};

const cachedBooks = () => {
  const books: Book[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('story-native:book:')) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
      if (isBook(value)) books.push(value);
    } catch {
      // One damaged cache must not hide the rest of the device-local library.
    }
  }
  return books;
};

const ensureLibrary = (): BookIndexEntry[] => {
  const recovered = cachedBooks();
  const byId = new Map(recovered.map((book) => [book.id, book]));
  const existing = readJson<BookIndexEntry[]>(libraryKey) ?? [];
  if (existing.length > 0 && byId.size > 0) {
    const ordered = existing.flatMap((entry) => {
      const cached = byId.get(entry.id);
      if (!cached) return [];
      byId.delete(entry.id);
      return [cached];
    });
    ordered.push(...byId.values());
    const entries = ordered.map(indexEntry);
    writeLibrary(entries);
    return entries;
  }

  for (const example of createExampleBooks()) {
    if (!byId.has(example.id)) byId.set(example.id, example);
  }
  const books = [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  books.forEach((book) => localStorage.setItem(bookKey(book.id), JSON.stringify(book)));
  const entries = books.map(indexEntry);
  writeLibrary(entries);
  return entries;
};

const loadBook = (bookId: string): Book => {
  ensureLibrary();
  const book = readJson<unknown>(bookKey(bookId));
  if (!book) throw new Error(`找不到 Book：${bookId}`);
  if (!isBook(book)) throw new Error(`Book 数据已损坏：${bookId}`);
  return normalizeBook(book);
};

const saveBook = (book: Book): Book => {
  const saved = { ...normalizeBook(book), updatedAt: new Date().toISOString() };
  localStorage.setItem(bookKey(saved.id), JSON.stringify(saved));
  const library = ensureLibrary();
  writeLibrary([
    indexEntry(saved),
    ...library.filter((entry) => entry.id !== saved.id),
  ]);
  return saved;
};

const createBook = (title: string): Book => saveBook({
  id: makeId('book'),
  title: title.trim() || '未命名书目',
  plotOutline: '',
  writingBrief: '',
  characters: [],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: makeId('chapter'),
    title: '第一章',
    sections: [{ id: makeId('section'), title: '新小节', content: '' }],
  }],
  branches: [],
  updatedAt: new Date().toISOString(),
});

const deleteBook = (bookId: string) => {
  const library = ensureLibrary();
  if (!library.some((entry) => entry.id === bookId)) throw new Error(`找不到 Book：${bookId}`);
  localStorage.removeItem(bookKey(bookId));
  writeLibrary(library.filter((entry) => entry.id !== bookId));
  return { id: bookId };
};

const fakeDraft = (mode: GenerationRequest['mode']) => (
  mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。'
);

export const deviceLibrary = {
  listBooks: async () => ensureLibrary(),
  loadBook: async (bookId: string) => loadBook(bookId),
  createBook: async (title: string) => createBook(title),
  saveBook: async (book: Book) => saveBook(book),
  deleteBook: async (bookId: string) => deleteBook(bookId),
  contextPlan: async (request: GenerationRequest): Promise<ContextPlanPreview> => (
    toContextPlanPreview(buildContextPlan(loadBook(request.bookId), request))
  ),
  generate: async (
    request: GenerationRequest,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<GenerationResult> => {
    if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
    const plan = buildContextPlan(loadBook(request.bookId), request);
    const result = {
      draft: request.generationKind === 'summarize-section'
        ? serializeSectionMemoryDraft(syntheticSectionMemoryDraft())
        : fakeDraft(request.mode),
      sourceSignature: plan.sourceSignature,
    };
    if (request.stream) {
      if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
      onDelta?.(result.draft);
    }
    return result;
  },
};
