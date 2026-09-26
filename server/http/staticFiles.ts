import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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

export const serveStatic = async (
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
