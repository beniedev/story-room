import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContextBudget,
  assertGenerationExecutable,
  buildContextPlan,
  fakeGenerate,
  normalizeSectionMemoryResponse,
  RequestValidationError,
} from './domain.ts';
import { BookNotFoundError, StoreInputError, StoryStore } from './store.ts';
import type { Book, GenerationRequest } from '../src/types.ts';
import type { ProviderProfile } from '../src/providerProfiles.ts';
import {
  ProviderConnectionError,
  ProviderInputError,
  ProviderStore,
} from './providers.ts';

const host = process.env.STORY_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.STORY_API_PORT ?? 4311);
const MAX_BODY_BYTES = 1_000_000;
const generationKinds = new Set(['continue-section', 'regenerate-block', 'rewrite-selection', 'summarize-section']);

export type StoryServerOptions = {
  accessToken?: string;
  allowedHosts?: string[];
};

type HostAuthority = {
  hostname: string;
  port?: string;
};

const loopbackHosts = new BlockList();
loopbackHosts.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackHosts.addAddress('::1', 'ipv6');

const normalizeHost = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
};

const isLoopbackHost = (value: string) => {
  const hostname = normalizeHost(value);
  if (hostname === 'localhost') return true;
  const version = isIP(hostname);
  return version === 4
    ? loopbackHosts.check(hostname, 'ipv4')
    : version === 6 && loopbackHosts.check(hostname, 'ipv6');
};

const isWildcardHost = (value: string) => {
  const hostname = normalizeHost(value);
  return hostname === '0.0.0.0' || hostname === '::';
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
  if (!hostname || isWildcardHost(hostname)) return null;
  return { hostname, port: parsed.port || undefined };
};

const parseAllowedHosts = (values: string[] | undefined): HostAuthority[] => {
  if (!values) return [];
  const result: HostAuthority[] = [];
  for (const value of values) {
    const parsed = parseHostAuthority(value);
    if (!parsed) throw new Error('服务器可信 Host 配置无效。');
    result.push(parsed);
  }
  return result;
};

const hostMatches = (actual: HostAuthority, trusted: HostAuthority) => (
  actual.hostname === trusted.hostname && (!trusted.port || actual.port === trusted.port)
);

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

const validToken = (request: IncomingMessage, expected: string) => {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return false;
  const actual = Buffer.from(match[1], 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

const safeAccessToken = (value: string | undefined) => value?.trim() || '';

const validateEntryConfiguration = (configuredHost: string, accessToken: string, allowedHosts: HostAuthority[]) => {
  if (isLoopbackHost(configuredHost)) return;
  if (!accessToken || !allowedHosts.length) throw new Error('Story host 安全配置无效。');
};

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

class PayloadTooLargeError extends Error {
  readonly statusCode = 413;

  constructor() {
    super('请求内容超过 DEMO 的 1 MB 限制。');
    this.name = 'PayloadTooLargeError';
  }
}

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
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new PayloadTooLargeError();
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
  options: StoryServerOptions = {},
) => {
  const accessToken = safeAccessToken(options.accessToken);
  const allowedHosts = parseAllowedHosts(options.allowedHosts);
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const actualHost = requestHost(request);
      const hostAllowed = actualHost && (allowedHosts.length
        ? allowedHosts.some((trustedHost) => hostMatches(actualHost, trustedHost))
        : isLoopbackHost(actualHost.hostname));
      if (!hostAllowed) return sendJson(response, 403, { error: '请求来源不被允许。' });
      const stateChanging = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';
      if (stateChanging && actualHost && !sameOrigin(request, actualHost)) {
        return sendJson(response, 403, { error: '请求来源不被允许。' });
      }
      const isHealth = request.method === 'GET' && url.pathname === '/api/health';
      if (accessToken && url.pathname.startsWith('/api/') && !isHealth && !validToken(request, accessToken)) {
        return sendJson(response, 401, { error: '需要访问凭据。' });
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        return sendJson(response, 200, await storyStore.listBooks());
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
        return sendJson(response, 200, buildContextPlan(book, body, limits));
      }
      if (request.method === 'POST' && url.pathname === '/api/generate') {
        const body = await readGenerationRequest(request);
        const book = await storyStore.loadBook(body.bookId);
        const limits = await providerStore.getContextLimits(body.providerProfileId);
        const plan = buildContextPlan(book, body, limits);
        assertGenerationExecutable(body);
        assertContextBudget(plan);
        const generated = body.providerProfileId
          ? await providerStore.generate(body.providerProfileId, plan.messages)
          : null;
        if (generated !== null) {
          return sendJson(response, 200, {
            plan,
            draft: body.generationKind === 'summarize-section'
              ? normalizeSectionMemoryResponse(generated)
              : generated,
          });
        }
        return sendJson(response, 200, fakeGenerate(book, body, limits));
      }
      if (knownRouteMethods[url.pathname]) {
        response.setHeader('allow', knownRouteMethods[url.pathname].join(', '));
        return sendJson(response, 405, { error: '这个 DEMO API 不支持当前请求方法。' });
      }
      if (staticRoot && await serveStatic(request, response, staticRoot, url.pathname)) return;
      return sendJson(response, 404, { error: '未找到这个 DEMO API。' });
    } catch (error) {
      const statusCode = error instanceof PayloadTooLargeError
        ? error.statusCode
        : error instanceof BookNotFoundError
          ? error.statusCode
          : error instanceof RequestValidationError || error instanceof StoreInputError
            ? error.statusCode
            : error instanceof ProviderInputError || error instanceof ProviderConnectionError
              ? error.statusCode
              : 500;
      const message = error instanceof PayloadTooLargeError
        || error instanceof BookNotFoundError
        || error instanceof RequestValidationError
        || error instanceof StoreInputError
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
  const accessToken = safeAccessToken(process.env.STORY_ACCESS_TOKEN);
  const rawAllowedHosts = process.env.STORY_ALLOWED_HOSTS?.split(',').map((value) => value.trim()).filter(Boolean);
  const allowedHosts = parseAllowedHosts(rawAllowedHosts);
  validateEntryConfiguration(host, accessToken, allowedHosts);
  const staticRoot = process.env.STORY_STATIC_DIR ?? path.resolve('dist-local');
  const providerStore = new ProviderStore(undefined, {
    allowPrivateNetwork: process.env.STORY_ALLOW_PRIVATE_PROVIDERS === '1',
  });
  const server = createStoryServer(undefined, providerStore, staticRoot, { accessToken, allowedHosts: rawAllowedHosts });
  server.listen(port, host, () => {
    console.log(`Story host ready at http://${host}:${port}`);
  });
}
