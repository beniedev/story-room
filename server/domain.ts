import type {
  Book,
  ContextPlan,
  GenerationRequest,
  ProviderLimits,
} from '../src/types.ts';
import {
  buildContextPlan as composeContextPlan,
  ContextPlanInputError,
  hasManualReference,
  largestContextItems,
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

export function assertGenerationExecutable(request: Omit<GenerationRequest, 'bookId'>) {
  const generationKind = request.generationKind ?? 'continue-section';
  if (generationKind === 'rewrite-selection') throw new RequestValidationError('rewrite-selection 当前尚未实现。');
}

export function normalizeSectionMemoryResponse(draft: string): string {
  try {
    return serializeSectionMemoryDraft(parseSectionMemoryDraft(draft));
  } catch {
    throw new RequestValidationError('Provider 返回的 Section memory draft 无效。');
  }
}

export function assertContextBudget(plan: ContextPlan) {
  if (plan.budget.overflow) {
    const largest = largestContextItems(plan.included)
      .map((item) => `${item.title}（约 ${item.estimatedTokens.toLocaleString()} tokens）`)
      .join('、');
    const label = hasManualReference(plan.included) ? '手选前文' : '内容';
    throw new RequestValidationError(
      `当前上下文约超出 ${plan.budget.overflowTokens} tokens；占用最大的${label}：${largest || '无'}。请缩短输入或调整 Prompt 材料。`,
    );
  }
}

export function fakeGenerate(
  book: Book,
  request: Omit<GenerationRequest, 'bookId'>,
  limits?: ProviderLimits,
): { plan: ContextPlan; draft: string } {
  const plan = buildContextPlan(book, request, limits);
  assertGenerationExecutable(request);
  assertContextBudget(plan);
  if (request.generationKind === 'summarize-section') {
    return {
      plan,
      draft: normalizeSectionMemoryResponse(serializeSectionMemoryDraft(syntheticSectionMemoryDraft())),
    };
  }
  const draft = request.mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。';
  return { plan, draft };
}
