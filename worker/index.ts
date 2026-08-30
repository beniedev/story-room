import { buildContextPlan, fakeGenerate, RequestValidationError } from '../server/domain';
import { createExampleBooks, createLegacyFixtureBook } from '../src/fixtures';
import type { Book, BookIndexEntry, GenerationRequest } from '../src/types';

interface Env {
  DB: D1Database;
}

interface BookRow {
  id: string;
  title: string;
  data_json: string;
  updated_at: string;
}

class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'HttpError';
  }
}

const MAX_BODY_BYTES = 1_000_000;
const idPattern = /^[a-z0-9][a-z0-9-]*$/i;
let schemaReady: Promise<void> | undefined;

const legacyExamples = new Map([
  ['the-observatory', createLegacyFixtureBook('the-observatory', 'The Observatory', 'Mira')],
  ['harbor-at-noon', createLegacyFixtureBook('harbor-at-noon', 'Harbor at Noon', 'Rowan')],
]);

const sameBookIgnoringTimestamp = (left: unknown, right: Book) => {
  if (!isRecord(left)) return false;
  return JSON.stringify({ ...left, updatedAt: '' }) === JSON.stringify({ ...right, updatedAt: '' });
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new HttpError(`${label}必须是文本。`);
  return value;
};

const requiredArray = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new HttpError(`${label}必须是数组。`);
  return value;
};

const validId = (value: unknown, label = '资料 ID') => {
  const id = requiredString(value, label);
  if (!idPattern.test(id)) throw new HttpError(`${label}无效。`);
  return id;
};

const validateSource = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new HttpError(`${label}数据无效。`);
  validId(value.id, `${label} ID`);
  requiredString(value.title, `${label}标题`);
  requiredString(value.content, `${label}正文`);
  if (typeof value.includeInPrompt !== 'boolean') throw new HttpError(`${label}启用状态无效。`);
};

function validateBook(value: unknown): asserts value is Book {
  if (!isRecord(value)) throw new HttpError('Book 数据无效。');
  validId(value.id, 'Book ID');
  requiredString(value.title, 'Book 标题');
  requiredString(value.writingBrief, 'Book 写作约定');

  for (const character of requiredArray(value.characters, '角色卡')) {
    validateSource(character, '角色卡');
    if (isRecord(character)) {
      requiredString(character.name, '角色名');
      requiredString(character.role, '角色职责');
    }
  }
  for (const rule of requiredArray(value.worldRules, '世界观条例')) validateSource(rule, '世界观条例');
  for (const fact of requiredArray(value.canonFacts, 'Canon 事实')) validateSource(fact, 'Canon 事实');
  for (const summary of requiredArray(value.summaries, 'Summary')) {
    validateSource(summary, 'Summary');
    if (isRecord(summary)) {
      for (const sectionId of requiredArray(summary.sourceSectionIds, 'Summary 来源 Section')) {
        validId(sectionId, 'Summary 来源 Section ID');
      }
    }
  }
  for (const chapter of requiredArray(value.chapters, 'Chapter')) {
    if (!isRecord(chapter)) throw new HttpError('Chapter 数据无效。');
    validId(chapter.id, 'Chapter ID');
    requiredString(chapter.title, 'Chapter 标题');
    for (const section of requiredArray(chapter.sections, 'Section')) {
      if (!isRecord(section)) throw new HttpError('Section 数据无效。');
      validId(section.id, 'Section ID');
      requiredString(section.title, 'Section 标题');
      requiredString(section.content, 'Section 正文');
    }
  }
  for (const branch of requiredArray(value.branches, 'Branch')) {
    if (!isRecord(branch)) throw new HttpError('Branch 数据无效。');
    validId(branch.id, 'Branch ID');
    requiredString(branch.title, 'Branch 标题');
    validId(branch.fromSectionId, 'Branch 来源 Section ID');
  }
}

const ensureDatabase = async (env: Env) => {
  schemaReady ??= (async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS books_updated_at_idx ON books (updated_at)'),
    ]);
    const fixtures = createExampleBooks();
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM books').first<{ total: number }>();
    if ((count?.total ?? 0) === 0) {
      await env.DB.batch(fixtures.map((book) => env.DB.prepare(
        'INSERT INTO books (id, title, data_json, updated_at) VALUES (?, ?, ?, ?)',
      ).bind(book.id, book.title, JSON.stringify(book), book.updatedAt)));
      return;
    }
    const existing = await env.DB.prepare(
      'SELECT id, title, data_json, updated_at FROM books WHERE id IN (?, ?, ?)',
    ).bind(...fixtures.map((book) => book.id)).all<BookRow>();
    const existingById = new Map(existing.results.map((row) => [row.id, row]));
    const writes = fixtures.flatMap((book) => {
      const row = existingById.get(book.id);
      if (!row) return [];
      const legacy = legacyExamples.get(book.id);
      let current: unknown;
      try {
        current = JSON.parse(row.data_json) as unknown;
      } catch {
        return [];
      }
      if (!legacy || !sameBookIgnoringTimestamp(current, legacy)) return [];
      return [env.DB.prepare(
        'UPDATE books SET title = ?, data_json = ?, updated_at = ? WHERE id = ?',
      ).bind(book.title, JSON.stringify(book), book.updatedAt, book.id)];
    });
    if (writes.length > 0) await env.DB.batch(writes);
  })();
  try {
    await schemaReady;
  } catch (error) {
    schemaReady = undefined;
    throw error;
  }
};

