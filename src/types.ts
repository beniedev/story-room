export type GenerationMode = 'author' | 'character';
export type ThemeName = 'paper' | 'manga' | 'gray' | 'purple';
export type GenerationKind = 'continue-section' | 'regenerate-block' | 'respond-to-input' | 'rewrite-selection' | 'summarize-section';

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

export interface AnswerCandidate {
  id: string;
  content: string;
  sourceSignature?: string;
}

export interface SectionBlock {
  id: string;
  kind: 'user' | 'assistant';
  content: string;
  candidates?: AnswerCandidate[];
  adoptedCandidateId?: string;
}

export type SectionContextReferenceMode = 'summary' | 'full' | 'both';
export type SectionContextReferenceReason = 'manual' | 'previous-section' | 'chapter-preset';

export interface SectionContextReference {
  sectionId: string;
  mode: SectionContextReferenceMode;
  reason: SectionContextReferenceReason;
}

export interface SectionPlan {
  goal: string;
  intendedBeats: string[];
  povCharacterId?: string;
}

export type SectionMemoryStatus = 'fresh' | 'stale';
export type SectionMemoryProvenance = 'manual' | 'model-draft' | 'model-confirmed' | 'model-edited';

export interface SectionMemoryDraft {
  synopsis: string;
  beats: string[];
  continuityFacts: string[];
  characterStateChanges: string[];
  foreshadowingCandidates: string[];
}

export interface SectionMemory extends SectionMemoryDraft {
  sourceContentHash: string;
  status: SectionMemoryStatus;
  provenance: SectionMemoryProvenance;
  updatedAt: string;
}

export interface Section {
  id: string;
  title: string;
  content: string;
  note?: string;
  blocks?: SectionBlock[];
  contextReferences?: SectionContextReference[];
  plan?: SectionPlan;
  memory?: SectionMemory;
  previousMemory?: SectionMemory;
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

export type PromptMessageRole = 'system' | 'user' | 'assistant';
export type PromptSemanticRole =
  | 'contract'
  | 'constraint'
  | 'outline-future'
  | 'memory'
  | 'reference-manuscript'
  | 'target'
  | 'note'
  | 'input';
export type PromptFreshness = 'fresh' | 'stale' | 'missing';

export interface PromptMessage {
  role: PromptMessageRole;
  content: string;
  blockIds: string[];
}

export interface PromptSourceLocation {
  bookId: string;
  sourceId?: string;
  chapterId?: string;
  chapterIndex?: number;
  sectionId?: string;
  sectionIndex?: number;
  blockId?: string;
  sourceSectionIds?: string[];
}

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
  messageRole: PromptMessageRole;
  semanticRole: PromptSemanticRole;
  source?: PromptSourceLocation;
  manualSelection?: boolean;
  freshness?: PromptFreshness;
  transformedFrom?: 'full' | 'summary';
  truncated?: boolean;
  truncationReason?: string;
  future?: boolean;
}

export interface ContextTarget {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  sectionId: string;
  sectionIndex: number;
}

export interface ProviderLimits {
  maxContext: number;
  maxOutput: number;
}

export interface ContextBudget {
  maxContext: number;
  protocolOverhead: number;
  safetyMargin: number;
  reservedOutput: number;
  availableInput: number;
  estimatedInput: number;
  remainingInput: number;
  overflow: boolean;
  overflowTokens: number;
  estimateKind: 'approximate';
}

export interface ContextPlan {
  bookId: string;
  mode: GenerationMode;
  generationKind: GenerationKind;
  target: ContextTarget;
  selectedCharacterId?: string;
  included: PromptBlock[];
  excluded: PromptBlock[];
  messages: PromptMessage[];
  estimatedTokens: number;
  budget: ContextBudget;
  sourceSignature?: string;
}

export interface ContextPreviewItem {
  layer: PromptLayer;
  cacheBand: PromptCacheBand;
  title: string;
  reason: string;
  included: boolean;
  charCount: number;
  estimatedTokens: number;
  semanticRole: PromptSemanticRole;
  manualSelection?: boolean;
  future?: boolean;
}

export interface ContextPlanPreview {
  mode: GenerationMode;
  generationKind: GenerationKind;
  included: ContextPreviewItem[];
  excluded: ContextPreviewItem[];
  estimatedTokens: number;
  budget: ContextBudget;
}

export interface GenerationRequest {
  bookId: string;
  sectionId: string;
  providerProfileId?: string;
  mode: GenerationMode;
  stream?: boolean;
  selectedCharacterId?: string;
  authorNote?: string;
  instruction: string;
  generationKind?: GenerationKind;
  targetBlockId?: string;
}

export interface GenerationResult {
  draft: string;
  sourceSignature?: string;
}
