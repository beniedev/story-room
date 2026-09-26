export class BookConflictError extends Error {
  readonly code = 'BOOK_CONFLICT' as const;
  readonly statusCode = 409 as const;

  constructor(message = '这本 Book 已在其他页面更新，请重新载入后再保存。') {
    super(message);
    this.name = 'BookConflictError';
  }
}

export const requestOnce = async (url: string, init: RequestInit | undefined) => {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  return fetch(url, { ...init, headers });
};

export const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await requestOnce(url, init);
  } catch (error) {
    if (init?.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    throw new Error('无法连接本地书库服务，请确认故事书屋仍在运行。');
  }

  const text = await response.text();
  let body: T & { error?: string; code?: unknown };
  try {
    body = text ? JSON.parse(text) as T & { error?: string; code?: unknown } : {} as T & { error?: string; code?: unknown };
  } catch {
    if (!response.ok && response.status === 409) throw new BookConflictError();
    throw new Error(response.ok
      ? '本地书库返回了无法读取的数据。'
      : `本地书库请求失败（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = body.error ?? (response.status === 502 || response.status === 503
      ? '本地书库服务暂时不可用，请确认故事书屋仍在运行。'
      : `请求失败（HTTP ${response.status}）。`);
    if (response.status === 409 || body.code === 'BOOK_CONFLICT') throw new BookConflictError(message);
    throw new Error(message);
  }
  return body;
};
