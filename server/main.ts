import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertGenerationExecutable,
  buildContextPlan,
  buildContextPreview,
  fakeGenerate,
  normalizeSectionMemoryResponse,
  ProviderResponseError,
  RequestValidationError,
} from './domain.ts';
import { BookNotFoundError, StoreInputError, StoryStore } from './store.ts';
import type { Book, GenerationRequest } from '../src/types.ts';
import type { ProviderProfile } from '../src/providerProfiles.ts';
import {
  ProviderCancelledError,
  ProviderConnectionError,
  ProviderInputError,
  ProviderStore,
} from './providers.ts';

const host = process.env.STORY_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.STORY_API_PORT ?? 4311);
const generationKinds = new Set(['continue-section', 'regenerate-block', 'respond-to-input', 'rewrite-selection', 'summarize-section']);

type HostAuthority = {
  hostname: string;
  port?: string;
};

const normalizeHost = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
};

const parseHostAuthority = (value: string): HostAuthority | null => {
  const raw = value.trim();
  if (!raw || raw !== value || raw.includes('\\')) return null;
  const authority = isIP(raw) === 6 ? `[${raw}]` : raw;
  let parsed: URL;
  try {
    parsed = new URL(`http://${authority}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  const hostname = normalizeHost(parsed.hostname);
  if (!hostname) return null;
  return { hostname, port: parsed.port || undefined };
};

const requestHost = (request: IncomingMessage) => {
  const value = request.headers.host;
  return typeof value === 'string' ? parseHostAuthority(value) : null;
};

const sameOrigin = (request: IncomingMessage, actualHost: HostAuthority) => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (origin.trim() !== origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return false;
  }
  const host = actualHost.hostname.includes(':') ? `[${actualHost.hostname}]` : actualHost.hostname;
  const expected = new URL(`http://${host}${actualHost.port ? `:${actualHost.port}` : ''}`);
  return parsed.origin === expected.origin;
};

const formatUrlHost = (value: string) => value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestValidationError('请求体必须是有效 JSON。');
  }
};

const readGenerationRequest = async (request: IncomingMessage): Promise<GenerationRequest> => {
  const body = await readBody(request);
  if (!isRecord(body)
    || typeof body.bookId !== 'string'
    || typeof body.sectionId !== 'string'
    || typeof body.instruction !== 'string'
    || (body.providerProfileId !== undefined && typeof body.providerProfileId !== 'string')
    || (body.mode !== 'author' && body.mode !== 'character')
    || (body.authorNote !== undefined && typeof body.authorNote !== 'string')
    || (body.selectedCharacterId !== undefined && typeof body.selectedCharacterId !== 'string')
    || (body.generationKind !== undefined && (typeof body.generationKind !== 'string' || !generationKinds.has(body.generationKind)))
    || (body.targetBlockId !== undefined && typeof body.targetBlockId !== 'string')) {
    throw new RequestValidationError('生成请求数据无效。');
  }
  return body as unknown as GenerationRequest;
};

const readProviderBody = async (request: IncomingMessage) => {
  const body = await readBody(request);
  if (!isRecord(body) || !isRecord(body.profile)
    || (body.apiKey !== undefined && typeof body.apiKey !== 'string')) {
    throw new RequestValidationError('Provider 请求数据无效。');
  }
  return { profile: body.profile as unknown as ProviderProfile, apiKey: body.apiKey as string | undefined };
};

const knownRouteMethods: Record<string, string[]> = {
  '/api/health': ['GET'],
  '/api/library': ['GET'],
  '/api/storage-location': ['GET'],
  '/api/books': ['POST'],
  '/api/providers': ['GET', 'POST'],
  '/api/provider-test': ['POST'],
  '/api/context-plan': ['POST'],
  '/api/generate': ['POST'],
};

