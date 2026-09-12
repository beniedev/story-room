import type { Book } from './types';

export type SourceSelectionKind = 'character' | 'world';

const reorderSources = <T extends { id: string }>(items: T[], id: string, beforeId: string | null): T[] => {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0 || (beforeId !== null && !items.some((item) => item.id === beforeId))) {
    throw new Error('要移动的内容或目标位置已改变，请重试。');
  }
  if (id === beforeId || (items[from + 1]?.id ?? null) === beforeId) return items;
  const next = items.filter((item) => item.id !== id);
  const target = beforeId === null ? next.length : next.findIndex((item) => item.id === beforeId);
  next.splice(target, 0, items[from]!);
  return next;
};

export const moveSourceItem = (book: Book, kind: SourceSelectionKind, id: string, beforeId: string | null): Book => {
  if (kind === 'character') {
    const characters = reorderSources(book.characters, id, beforeId);
    return characters === book.characters ? book : { ...book, characters };
  }
  const worldRules = reorderSources(book.worldRules, id, beforeId);
  return worldRules === book.worldRules ? book : { ...book, worldRules };
};

export const toggleSourceSelection = (selection: Set<string>, id: string) => {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export const deleteSourceSelection = (
  book: Book,
  kind: SourceSelectionKind,
  ids: Set<string>,
): Book => {
  if (kind === 'world') return {
    ...book,
    worldRules: book.worldRules.filter((item) => !ids.has(item.id)),
  };

  return {
    ...book,
    characters: book.characters.filter((item) => !ids.has(item.id)),
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.map((section) => {
        if (!section.plan?.povCharacterId || !ids.has(section.plan.povCharacterId)) return section;
        const { povCharacterId: _removed, ...plan } = section.plan;
        return { ...section, plan };
      }),
    })),
  };
};
