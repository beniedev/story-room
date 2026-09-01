import { describe, expect, it } from 'vitest';
import { buildContextPlan } from '../server/domain.ts';
import { createSectionMemory } from '../src/sectionMemory.ts';
import type {
  Book,
  ContextPlan,
  SectionContextReference,
  SectionMemoryDraft,
} from '../src/types.ts';

const FACTS = {
  itemLost: 'synthetic fact: the brass key is missing',
  rightHand: 'synthetic fact: the right hand is injured',
  knowledgePermission: 'synthetic fact: only Mira knows the coordinates; other characters cannot know them',
  communicationDelay: 'synthetic fact: the communication reply arrives no sooner than four hours later',
  unexplainedForeshadowing: 'synthetic fact: a future timestamp exists but remains unexplained',
  notTrusted: 'synthetic fact: the sentinel has not trusted the traveler',
  targetOnly: 'synthetic target fact: the brass gate opens in section three',
  future: 'synthetic future fact must stay out of the target prompt',
} as const;

const firstContent = [
  `${FACTS.itemLost}; the empty hook still swings beside the workbench.`,
  `${FACTS.rightHand}; the fresh bandage limits every careful movement.`,
  `${FACTS.knowledgePermission}; the others wait for Mira to describe the route.`,
  'The search party records the room layout and checks the empty hook before moving on.',
  'These observations stay unchanged until the next section adds a new clue.',
].join('\n');

const secondContent = [
  `${FACTS.communicationDelay}; the old relay stays silent through the four-hour wait.`,
  `${FACTS.unexplainedForeshadowing}; nobody can explain why the timestamp is there.`,
  `${FACTS.notTrusted}; the sentinel keeps the inner gate closed.`,
  'The waiting group marks the relay time and leaves the hatch untouched during the delay.',
  'The closed gate remains the last visible condition before the target section begins.',
].join('\n');

const firstMemory: SectionMemoryDraft = {
  synopsis: 'The key is missing, the right hand is injured, and only Mira knows the coordinates.',
  beats: ['The search continues while other characters wait for Mira\'s route.'],
  continuityFacts: [FACTS.itemLost, FACTS.rightHand, FACTS.knowledgePermission],
  characterStateChanges: [],
  foreshadowingCandidates: [],
};

const secondMemory: SectionMemoryDraft = {
  synopsis: 'The reply takes at least four hours, a future timestamp is unexplained, and trust is absent.',
  beats: ['The closed gate keeps the group waiting through the delayed reply.'],
  continuityFacts: [FACTS.communicationDelay, FACTS.unexplainedForeshadowing, FACTS.notTrusted],
  characterStateChanges: [],
  foreshadowingCandidates: [],
};

const invalidReferences = (): SectionContextReference[] => [
  { sectionId: 'eval-section-four', mode: 'full', reason: 'manual' },
  { sectionId: 'other-book-section', mode: 'full', reason: 'manual' },
];

