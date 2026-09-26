import type { Book } from '../types';

export type BookSessionToken = Readonly<{ bookId: string | null; sessionId: number }>;
export type BookRevisionToken = BookSessionToken & Readonly<{ revision: number }>;
export type BookOpenOptions = { ignoreDraft?: boolean; persistedOnly?: boolean };

export type BookSessionTransition =
  | { kind: 'reset' }
  | { kind: 'before-switch' }
  | { kind: 'activated'; book: Book; reason: 'open' | 'created' | 'imported' | 'deleted-next' }
  | { kind: 'empty' }
  | { kind: 'deleted'; bookId: string }
  | { kind: 'external-refresh'; book: Book }
  | { kind: 'navigation-pending'; pending: boolean };
