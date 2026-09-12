import { normalizeBook } from './sectionMemory';
import type {
  AnswerCandidate,
  Book,
  CharacterCard,
  Section,
  SectionBlock,
  SectionContextReference,
  SectionMemory,
  Summary,
  WorldRule,
} from './types';

const idPattern = /^[a-z0-9][a-z0-9-]*$/i;
const hashPattern = /^[0-9a-f]{16}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}必须是对象。`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本。`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (!value.trim()) throw new Error(`${label}不能为空。`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值。`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  assertArray(value, label);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
}

function assertUniqueStrings(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label}不得重复。`);
}

function assertUniqueIds(items: Array<{ id: string }>, label: string) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ID 不得重复。`);
  return new Set(ids);
}

const optionalString = (value: unknown, label: string) => {
  if (value !== undefined) assertString(value, label);
};

const assertId = (value: Record<string, unknown>, label: string) => {
  assertNonEmptyString(value.id, `${label}.id`);
  if (!idPattern.test(value.id)) throw new Error(`${label}.id 格式无效。`);
};

function assertIdValue(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!idPattern.test(value)) throw new Error(`${label}格式无效。`);
}

const assertTimestamp = (value: unknown, label: string) => {
  assertNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label}不是有效时间。`);
};

const assertHash = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new Error(`${label}格式无效。`);
};

function assertPromptSource(value: unknown, label: string): void {
  assertRecord(value, label);
  assertId(value, label);
  assertString(value.title, `${label}.title`);
  assertString(value.content, `${label}.content`);
  assertBoolean(value.includeInPrompt, `${label}.includeInPrompt`);
  if (value.loadedSectionIds !== undefined) {
    assertStringArray(value.loadedSectionIds, `${label}.loadedSectionIds`);
    value.loadedSectionIds.forEach((sectionId, index) => assertIdValue(
      sectionId,
      `${label}.loadedSectionIds[${index}]`,
    ));
    assertUniqueStrings(value.loadedSectionIds, `${label}.loadedSectionIds`);
  }
}

function assertCharacter(value: unknown, label: string): asserts value is CharacterCard {
  assertRecord(value, label);
  assertPromptSource(value, label);
  assertString(value.name, `${label}.name`);
  assertString(value.role, `${label}.role`);
  optionalString(value.title, `${label}.title`);
}

function assertSummary(value: unknown, label: string): asserts value is Summary {
  assertRecord(value, label);
  assertPromptSource(value, label);
  assertStringArray(value.sourceSectionIds, `${label}.sourceSectionIds`);
  value.sourceSectionIds.forEach((sectionId, index) => assertIdValue(
    sectionId,
    `${label}.sourceSectionIds[${index}]`,
  ));
  assertUniqueStrings(value.sourceSectionIds, `${label}.sourceSectionIds`);
}

function assertCandidate(value: unknown, label: string): asserts value is AnswerCandidate {
  assertRecord(value, label);
  assertId(value, label);
  assertString(value.content, `${label}.content`);
  if (value.sourceSignature !== undefined) assertHash(value.sourceSignature, `${label}.sourceSignature`);
}

function assertBlock(value: unknown, label: string): asserts value is SectionBlock {
  assertRecord(value, label);
  assertId(value, label);
  if (value.kind !== 'user' && value.kind !== 'assistant') throw new Error(`${label}.kind 无效。`);
  assertString(value.content, `${label}.content`);

  if (value.candidates !== undefined || value.adoptedCandidateId !== undefined) {
    if (value.kind !== 'assistant') throw new Error('只有 assistant block 可以保存回答候选。');
    assertArray(value.candidates, `${label}.candidates`);
    value.candidates.forEach((candidate, index) => assertCandidate(candidate, `${label}.candidates[${index}]`));
    const candidates = value.candidates as AnswerCandidate[];
    assertUniqueIds(candidates, `${label}.candidates`);
    if (value.adoptedCandidateId !== undefined) {
      assertIdValue(value.adoptedCandidateId, `${label}.adoptedCandidateId`);
      const adopted = candidates.find((candidate) => candidate.id === value.adoptedCandidateId);
      if (!adopted) throw new Error(`${label}.adoptedCandidateId 没有对应候选。`);
      if (value.content !== adopted.content) throw new Error(`${label}.content 必须镜像 adopted candidate。`);
    } else if (value.content.trim()) {
      throw new Error(`${label} 有回答候选但没有 adopted candidate 时，正文必须为空。`);
    }
  }
}

