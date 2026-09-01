import type {
  Book,
  Section,
  SectionContextReference,
} from './types';

export const selectAllUnsetReferences = (
  references: SectionContextReference[] | undefined,
  sections: Section[],
): SectionContextReference[] | undefined => {
  const next = new Map((references ?? []).map((reference) => [reference.sectionId, reference] as const));
  for (const section of sections) {
    if (!section.content.trim()) continue;
    if (!next.has(section.id)) next.set(section.id, { sectionId: section.id, mode: 'full', reason: 'manual' });
  }
  return next.size ? [...next.values()] : undefined;
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