const makeBook = (references: SectionContextReference[]): Book => {
  const first: Book['chapters'][number]['sections'][number] = {
    id: 'eval-section-one',
    title: 'First synthetic section',
    content: firstContent,
  };
  first.memory = createSectionMemory(firstMemory, first.content, 'model-confirmed', '2026-01-01T00:00:00.000Z');

  const second: Book['chapters'][number]['sections'][number] = {
    id: 'eval-section-two',
    title: 'Second synthetic section',
    content: secondContent,
  };
  second.memory = createSectionMemory(secondMemory, second.content, 'model-confirmed', '2026-01-01T00:00:00.000Z');

  return {
    id: 'eval-book',
    title: 'Synthetic continuity book',
    writingBrief: 'Synthetic prose only; no external provider is used by this eval.',
    characters: [],
    worldRules: [],
    canonFacts: [],
    summaries: [],
    chapters: [{
      id: 'eval-chapter',
      title: 'Synthetic chapter',
      sections: [
        first,
        second,
        {
          id: 'eval-section-three',
          title: 'Third synthetic section',
          content: `${FACTS.targetOnly}; this is the only target section.`,
          contextReferences: references,
        },
        {
          id: 'eval-section-four',
          title: 'Future synthetic section',
          content: FACTS.future,
        },
      ],
    }],
    branches: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

const planFor = (references: SectionContextReference[]) => buildContextPlan(
  makeBook(references),
  {
    sectionId: 'eval-section-three',
    mode: 'author',
    instruction: 'synthetic next turn',
  },
);

type EvalPacket = {
  generationKind: string;
  target: {
    locator: {
      book: { title: string; index: number };
      chapter: { title: string; index: number };
      section: { title: string; index: number };
    };
  };
  blocks: Array<{
    content: string;
    kind: string;
    location?: { chapterIndex?: number; sectionIndex?: number };
  }>;
};

const packetOf = (plan: ContextPlan): EvalPacket => {
  const content = plan.messages[1]?.content ?? '';
  const firstLineEnd = content.indexOf('\n');
  const lastLineStart = content.lastIndexOf('\n');
  if (firstLineEnd < 0 || lastLineStart <= firstLineEnd) throw new Error('synthetic packet framing missing');
  return JSON.parse(content.slice(firstLineEnd + 1, lastLineStart)) as EvalPacket;
};

const referenceShape = (plan: ContextPlan) => plan.included
  .filter((item) => item.source?.sectionId === 'eval-section-one' || item.source?.sectionId === 'eval-section-two')
  .map((item) => ({
    sectionId: item.source?.sectionId,
    semanticRole: item.semanticRole,
    transformedFrom: item.transformedFrom,
  }));

describe('deterministic synthetic prompt eval', () => {
  it('compares target-only, full, summary, and summary-plus-selected-full plans', () => {
    const invalid = invalidReferences();
    const targetOnly = planFor(invalid);
    const full = planFor([
      { sectionId: 'eval-section-one', mode: 'full', reason: 'manual' },
      { sectionId: 'eval-section-two', mode: 'full', reason: 'manual' },
      ...invalid,
    ]);
    const summary = planFor([
      { sectionId: 'eval-section-one', mode: 'summary', reason: 'manual' },
      { sectionId: 'eval-section-two', mode: 'summary', reason: 'manual' },
      ...invalid,
    ]);
    const summaryAndSelectedFull = planFor([
      { sectionId: 'eval-section-one', mode: 'summary', reason: 'manual' },
      { sectionId: 'eval-section-two', mode: 'both', reason: 'manual' },
      ...invalid,
    ]);
    const plans = [targetOnly, full, summary, summaryAndSelectedFull];
    const packets = plans.map(packetOf);

    expect(packets.every((packet) => packet.generationKind === 'continue-section')).toBe(true);
    expect(packets.map((packet) => packet.target.locator)).toEqual(plans.map(() => ({
      book: { title: 'Synthetic continuity book', index: 0 },
      chapter: { title: 'Synthetic chapter', index: 0 },
      section: { title: 'Third synthetic section', index: 2 },
    })));

    expect(referenceShape(targetOnly)).toEqual([]);
    expect(referenceShape(full)).toEqual([
      { sectionId: 'eval-section-one', semanticRole: 'reference-manuscript', transformedFrom: 'full' },
      { sectionId: 'eval-section-two', semanticRole: 'reference-manuscript', transformedFrom: 'full' },
    ]);
    expect(referenceShape(summary)).toEqual([
      { sectionId: 'eval-section-one', semanticRole: 'memory', transformedFrom: 'summary' },
      { sectionId: 'eval-section-two', semanticRole: 'memory', transformedFrom: 'summary' },
    ]);
    expect(referenceShape(summaryAndSelectedFull)).toEqual([
      { sectionId: 'eval-section-one', semanticRole: 'memory', transformedFrom: 'summary' },
      { sectionId: 'eval-section-two', semanticRole: 'memory', transformedFrom: 'summary' },
      { sectionId: 'eval-section-two', semanticRole: 'reference-manuscript', transformedFrom: 'full' },
    ]);

    const targetText = targetOnly.messages.map((message) => message.content).join('\n');
    expect(targetText).toContain(FACTS.targetOnly);
    for (const fact of Object.values(FACTS).slice(0, 6)) expect(targetText).not.toContain(fact);
    const fullPacketText = packetOf(full).blocks.map((block) => block.content).join('\n');
    expect(fullPacketText).toContain(firstContent);
    expect(fullPacketText).toContain(secondContent);
    for (const plan of [full, summary, summaryAndSelectedFull]) {
      const text = plan.messages.map((message) => message.content).join('\n');
      for (const fact of Object.values(FACTS).slice(0, 6)) expect(text).toContain(fact);
      expect(text).not.toContain(FACTS.future);
      expect(text).not.toContain('other-book-section');
      expect(plan.included.every((item) => item.bookId === 'eval-book')).toBe(true);
    }

    expect(targetOnly.estimatedTokens).toBeLessThan(summary.estimatedTokens);
    expect(summary.estimatedTokens).toBeLessThan(summaryAndSelectedFull.estimatedTokens);
    expect(targetOnly.estimatedTokens).toBeLessThan(full.estimatedTokens);
    for (const plan of plans) {
      expect(plan.budget.estimatedInput).toBe(plan.estimatedTokens);
      expect(plan.budget.remainingInput).toBe(plan.budget.availableInput - plan.estimatedTokens);
      expect(plan.budget.overflow).toBe(false);
    }

    expect(packets.every((packet) => packet.blocks.some((block) => block.kind === 'target'))).toBe(true);
    expect(packets.every((packet) => packet.blocks.every((block) => !('source' in block)))).toBe(true);
    expect(packets.every((packet) => packet.blocks.every((block) => Object.keys(block)
      .every((key) => ['kind', 'title', 'content', 'location', 'future'].includes(key))))).toBe(true);
  });

  it('keeps the target locator in the third section and rejects future or cross-Book references', () => {
    const plan = planFor([
      { sectionId: 'eval-section-four', mode: 'full', reason: 'manual' },
      { sectionId: 'other-book-section', mode: 'summary', reason: 'manual' },
    ]);
    const packet = packetOf(plan);
    const book = makeBook([]);
    const targetSections = book.chapters.flatMap((chapter) => chapter.sections)
      .filter((section) => section.content.includes(FACTS.targetOnly));

    expect(targetSections.map((section) => section.id)).toEqual(['eval-section-three']);
    expect(packet.target.locator.section.index).toBe(2);
    expect(plan.included.some((item) => item.source?.sectionId === 'eval-section-four')).toBe(false);
    expect(plan.included.some((item) => item.source?.sectionId === 'other-book-section')).toBe(false);
    expect(plan.excluded.find((item) => item.source?.sectionId === 'eval-section-four')?.reason)
      .toBe('当前或未来 Section 不能作为前文');
    expect(plan.excluded.find((item) => item.source?.sectionId === 'other-book-section')?.reason)
      .toBeUndefined();
  });
});
