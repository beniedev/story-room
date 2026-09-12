import type {
  Book,
  Section,
  SectionContextReference,
  SectionMemoryDraft,
  SectionMemoryProvenance,
} from './types';
import { commitSectionMemoryDraft } from './sectionMemory';

export const applySummaryReferenceSelection = (
  book: Book,
  targetSectionId: string,
  entries: Array<{ sourceSectionId: string; draft: SectionMemoryDraft; provenance: SectionMemoryProvenance }>,
  retainedInactiveSectionIds?: string[],
): Book => {
  const sections = book.chapters.flatMap((chapter) => chapter.sections);
  const targetOrdinal = sections.findIndex((section) => section.id === targetSectionId);
  if (targetOrdinal < 0) throw new Error('找不到当前小节。');
  const sources = new Map<string, Section>();
  for (const entry of entries) {
    const sourceOrdinal = sections.findIndex((section) => section.id === entry.sourceSectionId);
    if (sourceOrdinal < 0 || sourceOrdinal >= targetOrdinal) throw new Error('只能加载当前小节之前的梗概。');
    if (!entry.draft.synopsis.trim()) throw new Error('请先填写或生成所选小节的梗概。');
    const source = sections[sourceOrdinal];
    sources.set(source.id, commitSectionMemoryDraft(source, entry.draft, entry.provenance));
  }
  const inactiveReferences = (sections[targetOrdinal].contextReferences ?? []).filter((reference) => {
    const sourceOrdinal = sections.findIndex((section) => section.id === reference.sectionId);
    return sourceOrdinal >= targetOrdinal;
  });
  if (retainedInactiveSectionIds?.some((id) => !inactiveReferences.some((reference) => reference.sectionId === id))) {
    throw new Error('待保留的前文引用已经改变，请重新查看后确认。');
  }
  const references: SectionContextReference[] = [...sources.keys()].map((sectionId) => ({
    sectionId, mode: 'summary', reason: 'manual',
  }));
  references.push(...inactiveReferences.filter((reference) => retainedInactiveSectionIds === undefined
    || retainedInactiveSectionIds.includes(reference.sectionId)));
  return {
    ...book,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.map((section) => {
        if (sources.has(section.id)) return sources.get(section.id)!;
        if (section.id !== targetSectionId) return section;
        const { contextReferences: _previous, ...target } = section;
        return references.length ? { ...target, contextReferences: references } : target;
      }),
    })),
  };
};

export const reconcileReferencesAfterMemoryDeletion = (book: Book, sourceSectionId: string): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map((section) => {
      if (!section.contextReferences?.length) return section;
      const next = section.contextReferences.flatMap((reference) => {
        if (reference.sectionId !== sourceSectionId) return [reference];
        if (reference.mode === 'both') return [{ ...reference, mode: 'full' as const }];
        if (reference.mode === 'summary') return [];
        return [reference];
      });
      if (next.length) return { ...section, contextReferences: next };
      const { contextReferences: _removed, ...withoutReferences } = section;
      return withoutReferences;
    }),
  })),
});
