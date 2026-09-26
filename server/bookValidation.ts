import type { Book } from '../src/types.ts';
import { StoreDataError, StoreInputError } from './storeErrors.ts';

export const idPattern = /^[a-z0-9][a-z0-9-]*$/i;

export const validId = (id: string) => {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new StoreInputError('无效的 Book 或资料 ID。');
  return id;
};

export const storedId = (id: unknown) => {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new StoreDataError();
  return id;
};

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new StoreInputError(`${label}必须是文本。`);
  return value;
};

const requiredBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new StoreInputError(`${label}必须是布尔值。`);
  return value;
};

const requiredArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new StoreInputError(`${label}必须是数组。`);
  return value;
};

const validateMemoryText = (value: unknown, label: string) => {
  if (typeof value !== 'string') {
    throw new StoreInputError(`${label}必须是文本。`);
  }
};

const validateMemoryTextList = (value: unknown, label: string) => {
  const items = requiredArray(value, label);
  for (const item of items) validateMemoryText(item, `${label}元素`);
};

const validateSectionPlan = (value: unknown) => {
  if (!isRecord(value)) throw new StoreInputError('Section 计划数据无效。');
  requiredString(value.goal, 'Section 计划目标');
  for (const beat of requiredArray(value.intendedBeats, 'Section 计划节拍')) {
    requiredString(beat, 'Section 计划节拍元素');
  }
  if (value.povCharacterId !== undefined) validId(requiredString(value.povCharacterId, 'Section 计划 POV 角色 ID'));
};

const validateSectionMemory = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new StoreInputError(`${label}数据无效。`);
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
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new StoreInputError(`${label}字段不完整或包含未知字段。`);
  }
  validateMemoryText(value.synopsis, `${label} synopsis`);
  validateMemoryTextList(value.beats, `${label} beats`);
  validateMemoryTextList(value.continuityFacts, `${label} continuityFacts`);
  validateMemoryTextList(value.characterStateChanges, `${label} characterStateChanges`);
  validateMemoryTextList(value.foreshadowingCandidates, `${label} foreshadowingCandidates`);
  if (typeof value.sourceContentHash !== 'string' || !/^[0-9a-f]{16}$/.test(value.sourceContentHash)) {
    throw new StoreInputError(`${label} sourceContentHash 无效。`);
  }
  if (value.status !== 'fresh' && value.status !== 'stale') {
    throw new StoreInputError(`${label} freshness 状态无效。`);
  }
  if (value.provenance !== 'manual' && value.provenance !== 'model-draft'
    && value.provenance !== 'model-confirmed' && value.provenance !== 'model-edited') {
    throw new StoreInputError(`${label} provenance 无效。`);
  }
  validateMemoryText(value.updatedAt, `${label} updatedAt`);
};

const validateSource = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new StoreInputError(`${label}数据无效。`);
  validId(requiredString(value.id, `${label} ID`));
  requiredString(value.title, `${label}标题`);
  requiredString(value.content, `${label}正文`);
  requiredBoolean(value.includeInPrompt, `${label}启用状态`);
  if (value.loadedSectionIds !== undefined) {
    for (const sectionId of requiredArray(value.loadedSectionIds, `${label}加载范围`)) {
      validId(requiredString(sectionId, `${label}加载范围 Section ID`));
    }
  }
};

