import type { Book, Chapter } from './types';

export type DirectoryMove =
  | { kind: 'chapter'; id: string; beforeId: string | null }
  | { kind: 'section'; id: string; targetChapterId: string; beforeId: string | null };

export interface DirectoryReferenceImpact {
  targetSectionId: string;
  targetTitle: string;
  sourceSectionId: string;
  sourceTitle: string;
  availableAfter: boolean;
}

const insertBefore = <T extends { id: string }>(items: T[], item: T, beforeId: string | null): T[] => {
  const index = beforeId === null ? items.length : items.findIndex((entry) => entry.id === beforeId);
  if (index < 0) throw new Error('目标位置已经改变，请重新选择。');
  return [...items.slice(0, index), item, ...items.slice(index)];
};

const sameOrder = (before: Chapter[], after: Chapter[]) => before.length === after.length
  && before.every((chapter, index) => chapter.id === after[index].id
    && chapter.sections.length === after[index].sections.length
    && chapter.sections.every((section, sectionIndex) => section.id === after[index].sections[sectionIndex].id));

/** Change only directory order: all prose and ID-linked material retain their identity. */
export const moveDirectoryItem = (book: Book, move: DirectoryMove): Book => {
  let chapters: Chapter[];
  if (move.kind === 'chapter') {
    const chapter = book.chapters.find((item) => item.id === move.id);
    if (!chapter) throw new Error('找不到要移动的章节。');
    if (move.beforeId === move.id) return book;
    chapters = insertBefore(book.chapters.filter((item) => item.id !== move.id), chapter, move.beforeId);
  } else {
    const source = book.chapters.find((chapter) => chapter.sections.some((item) => item.id === move.id));
    const target = book.chapters.find((chapter) => chapter.id === move.targetChapterId);
    if (!source) throw new Error('找不到要移动的小节。');
    if (!target) throw new Error('目标章节已经不存在，请重新选择。');
    if (source.id === target.id && move.beforeId === move.id) return book;
    const section = source.sections.find((item) => item.id === move.id)!;
    const destination = insertBefore(target.sections.filter((item) => item.id !== move.id), section, move.beforeId);
    chapters = book.chapters.map((chapter) => {
      if (chapter.id === target.id) return { ...chapter, sections: destination };
      if (chapter.id === source.id) return { ...chapter, sections: chapter.sections.filter((item) => item.id !== move.id) };
      return chapter;
    });
  }
  return sameOrder(book.chapters, chapters) ? book : { ...book, chapters };
};

/** An inverse position, never a Book snapshot: later text edits survive undo. */
export const reverseDirectoryMove = (book: Book, move: DirectoryMove): DirectoryMove => {
  if (move.kind === 'chapter') {
    const index = book.chapters.findIndex((chapter) => chapter.id === move.id);
    if (index < 0) throw new Error('找不到要移动的章节。');
    return { kind: 'chapter', id: move.id, beforeId: book.chapters[index + 1]?.id ?? null };
  }
  const chapter = book.chapters.find((item) => item.sections.some((section) => section.id === move.id));
  if (!chapter) throw new Error('找不到要移动的小节。');
  const index = chapter.sections.findIndex((section) => section.id === move.id);
  return { kind: 'section', id: move.id, targetChapterId: chapter.id, beforeId: chapter.sections[index + 1]?.id ?? null };
};

export const getDirectoryMoveImpact = (book: Book, move: DirectoryMove): DirectoryReferenceImpact[] => {
  const moved = moveDirectoryItem(book, move);
  if (moved === book) return [];
  const before = book.chapters.flatMap((chapter) => chapter.sections);
  const after = moved.chapters.flatMap((chapter) => chapter.sections);
  const beforeOrdinals = new Map(before.map((section, index) => [section.id, index]));
  const afterOrdinals = new Map(after.map((section, index) => [section.id, index]));
  const sources = new Map(before.map((section) => [section.id, section]));
  return before.flatMap((target, targetOrdinal) => (target.contextReferences ?? []).flatMap((reference) => {
    const source = sources.get(reference.sectionId);
    if (!source) return [];
    const availableBefore = beforeOrdinals.get(source.id)! < targetOrdinal;
    const availableAfter = afterOrdinals.get(source.id)! < afterOrdinals.get(target.id)!;
    return availableBefore === availableAfter ? [] : [{
      targetSectionId: target.id, targetTitle: target.title,
      sourceSectionId: source.id, sourceTitle: source.title, availableAfter,
    }];
  }));
};
