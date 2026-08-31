export const countWords = (content: string) => content.match(
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu,
)?.length ?? 0;

export const estimateTokens = (content: string) => Math.ceil(Array.from(content).length / 3);
