import { isEligibleSectionMemory, sectionMemoryFreshness } from '../sectionMemory.ts';
import { ContextPlanInputError } from './contextErrors.ts';
import { block } from './promptBlocks.ts';
import type { Book, ContextTarget, SectionContextReference } from '../types.ts';

type SectionLocation = {
  chapter: Book['chapters'][number];
  section: Book['chapters'][number]['sections'][number];
  chapterIndex: number;
  sectionIndex: number;
  ordinal: number;
};

const sectionLocations = (book: Book) => {
  const locations = new Map<string, SectionLocation>();
  let ordinal = 0;
  book.chapters.forEach((chapter, chapterIndex) => {
    chapter.sections.forEach((section, sectionIndex) => {
      locations.set(section.id, { chapter, section, chapterIndex, sectionIndex, ordinal });
      ordinal += 1;
    });
  });
  return locations;
};

export const referenceBlocks = (
  book: Book,
  target: ContextTarget,
  section: Book['chapters'][number]['sections'][number],
) => {
  const locations = sectionLocations(book);
  const targetLocation = locations.get(target.sectionId);
  if (!targetLocation) return [];

  const uniqueReferences = new Map<string, SectionContextReference>();
  for (const reference of section.contextReferences ?? []) {
    // Persisted/imported input can repeat a source. Last-wins keeps one block
    // and avoids duplicate IDs or duplicate manuscript content.
    uniqueReferences.set(reference.sectionId, reference);
  }

  return [...uniqueReferences.values()].flatMap((reference) => {
    const sourceLocation = locations.get(reference.sectionId);
    if (!sourceLocation) {
      return [block(
        book.id,
        'manuscript',
        'session',
        `${target.sectionId}:reference:${reference.sectionId}`,
        `REFERENCE · ${reference.sectionId}`,
        '',
        '引用不存在或不属于当前 Book',
        false,
        true,
        {
          messageRole: 'user',
          semanticRole: 'reference-manuscript',
          source: { bookId: book.id, sourceId: reference.sectionId, sectionId: reference.sectionId },
          manualSelection: true,
        },
      )];
    }
    if (sourceLocation.ordinal >= targetLocation.ordinal) {
      return [block(
        book.id,
        'manuscript',
        'session',
        `${target.sectionId}:reference:${sourceLocation.section.id}`,
        `REFERENCE · 第${sourceLocation.chapterIndex + 1}章 / 第${sourceLocation.sectionIndex + 1}节 · ${sourceLocation.section.title}`,
        '',
        '当前或未来 Section 不能作为前文',
        false,
        true,
        {
          messageRole: 'user',
          semanticRole: 'reference-manuscript',
          source: {
            bookId: book.id,
            sourceId: sourceLocation.section.id,
            chapterId: sourceLocation.chapter.id,
            chapterIndex: sourceLocation.chapterIndex,
            sectionId: sourceLocation.section.id,
            sectionIndex: sourceLocation.sectionIndex,
          },
          manualSelection: true,
        },
      )];
    }

    const source = {
      bookId: book.id,
      sourceId: sourceLocation.section.id,
      chapterId: sourceLocation.chapter.id,
      chapterIndex: sourceLocation.chapterIndex,
      sectionId: sourceLocation.section.id,
      sectionIndex: sourceLocation.sectionIndex,
    };
    const title = `REFERENCE · 第${sourceLocation.chapterIndex + 1}章 / 第${sourceLocation.sectionIndex + 1}节 · ${sourceLocation.section.title}`;
    const common = {
      messageRole: 'user' as const,
      semanticRole: 'reference-manuscript' as const,
      source,
      manualSelection: true,
    };
    const memoryFreshness = sectionMemoryFreshness(
      sourceLocation.section.memory,
      sourceLocation.section.content,
    );
    const eligibleMemory = Boolean(sourceLocation.section.memory && isEligibleSectionMemory(
      sourceLocation.section.memory,
      sourceLocation.section.content,
    ));
    const memoryReason = memoryFreshness === 'missing'
      ? '前文记忆缺失'
      : memoryFreshness === 'stale'
        ? '前文记忆已过期'
        : sourceLocation.section.memory?.provenance === 'model-draft'
          ? '前文记忆尚未确认'
          : '手选前文新鲜梗概';
    const memoryBlock = block(
      book.id,
      'summary',
      'session',
      `${target.sectionId}:reference:${sourceLocation.section.id}:memory`,
      `REFERENCE MEMORY · 第${sourceLocation.chapterIndex + 1}章 / 第${sourceLocation.sectionIndex + 1}节 · ${sourceLocation.section.title}`,
      eligibleMemory && sourceLocation.section.memory
        ? JSON.stringify({
            synopsis: sourceLocation.section.memory.synopsis,
            beats: sourceLocation.section.memory.beats,
            continuityFacts: sourceLocation.section.memory.continuityFacts,
            characterStateChanges: sourceLocation.section.memory.characterStateChanges,
            foreshadowingCandidates: sourceLocation.section.memory.foreshadowingCandidates,
          })
        : '',
      memoryReason,
      eligibleMemory,
      true,
      {
        ...common,
        semanticRole: 'memory',
        freshness: memoryFreshness,
        transformedFrom: eligibleMemory ? 'summary' : undefined,
      },
    );
    if (reference.mode === 'summary') return [memoryBlock];
    const fullBlock = block(
      book.id,
      'manuscript',
      'session',
      `${target.sectionId}:reference:${sourceLocation.section.id}${reference.mode === 'both' ? ':full' : ''}`,
      title,
      sourceLocation.section.content,
      '手选前文全文参考',
      Boolean(sourceLocation.section.content.trim()),
      true,
      { ...common, transformedFrom: 'full' },
    );
    if (reference.mode === 'both') return [memoryBlock, fullBlock];
    return [fullBlock];
  });
};

export const assertReferenceMemoryAvailability = (
  book: Book,
  target: ContextTarget,
  section: Book['chapters'][number]['sections'][number],
) => {
  const locations = sectionLocations(book);
  const targetLocation = locations.get(target.sectionId);
  if (!targetLocation) return;
  for (const reference of section.contextReferences ?? []) {
    const sourceLocation = locations.get(reference.sectionId);
    if (!sourceLocation || sourceLocation.ordinal >= targetLocation.ordinal) continue;
    if (!sourceLocation.section.content.trim()) {
      throw new ContextPlanInputError(
        `前文「${sourceLocation.section.title}」尚无正文，请先改为不使用，或补充正文后再生成。`,
      );
    }
    if (reference.mode !== 'summary' && reference.mode !== 'both') continue;
    const freshness = sectionMemoryFreshness(sourceLocation.section.memory, sourceLocation.section.content);
    if (freshness === 'fresh' && isEligibleSectionMemory(sourceLocation.section.memory, sourceLocation.section.content)) continue;
    const reason = freshness === 'missing'
      ? '尚未建立'
      : freshness === 'stale'
        ? '已过期'
        : '尚未确认';
    throw new ContextPlanInputError(
      `前文「${sourceLocation.section.title}」的梗概${reason}，请完整复核 Memory，或改为全文/不使用后再生成。`,
    );
  }
};