const serveStatic = async (
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  pathname: string,
) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, candidate);
  const safeCandidate = relativeToRoot !== '..'
    && !relativeToRoot.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativeToRoot);

  let file = safeCandidate ? candidate : '';
  try {
    if (!file || !(await stat(file)).isFile()) file = '';
  } catch {
    file = '';
  }
  if (!file) {
    file = path.resolve(root, 'index.html');
    try {
      if (!(await stat(file)).isFile()) return false;
    } catch {
      return false;
    }
  }

  const body = await readFile(file);
  response.writeHead(200, {
    'content-type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
};

export const createStoryServer = (
  storyStore = new StoryStore(),
  providerStore = new ProviderStore(),
  staticRoot?: string,
) => {
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    let generationSignal: AbortSignal | undefined;
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const actualHost = requestHost(request);
      if (!actualHost) return sendJson(response, 403, { error: '请求来源不被允许。' });
      const stateChanging = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';
      if (stateChanging && !sameOrigin(request, actualHost)) {
        return sendJson(response, 403, { error: '请求来源不被允许。' });
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        return sendJson(response, 200, await storyStore.listBooks());
      }
      if (request.method === 'GET' && url.pathname === '/api/storage-location') {
        return sendJson(response, 200, { location: path.resolve(storyStore.root) });
      }
      if (request.method === 'GET' && url.pathname === '/api/providers') {
        return sendJson(response, 200, await providerStore.list());
      }
      if (request.method === 'POST' && url.pathname === '/api/providers') {
        const body = await readProviderBody(request);
        return sendJson(response, 200, await providerStore.save(body.profile, body.apiKey));
      }
      if (request.method === 'POST' && url.pathname === '/api/provider-test') {
        const body = await readProviderBody(request);
        return sendJson(response, 200, await providerStore.test(body.profile, body.apiKey));
      }
      if (request.method === 'POST' && url.pathname === '/api/books') {
        const body = await readBody(request);
        if (!isRecord(body) || typeof body.title !== 'string') {
          throw new RequestValidationError('Book 标题必须是文本。');
        }
        return sendJson(response, 201, await storyStore.createBook(body.title));
      }

      const bookMatch = url.pathname.match(/^\/api\/books\/([a-z0-9-]+)$/i);
      if (bookMatch && request.method === 'GET') {
        return sendJson(response, 200, await storyStore.loadBook(bookMatch[1]));
      }
      if (bookMatch && request.method === 'PUT') {
        // Every edit saves the whole Book, so manuscript growth must not block saving.
        const body = await readBody(request);
        if (!isRecord(body) || typeof body.id !== 'string') {
          throw new RequestValidationError('Book 数据无效。');
        }
        if (body.id !== bookMatch[1]) throw new RequestValidationError('URL 与 Book ID 不一致。');
        return sendJson(response, 200, await storyStore.saveBook(body as unknown as Book));
      }
      if (bookMatch && request.method === 'DELETE') {
        return sendJson(response, 200, await storyStore.deleteBook(bookMatch[1]));
      }
      if (bookMatch) {
        response.setHeader('allow', 'GET, PUT, DELETE');
        return sendJson(response, 405, { error: '这个 Book API 不支持当前请求方法。' });
      }
      if (request.method === 'POST' && url.pathname === '/api/context-plan') {
        const body = await readGenerationRequest(request);
        const book = await storyStore.loadBook(body.bookId);
        const limits = await providerStore.getContextLimits(body.providerProfileId);
        return sendJson(response, 200, buildContextPreview(book, body, limits));
      }
      if (request.method === 'POST' && url.pathname === '/api/generate') {
        const generationController = new AbortController();
        let responseStarted = false;
        generationSignal = generationController.signal;
        const abortOnClientDisconnect = () => {
          if (!responseStarted && !generationController.signal.aborted) generationController.abort();
        };
        request.once('aborted', abortOnClientDisconnect);
        response.once('close', abortOnClientDisconnect);
        try {
          const body = await readGenerationRequest(request);
          if (generationController.signal.aborted) return;
          const book = await storyStore.loadBook(body.bookId);
          if (generationController.signal.aborted) return;
          const limits = await providerStore.getContextLimits(body.providerProfileId);
          if (generationController.signal.aborted) return;
          const plan = buildContextPlan(book, body, limits);
          assertGenerationExecutable(body);
          const generated = body.providerProfileId
            ? await providerStore.generate(body.providerProfileId, plan.messages, generationController.signal)
            : null;
          if (generationController.signal.aborted) return;
          if (generated !== null) {
            responseStarted = true;
            return sendJson(response, 200, {
              draft: body.generationKind === 'summarize-section'
                ? normalizeSectionMemoryResponse(generated)
                : generated,
              sourceSignature: plan.sourceSignature,
            });
          }
          responseStarted = true;
          const fake = fakeGenerate(book, body, limits);
          return sendJson(response, 200, {
            draft: fake.draft,
            sourceSignature: fake.sourceSignature,
          });
        } finally {
          responseStarted = true;
          request.off('aborted', abortOnClientDisconnect);
          response.off('close', abortOnClientDisconnect);
        }
      }
      if (knownRouteMethods[url.pathname]) {
        response.setHeader('allow', knownRouteMethods[url.pathname].join(', '));
        return sendJson(response, 405, { error: '这个 DEMO API 不支持当前请求方法。' });
      }
      if (url.pathname.startsWith('/api/')) {
        return sendJson(response, 404, { error: '未找到这个 DEMO API。' });
      }
      if (staticRoot && await serveStatic(request, response, staticRoot, url.pathname)) return;
      return sendJson(response, 404, { error: '未找到这个 DEMO API。' });
    } catch (error) {
      if (error instanceof ProviderCancelledError
        || generationSignal?.aborted
        || response.destroyed
        || response.writableEnded) return;
      const statusCode = error instanceof BookNotFoundError
          ? error.statusCode
          : error instanceof RequestValidationError || error instanceof StoreInputError
            ? error.statusCode
            : error instanceof ProviderResponseError
              ? error.statusCode
            : error instanceof ProviderInputError || error instanceof ProviderConnectionError
              ? error.statusCode
              : 500;
      const message = error instanceof BookNotFoundError
        || error instanceof RequestValidationError
        || error instanceof StoreInputError
        || error instanceof ProviderResponseError
        || error instanceof ProviderInputError
        || error instanceof ProviderConnectionError
        ? error.message
        : '服务器内部错误。';
      if (statusCode >= 500) console.error('Story host request failed:', error);
      return sendJson(response, statusCode, { error: message });
    }
  };
  return createServer(handler);
};

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  const staticRoot = process.env.STORY_STATIC_DIR ?? path.resolve('dist-local');
  const providerStore = new ProviderStore();
  const server = createStoryServer(undefined, providerStore, staticRoot);
  server.listen(port, host, () => {
    console.log(`Story host ready at http://${formatUrlHost(host)}:${port}`);
  });
}
