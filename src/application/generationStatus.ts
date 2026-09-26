import type { GenerationFinishReason, GenerationRequest } from '../types';

export type StreamingDraftStatus = 'streaming' | 'stopped' | 'failed';
export type StreamingDraft = {
  key: string;
  bookId: string;
  sectionId: string;
  targetBlockId?: string;
  replaceTarget: boolean;
  content: string;
  status: StreamingDraftStatus;
  message: string;
};

export const streamingDraftKey = (request: Pick<GenerationRequest, 'bookId' | 'sectionId' | 'targetBlockId'>) => (
  `${request.bookId}:${request.sectionId}:${request.targetBlockId ?? 'section'}`
);

export const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
  || error instanceof Error && error.name === 'AbortError';

export const abortGenerationError = () => {
  try {
    return new DOMException('生成已取消。', 'AbortError');
  } catch {
    const error = new Error('生成已取消。');
    error.name = 'AbortError';
    return error;
  }
};

export const isUnsuccessfulFinishReason = (reason: GenerationFinishReason) => (
  reason === 'length'
  || reason === 'content-filter'
  || reason === 'refusal'
  || reason === 'unsupported'
);

const finishReasonDescription = (reason: GenerationFinishReason) => {
  switch (reason) {
    case 'length': return '服务因输出长度上限结束了生成';
    case 'content-filter': return '服务的内容筛选未允许完整结果';
    case 'refusal': return '服务明确拒绝了本次生成';
    case 'unsupported': return '服务返回了应用当前不支持的结束类型';
    default: return '';
  }
};

export const finishReasonSuccessStatus = (message: string, reason: GenerationFinishReason) => (
  reason === 'unknown' ? `${message} 模型服务未提供明确的结束原因。` : message
);

export const unsuccessfulFinishMessage = (
  reason: GenerationFinishReason,
  isSummary: boolean,
  sourceSectionTitle?: string,
) => {
  const description = finishReasonDescription(reason);
  return isSummary
    ? `${sourceSectionTitle ? `「${sourceSectionTitle}」的` : '所选前文的'}梗概 JSON 草稿，未保存。${description}；可复制草稿后检查。`
    : `生成未完成：${description}；正文和候选未修改，草稿可复制。`;
};
