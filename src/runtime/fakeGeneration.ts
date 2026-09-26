import { buildContextPlan, toContextPlanPreview } from '../contextPlan';
import { serializeSectionMemoryDraft, syntheticSectionMemoryDraft } from '../sectionMemory';
import type { Book, ContextPlanPreview, GenerationRequest, GenerationResult } from '../types';

const fakeDraft = (mode: GenerationRequest['mode']) => (
  mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。'
);

export const createFakeGenerationApi = (loadBook: (bookId: string) => Book) => ({
  contextPlan: async (request: GenerationRequest): Promise<ContextPlanPreview> => (
    toContextPlanPreview(buildContextPlan(loadBook(request.bookId), request))
  ),
  generate: async (
    request: GenerationRequest,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<GenerationResult> => {
    if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
    const plan = buildContextPlan(loadBook(request.bookId), request);
    const result = {
      draft: request.generationKind === 'summarize-section'
        ? serializeSectionMemoryDraft(syntheticSectionMemoryDraft())
        : fakeDraft(request.mode),
      finishReason: 'stop' as const,
      sourceSignature: plan.sourceSignature,
    };
    if (request.stream) {
      if (signal?.aborted) throw new DOMException('生成已取消。', 'AbortError');
      onDelta?.(result.draft);
    }
    return result;
  },
});