const readJson = async (request: Request) => {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError('请求内容超过 DEMO 的 1 MB 限制。', 413);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError('请求体必须是有效 JSON。');
  }
};

const readGenerationRequest = async (request: Request): Promise<GenerationRequest> => {
  const body = await readJson(request);
  if (!isRecord(body)
    || typeof body.bookId !== 'string'
    || typeof body.sectionId !== 'string'
    || typeof body.instruction !== 'string'
    || (body.mode !== 'author' && body.mode !== 'character')
    || (body.selectedCharacterId !== undefined && typeof body.selectedCharacterId !== 'string')) {
    throw new HttpError('生成请求数据无效。');
  }
  return body as unknown as GenerationRequest;
};

const loadBook = async (env: Env, bookId: string): Promise<Book> => {
  validId(bookId, 'Book ID');
  await ensureDatabase(env);
  const row = await env.DB.prepare(
    'SELECT id, title, data_json, updated_at FROM books WHERE id = ?',
  ).bind(bookId).first<BookRow>();
  if (!row) throw new HttpError(`找不到 Book：${bookId}`, 404);
  const book = JSON.parse(row.data_json) as unknown;
  validateBook(book);
  return book;
};

const saveBook = async (env: Env, value: unknown): Promise<Book> => {
  validateBook(value);
  await ensureDatabase(env);
  const saved: Book = { ...value, updatedAt: new Date().toISOString() };
  await env.DB.prepare(`INSERT INTO books (id, title, data_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, data_json = excluded.data_json, updated_at = excluded.updated_at`)
    .bind(saved.id, saved.title, JSON.stringify(saved), saved.updatedAt)
    .run();
  return saved;
};

const createBook = async (env: Env, title: string) => {
  const id = `book-${crypto.randomUUID()}`;
  return saveBook(env, {
    id,
    title: title.trim() || 'Untitled Book',
    writingBrief: '',
    characters: [],
    worldRules: [],
    canonFacts: [],
    summaries: [],
    chapters: [{
      id: `chapter-${crypto.randomUUID()}`,
      title: '第一章',
      sections: [{ id: `section-${crypto.randomUUID()}`, title: '新段落', content: '' }],
    }],
    branches: [],
    updatedAt: new Date().toISOString(),
  });
};

const deleteBook = async (env: Env, bookId: string) => {
  validId(bookId, 'Book ID');
  await ensureDatabase(env);
  const result = await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(bookId).run();
  if (!result.meta.changes) throw new HttpError(`找不到 Book：${bookId}`, 404);
  return { id: bookId };
};

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { 'cache-control': 'no-store' },
});

const methods: Record<string, string[]> = {
  '/api/health': ['GET'],
  '/api/library': ['GET'],
  '/api/books': ['POST'],
  '/api/context-plan': ['POST'],
  '/api/generate': ['POST'],
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true });
      if (request.method === 'GET' && url.pathname === '/api/library') {
        await ensureDatabase(env);
        const rows = await env.DB.prepare(
          'SELECT id, title, updated_at AS updatedAt FROM books ORDER BY updated_at DESC',
        ).all<BookIndexEntry>();
        return json(rows.results);
      }
      if (request.method === 'POST' && url.pathname === '/api/books') {
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.title !== 'string') throw new HttpError('Book 标题必须是文本。');
        return json(await createBook(env, body.title), 201);
      }

      const bookMatch = url.pathname.match(/^\/api\/books\/([a-z0-9-]+)$/i);
      if (bookMatch && request.method === 'GET') return json(await loadBook(env, bookMatch[1]));
      if (bookMatch && request.method === 'PUT') {
        const body = await readJson(request);
        if (!isRecord(body) || body.id !== bookMatch[1]) throw new HttpError('URL 与 Book ID 不一致。');
        return json(await saveBook(env, body));
      }
      if (bookMatch && request.method === 'DELETE') return json(await deleteBook(env, bookMatch[1]));
      if (bookMatch) return json({ error: '这个 Book API 不支持当前请求方法。' }, 405);

      if (request.method === 'POST' && url.pathname === '/api/context-plan') {
        const body = await readGenerationRequest(request);
        return json(buildContextPlan(await loadBook(env, body.bookId), body));
      }
      if (request.method === 'POST' && url.pathname === '/api/generate') {
        const body = await readGenerationRequest(request);
        return json(fakeGenerate(await loadBook(env, body.bookId), body));
      }
      if (methods[url.pathname]) return json({ error: '这个 DEMO API 不支持当前请求方法。' }, 405);
      return json({ error: '未找到这个 DEMO API。' }, 404);
    } catch (error) {
      const status = error instanceof HttpError || error instanceof RequestValidationError
        ? (error instanceof HttpError ? error.status : error.statusCode)
        : 500;
      if (status >= 500) console.error('Story Site request failed:', error);
      return json({ error: status >= 500 ? '服务器内部错误。' : (error as Error).message }, status);
    }
  },
} satisfies ExportedHandler<Env>;