const validateSection = (value: unknown) => {
  if (!isRecord(value)) throw new StoreInputError('Section 数据无效。');
  validId(requiredString(value.id, 'Section ID'));
  requiredString(value.title, 'Section 标题');
  const sectionContent = requiredString(value.content, 'Section 正文');
  if (value.note !== undefined) requiredString(value.note, 'Section 注释');
  if (value.blocks !== undefined) {
    const blockIds = new Set<string>();
    const activeContents: string[] = [];
    let hasCandidateMetadata = false;
    for (const block of requiredArray(value.blocks, 'Section blocks')) {
      if (!isRecord(block)) throw new StoreInputError('Section block 数据无效。');
      const blockId = validId(requiredString(block.id, 'Section block ID'));
      if (blockIds.has(blockId)) throw new StoreInputError('同一 Section 的 block ID 不得重复。');
      blockIds.add(blockId);
      if (block.kind !== 'user' && block.kind !== 'assistant') {
        throw new StoreInputError('Section block kind 无效。');
      }
      const blockContent = requiredString(block.content, 'Section block 正文');
      if (block.candidates !== undefined || block.adoptedCandidateId !== undefined) {
        hasCandidateMetadata = true;
        if (block.kind !== 'assistant') throw new StoreInputError('只有 assistant block 可以保存回答候选。');
        const candidates = requiredArray(block.candidates, 'Section block candidates');
        const candidateIds = new Set<string>();
        const candidateRecords: Array<Record<string, unknown>> = [];
        for (const candidate of candidates) {
          if (!isRecord(candidate)) throw new StoreInputError('Section block candidate 数据无效。');
          candidateRecords.push(candidate);
          const candidateId = validId(requiredString(candidate.id, 'Section block candidate ID'));
          if (candidateIds.has(candidateId)) throw new StoreInputError('同一 assistant block 的 candidate ID 不得重复。');
          candidateIds.add(candidateId);
          requiredString(candidate.content, 'Section block candidate 正文');
          if (candidate.sourceSignature !== undefined
            && (typeof candidate.sourceSignature !== 'string' || !/^[0-9a-f]{16}$/.test(candidate.sourceSignature))) {
            throw new StoreInputError('Section block candidate sourceSignature 无效。');
          }
        }
        if (block.adoptedCandidateId !== undefined) {
          const adoptedId = validId(requiredString(block.adoptedCandidateId, 'Section adopted candidate ID'));
          if (!candidateIds.has(adoptedId)) throw new StoreInputError('Section adopted candidate 不属于当前 block。');
          const adopted = candidateRecords.find((candidate) => candidate.id === adoptedId);
          if (!adopted || blockContent !== adopted.content) {
            throw new StoreInputError('Section block.content 必须镜像 adopted candidate。');
          }
          activeContents.push(adopted.content as string);
        } else if (blockContent.trim()) {
          throw new StoreInputError('有回答候选但没有 adopted candidate 时，block 正文必须为空。');
        } else {
          activeContents.push('');
        }
      } else {
        activeContents.push(blockContent);
      }
    }
    if (hasCandidateMetadata && sectionContent !== activeContents.map((content) => content.trim()).filter(Boolean).join('\n\n')) {
      throw new StoreInputError('Section 正文必须镜像采用候选。');
    }
  }
  if (value.contextReferences !== undefined) {
    const referenceIds = new Set<string>();
    for (const reference of requiredArray(value.contextReferences, 'Section 前文参考')) {
      if (!isRecord(reference)) throw new StoreInputError('Section 前文参考数据无效。');
      const referenceId = validId(requiredString(reference.sectionId, 'Section 前文参考 Section ID'));
      if (referenceIds.has(referenceId)) throw new StoreInputError('Section 前文参考不得重复引用同一个 Section。');
      referenceIds.add(referenceId);
      if (reference.mode !== 'summary' && reference.mode !== 'full' && reference.mode !== 'both') {
        throw new StoreInputError('Section 前文参考模式无效。');
      }
      if (reference.reason !== 'manual' && reference.reason !== 'previous-section' && reference.reason !== 'chapter-preset') {
        throw new StoreInputError('Section 前文参考来源无效。');
      }
    }
  }
  if (value.plan !== undefined) validateSectionPlan(value.plan);
  if (value.memory !== undefined) validateSectionMemory(value.memory, 'Section memory');
  if (value.previousMemory !== undefined) validateSectionMemory(value.previousMemory, 'Section previousMemory');
};

