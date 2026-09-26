import type { DirectorySelection } from '../../directorySelection';
import type { DirectoryMove, DirectoryReferenceImpact } from '../../directoryOperations';
import type { SourceSelectionKind } from '../../sourceSelection';
import type { Book, BookIndexEntry } from '../../types';
import type { DialogOperationState } from '../shared/DialogOperationStatus';

export type SettingsSection = 'guidance' | 'characters' | 'world';
export type BookSettingsView =
  | { kind: 'root' }
  | { kind: 'outline' }
  | { kind: 'style' }
  | { kind: 'character'; id: string }
  | { kind: 'world'; id: string }
  | { kind: 'character-scope'; id: string }
  | { kind: 'world-scope'; id: string };
export interface BookshelfProps {
  settingsOnly?: boolean;
  canEdit?: boolean;
  book: Book;
  library: BookIndexEntry[];
  selectedSectionId: string;
  openNewBookRequest: number;
  onNewBookOpened: () => void;
  openBookSettingsRequest: number;
  onBookSettingsOpened: () => void;
  onBookSettingsClose: () => void;
  onOpenBook: (id: string) => void;
  onOpenSection: (id: string) => void;
  onCreateBook: (title: string) => Promise<void>;
  onDeleteBook: () => Promise<void>;
  onBookChange: (recipe: (current: Book) => Book) => Promise<void>;
  onAddCharacter: (name: string) => Promise<void>;
  onAddWorldRule: (title: string) => Promise<void>;
  onAddChapter: (title: string) => Promise<void>;
  onAddSection: (chapterId: string, title: string, afterSectionId?: string) => Promise<void>;
  onRenameChapter: (chapterId: string, title: string) => Promise<void>;
  onRenameSection: (chapterId: string, sectionId: string, title: string) => Promise<void>;
  onMoveDirectoryItem: (move: DirectoryMove) => Promise<void>;
  onUndoDirectoryMove: () => Promise<void>;
  canUndoDirectoryMove: boolean;
  directoryBusy: boolean;
  onDeleteSelection: (selection: DirectorySelection) => Promise<void>;
  onDeleteSources: (kind: SourceSelectionKind, ids: Set<string>) => Promise<void>;
}

export type NameDialogState =
  { kind: 'new-book' | 'rename-book' | 'new-chapter' | 'new-character' | 'new-world'; value: string };

export type DeleteDialogState =
  | { kind: 'book'; id: string; title: string }
  | { kind: 'selection'; chapterIds: string[]; sectionIds: string[]; chapterCount: number; sectionCount: number }
  | { kind: 'source-selection'; sourceKind: SourceSelectionKind; ids: string[] };

export type DirectorySelectionState = 'checked' | 'mixed' | 'unchecked';

export type InlineSectionDraft = {
  chapterId: string;
  afterSectionId: string | null;
  value: string;
  operation: DialogOperationState;
};

export type DirectoryMoveOperation = DialogOperationState & {
  action: 'move' | 'undo';
  move: DirectoryMove | null;
  impact: DirectoryReferenceImpact[];
};

export type DirectoryDragState = {
  kind: DirectoryMove['kind'];
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  move: DirectoryMove | null;
};
