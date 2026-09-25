import type { GenerationFinishReason } from '../src/types.ts';

export type ProviderGenerationResult = {
  draft: string;
  finishReason: GenerationFinishReason;
};

export const hasExplicitRefusal = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0
);

export const mapProviderFinishReason = (
  finishReason: unknown,
  refusal?: unknown,
): GenerationFinishReason => {
  if (hasExplicitRefusal(refusal)) return 'refusal';
  switch (finishReason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content_filter': return 'content-filter';
    case 'tool_calls':
    case 'function_call': return 'unsupported';
    default: return 'unknown';
  }
};

const isFailureReason = (reason: GenerationFinishReason) => (
  reason === 'length'
  || reason === 'content-filter'
  || reason === 'refusal'
  || reason === 'unsupported'
);

export const preserveFailureFinishReason = (
  current: GenerationFinishReason,
  next: GenerationFinishReason,
): GenerationFinishReason => {
  if (isFailureReason(current)) return current;
  if (isFailureReason(next)) return next;
  if (current === 'stop') return current;
  if (next === 'stop') return next;
  return 'unknown';
};

export const finishReasonAllowsEmptyDraft = (finishReason: GenerationFinishReason) => (
  finishReason === 'length'
  || finishReason === 'content-filter'
  || finishReason === 'refusal'
  || finishReason === 'unsupported'
);
