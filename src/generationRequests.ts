import type { GenerationRequest, Section } from './types';

export type RegenerateBlockRequestInput = Pick<
  GenerationRequest,
  'bookId' | 'sectionId' | 'providerProfileId' | 'mode' | 'selectedCharacterId' | 'targetBlockId'
>;

export const makeRegenerateBlockRequest = (
  input: RegenerateBlockRequestInput,
): GenerationRequest => ({
  ...input,
  authorNote: undefined,
  instruction: '',
  generationKind: 'regenerate-block',
});

export type WriterDraftState = {
  instruction: string;
  authorNote: string;
};

export type RegenerateBlockOutcome =
  | { status: 'success'; content: string }
  | { status: 'failed' | 'cancelled' };

const sectionBlocksForRegeneration = (section: Section) => section.blocks?.length
  ? section.blocks
  : section.content.trim()
    ? [{ id: `${section.id}-legacy-block`, kind: 'assistant' as const, content: section.content }]
    : [];

export const applyRegenerateBlockOutcome = ({
  section,
  targetBlockId,
  writerDraft,
  outcome,
}: {
  section: Section;
  targetBlockId: string;
  writerDraft: WriterDraftState;
  outcome: RegenerateBlockOutcome;
}) => {
  if (outcome.status !== 'success') return { section, writerDraft: { ...writerDraft } };
  const blocks = sectionBlocksForRegeneration(section).map((block) => block.id === targetBlockId
    ? { ...block, content: outcome.content }
    : block);
  if (!blocks.some((block) => block.id === targetBlockId)) return { section, writerDraft: { ...writerDraft } };
  return {
    section: {
      ...section,
      blocks,
      content: blocks.map((block) => block.content.trim()).filter(Boolean).join('\n\n'),
    },
    writerDraft: { ...writerDraft },
  };
};
