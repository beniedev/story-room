import { describe, expect, it } from 'vitest';
import {
  adoptCandidate,
  appendCandidate,
  deleteCandidate,
  editCandidate,
  finalizeAnswerCandidates,
  getAnswerCandidates,
  materializeCandidate,
} from '../src/answerCandidates';
import { blocksAsContent } from '../src/components/shared/sectionContent';

describe('answer candidate helpers', () => {
  it('lazily reads legacy assistant content and materializes it only when asked', () => {
    const legacy = { id: 'answer', kind: 'assistant' as const, content: '旧答案' };
    expect(getAnswerCandidates(legacy)).toEqual([
      { id: 'answer-legacy-candidate', content: '旧答案' },
    ]);
    expect(legacy).not.toHaveProperty('candidates');
    expect(materializeCandidate(legacy)).toEqual({
      ...legacy,
      candidates: [{ id: 'answer-legacy-candidate', content: '旧答案' }],
      adoptedCandidateId: 'answer-legacy-candidate',
    });
  });

  it('keeps the adopted answer in content while appending a preview candidate', () => {
    const block = appendCandidate(
      { id: 'answer', kind: 'assistant', content: '旧答案' },
      { id: 'candidate-2', content: '新答案', sourceSignature: '0123456789abcdef' },
    );
    expect(block.content).toBe('旧答案');
    expect(block.adoptedCandidateId).toBe('answer-legacy-candidate');
    expect(block.candidates?.map((candidate) => candidate.content)).toEqual(['旧答案', '新答案']);
    expect(blocksAsContent([block])).toBe('旧答案');
  });

  it('adopts, edits, and deletes without silently promoting another candidate', () => {
    const block = appendCandidate(
      appendCandidate({ id: 'answer', kind: 'assistant', content: '' }, { id: 'candidate-1', content: '一版' }),
      { id: 'candidate-2', content: '二版' },
    );
    const adopted = adoptCandidate(block, 'candidate-2');
    expect(adopted.content).toBe('二版');
    const edited = editCandidate(adopted, 'candidate-1', '改过的一版');
    expect(edited.content).toBe('二版');
    const deleted = deleteCandidate(edited, 'candidate-2');
    expect(deleted.content).toBe('');
    expect(deleted.adoptedCandidateId).toBeUndefined();
    expect(deleted.candidates).toEqual([{ id: 'candidate-1', content: '改过的一版' }]);
    expect(blocksAsContent([deleted])).toBe('');
  });

  it('finalizes only the valid adopted answer and preserves its identity metadata', () => {
    const block = {
      id: 'answer',
      kind: 'assistant' as const,
      content: '二版',
      candidates: [
        { id: 'candidate-1', content: '一版', sourceSignature: 'sig-1' },
        { id: 'candidate-2', content: '二版', sourceSignature: 'sig-2' },
      ],
      adoptedCandidateId: 'candidate-2',
    };
    expect(finalizeAnswerCandidates(block)).toEqual({
      ...block,
      candidates: [{ id: 'candidate-2', content: '二版', sourceSignature: 'sig-2' }],
    });
  });

  it('leaves legacy, user, and unresolved adopted blocks untouched', () => {
    const legacy = { id: 'legacy', kind: 'assistant' as const, content: '旧正文' };
    const user = {
      id: 'input',
      kind: 'user' as const,
      content: '用户输入',
      candidates: [{ id: 'candidate', content: '不应被处理' }],
      adoptedCandidateId: 'candidate',
    };
    const unresolved = {
      id: 'unresolved',
      kind: 'assistant' as const,
      content: '正文',
      candidates: [{ id: 'candidate', content: '候选' }],
      adoptedCandidateId: 'missing',
    };
    expect(finalizeAnswerCandidates(legacy)).toBe(legacy);
    expect(finalizeAnswerCandidates(user)).toBe(user);
    expect(finalizeAnswerCandidates(unresolved)).toBe(unresolved);
  });
});
