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
): Book => kind === 'character'
  ? { ...book, characters: book.characters.filter((item) => !ids.has(item.id)) }
  : { ...book, worldRules: book.worldRules.filter((item) => !ids.has(item.id)) };