function assertMemory(value: unknown, label: string): asserts value is SectionMemory {
  assertRecord(value, label);
  const fields = [
    'synopsis',
    'beats',
    'continuityFacts',
    'characterStateChanges',
    'foreshadowingCandidates',
    'sourceContentHash',
    'status',
    'provenance',
    'updatedAt',
  ];
  if (Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error(`${label}字段不完整或包含未知字段。`);
  }
  assertString(value.synopsis, `${label}.synopsis`);
  assertStringArray(value.beats, `${label}.beats`);
  assertStringArray(value.continuityFacts, `${label}.continuityFacts`);
  assertStringArray(value.characterStateChanges, `${label}.characterStateChanges`);
  assertStringArray(value.foreshadowingCandidates, `${label}.foreshadowingCandidates`);
  assertHash(value.sourceContentHash, `${label}.sourceContentHash`);
  if (value.status !== 'fresh' && value.status !== 'stale') throw new Error(`${label}.status 无效。`);
  if (!['manual', 'model-draft', 'model-confirmed', 'model-edited'].includes(String(value.provenance))) {
    throw new Error(`${label}.provenance 无效。`);
  }
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
}

function assertReference(value: unknown, label: string): asserts value is SectionContextReference {
  assertRecord(value, label);
  assertIdValue(value.sectionId, `${label}.sectionId`);
  if (!['summary', 'full', 'both'].includes(String(value.mode))) throw new Error(`${label}.mode 无效。`);
  if (!['manual', 'previous-section', 'chapter-preset'].includes(String(value.reason))) {
    throw new Error(`${label}.reason 无效。`);
  }
}

function assertSection(value: unknown, label: string): asserts value is Section {
  assertRecord(value, label);
  assertId(value, label);
  assertString(value.title, `${label}.title`);
  const sectionContent = (() => {
    assertString(value.content, `${label}.content`);
    return value.content;
  })();
  optionalString(value.note, `${label}.note`);

  if (value.blocks !== undefined) {
    assertArray(value.blocks, `${label}.blocks`);
    value.blocks.forEach((block, index) => assertBlock(block, `${label}.blocks[${index}]`));
    const blocks = value.blocks as SectionBlock[];
    assertUniqueIds(blocks, `${label}.blocks`);
    const activeContent = blocks.map((block) => {
      if (block.kind !== 'assistant' || block.candidates === undefined) return block.content;
      if (!block.adoptedCandidateId) return '';
      return block.candidates.find((candidate) => candidate.id === block.adoptedCandidateId)?.content ?? '';
    }).map((content) => content.trim()).filter(Boolean).join('\n\n');
    if (sectionContent !== activeContent) throw new Error(`${label}.content 与 blocks 正文镜像不一致。`);
  }
  if (value.contextReferences !== undefined) {
    assertArray(value.contextReferences, `${label}.contextReferences`);
    value.contextReferences.forEach((reference, index) => assertReference(
      reference,
      `${label}.contextReferences[${index}]`,
    ));
    assertUniqueStrings(
      (value.contextReferences as SectionContextReference[]).map((reference) => reference.sectionId),
      `${label}.contextReferences`,
    );
  }
  if (value.plan !== undefined) {
    assertRecord(value.plan, `${label}.plan`);
    assertString(value.plan.goal, `${label}.plan.goal`);
    assertStringArray(value.plan.intendedBeats, `${label}.plan.intendedBeats`);
    if (value.plan.povCharacterId !== undefined) {
      assertIdValue(value.plan.povCharacterId, `${label}.plan.povCharacterId`);
    }
  }
  if (value.memory !== undefined) assertMemory(value.memory, `${label}.memory`);
  if (value.previousMemory !== undefined) assertMemory(value.previousMemory, `${label}.previousMemory`);
}

