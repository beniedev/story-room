import { moveDirectoryItem, type DirectoryMove } from '../../directoryOperations';
import type { Book } from '../../types';

export function isDirectoryMoveNoop(book: Book, move: DirectoryMove) {
  try {
    return moveDirectoryItem(book, move) === book;
  } catch {
    return false;
  }
}

export function moveAtDirectoryPoint(
  book: Book,
  kind: DirectoryMove['kind'],
  id: string,
  clientX: number,
  clientY: number,
): DirectoryMove | null {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!(hit instanceof Element)) return null;
  const chapterCard = hit.closest<HTMLElement>('[data-directory-chapter-id]');
  const targetChapterId = chapterCard?.dataset.directoryChapterId;
  if (!targetChapterId) return null;
  const targetChapter = book.chapters.find((chapter) => chapter.id === targetChapterId);
  if (!targetChapter) return null;

  if (kind === 'chapter') {
    const targetIndex = book.chapters.findIndex((chapter) => chapter.id === targetChapterId);
    if (targetIndex < 0) return null;
    const rect = chapterCard.getBoundingClientRect();
    const beforeId = clientY < rect.top + rect.height / 2
      ? targetChapterId
      : book.chapters[targetIndex + 1]?.id ?? null;
    return { kind: 'chapter', id, beforeId };
  }

  const targetSectionRow = hit.closest<HTMLElement>('[data-directory-section-id]');
  if (!targetSectionRow) return { kind: 'section', id, targetChapterId, beforeId: null };
  const targetSectionId = targetSectionRow.dataset.directorySectionId;
  if (!targetSectionId) return null;
  const targetIndex = targetChapter.sections.findIndex((section) => section.id === targetSectionId);
  if (targetIndex < 0) return { kind: 'section', id, targetChapterId, beforeId: null };
  const rect = targetSectionRow.getBoundingClientRect();
  const beforeId = clientY < rect.top + rect.height / 2
    ? targetSectionId
    : targetChapter.sections[targetIndex + 1]?.id ?? null;
  return { kind: 'section', id, targetChapterId, beforeId };
}

export function describeDirectoryMove(book: Book, move: DirectoryMove) {
  if (move.kind === 'chapter') {
    const targetIndex = move.beforeId === null ? -1 : book.chapters.findIndex((chapter) => chapter.id === move.beforeId);
    const target = move.beforeId === null
      ? '目录末尾'
      : targetIndex >= 0 ? `第 ${targetIndex + 1} 章之前` : '目标位置';
    return target;
  }
  const targetChapter = book.chapters.find((chapter) => chapter.id === move.targetChapterId);
  const target = move.beforeId === null
    ? '目标章节末尾'
    : `“${targetChapter?.sections.find((section) => section.id === move.beforeId)?.title ?? '目标小节'}”之前`;
  return `${targetChapter?.title ?? '目标章节'} · ${target}`;
}

export function describeDirectoryMoveSubject(book: Book, move: DirectoryMove) {
  if (move.kind === 'chapter') return book.chapters.find((chapter) => chapter.id === move.id)?.title ?? '章节';
  return book.chapters.flatMap((chapter) => chapter.sections).find((section) => section.id === move.id)?.title ?? '小节';
}
