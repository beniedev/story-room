export interface ProseSegment {
  text: string;
  emphasized: boolean;
}

const emphasisPattern = /(?<![\\*])\*(?!\*)(\S(?:[^*\n]*?\S)?)(?<!\\)\*(?!\*)/gu;
const unescapeStars = (value: string) => value.replace(/\\\*/g, '*');

export const parseProseFormatting = (value: string): ProseSegment[] => {
  const segments: ProseSegment[] = [];
  let offset = 0;

  for (const match of value.matchAll(emphasisPattern)) {
    const index = match.index;
    if (index > offset) {
      segments.push({ text: unescapeStars(value.slice(offset, index)), emphasized: false });
    }
    segments.push({ text: unescapeStars(match[1]), emphasized: true });
    offset = index + match[0].length;
  }

  if (offset < value.length || segments.length === 0) {
    segments.push({ text: unescapeStars(value.slice(offset)), emphasized: false });
  }
  return segments;
};

export const stripProseFormatting = (value: string) => parseProseFormatting(value)
  .map((segment) => segment.text)
  .join('');