function assertBookShape(value: unknown): asserts value is Book {
  assertRecord(value, '备份');
  assertId(value, '备份');
  assertString(value.title, '备份.title');
  optionalString(value.plotOutline, '备份.plotOutline');
  assertString(value.writingBrief, '备份.writingBrief');
  assertTimestamp(value.updatedAt, '备份.updatedAt');

  assertArray(value.characters, '备份.characters');
  value.characters.forEach((character, index) => assertCharacter(character, `备份.characters[${index}]`));
  assertArray(value.worldRules, '备份.worldRules');
  value.worldRules.forEach((rule, index) => assertPromptSource(rule, `备份.worldRules[${index}]`));
  assertArray(value.canonFacts, '备份.canonFacts');
  value.canonFacts.forEach((fact, index) => assertPromptSource(fact, `备份.canonFacts[${index}]`));
  assertArray(value.summaries, '备份.summaries');
  value.summaries.forEach((summary, index) => assertSummary(summary, `备份.summaries[${index}]`));
  assertArray(value.chapters, '备份.chapters');
  value.chapters.forEach((chapter, chapterIndex) => {
    assertRecord(chapter, `备份.chapters[${chapterIndex}]`);
    assertId(chapter, `备份.chapters[${chapterIndex}]`);
    assertString(chapter.title, `备份.chapters[${chapterIndex}].title`);
    assertArray(chapter.sections, `备份.chapters[${chapterIndex}].sections`);
    chapter.sections.forEach((section, sectionIndex) => assertSection(
      section,
      `备份.chapters[${chapterIndex}].sections[${sectionIndex}]`,
    ));
  });
  assertArray(value.branches, '备份.branches');
  value.branches.forEach((branch, index) => {
    assertRecord(branch, `备份.branches[${index}]`);
    assertId(branch, `备份.branches[${index}]`);
    assertString(branch.title, `备份.branches[${index}].title`);
    assertIdValue(branch.fromSectionId, `备份.branches[${index}].fromSectionId`);
  });

  const characters = value.characters as CharacterCard[];
  const worldRules = value.worldRules as WorldRule[];
  const canonFacts = value.canonFacts as WorldRule[];
  const summaries = value.summaries as Summary[];
  const chapters = value.chapters as Book['chapters'];
  const branches = value.branches as Book['branches'];
  assertUniqueIds(characters, '备份.characters');
  assertUniqueIds(worldRules, '备份.worldRules');
  assertUniqueIds(canonFacts, '备份.canonFacts');
  assertUniqueIds(summaries, '备份.summaries');
  assertUniqueIds(chapters, '备份.chapters');
  assertUniqueIds(branches, '备份.branches');

  const characterIds = new Set(characters.map((character) => character.id));
  const sectionOrdinals = new Map<string, number>();
  let ordinal = 0;
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (sectionOrdinals.has(section.id)) throw new Error('Section ID 必须在整本 Book 内唯一。');
      sectionOrdinals.set(section.id, ordinal);
      ordinal += 1;
    }
  }
  const assertExistingSection = (sectionId: string, label: string) => {
    if (!sectionOrdinals.has(sectionId)) throw new Error(`${label}必须指向当前 Book 内存在的 Section。`);
  };

  for (const source of [...characters, ...worldRules, ...canonFacts, ...summaries]) {
    for (const sectionId of source.loadedSectionIds ?? []) assertExistingSection(sectionId, '资料加载范围');
  }
  for (const summary of summaries) {
    for (const sectionId of summary.sourceSectionIds) assertExistingSection(sectionId, 'Summary 来源');
  }
  for (const branch of branches) assertExistingSection(branch.fromSectionId, 'Branch 来源');
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      for (const reference of section.contextReferences ?? []) {
        const sourceOrdinal = sectionOrdinals.get(reference.sectionId);
        if (sourceOrdinal === undefined) throw new Error('Section 前文参考必须指向当前 Book 内存在的 Section。');
        if (reference.sectionId === section.id) throw new Error('Section 前文参考不能指向自身。');
      }
      if (section.plan?.povCharacterId && !characterIds.has(section.plan.povCharacterId)) {
        throw new Error('Section 计划 POV 角色必须存在于当前 Book。');
      }
    }
  }
}

/** Parse and validate the lossless JSON Book backup before it reaches storage. */
export const parseBookBackup = (input: string): Book => {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请选择非空的 JSON 备份文件。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('备份文件不是有效 JSON。');
  }
  assertBookShape(parsed);
  return normalizeBook(JSON.parse(JSON.stringify(parsed)) as Book);
};
