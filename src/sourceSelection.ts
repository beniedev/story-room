import type { Book } from './types';

export type SourceSelectionKind = 'character' | 'world';

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
