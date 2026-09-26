import { adoptCandidate, appendCandidate, finalizeAnswerCandidates } from '../answerCandidates';
import { blocksAsContent, sectionBlocks } from '../components/shared/sectionContent';
import { applyAnswerCandidateOutcome } from '../generationRequests';
import type { AnswerCandidate, Book, GenerationResult, Section, SectionBlock } from '../types';

export const generationSourceFingerprint = (blocks: SectionBlock[], targetIndex: number) => JSON.stringify(
  blocks.slice(0, targetIndex).map((block) => [block.id, block.kind, block.content]),
);

const updateGeneratedSection = (book: Book, sectionId: string, recipe: (section: Section) => Section): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map((section) => section.id === sectionId ? recipe(section) : section),
  })),
});

export const appendGeneratedBlocks = (book: Book, sectionId: string, additions: SectionBlock[]) => (
  updateGeneratedSection(book, sectionId, (section) => {
    const blocks = [...sectionBlocks(section), ...additions];
    return { ...section, blocks, content: blocksAsContent(blocks) };
  })
);

export const applyGeneratedResponse = (book: Book, sectionId: string, blockId: string, result: GenerationResult) => (
  updateGeneratedSection(book, sectionId, (section) => applyAnswerCandidateOutcome({
    section,
    targetBlockId: blockId,
    writerDraft: { instruction: '', authorNote: '' },
    outcome: { status: 'success', content: result.draft, sourceSignature: result.sourceSignature },
  }).section)
);

export const applyRegeneratedCandidate = (book: Book, sectionId: string, blockId: string, candidate: AnswerCandidate) => (
  updateGeneratedSection(book, sectionId, (section) => {
    const blocks = sectionBlocks(section).map((block) => block.id === blockId
      ? adoptCandidate(appendCandidate(block, candidate), candidate.id)
      : block);
    if (!blocks.some((block) => block.id === blockId)) return section;
    return { ...section, blocks, content: blocksAsContent(blocks) };
  })
);

export const previousAnswerWithCandidates = (book: Book, sectionId: string, blockId: string): string | undefined => {
  const section = book.chapters.flatMap((chapter) => chapter.sections).find((item) => item.id === sectionId);
  const blocks = section ? sectionBlocks(section) : [];
  const targetIndex = blocks.findIndex((item) => item.id === blockId);
  if (targetIndex < 0) return undefined;
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index];
    if (candidate?.kind === 'assistant') {
      if (candidate.candidates && candidate.candidates.length > 1 && candidate.adoptedCandidateId) return candidate.id;
      break;
    }
  }
  return undefined;
};

export const finalizePreviousAnswer = (book: Book, sectionId: string, previousAnswerId: string) => (
  updateGeneratedSection(book, sectionId, (section) => {
    const blocks = sectionBlocks(section).map((candidate) => candidate.id === previousAnswerId
      ? finalizeAnswerCandidates(candidate)
      : candidate);
    return { ...section, blocks, content: blocksAsContent(blocks) };
  })
);
