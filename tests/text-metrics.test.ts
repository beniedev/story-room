import { describe, expect, it } from 'vitest';
import { countWords, estimateTokens } from '../src/textMetrics';

describe('writing text metrics', () => {
  it('counts Han characters and continuous Latin text as writing words', () => {
    expect(countWords('月光落下。')).toBe(4);
    expect(countWords('AI 写作 2026')).toBe(4);
    expect(countWords('  ……  ')).toBe(0);
  });

  it('shares the prompt token estimate used by the writing UI', () => {
    expect(estimateTokens('一二三四')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});
