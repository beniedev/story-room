import { makeId } from './components/shared/id';
import { adoptCandidate, appendCandidate, editCandidate } from './answerCandidates';
import { blocksAsContent, sectionBlocks } from './components/shared/sectionContent';
import type { GenerationRequest, Section, SectionBlock } from './types';

export type RegenerateBlockRequestInput = Pick<
  GenerationRequest,
  'bookId' | 'sectionId' | 'providerProfileId' | 'mode' | 'selectedCharacterId' | 'targetBlockId'
> & { targetBlockId: string };

export const makeRegenerateBlockRequest = (
  input: RegenerateBlockRequestInput,
): GenerationRequest => ({
  ...input,
  authorNote: undefined,
  instruction: '',
  generationKind: 'regenerate-block',
});

export type RespondToInputRequestInput = RegenerateBlockRequestInput;

export const makeRespondToInputRequest = (
  input: RespondToInputRequestInput,
): GenerationRequest => ({
  ...input,
  authorNote: undefined,
  instruction: '',
  generationKind: 'respond-to-input',
});

/** Select the request contract from the logical target block kind. */
export const makeAnswerCandidateRequest = (
  input: RegenerateBlockRequestInput,
  targetKind: SectionBlock['kind'],
): GenerationRequest => targetKind === 'user'
  ? makeRespondToInputRequest(input)
  : makeRegenerateBlockRequest(input);

export type WriterDraftState = {
  instruction: string;
  authorNote: string;
};

export type RegenerateBlockOutcome =
  | { status: 'success'; content: string }
  | { status: 'failed' | 'cancelled' };

export type AnswerCandidateOutcome =
  | { status: 'success'; content: string; sourceSignature?: string; candidateId?: string }
  | { status: 'failed' | 'cancelled' };

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
  const blocks = sectionBlocks(section).map((block) => {
    if (block.id !== targetBlockId) return block;
    if (block.kind !== 'assistant' || block.candidates === undefined) {
      return { ...block, content: outcome.content };
    }
    const adoptedId = block.adoptedCandidateId ?? block.candidates[0]?.id;
    if (!adoptedId) return block;
    return editCandidate(adoptCandidate(block, adoptedId), adoptedId, outcome.content);
  });
  if (!blocks.some((block) => block.id === targetBlockId)) return { section, writerDraft: { ...writerDraft } };
  return {
    section: {
      ...section,
      blocks,
      content: blocksAsContent(blocks),
    },
    writerDraft: { ...writerDraft },
  };
};

/**
 * Apply a new answer without flattening candidates into the manuscript.
 * Assistant targets receive a sibling candidate; user targets receive a new
 * assistant block immediately after the user input.
 */
export const applyAnswerCandidateOutcome = ({
  section,
  targetBlockId,
  writerDraft,
  outcome,
}: {
  section: Section;
  targetBlockId: string;
  writerDraft: WriterDraftState;
  outcome: AnswerCandidateOutcome;
}) => {
  if (outcome.status !== 'success') return { section, writerDraft: { ...writerDraft } };
  const blocks = sectionBlocks(section);
  const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
  if (targetIndex < 0) return { section, writerDraft: { ...writerDraft } };
  const candidate = {
    id: outcome.candidateId ?? makeId('candidate'),
    content: outcome.content,
    ...(outcome.sourceSignature !== undefined ? { sourceSignature: outcome.sourceSignature } : {}),
  };
  let nextBlocks: SectionBlock[];
  const target = blocks[targetIndex];
  if (target.kind === 'assistant') {
    nextBlocks = blocks.map((block, index) => index === targetIndex
      ? adoptCandidate(appendCandidate(block, candidate), candidate.id)
      : block);
  } else {
    const answerBlock = appendCandidate({
      id: makeId('block'),
      kind: 'assistant',
      content: '',
    }, candidate);
    nextBlocks = [...blocks.slice(0, targetIndex + 1), answerBlock, ...blocks.slice(targetIndex + 1)];
  }
  return {
    section: {
      ...section,
      blocks: nextBlocks,
      content: blocksAsContent(nextBlocks),
    },
    writerDraft: { ...writerDraft },
  };
};