export const validateBook = (book: Book) => {
  if (!isRecord(book)) throw new StoreInputError('Book 数据无效。');
  validId(requiredString(book.id, 'Book ID'));
  requiredString(book.title, 'Book 标题');
  if (book.plotOutline !== undefined) requiredString(book.plotOutline, 'Book 剧情大纲');
  requiredString(book.writingBrief, 'Book 写作约定');

  for (const character of requiredArray(book.characters, '角色卡')) {
    validateSource(character, '角色卡');
    if (!isRecord(character)) continue;
    requiredString(character.name, '角色名');
    requiredString(character.role, '角色身份');
  }
  for (const rule of requiredArray(book.worldRules, '世界观设定')) validateSource(rule, '世界观设定');
  for (const fact of requiredArray(book.canonFacts, 'Canon 事实')) validateSource(fact, 'Canon 事实');
  for (const summary of requiredArray(book.summaries, 'Summary')) {
    validateSource(summary, 'Summary');
    if (!isRecord(summary)) continue;
    for (const sectionId of requiredArray(summary.sourceSectionIds, 'Summary 来源 Section')) {
      validId(requiredString(sectionId, 'Summary 来源 Section ID'));
    }
  }
  for (const chapter of requiredArray(book.chapters, 'Chapter')) {
    if (!isRecord(chapter)) throw new StoreInputError('Chapter 数据无效。');
    validId(requiredString(chapter.id, 'Chapter ID'));
    requiredString(chapter.title, 'Chapter 标题');
    for (const section of requiredArray(chapter.sections, 'Section')) validateSection(section);
  }
  for (const branch of requiredArray(book.branches, 'Branch')) {
    if (!isRecord(branch)) throw new StoreInputError('Branch 数据无效。');
    validId(requiredString(branch.id, 'Branch ID'));
    requiredString(branch.title, 'Branch 标题');
    validId(requiredString(branch.fromSectionId, 'Branch 来源 Section ID'));
  }

  const assertUniqueIds = (items: Array<{ id: string }>, label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) throw new StoreInputError(`${label} ID 不得重复。`);
      ids.add(item.id);
    }
    return ids;
  };

  const characterIds = assertUniqueIds(book.characters, '角色卡');
  assertUniqueIds(book.worldRules, '世界观设定');
  assertUniqueIds(book.canonFacts, 'Canon 事实');
  assertUniqueIds(book.summaries, 'Summary');
  assertUniqueIds(book.chapters, 'Chapter');
  assertUniqueIds(book.branches, 'Branch');

  const sectionOrdinals = new Map<string, number>();
  let ordinal = 0;
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      if (sectionOrdinals.has(section.id)) throw new StoreInputError('Section ID 必须在整本 Book 内唯一。');
      sectionOrdinals.set(section.id, ordinal);
      ordinal += 1;
    }
  }

  const assertExistingSection = (sectionId: string, label: string) => {
    if (!sectionOrdinals.has(sectionId)) throw new StoreInputError(`${label}必须指向当前 Book 内存在的 Section。`);
  };

  for (const source of [...book.characters, ...book.worldRules, ...book.canonFacts, ...book.summaries]) {
    for (const sectionId of source.loadedSectionIds ?? []) {
      assertExistingSection(sectionId, '资料加载范围');
    }
  }
  for (const summary of book.summaries) {
    for (const sectionId of summary.sourceSectionIds) {
      assertExistingSection(sectionId, 'Summary 来源');
    }
  }
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const reference of section.contextReferences ?? []) {
        const sourceOrdinal = sectionOrdinals.get(reference.sectionId);
        if (sourceOrdinal === undefined) throw new StoreInputError('Section 前文参考必须指向当前 Book 内存在的 Section。');
        if (reference.sectionId === section.id) throw new StoreInputError('Section 前文参考不能指向自身。');
      }
      if (section.plan?.povCharacterId && !characterIds.has(section.plan.povCharacterId)) {
        throw new StoreInputError('Section 计划 POV 角色必须存在于当前 Book。');
      }
    }
  }
  for (const branch of book.branches) {
    assertExistingSection(branch.fromSectionId, 'Branch 来源');
  }
};
