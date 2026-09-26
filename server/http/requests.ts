import type { IncomingMessage } from 'node:http';
import { RequestValidationError } from '../domain.ts';
import type { Book, GenerationRequest } from '../../src/types.ts';
import type { ProviderProfile } from '../../src/providerProfiles.ts';

const generationKinds = new Set(['continue-section', 'regenerate-block', 'respond-to-input', 'rewrite-selection', 'summarize-section']);

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export const readBody = async (request: IncomingMessage): Promise<unknown> => {
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

export const readGenerationRequest = async (request: IncomingMessage): Promise<GenerationRequest> => {
  const body = await readBody(request);
  if (!isRecord(body)
    || typeof body.bookId !== 'string'
    || typeof body.sectionId !== 'string'
    || typeof body.instruction !== 'string'
    || (body.providerProfileId !== undefined && typeof body.providerProfileId !== 'string')
    || (body.stream !== undefined && typeof body.stream !== 'boolean')
    || (body.mode !== 'author' && body.mode !== 'character')
    || (body.authorNote !== undefined && typeof body.authorNote !== 'string')
    || (body.selectedCharacterId !== undefined && typeof body.selectedCharacterId !== 'string')
    || (body.generationKind !== undefined && (typeof body.generationKind !== 'string' || !generationKinds.has(body.generationKind)))
    || (body.targetBlockId !== undefined && typeof body.targetBlockId !== 'string')) {
    throw new RequestValidationError('生成请求数据无效。');
  }
  return body as unknown as GenerationRequest;
};

export const readProviderBody = async (request: IncomingMessage) => {
  const body = await readBody(request);
  if (!isRecord(body) || !isRecord(body.profile)
    || (body.apiKey !== undefined && typeof body.apiKey !== 'string')) {
    throw new RequestValidationError('Provider 请求数据无效。');
  }
  return { profile: body.profile as unknown as ProviderProfile, apiKey: body.apiKey as string | undefined };
};

export const readBookSaveRequest = async (request: IncomingMessage, bookId: string) => {
  const body = await readBody(request);
  if (!isRecord(body) || !isRecord(body.book)
    || typeof body.book.id !== 'string'
    || typeof body.expectedUpdatedAt !== 'string'
    || !body.expectedUpdatedAt.trim()) {
    throw new RequestValidationError('保存请求必须包含有效的 Book 与 expectedUpdatedAt。');
  }
  if (body.book.id !== bookId) throw new RequestValidationError('URL 与 Book ID 不一致。');
  return {
    book: body.book as unknown as Book,
    expectedUpdatedAt: body.expectedUpdatedAt,
  };
};

export const readBookImportRequest = async (request: IncomingMessage) => {
  const body = await readBody(request);
  if (!isRecord(body) || !isRecord(body.book) || typeof body.book.id !== 'string') {
    throw new RequestValidationError('导入请求必须包含有效的 Book。');
  }
  return body.book as unknown as Book;
};
