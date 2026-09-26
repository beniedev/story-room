import { reconcileReferencesAfterMemoryDeletion } from '../contextReferences';
import { clearPreviousSectionMemory, deleteCurrentSectionMemory, normalizeBook, rollbackSectionMemory } from '../sectionMemory';
import { blocksAsContent, sectionBlocks } from '../components/shared/sectionContent';
import type { Book } from '../types';

export const renameBookChapter = (book: Book, chapterId: string, title: string): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => chapter.id === chapterId
    ? { ...chapter, title: title.trim() }
    : chapter),
});

export const renameBookSection = (book: Book, chapterId: string, sectionId: string, title: string): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => chapter.id === chapterId
    ? { ...chapter, sections: chapter.sections.map((item) => item.id === sectionId ? { ...item, title: title.trim() } : item) }
    : chapter),
});

export const deleteBookSectionBlock = (book: Book, sectionId: string, blockId: string): Book => ({
  ...book,
  chapters: book.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map((item) => {
      if (item.id !== sectionId) return item;
      const blocks = sectionBlocks(item).filter((block) => block.id !== blockId);
      return { ...item, blocks, content: blocksAsContent(blocks) };
    }),
  })),
});

export const referenceLocation = (book: Book, sectionId: string) => {
  let ordinal = 0;
  for (const chapter of book.chapters) {
    const sectionIndex = chapter.sections.findIndex((item) => item.id === sectionId);
    if (sectionIndex >= 0) return { chapter, section: chapter.sections[sectionIndex], sectionIndex, ordinal: ordinal + sectionIndex };
    ordinal += chapter.sections.length;
  }
  return undefined;
};

export const editBookSectionMemory = (
  book: Book,
  sectionId: string,
  operation: 'delete' | 'rollback' | 'clear-previous',
  updatedAt: string,
): Book => {
  const source = operation === 'delete' ? reconcileReferencesAfterMemoryDeletion(book, sectionId) : book;
  return normalizeBook({
    ...source,
    updatedAt,
    chapters: source.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.map((item) => {
        if (item.id !== sectionId) return item;
        if (operation === 'delete') return deleteCurrentSectionMemory(item);
        if (operation === 'rollback') return rollbackSectionMemory(item);
        return clearPreviousSectionMemory(item);
      }),
    })),
  });
};
