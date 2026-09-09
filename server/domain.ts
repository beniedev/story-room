import type {
  Book,
  ContextPlan,
  ContextPlanPreview,
  GenerationRequest,
  ProviderLimits,
} from '../src/types.ts';
import {
  buildContextPlan as composeContextPlan,
  ContextPlanInputError,
  toContextPlanPreview,
} from '../src/contextPlan.ts';
import {
  parseSectionMemoryDraft,
  serializeSectionMemoryDraft,
  syntheticSectionMemoryDraft,
} from '../src/sectionMemory.ts';

export class RequestValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function buildContextPlan(
  book: Book,
  request: Omit<GenerationRequest, 'bookId'>,
  limits?: ProviderLimits,
): ContextPlan {
  try {
    return composeContextPlan(book, request, limits);
  } catch (error) {
    if (error instanceof ContextPlanInputError) throw new RequestValidationError(error.message);
    throw error;
  }
}

export const buildContextPreview = (
  book: Book,
  request: Omit<GenerationRequest, 'bookId'>,
  limits?: ProviderLimits,
): ContextPlanPreview => toContextPlanPreview(buildContextPlan(book, request, limits));

export class ProviderResponseError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

export function assertGenerationExecutable(request: Omit<GenerationRequest, 'bookId'>) {
  const generationKind = request.generationKind ?? 'continue-section';
  if (generationKind === 'rewrite-selection') throw new RequestValidationError('rewrite-selection 当前尚未实现。');
}

export function normalizeSectionMemoryResponse(draft: string): string {
  try {
    return serializeSectionMemoryDraft(parseSectionMemoryDraft(draft));
  } catch {
    throw new ProviderResponseError('Provider 返回的 Section memory draft 无效。');
  }
}

export function fakeGenerate(
  book: Book,
  request: Omit<GenerationRequest, 'bookId'>,
  limits?: ProviderLimits,
): { plan: ContextPlan; draft: string; sourceSignature?: string } {
  const plan = buildContextPlan(book, request, limits);
  assertGenerationExecutable(request);
  if (request.generationKind === 'summarize-section') {
    return {
      plan,
      draft: normalizeSectionMemoryResponse(serializeSectionMemoryDraft(syntheticSectionMemoryDraft())),
      sourceSignature: plan.sourceSignature,
    };
  }
  const draft = request.mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。';
  return { plan, draft, sourceSignature: plan.sourceSignature };
}
