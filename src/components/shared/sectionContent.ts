import type { Book, SectionBlock } from '../../types';

export const sectionBlocks = (section: Book['chapters'][number]['sections'][number]): SectionBlock[] => {
  if (section.blocks?.length) return section.blocks;
  return section.content.trim()
    ? [{ id: `${section.id}-legacy-block`, kind: 'assistant', content: section.content }]
    : [];
};

export const blocksAsContent = (blocks: SectionBlock[]) => blocks
  .map((item) => item.content.trim())
  .filter(Boolean)
  .join('\n\n');
