import {
  defaultProviderProfiles,
  isValidProviderLimit,
  MAX_PROVIDER_CONTEXT_TOKENS,
  MAX_PROVIDER_OUTPUT_TOKENS,
} from '../providerProfiles.ts';
import { estimateTokens } from '../textMetrics.ts';
import type { ContextBudget, ContextPlan, PromptBlock, PromptMessage, ProviderLimits } from '../types.ts';

export const CONTEXT_PROTOCOL_OVERHEAD = 512;
export const CONTEXT_SAFETY_MARGIN = 256;

export const DEFAULT_PROVIDER_LIMITS: ProviderLimits = {
  maxContext: defaultProviderProfiles[0]?.maxContext ?? 128000,
  maxOutput: defaultProviderProfiles[0]?.maxOutput ?? 8192,
};

export const normalizedLimits = (limits?: ProviderLimits): ProviderLimits => (
  limits && isValidProviderLimit(limits.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
    && isValidProviderLimit(limits.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)
    ? { maxContext: limits.maxContext, maxOutput: limits.maxOutput }
    : { ...DEFAULT_PROVIDER_LIMITS }
);

export const estimateMessages = (messages: PromptMessage[]): number => estimateTokens(JSON.stringify(
  messages.map((message) => ({ role: message.role, content: message.content })),
));

const isManualReferenceBlock = (item: PromptBlock) => item.manualSelection === true
  && (item.semanticRole === 'reference-manuscript' || item.semanticRole === 'memory');

export const largestContextItems = (items: PromptBlock[], limit = 3): PromptBlock[] => {
  const references = items.filter(isManualReferenceBlock);
  return [...(references.length ? references : items)]
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens)
    .slice(0, limit);
};

export const hasManualReference = (items: PromptBlock[]) => items.some(isManualReferenceBlock);

export const messageFramingResidual = (plan: Pick<ContextPlan, 'included' | 'estimatedTokens'>): number => Math.max(
  0,
  plan.estimatedTokens - plan.included.reduce((total, item) => total + item.estimatedTokens, 0),
);

export const budgetFor = (limits: ProviderLimits, estimatedInput: number): ContextBudget => {
  const availableInput = Math.max(
    0,
    limits.maxContext - limits.maxOutput - CONTEXT_PROTOCOL_OVERHEAD - CONTEXT_SAFETY_MARGIN,
  );
  const remainingInput = availableInput - estimatedInput;
  return {
    maxContext: limits.maxContext,
    protocolOverhead: CONTEXT_PROTOCOL_OVERHEAD,
    safetyMargin: CONTEXT_SAFETY_MARGIN,
    reservedOutput: limits.maxOutput,
    availableInput,
    estimatedInput,
    remainingInput,
    overflow: remainingInput < 0,
    overflowTokens: Math.max(0, -remainingInput),
    estimateKind: 'approximate',
  };
};
