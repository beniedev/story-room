import { estimateTokens } from '../textMetrics.ts';
import type { Book, ContextTarget, PromptBlock, PromptCacheBand, PromptLayer, PromptSource } from '../types.ts';

export type BlockOptions = Partial<Pick<PromptBlock,
  'messageRole' | 'semanticRole' | 'source' | 'manualSelection' | 'freshness' | 'transformedFrom'
  | 'truncated' | 'truncationReason' | 'future'>>;

export const block = (
  bookId: string,
  layer: PromptLayer,
  cacheBand: PromptCacheBand,
  sourceId: string,
  title: string,
  content: string,
  reason: string,
  included: boolean,
  readOnly: boolean,
  options: BlockOptions = {},
): PromptBlock => ({
  id: `${layer}:${sourceId}`,
  layer,
  cacheBand,
  title,
  content,
  bookId,
  sourceId,
  reason,
  included,
  readOnly,
  charCount: Array.from(content).length,
  estimatedTokens: estimateTokens(content),
  messageRole: options.messageRole ?? (layer === 'system' ? 'system' : 'user'),
  semanticRole: options.semanticRole ?? 'constraint',
  source: options.source ?? { bookId, sourceId },
  manualSelection: options.manualSelection ?? false,
  ...(options.freshness ? { freshness: options.freshness } : {}),
  ...(options.transformedFrom ? { transformedFrom: options.transformedFrom } : {}),
  truncated: options.truncated ?? false,
  ...(options.truncationReason ? { truncationReason: options.truncationReason } : {}),
  future: options.future ?? false,
});

export const sourceBlock = (
  bookId: string,
  layer: PromptLayer,
  source: PromptSource,
  target: ContextTarget,
  reason: string,
  forceInclude = false,
  options: BlockOptions = {},
) => block(
  bookId,
  layer,
  'stable',
  source.id,
  source.title,
  source.content,
  forceInclude ? `${reason}（当前模式必需）` : reason,
  forceInclude || (source.includeInPrompt
    && (source.loadedSectionIds === undefined || source.loadedSectionIds.includes(target.sectionId))),
  false,
  {
    ...options,
    source: options.source ?? {
      bookId,
      sourceId: source.id,
      chapterId: target.chapterId,
      chapterIndex: target.chapterIndex,
      sectionId: target.sectionId,
      sectionIndex: target.sectionIndex,
    },
  },
);

export const characterBlock = (
  bookId: string,
  character: Book['characters'][number],
  target: ContextTarget,
  reason: string,
  forceInclude = false,
) => block(
  bookId,
  'character',
  'stable',
  character.id,
  character.name,
  [`角色名：${character.name}`, `角色身份：${character.role}`, character.content].join('\n'),
  forceInclude ? `${reason}（当前模式必需）` : reason,
  forceInclude || (character.includeInPrompt
    && (character.loadedSectionIds === undefined || character.loadedSectionIds.includes(target.sectionId))),
  false,
  {
    semanticRole: 'constraint',
    source: {
      bookId,
      sourceId: character.id,
      chapterId: target.chapterId,
      chapterIndex: target.chapterIndex,
      sectionId: target.sectionId,
      sectionIndex: target.sectionIndex,
    },
  },
);
