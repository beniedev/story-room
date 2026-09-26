import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContextPreview, RequestValidationError } from './domain.ts';
import { StoryStore } from './store.ts';
import { ProviderStore } from './providers.ts';
import { formatUrlHost, requestHost, sameOrigin } from './http/requestOrigin.ts';
import { isRecord, readBody, readBookImportRequest, readBookSaveRequest, readGenerationRequest, readProviderBody } from './http/requests.ts';
import { sendJson, sendRequestError } from './http/responses.ts';
import { serveStatic } from './http/staticFiles.ts';
import { handleGenerationRequest } from './http/generationResponse.ts';

const host = process.env.STORY_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.STORY_API_PORT ?? 4311);
const knownRouteMethods: Record<string, string[]> = {
  '/api/health': ['GET'],
  '/api/library': ['GET'],
  '/api/storage-location': ['GET'],
  '/api/books': ['POST'],
  '/api/books/import': ['POST'],
  '/api/providers': ['GET', 'POST'],
  '/api/provider-test': ['POST'],
  '/api/context-plan': ['POST'],
  '/api/generate': ['POST'],
};

export const createStoryServer = (
  storyStore = new StoryStore(),
  providerStore = new ProviderStore(),
  staticRoot?: string,
) => {
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
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
      if (url.pathname === '/api/books/import') {
        if (request.method === 'POST') {
          const book = await readBookImportRequest(request);
          return sendJson(response, 201, await storyStore.importBook(book));
        }
        response.setHeader('allow', 'POST');
        return sendJson(response, 405, { error: '这个 Book 导入 API 不支持当前请求方法。' });
      }

      const bookMatch = url.pathname.match(/^\/api\/books\/([a-z0-9-]+)$/i);
      if (bookMatch && request.method === 'GET') {
        return sendJson(response, 200, await storyStore.loadBook(bookMatch[1]));
      }
      if (bookMatch && request.method === 'PUT') {
        // Every edit saves the whole Book, so manuscript growth must not block saving.
        const body = await readBookSaveRequest(request, bookMatch[1]);
        return sendJson(response, 200, await storyStore.saveBook(body.book, {
          expectedUpdatedAt: body.expectedUpdatedAt,
        }));
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
        return handleGenerationRequest(request, response, storyStore, providerStore);
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
      return sendRequestError(response, error);
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
