import type { Book, SectionBlock } from '../../types';
import { getAdoptedCandidate } from '../../answerCandidates.ts';

export const sectionBlocks = (section: Book['chapters'][number]['sections'][number]): SectionBlock[] => {
  if (section.blocks?.length) return section.blocks;
  return section.content.trim()
    ? [{ id: `${section.id}-legacy-block`, kind: 'assistant', content: section.content }]
    : [];
};

export const blockAsContent = (block: SectionBlock) => {
  if (block.kind !== 'assistant' || block.candidates === undefined) return block.content;
  return getAdoptedCandidate(block)?.content ?? '';
};

export const blocksAsContent = (blocks: SectionBlock[]) => blocks
  .map((item) => blockAsContent(item).trim())
  .filter(Boolean)
  .join('\n\n');
