import type { Book } from './types';

export interface DirectorySelection {
  chapterIds: Set<string>;
  sectionIds: Set<string>;
}

export const toggleChapterSelection = (
  book: Book,
  selection: DirectorySelection,
  chapterId: string,
): DirectorySelection => {
  const chapterIds = new Set(selection.chapterIds);
  const sectionIds = new Set(selection.sectionIds);
  const chapter = book.chapters.find((item) => item.id === chapterId);
  if (!chapter) return selection;

  if (chapterIds.has(chapterId)) {
    chapterIds.delete(chapterId);
    chapter.sections.forEach((section) => sectionIds.delete(section.id));
  } else {
    chapterIds.add(chapterId);
    chapter.sections.forEach((section) => sectionIds.add(section.id));
  }
  return { chapterIds, sectionIds };
};

export const toggleSectionSelection = (
  book: Book,
  selection: DirectorySelection,
  sectionId: string,
): DirectorySelection => {
  const chapterIds = new Set(selection.chapterIds);
  const sectionIds = new Set(selection.sectionIds);
  const chapter = book.chapters.find((item) => item.sections.some((section) => section.id === sectionId));
  if (!chapter) return selection;

  if (sectionIds.has(sectionId)) {
    sectionIds.delete(sectionId);
    chapterIds.delete(chapter.id);
  } else {
    sectionIds.add(sectionId);
  }
  return { chapterIds, sectionIds };
};

export const deleteDirectorySelection = (
  book: Book,
  selection: DirectorySelection,
): { book: Book; removedSectionIds: Set<string> } => {
  const removedSectionIds = new Set(selection.sectionIds);
  book.chapters
    .filter((chapter) => selection.chapterIds.has(chapter.id))
    .forEach((chapter) => chapter.sections.forEach((section) => removedSectionIds.add(section.id)));

  const removeDeletedSectionReferences = <T extends { loadedSectionIds?: string[] }>(source: T): T => (
    source.loadedSectionIds === undefined
      ? source
      : { ...source, loadedSectionIds: source.loadedSectionIds.filter((id) => !removedSectionIds.has(id)) }
  );
  const removeDeletedContextReferences = (section: Book['chapters'][number]['sections'][number]) => (
    section.contextReferences === undefined
      ? section
      : {
          ...section,
          contextReferences: section.contextReferences.filter((reference) => !removedSectionIds.has(reference.sectionId)),
        }
  );

  return {
    book: {
      ...book,
      characters: book.characters.map(removeDeletedSectionReferences),
      worldRules: book.worldRules.map(removeDeletedSectionReferences),
      canonFacts: book.canonFacts.map(removeDeletedSectionReferences),
      chapters: book.chapters
        .filter((chapter) => !selection.chapterIds.has(chapter.id))
        .map((chapter) => ({
          ...chapter,
          sections: chapter.sections
            .filter((section) => !removedSectionIds.has(section.id))
            .map(removeDeletedContextReferences),
        })),
      summaries: book.summaries.map((summary) => ({
        ...removeDeletedSectionReferences(summary),
        sourceSectionIds: summary.sourceSectionIds.filter((id) => !removedSectionIds.has(id)),
      })),
      branches: book.branches.filter((branch) => !removedSectionIds.has(branch.fromSectionId)),
    },
    removedSectionIds,
  };
};
