import type {
  Book,
  Section,
  SectionContextReference,
  SectionContextReferenceMode,
} from './types';

export type SectionReferenceMode = SectionContextReferenceMode | 'none';

export const sectionReferenceModes: readonly SectionReferenceMode[] = [
  'none',
  'full',
  'summary',
  'both',
];

export const referenceModeFor = (
  references: SectionContextReference[] | undefined,
  sectionId: string,
): SectionReferenceMode => references?.find((reference) => reference.sectionId === sectionId)?.mode ?? 'none';

export const setReferenceMode = (
  references: SectionContextReference[] | undefined,
  sectionId: string,
  mode: SectionReferenceMode,
): SectionContextReference[] | undefined => {
  const next = new Map((references ?? []).map((reference) => [reference.sectionId, reference] as const));
  next.delete(sectionId);
  if (mode !== 'none') next.set(sectionId, { sectionId, mode, reason: 'manual' });
  return next.size ? [...next.values()] : undefined;
};

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
