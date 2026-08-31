export type GenerationMode = 'author' | 'character';
export type ThemeName = 'paper' | 'manga';

export interface PromptSource {
  id: string;
  title: string;
  content: string;
  includeInPrompt: boolean;
  loadedSectionIds?: string[];
}

export interface CharacterCard extends PromptSource {
  name: string;
  role: string;
}

export interface WorldRule extends PromptSource {}

export interface CanonFact extends PromptSource {}

export interface Summary extends PromptSource {
  sourceSectionIds: string[];
}

export interface SectionBlock {
  id: string;
  kind: 'user' | 'assistant';
  content: string;
}

export interface Section {
  id: string;
  title: string;
  content: string;
  note?: string;
  blocks?: SectionBlock[];
}

export interface Chapter {
  id: string;
  title: string;
  sections: Section[];
}

export interface Branch {
  id: string;
  title: string;
  fromSectionId: string;
}

export interface Book {
  id: string;
  title: string;
  plotOutline?: string;
  writingBrief: string;
  characters: CharacterCard[];
  worldRules: WorldRule[];
  canonFacts: CanonFact[];
  summaries: Summary[];
  chapters: Chapter[];
  branches: Branch[];
  updatedAt: string;
}

export interface BookIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
}

export type PromptLayer =
  | 'system'
  | 'mode'
  | 'book'
  | 'character'
  | 'world'
  | 'canon'
  | 'summary'
  | 'note'
  | 'manuscript'
  | 'instruction';

export type PromptCacheBand = 'stable' | 'session' | 'dynamic';

export interface PromptBlock {
  id: string;
  layer: PromptLayer;
  cacheBand: PromptCacheBand;
  title: string;
  content: string;
  bookId: string;
  sourceId: string;
  reason: string;
  included: boolean;
  readOnly: boolean;
  charCount: number;
  estimatedTokens: number;
}

export interface ContextPlan {
  bookId: string;
  mode: GenerationMode;
  selectedCharacterId?: string;
  included: PromptBlock[];
  excluded: PromptBlock[];
  prompt: string;
  estimatedTokens: number;
}

export interface GenerationRequest {
  bookId: string;
  sectionId: string;
  mode: GenerationMode;
  selectedCharacterId?: string;
  authorNote?: string;
  instruction: string;
}

export interface GenerationResult {
  plan: ContextPlan;
  draft: string;
}
