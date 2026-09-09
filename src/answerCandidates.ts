import type { AnswerCandidate, SectionBlock } from './types';

const legacyCandidateId = (blockId: string) => `${blockId}-legacy-candidate`;

const assertAssistantBlock = (block: SectionBlock) => {
  if (block.kind !== 'assistant') throw new Error('只有 assistant block 可以保存回答候选。');
};

const cloneCandidate = (candidate: AnswerCandidate): AnswerCandidate => ({
  id: candidate.id,
  content: candidate.content,
  ...(candidate.sourceSignature !== undefined ? { sourceSignature: candidate.sourceSignature } : {}),
});

/**
 * Return persisted candidates, or a synthetic read-only candidate for a legacy
 * assistant block. The synthetic candidate is never written unless a caller
 * materializes it before appending a new answer.
 */
export const getAnswerCandidates = (block: SectionBlock): AnswerCandidate[] => {
  if (block.kind !== 'assistant') return [];
  if (block.candidates?.length) return block.candidates.map(cloneCandidate);
  return block.content.trim()
    ? [{ id: legacyCandidateId(block.id), content: block.content }]
    : [];
};

export const getAdoptedCandidate = (block: SectionBlock): AnswerCandidate | undefined => {
  if (block.kind !== 'assistant') return undefined;
  if (block.candidates?.length) {
    const adopted = block.candidates.find((candidate) => candidate.id === block.adoptedCandidateId);
    return adopted ? cloneCandidate(adopted) : undefined;
  }
  return block.content.trim()
    ? { id: legacyCandidateId(block.id), content: block.content }
    : undefined;
};

/**
 * Materialize the current legacy answer as the first adopted candidate. This
 * is intentionally lazy so opening old books does not rewrite their data.
 */
export const materializeCandidate = (
  block: SectionBlock,
  candidateId = legacyCandidateId(block.id),
): SectionBlock => {
  assertAssistantBlock(block);
  if (block.candidates?.length) return { ...block, candidates: block.candidates.map(cloneCandidate) };
  if (!block.content.trim()) return { ...block, candidates: [] };
  return {
    ...block,
    candidates: [{ id: candidateId, content: block.content }],
    adoptedCandidateId: candidateId,
  };
};

/**
 * Add a candidate while preserving the currently adopted answer. An empty
 * assistant block adopts its first candidate so the first successful answer
 * keeps the existing linear-writing behavior.
 */
export const appendCandidate = (
  block: SectionBlock,
  candidate: AnswerCandidate,
): SectionBlock => {
  assertAssistantBlock(block);
  const materialized = materializeCandidate(block);
  const candidates = materialized.candidates ?? [];
  if (candidates.some((item) => item.id === candidate.id)) {
    throw new Error(`回答候选 ID 重复：${candidate.id}`);
  }
  const nextCandidate = cloneCandidate(candidate);
  const nextCandidates = [...candidates, nextCandidate];
  if (materialized.adoptedCandidateId || candidates.length > 0) {
    return { ...materialized, candidates: nextCandidates };
  }
  return {
    ...materialized,
    content: nextCandidate.content,
    candidates: nextCandidates,
    adoptedCandidateId: nextCandidate.id,
  };
};

export const adoptCandidate = (block: SectionBlock, candidateId: string): SectionBlock => {
  assertAssistantBlock(block);
  const candidates = block.candidates ?? getAnswerCandidates(block);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`找不到回答候选：${candidateId}`);
  return {
    ...block,
    content: candidate.content,
    candidates: candidates.map(cloneCandidate),
    adoptedCandidateId: candidate.id,
  };
};

export const editCandidate = (
  block: SectionBlock,
  candidateId: string,
  content: string,
): SectionBlock => {
  assertAssistantBlock(block);
  const candidates = block.candidates ?? getAnswerCandidates(block);
  if (!candidates.some((candidate) => candidate.id === candidateId)) {
    throw new Error(`找不到回答候选：${candidateId}`);
  }
  const nextCandidates = candidates.map((candidate) => candidate.id === candidateId
    ? { ...candidate, content }
    : cloneCandidate(candidate));
  const wasAdopted = block.adoptedCandidateId === candidateId
    || (block.candidates === undefined && candidateId === legacyCandidateId(block.id));
  return {
    ...block,
    content: wasAdopted ? content : block.content,
    candidates: nextCandidates,
    ...(wasAdopted ? { adoptedCandidateId: candidateId } : {}),
  };
};

/**
 * Delete only one candidate. Deleting the adopted candidate deliberately
 * leaves the answer block without an adopted answer; another version must be
 * explicitly chosen instead of being silently promoted.
 */
export const deleteCandidate = (block: SectionBlock, candidateId: string): SectionBlock => {
  assertAssistantBlock(block);
  const candidates = block.candidates ?? getAnswerCandidates(block);
  if (!candidates.some((candidate) => candidate.id === candidateId)) {
    throw new Error(`找不到回答候选：${candidateId}`);
  }
  const nextCandidates = candidates.filter((candidate) => candidate.id !== candidateId).map(cloneCandidate);
  const deletedAdopted = block.adoptedCandidateId === candidateId
    || (block.candidates === undefined && candidateId === legacyCandidateId(block.id));
  return {
    ...block,
    content: deletedAdopted ? '' : block.content,
    candidates: nextCandidates,
    ...(deletedAdopted ? { adoptedCandidateId: undefined } : {}),
  };
};

/**
 * Keep only the answer that is currently visible/adopted.
 *
 * Legacy assistant blocks have no persisted candidate set, and blocks whose
 * adopted id no longer resolves to a candidate are ambiguous.  Both cases
 * are left untouched so a caller can safely use this when a later answer has
 * been saved successfully without deleting content it cannot identify.
 */
export const finalizeAnswerCandidates = (block: SectionBlock): SectionBlock => {
  if (block.kind !== 'assistant' || !block.candidates?.length || !block.adoptedCandidateId) {
    return block;
  }
  const adopted = block.candidates.find((candidate) => candidate.id === block.adoptedCandidateId);
  if (!adopted) return block;
  return {
    ...block,
    content: adopted.content,
    candidates: [cloneCandidate(adopted)],
    adoptedCandidateId: adopted.id,
  };
};
