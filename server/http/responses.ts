import type { ServerResponse } from 'node:http';
import { ProviderResponseError, RequestValidationError } from '../domain.ts';
import { BookNotFoundError, StoreConflictError, StoreInputError } from '../storeErrors.ts';
import { ProviderCancelledError, ProviderConnectionError, ProviderInputError } from '../providers/errors.ts';

export const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
};

type GenerationStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'result'; result: { draft: string; sourceSignature?: string } }
  | { type: 'error'; error: string };

export const writeGenerationStreamEvent = (response: ServerResponse, event: GenerationStreamEvent) => {
  if (response.destroyed || response.writableEnded) throw new ProviderCancelledError();
  if (!response.headersSent) {
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
  }
  try {
    response.write(`${JSON.stringify(event)}\n`);
  } catch {
    throw new ProviderCancelledError();
  }
};

export const finishGenerationStream = (response: ServerResponse) => {
  if (!response.destroyed && !response.writableEnded) response.end();
};

export const sendRequestError = (
  response: ServerResponse,
  error: unknown,
  generationSignal?: AbortSignal,
  streamingGeneration = false,
) => {
  if (error instanceof ProviderCancelledError
    || generationSignal?.aborted
    || response.destroyed
    || response.writableEnded) return;
  const statusCode = error instanceof BookNotFoundError
      ? error.statusCode
      : error instanceof StoreConflictError
        ? error.statusCode
      : error instanceof RequestValidationError || error instanceof StoreInputError
        ? error.statusCode
        : error instanceof ProviderResponseError
          ? error.statusCode
        : error instanceof ProviderInputError || error instanceof ProviderConnectionError
          ? error.statusCode
          : 500;
  const message = error instanceof BookNotFoundError
    || error instanceof StoreConflictError
    || error instanceof RequestValidationError
    || error instanceof StoreInputError
    || error instanceof ProviderResponseError
    || error instanceof ProviderInputError
    || error instanceof ProviderConnectionError
    ? error.message
    : '服务器内部错误。';
  if (streamingGeneration && response.headersSent
    && !response.destroyed && !response.writableEnded && !generationSignal?.aborted) {
    const message = error instanceof BookNotFoundError
      || error instanceof RequestValidationError
      || error instanceof StoreInputError
      || error instanceof ProviderResponseError
      || error instanceof ProviderInputError
      || error instanceof ProviderConnectionError
      ? error.message
      : '服务器内部错误。';
    try {
      writeGenerationStreamEvent(response, { type: 'error', error: message });
      finishGenerationStream(response);
    } catch {
      // The client disconnected while the error event was being written.
    }
    return;
  }
  if (statusCode >= 500) console.error('Story host request failed:', error);
  return sendJson(response, statusCode, statusCode === 409
    ? { error: message, code: 'BOOK_CONFLICT' }
    : { error: message });
};
