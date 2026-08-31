import { describe, expect, it } from 'vitest';
import { parseProseFormatting, stripProseFormatting } from '../src/proseFormatting';

describe('prose formatting', () => {
  it('parses paired single asterisks as emphasis', () => {
    expect(parseProseFormatting('风从 *窗外* 吹来。')).toEqual([
      { text: '风从 ', emphasized: false },
      { text: '窗外', emphasized: true },
      { text: ' 吹来。', emphasized: false },
    ]);
  });

  it('keeps escaped, doubled, incomplete, and whitespace-padded markers literal', () => {
    const source = String.raw`\*星号\* **粗体** * 未闭合* 末尾*`;
    expect(stripProseFormatting(source)).toBe('*星号* **粗体** * 未闭合* 末尾*');
    expect(parseProseFormatting(source).some((segment) => segment.emphasized)).toBe(false);
  });
});
