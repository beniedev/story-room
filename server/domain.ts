import type {
  Book,
  ContextPlan,
  GenerationRequest,
} from '../src/types.ts';
import {
  buildContextPlan as composeContextPlan,
  ContextPlanInputError,
} from '../src/contextPlan.ts';

export class RequestValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function buildContextPlan(book: Book, request: Omit<GenerationRequest, 'bookId'>): ContextPlan {
  try {
    return composeContextPlan(book, request);
  } catch (error) {
    if (error instanceof ContextPlanInputError) throw new RequestValidationError(error.message);
    throw error;
  }
}

export function fakeGenerate(book: Book, request: Omit<GenerationRequest, 'bookId'>): { plan: ContextPlan; draft: string } {
  const plan = buildContextPlan(book, request);
  const draft = request.mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。';
  return { plan, draft };
}
