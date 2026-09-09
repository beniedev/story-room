export const countWords = (content: string) => content.match(
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu,
)?.length ?? 0;

const cjkPattern = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const latinNumberSpacePattern = /^[\p{Script=Latin}\p{N} ]$/u;

export const estimateTokens = (content: string): number => {
  let tokens = 0;
  let latinRunLength = 0;
  const flushLatinRun = () => {
    if (!latinRunLength) return;
    tokens += Math.ceil(latinRunLength / 4);
    latinRunLength = 0;
  };

  for (const character of content) {
    if (cjkPattern.test(character)) {
      flushLatinRun();
      tokens += 1;
      continue;
    }
    if (latinNumberSpacePattern.test(character)) {
      latinRunLength += 1;
      continue;
    }
    flushLatinRun();
    tokens += 1;
  }
  flushLatinRun();
  return tokens;
};
