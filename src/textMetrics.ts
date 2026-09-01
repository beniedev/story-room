export const countWords = (content: string) => content.match(
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu,
)?.length ?? 0;

const cjkPattern = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const latinNumberSpacePattern = /^[\p{Script=Latin}\p{N} ]$/u;

export const estimateTokens = (content: string): number => {
  const characters = Array.from(content);
  let tokens = 0;
  let latinRun = '';
  const flushLatinRun = () => {
    if (!latinRun) return;
    tokens += Math.max(1, Math.ceil(Array.from(latinRun).length / 4));
    latinRun = '';
  };

  characters.forEach((character) => {
    if (cjkPattern.test(character)) {
      flushLatinRun();
      tokens += 1;
      return;
    }
    if (latinNumberSpacePattern.test(character)) {
      latinRun += character;
      return;
    }
    flushLatinRun();
    tokens += 1;
  });
  flushLatinRun();
  return tokens;
};
