import type {
  Book,
  Section,
  SectionMemory,
  SectionMemoryDraft,
} from './types';

export const MAX_SECTION_MEMORY_JSON_BYTES = 64_000;
export const MAX_SECTION_MEMORY_TEXT_LENGTH = 4_000;
export const MAX_SECTION_MEMORY_ITEMS = 32;
export const MAX_SECTION_MEMORY_ITEM_LENGTH = 1_000;

const draftFields = [
  'synopsis',
  'beats',
  'continuityFacts',
  'characterStateChanges',
  'foreshadowingCandidates',
] as const;

export type SectionMemoryFreshness = 'fresh' | 'stale' | 'missing';

export const hashSectionContent = (content: string): string => {
  // This is a stable content fingerprint, not encryption or authentication.
  const bytes = new TextEncoder().encode(content);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const assertText = (
  value: unknown,
  label: string,
  maxLength = MAX_SECTION_MEMORY_TEXT_LENGTH,
) => {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${label}必须是 ${maxLength} 字以内的文本。`);
  }
};

function assertTextList(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_SECTION_MEMORY_ITEMS) {
    throw new Error(`${label}必须是最多 ${MAX_SECTION_MEMORY_ITEMS} 项的文本数组。`);
  }
  value.forEach((item) => assertText(item, `${label}元素`, MAX_SECTION_MEMORY_ITEM_LENGTH));
}

function assertDraft(value: unknown): asserts value is SectionMemoryDraft {
  if (!isRecord(value) || Object.keys(value).length !== draftFields.length
    || draftFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error('Section memory draft 字段必须严格匹配 schema。');
  }
  assertText(value.synopsis, 'synopsis');
  assertTextList(value.beats, 'beats');
  assertTextList(value.continuityFacts, 'continuityFacts');
  assertTextList(value.characterStateChanges, 'characterStateChanges');
  assertTextList(value.foreshadowingCandidates, 'foreshadowingCandidates');
}

export const parseSectionMemoryDraft = (input: string): SectionMemoryDraft => {
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > MAX_SECTION_MEMORY_JSON_BYTES) {
    throw new Error(`Section memory draft 必须是 ${MAX_SECTION_MEMORY_JSON_BYTES} bytes 以内的 JSON。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Section memory draft 必须是有效 JSON。');
  }
  assertDraft(parsed);
  return {
    synopsis: parsed.synopsis,
    beats: [...parsed.beats],
    continuityFacts: [...parsed.continuityFacts],
    characterStateChanges: [...parsed.characterStateChanges],
    foreshadowingCandidates: [...parsed.foreshadowingCandidates],
  };
};

export const serializeSectionMemoryDraft = (draft: SectionMemoryDraft): string => {
  assertDraft(draft);
  return JSON.stringify({
    synopsis: draft.synopsis,
    beats: [...draft.beats],
    continuityFacts: [...draft.continuityFacts],
    characterStateChanges: [...draft.characterStateChanges],
    foreshadowingCandidates: [...draft.foreshadowingCandidates],
  });
};

export const syntheticSectionMemoryDraft = (): SectionMemoryDraft => ({
  synopsis: '合成摘要：本节的关键变化仍待作者确认。',
  beats: ['合成节拍：局势出现可追踪变化。'],
  continuityFacts: ['合成连续性事实：仅用于本地演示。'],
  characterStateChanges: ['合成角色状态变化：未写入持久化记忆。'],
  foreshadowingCandidates: ['合成伏笔候选：需要作者后续确认。'],
});

export const createSectionMemory = (
  draft: SectionMemoryDraft,
  content: string,
  provenance: SectionMemory['provenance'] = 'manual',
  updatedAt = new Date().toISOString(),
): SectionMemory => {
  assertDraft(draft);
  if (!['manual', 'model-draft', 'model-confirmed', 'model-edited'].includes(provenance)) {
    throw new Error('Section memory provenance 无效。');
  }
  return {
    ...draft,
    beats: [...draft.beats],
    continuityFacts: [...draft.continuityFacts],
    characterStateChanges: [...draft.characterStateChanges],
    foreshadowingCandidates: [...draft.foreshadowingCandidates],
    sourceContentHash: hashSectionContent(content),
    status: 'fresh',
    provenance,
    updatedAt,
  };
};

export const draftFromSectionMemory = (
  memory: SectionMemory | undefined,
): SectionMemoryDraft | undefined => memory
  ? {
      synopsis: memory.synopsis,
      beats: [...memory.beats],
      continuityFacts: [...memory.continuityFacts],
      characterStateChanges: [...memory.characterStateChanges],
      foreshadowingCandidates: [...memory.foreshadowingCandidates],
    }
  : undefined;

export const commitSectionMemoryDraft = (
  section: Section,
  draft: SectionMemoryDraft,
  provenance: SectionMemory['provenance'],
  updatedAt = new Date().toISOString(),
): Section => {
  if (provenance === 'model-draft') {
    throw new Error('model-draft 只能作为待确认草稿，不能直接保存。');
  }
  const previousMemory = section.memory && section.memory.provenance !== 'model-draft'
    ? section.memory
    : section.previousMemory;
  return {
    ...section,
    memory: createSectionMemory(draft, section.content, provenance, updatedAt),
    ...(previousMemory ? { previousMemory } : {}),
  };
};

export const rollbackSectionMemory = (section: Section): Section => {
  if (!section.previousMemory) return section;
  return {
    ...section,
    memory: section.previousMemory,
    previousMemory: section.memory,
  };
};

export const sectionMemoryFreshness = (
  memory: SectionMemory | undefined,
  content: string,
): SectionMemoryFreshness => {
  if (!memory) return 'missing';
  return memory.status === 'fresh' && memory.sourceContentHash === hashSectionContent(content)
    ? 'fresh'
    : 'stale';
};

export const isEligibleSectionMemory = (
  memory: SectionMemory | undefined,
  content: string,
) => Boolean(memory
  && sectionMemoryFreshness(memory, content) === 'fresh'
  && memory.provenance !== 'model-draft');

const normalizeMemory = (memory: SectionMemory | undefined, content: string) => {
  if (!memory) return undefined;
  const hash = hashSectionContent(content);
  return memory.sourceContentHash === hash
    ? memory
    : { ...memory, status: 'stale' as const };
};

const normalizeSection = (section: Section): Section => {
  const migrated = section.plan === undefined && typeof section.note === 'string' && section.note.length > 0
    ? (() => {
        const { note: _migratedNote, ...withoutNote } = section;
        return { ...withoutNote, plan: { goal: section.note, intendedBeats: [] } };
      })()
    : section;
  return {
    ...migrated,
    ...(migrated.memory ? { memory: normalizeMemory(migrated.memory, migrated.content) } : {}),
    ...(migrated.previousMemory ? { previousMemory: normalizeMemory(migrated.previousMemory, migrated.content) } : {}),
  };
};

export const normalizeBook = (book: Book): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map(normalizeSection),
  })),
});
