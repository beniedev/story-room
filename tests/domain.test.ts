import { describe, expect, it } from 'vitest';
import { buildContextPlan, fakeGenerate } from '../server/domain.ts';
import { estimateMessages, messageFramingResidual, toContextPlanPreview } from '../src/contextPlan.ts';
import { estimateTokens } from '../src/textMetrics.ts';
import { createSectionMemory } from '../src/sectionMemory';
import type { Book, ContextPlan } from '../src/types.ts';

const promptText = (plan: ContextPlan) => plan.messages
  .map((message) => `${message.role}: ${message.content}`)
  .join('\n\n');

const makeBook = (id: string, marker: string): Book => ({
  id,
  title: `Book ${marker}`,
  plotOutline: `Outline ${marker}`,
  writingBrief: `Brief ${marker}`,
  characters: [{
    id: `${id}-character`,
    name: `Character ${marker}`,
    title: `Character ${marker}`,
    role: 'Observer',
    content: `Character context ${marker}`,
    includeInPrompt: false,
  }],
  worldRules: [{ id: `${id}-world`, title: 'World', content: `World context ${marker}`, includeInPrompt: true }],
  canonFacts: [{ id: `${id}-canon`, title: 'Canon', content: `Canon context ${marker}`, includeInPrompt: true }],
  summaries: [{
    id: `${id}-summary`,
    title: 'Summary',
    content: `Summary context ${marker}`,
    includeInPrompt: false,
    sourceSectionIds: [`${id}-section`],
  }],
  chapters: [{
    id: `${id}-chapter`,
    title: 'Chapter',
    sections: [{ id: `${id}-section`, title: 'Section', content: `Manuscript ${marker}` }],
  }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('context plan', () => {
  it('keeps every included source inside the active Book', () => {
    const bookA = makeBook('book-a', 'ALPHA');
    const plan = buildContextPlan(bookA, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Continue ALPHA',
    });

    expect(plan.included.every((item) => item.bookId === 'book-a')).toBe(true);
    expect(promptText(plan)).toContain('Outline ALPHA');
    expect(plan.messages[1]?.content).toContain('Outline ALPHA');
    expect(plan.included.find((item) => item.sourceId === 'book-a:outline')).toMatchObject({
      title: '剧情大纲',
      semanticRole: 'outline-future',
      future: true,
    });
    expect(promptText(plan)).toContain('Brief ALPHA');
    expect(promptText(plan)).toContain('World context ALPHA');
    expect(promptText(plan)).not.toContain('Canon context ALPHA');
    expect(promptText(plan)).not.toContain('Summary context ALPHA');
    expect(promptText(plan)).not.toContain('BRAVO');
    expect([...plan.included, ...plan.excluded].map((item) => item.sourceId)).not.toContain('book-a-summary');
    expect([...plan.included, ...plan.excluded].map((item) => item.sourceId)).not.toContain('book-a-canon');
  });

  it('estimates mixed-language provider messages from serialized role/content framing', () => {
    const messages = [
      { role: 'system' as const, content: '规则：只输出正文。', blockIds: ['system'] },
      { role: 'user' as const, content: '{"text":"hello, 世界!? 😊"}', blockIds: ['user'] },
    ];
    const serialized = JSON.stringify(messages.map(({ role, content }) => ({ role, content })));
    expect(estimateMessages(messages)).toBe(estimateTokens(serialized));
    expect(estimateMessages(messages)).toBeGreaterThan(estimateTokens(messages[0]!.content) + estimateTokens(messages[1]!.content));
    expect(messageFramingResidual({ included: [], estimatedTokens: -1 })).toBe(0);
  });

  it('keeps reusable Book material in a stable prefix and turn-specific input at the tail', () => {
    const plan = buildContextPlan(makeBook('book-a', 'ALPHA'), {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Continue ALPHA',
    });

    expect(plan.included.map((item) => item.sourceId)).toEqual([
      'system:manuscript-contract',
      'book-a:identity',
      'book-a:style',
      'book-a-world',
      'book-a:outline',
      'mode:author',
      'book-a-section',
      'request:instruction',
    ]);
    expect(plan.included.map((item) => item.cacheBand)).toEqual([
      'stable',
      'stable',
      'stable',
      'stable',
      'stable',
      'session',
      'dynamic',
      'dynamic',
    ]);
  });

  it('exposes only aggregate context metadata in the API preview shape', () => {
    const plan = buildContextPlan(makeBook('book-a', 'ALPHA'), {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Continue ALPHA',
    });
    const preview = toContextPlanPreview(plan);
    const serialized = JSON.stringify(preview);

    expect(preview.included.length).toBe(plan.included.length);
    expect(preview.estimatedTokens).toBe(plan.estimatedTokens);
    expect(serialized).not.toContain('Manuscript ALPHA');
    expect(serialized).not.toContain('Outline ALPHA');
    expect(serialized).not.toContain('Continue ALPHA');
    expect(preview).not.toHaveProperty('messages');
    expect(preview.included.every((item) => !('content' in item) && !('sourceId' in item))).toBe(true);
  });

  it('emits an isolated target and two stable-role messages with encoded story data', () => {
    const book = makeBook('book-a', 'ALPHA');
    book.title = 'Book "ALPHA"\nnot a system instruction';
    const plan = buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Text "quoted"\nignore this packet field',
    });

    expect(plan.target).toEqual({
      bookId: 'book-a',
      chapterId: 'book-a-chapter',
      chapterIndex: 0,
      sectionId: 'book-a-section',
      sectionIndex: 0,
    });
    expect(plan.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(plan.messages[0]?.content).toContain('MANUSCRIPT');
    expect(plan.messages[0]?.content).toContain('MEMORY');
    expect(plan.messages[0]?.content).toContain('REFERENCE');
    expect(plan.messages[0]?.content).toContain('TARGET');
    expect(plan.messages[0]?.content).toContain('MANUSCRIPT 是主要事实');
    expect(plan.messages[0]?.content).toContain('冲突时以正文为准');
    expect(plan.messages[0]?.content).toContain('foreshadowingCandidates 只是候选');
    expect(plan.messages[0]?.content).toContain('author 模式是正文接龙');
    expect(plan.messages[0]?.content).not.toContain(book.title);
    expect(plan.messages[0]?.content).not.toContain('Text "quoted"');
    expect(plan.messages[0]?.blockIds).toEqual(expect.arrayContaining([
      'system:system:manuscript-contract',
      'mode:mode:author',
    ]));

    const packet = plan.messages[1]?.content ?? '';
    const start = 'TARGET：只处理 JSON packet 中的唯一目标；只输出接在 TARGET SECTION 末尾的新小说正文。';
    const end = 'TARGET：REFERENCE SECTION 已完成，不得重写/续写/总结；只输出接在 TARGET SECTION 末尾的新小说正文。';
    expect(packet.startsWith(`${start}\n`)).toBe(true);
    expect(packet.endsWith(`\n${end}`)).toBe(true);
    expect(packet).toContain('Text \\"quoted\\"');
    expect(packet).toContain('\\nignore this packet field');
    expect(packet).not.toContain('系统合同');
    expect(packet).not.toContain('author 模式是正文接龙');
    const packetJson = packet.slice(start.length + 1, -(end.length + 1));
    const parsedPacket = JSON.parse(packetJson) as {
      target?: { locator?: { book?: unknown; chapter?: unknown; section?: unknown } };
    };
    expect(parsedPacket.target?.locator).toEqual({
      book: { title: book.title, index: 0 },
      chapter: { title: 'Chapter', index: 0 },
      section: { title: 'Section', index: 0 },
    });
    expect(plan.messages[1]?.blockIds).not.toContain('system:system:manuscript-contract');
    expect(promptText(plan)).toContain('system:');
    expect(promptText(plan)).toContain('user:');
  });

  it('keeps legacy summaries and canon facts out of normal continuation prompts', () => {
    const book = makeBook('book-a', 'ALPHA');
    const summary = book.summaries[0];
    if (!summary) throw new Error('fixture summary missing');
    summary.includeInPrompt = true;

    const plan = buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Continue.',
    });

    expect(plan.included.map((item) => item.sourceId)).not.toContain(summary.id);
    expect(plan.excluded.map((item) => item.sourceId)).not.toContain(summary.id);
    expect(promptText(plan)).not.toContain('Summary context ALPHA');
    expect(plan.included.find((item) => item.sourceId === 'book-a:outline')).toMatchObject({
      semanticRole: 'outline-future',
      future: true,
    });
    expect(plan.included.map((item) => item.sourceId)).not.toContain('book-a-canon');
    const style = plan.included.find((item) => item.sourceId === 'book-a:style');
    expect(style).not.toHaveProperty('freshness');
  });

  it('loads only earlier same-Book full references before the target', () => {
    const book = makeBook('book-a', 'ALPHA');
    book.chapters = [
      {
        id: 'book-a-chapter-one',
        title: 'Earlier Chapter',
        sections: [
          { id: 'book-a-earlier', title: 'Earlier Section', content: 'Earlier manuscript.' },
          { id: 'book-a-summary-source', title: 'Summary Source', content: 'Summary source manuscript.' },
        ],
      },
      {
        id: 'book-a-chapter-two',
        title: 'Current Chapter',
        sections: [
          {
            id: 'book-a-target',
            title: 'Target Section',
            content: 'Target manuscript.',
            contextReferences: [
              { sectionId: 'book-a-earlier', mode: 'full', reason: 'manual' },
              { sectionId: 'book-a-future', mode: 'full', reason: 'manual' },
              { sectionId: 'book-a-target', mode: 'full', reason: 'manual' },
              { sectionId: 'book-b-other', mode: 'full', reason: 'manual' },
              { sectionId: 'book-a-summary-source', mode: 'full', reason: 'manual' },
            ],
          },
          { id: 'book-a-future', title: 'Future Section', content: 'Future manuscript.' },
        ],
      },
    ];

    const plan = buildContextPlan(book, {
      sectionId: 'book-a-target',
      mode: 'author',
      instruction: 'Continue.',
    });
    const reference = plan.included.find((item) => item.source?.sectionId === 'book-a-earlier');
    const targetIndex = plan.included.findIndex((item) => item.semanticRole === 'target');

    expect(reference).toMatchObject({
      title: expect.stringContaining('REFERENCE'),
      content: 'Earlier manuscript.',
      messageRole: 'user',
      semanticRole: 'reference-manuscript',
      manualSelection: true,
      transformedFrom: 'full',
      cacheBand: 'session',
      source: {
        bookId: 'book-a',
        chapterId: 'book-a-chapter-one',
        chapterIndex: 0,
        sectionId: 'book-a-earlier',
        sectionIndex: 0,
      },
    });
    expect(plan.included.findIndex((item) => item.source?.sectionId === 'book-a-earlier')).toBeLessThan(targetIndex);
    expect(plan.messages[1]?.content).toContain('Earlier manuscript.');
    expect(plan.messages[1]?.content).not.toContain('Future manuscript.');
    expect(plan.messages[1]?.content).not.toContain('book-b-other');
    const futurePlaceholder = plan.excluded.find((item) => item.source?.sectionId === 'book-a-future');
    const targetPlaceholder = plan.excluded.find((item) => item.title.startsWith('REFERENCE') && item.source?.sectionId === 'book-a-target');
    const missingPlaceholder = plan.excluded.find((item) => item.source?.sectionId === 'book-b-other');
    expect(futurePlaceholder).toMatchObject({ content: '', reason: '当前或未来 Section 不能作为前文' });
    expect(targetPlaceholder).toMatchObject({ content: '', reason: '当前或未来 Section 不能作为前文' });
    expect(missingPlaceholder).toBeUndefined();
    expect(plan.included.find((item) => item.source?.sectionId === 'book-a-summary-source')?.content)
      .toBe('Summary source manuscript.');
  });

  it('deduplicates imported references with last-wins semantics', () => {
    const book = makeBook('book-a', 'ALPHA');
    const target = book.chapters[0]?.sections[0];
    if (!target) throw new Error('target fixture missing');
    const source = { id: 'book-a-source', title: 'Source', content: 'Source manuscript.' };
    book.chapters[0]!.sections = [source, { ...target, contextReferences: [
      { sectionId: source.id, mode: 'full', reason: 'manual' },
      { sectionId: source.id, mode: 'full', reason: 'manual' },
    ] }];

    const plan = buildContextPlan(book, {
      sectionId: target.id,
      mode: 'author',
      instruction: 'Continue.',
    });

    expect(plan.included.filter((item) => item.source?.sectionId === source.id)).toHaveLength(1);
    expect(plan.excluded.filter((item) => item.source?.sectionId === source.id)).toHaveLength(0);
    expect(plan.messages[1]?.content).toContain('Source manuscript.');
  });

  it('loads eligible memory and full references in deterministic order, with future target plan', () => {
    const book = makeBook('book-a', 'ALPHA');
    const memorySource: Book['chapters'][number]['sections'][number] = {
      id: 'book-a-memory-source', title: 'Memory Source', content: 'Memory source manuscript.'
    };
    const bothSource: Book['chapters'][number]['sections'][number] = {
      id: 'book-a-both-source', title: 'Both Source', content: 'Both source manuscript.'
    };
    const staleSource: Book['chapters'][number]['sections'][number] = {
      id: 'book-a-stale-source', title: 'Stale Source', content: 'Stale source manuscript.'
    };
    const modelDraftSource: Book['chapters'][number]['sections'][number] = {
      id: 'book-a-draft-source', title: 'Draft Source', content: 'Draft source manuscript.'
    };
    memorySource.memory = createSectionMemory({
      synopsis: 'Memory synopsis',
      beats: ['Memory beat'],
      continuityFacts: ['Memory fact'],
      characterStateChanges: ['Memory state'],
      foreshadowingCandidates: ['Memory candidate'],
    }, memorySource.content, 'model-confirmed');
    bothSource.memory = createSectionMemory({
      synopsis: 'Both synopsis',
      beats: ['Both beat'],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, bothSource.content, 'manual');
    staleSource.memory = createSectionMemory({
      synopsis: 'Stale synopsis',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, 'original source', 'manual');
    modelDraftSource.memory = createSectionMemory({
      synopsis: 'Draft synopsis',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, modelDraftSource.content, 'model-draft');
    const target = {
      id: 'book-a-target-with-plan',
      title: 'Target With Plan',
      content: 'Target manuscript.',
      plan: { goal: 'Future goal', intendedBeats: ['Future beat'] },
      contextReferences: [
        { sectionId: memorySource.id, mode: 'summary' as const, reason: 'manual' as const },
        { sectionId: bothSource.id, mode: 'both' as const, reason: 'manual' as const },
        { sectionId: staleSource.id, mode: 'summary' as const, reason: 'manual' as const },
        { sectionId: modelDraftSource.id, mode: 'summary' as const, reason: 'manual' as const },
      ],
    };
    book.chapters[0]!.sections = [memorySource, bothSource, staleSource, modelDraftSource, target];

    expect(() => buildContextPlan(book, {
      sectionId: target.id,
      mode: 'author',
      instruction: 'Continue.',
    })).toThrow('梗概');

    target.contextReferences = target.contextReferences.slice(0, 2);

    const plan = buildContextPlan(book, {
      sectionId: target.id,
      mode: 'author',
      instruction: 'Continue.',
    });
    const targetIndex = plan.included.findIndex((item) => item.semanticRole === 'target');
    const memory = plan.included.find((item) => item.source?.sectionId === memorySource.id);
    const bothMemoryIndex = plan.included.findIndex((item) => item.source?.sectionId === bothSource.id
      && item.semanticRole === 'memory');
    const bothFullIndex = plan.included.findIndex((item) => item.source?.sectionId === bothSource.id
      && item.transformedFrom === 'full');
    expect(memory).toMatchObject({ semanticRole: 'memory', freshness: 'fresh', transformedFrom: 'summary', cacheBand: 'session' });
    expect(JSON.parse(memory?.content ?? '{}')).toEqual({
      synopsis: 'Memory synopsis',
      beats: ['Memory beat'],
      continuityFacts: ['Memory fact'],
      characterStateChanges: ['Memory state'],
      foreshadowingCandidates: ['Memory candidate'],
    });
    expect(memory?.content).not.toContain('sourceContentHash');
    expect(bothMemoryIndex).toBeLessThan(bothFullIndex);
    expect(plan.included[bothFullIndex]?.cacheBand).toBe('session');
    expect(bothFullIndex).toBeLessThan(targetIndex);
    expect(plan.included.some((item) => item.semanticRole === 'outline-future'
      && item.source?.sectionId === target.id)).toBe(false);
    expect(plan.messages[1]?.content).toContain('Both source manuscript.');

    target.contextReferences = [{ sectionId: modelDraftSource.id, mode: 'summary', reason: 'manual' }];
    expect(() => buildContextPlan(book, {
      sectionId: target.id,
      mode: 'author',
      instruction: 'Continue.',
    })).toThrow('尚未确认');
    modelDraftSource.memory = createSectionMemory({
      synopsis: 'Confirmed synopsis',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, modelDraftSource.content, 'model-confirmed');
    const confirmedPlan = buildContextPlan(book, {
      sectionId: target.id,
      mode: 'author',
      instruction: 'Continue.',
    });
    expect(confirmedPlan.included.find((item) => item.source?.sectionId === modelDraftSource.id
      && item.semanticRole === 'memory')?.content).toContain('Confirmed synopsis');
  });

  it('keeps the legacy SectionPlan out of normal continuation context', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.plan = { goal: '', intendedBeats: [], povCharacterId: 'book-a-character' };
    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Continue.',
    });
    expect(plan.included.find((item) => item.semanticRole === 'outline-future'
      && item.source?.sectionId === section.id)).toBeUndefined();
    expect(promptText(plan)).not.toContain('Future goal');
  });

  it('builds regenerate-block context from the selected assistant block prefix only', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.blocks = [
      { id: 'block-before', kind: 'user', content: 'Prefix synthetic text.' },
      { id: 'block-target', kind: 'assistant', content: 'Target synthetic text.' },
      { id: 'block-after', kind: 'user', content: 'Suffix synthetic text.' },
    ];
    section.note = 'Synthetic persistent section guidance.';

    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      authorNote: 'Synthetic transient note.',
      instruction: 'Rewrite only the target block.',
      generationKind: 'regenerate-block',
      targetBlockId: 'block-target',
    });

    expect(plan.target).toMatchObject({ sectionId: section.id, sectionIndex: 0 });
    expect(plan.included.map((item) => item.semanticRole)).toEqual(expect.arrayContaining(['reference-manuscript']));
    expect(plan.included.find((item) => item.semanticRole === 'reference-manuscript'))
      .not.toHaveProperty('transformedFrom');
    const packet = plan.messages[1]?.content ?? '';
    expect(plan.messages[0]?.content).toContain('regenerate-block 从 TARGET 之前的当前正文重新作答');
    expect(packet.startsWith('TARGET：只处理 JSON packet 中的唯一目标；从 TARGET 之前的当前正文重新作答')).toBe(true);
    expect(packet).toContain('Prefix synthetic text.');
    expect(packet).not.toContain('Target synthetic text.');
    expect(packet).not.toContain('Suffix synthetic text.');
    const prefixIndex = plan.included.findIndex((item) => item.title === 'TARGET prefix');
    const targetBlockIndex = plan.included.findIndex((item) => item.title === 'TARGET input');
    expect(prefixIndex).toBeGreaterThanOrEqual(0);
    expect(targetBlockIndex).toBe(-1);
    expect(plan.included.some((item) => item.layer === 'note')).toBe(true);
    expect(plan.included.some((item) => item.layer === 'instruction')).toBe(false);
    expect(packet).not.toContain('Synthetic persistent section guidance.');
    expect(plan.messages.at(-2)).toMatchObject({
      role: 'assistant',
      content: 'Synthetic persistent section guidance.',
    });
    expect(promptText(plan)).not.toContain('Synthetic transient note.');
    expect(packet).not.toContain('Rewrite only the target block.');
    expect(() => buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Rewrite.',
      generationKind: 'regenerate-block',
      targetBlockId: 'block-before',
    })).toThrow('assistant block');
    expect(() => buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Rewrite.',
      generationKind: 'regenerate-block',
      targetBlockId: 'missing-block',
    })).toThrow('当前 Section');
  });

  it('answers only the末尾 user block for respond-to-input', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.blocks = [
      { id: 'block-before', kind: 'assistant', content: 'Prefix synthetic text.' },
      { id: 'block-input', kind: 'user', content: 'Current input synthetic text.' },
    ];
    section.content = 'Prefix synthetic text.\n\nCurrent input synthetic text.';

    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: '底部草稿不应进入请求。',
      generationKind: 'respond-to-input',
      targetBlockId: 'block-input',
    });
    const packet = plan.messages[1]?.content ?? '';
    expect(packet).toContain('Prefix synthetic text.');
    expect(packet).toContain('Current input synthetic text.');
    expect(packet).not.toContain('底部草稿不应进入请求。');
    expect(plan.included.filter((item) => item.title === 'TARGET input')).toHaveLength(1);
    expect(() => buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: '',
      generationKind: 'respond-to-input',
      targetBlockId: 'block-before',
    })).toThrow('user block');
  });

  it('keeps source signatures stable when continue and re-answer use the same material', () => {
    const initial = makeBook('book-a', 'ALPHA');
    const initialSection = initial.chapters[0]?.sections[0];
    if (!initialSection) throw new Error('initial section missing');
    initialSection.blocks = [{ id: 'prefix', kind: 'assistant', content: 'Prefix text.' }];
    initialSection.content = 'Prefix text.';
    const continued = buildContextPlan(initial, {
      sectionId: initialSection.id,
      mode: 'author',
      instruction: 'Current input.',
      generationKind: 'continue-section',
    });

    const answered = makeBook('book-a', 'ALPHA');
    const answeredSection = answered.chapters[0]?.sections[0];
    if (!answeredSection) throw new Error('answered section missing');
    answeredSection.blocks = [
      { id: 'prefix', kind: 'assistant', content: 'Prefix text.' },
      { id: 'input', kind: 'user', content: 'Current input.' },
      { id: 'answer', kind: 'assistant', content: 'First answer.' },
    ];
    answeredSection.content = 'Prefix text.\n\nCurrent input.\n\nFirst answer.';
    const regenerated = buildContextPlan(answered, {
      sectionId: answeredSection.id,
      mode: 'author',
      instruction: '',
      generationKind: 'regenerate-block',
      targetBlockId: 'answer',
    });
    expect(continued.sourceSignature).toBe(regenerated.sourceSignature);

    const responseBook = makeBook('book-a', 'ALPHA');
    const responseSection = responseBook.chapters[0]?.sections[0];
    if (!responseSection) throw new Error('response section missing');
    responseSection.blocks = [
      { id: 'prefix', kind: 'assistant', content: 'Prefix text.' },
      { id: 'input', kind: 'user', content: 'Current input.' },
    ];
    responseSection.content = 'Prefix text.\n\nCurrent input.';
    const responded = buildContextPlan(responseBook, {
      sectionId: responseSection.id,
      mode: 'author',
      instruction: '',
      generationKind: 'respond-to-input',
      targetBlockId: 'input',
    });
    expect(responded.sourceSignature).toBe(regenerated.sourceSignature);
  });

  it('excludes unadopted candidates and suffix content from a re-answer prompt', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.blocks = [
      {
        id: 'prefix',
        kind: 'assistant',
        content: 'Adopted prefix.',
        adoptedCandidateId: 'prefix-1',
        candidates: [
          { id: 'prefix-1', content: 'Adopted prefix.' },
          { id: 'prefix-2', content: 'HIDDEN PREFIX VARIANT.' },
        ],
      },
      {
        id: 'target',
        kind: 'assistant',
        content: 'Adopted target.',
        adoptedCandidateId: 'target-1',
        candidates: [
          { id: 'target-1', content: 'Adopted target.' },
          { id: 'target-2', content: 'HIDDEN TARGET VARIANT.' },
        ],
      },
      { id: 'suffix', kind: 'user', content: 'HIDDEN SUFFIX.' },
    ];
    section.content = 'Adopted prefix.\n\nAdopted target.\n\nHIDDEN SUFFIX.';
    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: '',
      generationKind: 'regenerate-block',
      targetBlockId: 'target',
    });
    const packet = plan.messages[1]?.content ?? '';
    expect(packet).toContain('Adopted prefix.');
    expect(packet).not.toContain('HIDDEN PREFIX VARIANT.');
    expect(packet).not.toContain('HIDDEN TARGET VARIANT.');
    expect(packet).not.toContain('HIDDEN SUFFIX.');
  });

  it('executes summary contract without mixing other story context and keeps rewrite unsupported', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    const earlier = {
      id: 'book-a-earlier',
      title: 'Earlier section',
      content: 'Earlier manuscript changed after summary.',
      memory: createSectionMemory({
        synopsis: 'Stale synopsis.',
        beats: [],
        continuityFacts: [],
        characterStateChanges: [],
        foreshadowingCandidates: [],
      }, 'Earlier manuscript before change.', 'model-confirmed'),
    };
    book.chapters[0]!.sections.unshift(earlier);
    section.contextReferences = [{ sectionId: earlier.id, mode: 'summary', reason: 'manual' }];
    const summaryPlan = buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'character',
      selectedCharacterId: 'missing-character',
      instruction: 'Summarize this section.',
      generationKind: 'summarize-section',
    });
    expect(summaryPlan.messages[0]?.content).toContain('JSON schema');
    for (const field of ['synopsis', 'beats', 'continuityFacts', 'characterStateChanges', 'foreshadowingCandidates']) {
      expect(summaryPlan.messages[0]?.content).toContain(field);
    }
    expect(summaryPlan.messages[1]?.content).toContain('只输出 SectionMemoryDraft schema JSON');
    expect(summaryPlan.included.map((item) => item.semanticRole)).not.toContain('instruction');
    expect(summaryPlan.included.map((item) => item.semanticRole)).toEqual(['contract', 'target']);
    expect(summaryPlan.messages[1]?.content).not.toContain('Outline ALPHA');
    expect(summaryPlan.messages[1]?.content).not.toContain('Summary context ALPHA');
    const generated = fakeGenerate(book, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Summarize this section.',
      generationKind: 'summarize-section',
    });
    expect(JSON.parse(generated.draft)).toEqual({
      synopsis: expect.any(String),
      beats: expect.any(Array),
      continuityFacts: expect.any(Array),
      characterStateChanges: expect.any(Array),
      foreshadowingCandidates: expect.any(Array),
    });
    expect(() => buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Rewrite a selection.',
      generationKind: 'rewrite-selection',
    })).toThrow('rewrite-selection');
  });

  it('keeps the full target and reports overflow for required material', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.content = `${'前文'.repeat(1800)}TAIL`;
    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Continue.',
    }, { maxContext: 2200, maxOutput: 100 });
    const target = plan.included.find((item) => item.semanticRole === 'target');
    expect(target?.truncated).toBe(false);
    expect(target?.content).toBe(section.content);
    expect(plan.budget.overflow).toBe(true);
    expect(plan.budget.reservedOutput).toBe(100);
    expect(plan.budget.availableInput).toBe(1_332);
    expect(plan.budget.estimatedInput).toBe(plan.estimatedTokens);
    expect(plan.budget.remainingInput).toBeLessThan(0);
    expect(plan.budget).not.toHaveProperty('inputBudget');

    book.writingBrief = 'required brief '.repeat(900);
    const overflow = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Continue.',
    }, { maxContext: 2200, maxOutput: 100 });
    expect(overflow.budget.overflow).toBe(true);
    expect(overflow.budget.overflowTokens).toBeGreaterThan(0);
    expect(() => fakeGenerate(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Continue.',
    }, { maxContext: 2200, maxOutput: 100 })).not.toThrow();
  });

  it('keeps the full target when no positive tail fits the budget', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    const original = section.content;
    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Continue.',
    }, { maxContext: 769, maxOutput: 1 });
    const target = plan.included.find((item) => item.semanticRole === 'target');
    expect(target?.content).toBe(original);
    expect(target?.charCount).toBe(Array.from(original).length);
    expect(target?.truncated).toBe(false);
    expect(plan.budget.overflow).toBe(true);
  });

  it('never truncates the target for summary generation', () => {
    const book = makeBook('book-a', 'ALPHA');
    const section = book.chapters[0]?.sections[0];
    if (!section) throw new Error('fixture section missing');
    section.content = '完整摘要正文。'.repeat(2_000);
    const plan = buildContextPlan(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Summarize.',
      generationKind: 'summarize-section',
    }, { maxContext: 1_000, maxOutput: 100 });
    const target = plan.included.find((item) => item.semanticRole === 'target');
    expect(target?.content).toBe(section.content);
    expect(target?.truncated).toBe(false);
    expect(plan.budget.overflow).toBe(true);
    expect(() => fakeGenerate(book, {
      sectionId: section.id,
      mode: 'author',
      instruction: 'Summarize.',
      generationKind: 'summarize-section',
    }, { maxContext: 1_000, maxOutput: 100 })).not.toThrow();
  });

  it('loads scoped character cards and world settings only for matching sections', () => {
    const book = makeBook('book-a', 'ALPHA');
    const secondSectionId = 'book-a-second-section';
    book.chapters[0]?.sections.push({
      id: secondSectionId,
      title: 'Second section',
      content: 'Second manuscript',
    });

    const alwaysCharacter = book.characters[0];
    if (!alwaysCharacter) throw new Error('fixture character missing');
    alwaysCharacter.includeInPrompt = true;
    alwaysCharacter.loadedSectionIds = undefined;
    const scopedCharacter = {
      id: 'book-a-scoped-character',
      name: 'Scoped character',
      title: 'Scoped character',
      role: 'Guide',
      content: 'Only for the second section.',
      includeInPrompt: true,
      loadedSectionIds: [secondSectionId],
    };
    const disabledCharacter = {
      id: 'book-a-disabled-character',
      name: 'Disabled character',
      title: 'Disabled character',
      role: 'Extra',
      content: 'Never load unless character mode forces it.',
      includeInPrompt: false,
      loadedSectionIds: [],
    };
    book.characters = [alwaysCharacter, scopedCharacter, disabledCharacter];

    const alwaysWorld = book.worldRules[0];
    if (!alwaysWorld) throw new Error('fixture world setting missing');
    alwaysWorld.loadedSectionIds = undefined;
    const scopedWorld = {
      id: 'book-a-scoped-world',
      title: 'Scoped setting',
      content: 'Only for the second section.',
      includeInPrompt: true,
      loadedSectionIds: [secondSectionId],
    };
    const disabledWorld = {
      id: 'book-a-disabled-world',
      title: 'Disabled setting',
      content: 'Never load.',
      includeInPrompt: true,
      loadedSectionIds: [],
    };
    book.worldRules = [alwaysWorld, scopedWorld, disabledWorld];

    const firstSectionPlan = buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: 'Continue the first section.',
    });
    expect(firstSectionPlan.included.map((item) => item.sourceId)).toEqual(expect.arrayContaining([
      alwaysCharacter.id,
      alwaysWorld.id,
    ]));
    for (const sourceId of [scopedCharacter.id, disabledCharacter.id, scopedWorld.id, disabledWorld.id]) {
      expect(firstSectionPlan.included.map((item) => item.sourceId)).not.toContain(sourceId);
    }

    const secondSectionPlan = buildContextPlan(book, {
      sectionId: secondSectionId,
      mode: 'author',
      instruction: 'Continue the second section.',
    });
    expect(secondSectionPlan.included.map((item) => item.sourceId)).toEqual(expect.arrayContaining([
      alwaysCharacter.id,
      scopedCharacter.id,
      alwaysWorld.id,
      scopedWorld.id,
    ]));
    expect(secondSectionPlan.included.map((item) => item.sourceId)).not.toContain(disabledWorld.id);

    const forcedCharacterPlan = buildContextPlan(book, {
      sectionId: 'book-a-section',
      mode: 'character',
      selectedCharacterId: disabledCharacter.id,
      instruction: 'Look around.',
    });
    expect(forcedCharacterPlan.included.map((item) => item.sourceId)).toContain(disabledCharacter.id);
  });

  it('loads the persisted current-section note after manuscript in both writing modes', () => {
    const book = makeBook('book-a', 'ALPHA');
    const current = book.chapters[0]?.sections[0];
    if (!current) throw new Error('fixture section missing');
    current.note = 'Legacy persisted section note';
    book.chapters[0]?.sections.push({
      id: 'book-a-other-section',
      title: 'Other section',
      content: 'Other manuscript',
      note: 'Other legacy section note',
    });

    const plan = buildContextPlan(book, {
      sectionId: current.id,
      mode: 'author',
      instruction: '',
    });
    const noteIndex = plan.included.findIndex((item) => item.layer === 'note');
    const manuscriptIndex = plan.included.findIndex((item) => item.layer === 'manuscript');

    const planIndex = plan.included.findIndex((item) => item.semanticRole === 'outline-future'
      && item.source?.sectionId === current.id);
    expect(planIndex).toBe(-1);
    expect(noteIndex).toBe(manuscriptIndex + 1);
    expect(plan.included[noteIndex]?.title).toBe('小节注释');
    expect(plan.included[noteIndex]?.sourceId).toBe(`${current.id}:note`);
    expect(plan.included[noteIndex]?.cacheBand).toBe('dynamic');
    expect(promptText(plan)).toContain('Legacy persisted section note');
    expect(promptText(plan)).not.toContain('Other legacy section note');
    expect(plan.included.some((item) => item.layer === 'instruction')).toBe(false);

    const characterPlan = buildContextPlan(book, {
      sectionId: current.id,
      mode: 'character',
      selectedCharacterId: 'book-a-character',
      instruction: '',
    });
    expect(promptText(characterPlan)).toContain('Legacy persisted section note');
  });

  it('describes author mode as a user-to-AI prose relay', () => {
    const plan = buildContextPlan(makeBook('book-a', 'ALPHA'), {
      sectionId: 'book-a-section',
      mode: 'author',
      instruction: '我推开观测站的门。',
    });

    const mode = plan.included.find((item) => item.layer === 'mode');
    expect(mode?.content).toContain('正文接龙');
    expect(mode?.content).toContain('用户本轮输入');
    expect(mode?.content).toContain('AI 从它的结尾继续写');
    expect(plan.included.find((item) => item.layer === 'instruction')?.title).toBe('作者接龙正文');
  });

  it('rejects a character that is not in the active Book', () => {
    const bookA = makeBook('book-a', 'ALPHA');
    expect(() => buildContextPlan(bookA, {
      sectionId: 'book-a-section',
      mode: 'character',
      selectedCharacterId: 'book-b-character',
      instruction: 'Look outside',
    })).toThrow('当前 Book');
  });

  it('forces the selected character into first-person character mode', () => {
    const book = makeBook('book-a', 'ALPHA');
    const result = fakeGenerate(book, {
      sectionId: 'book-a-section',
      mode: 'character',
      selectedCharacterId: 'book-a-character',
      instruction: 'Touch the glass',
    });

    expect(result.plan.included.map((item) => item.sourceId)).toContain('book-a-character');
    expect(result.plan.included.findIndex((item) => item.sourceId === 'book-a-character'))
      .toBeLessThan(result.plan.included.findIndex((item) => item.sourceId === 'mode:character'));
    expect(promptText(result.plan)).toContain('第一人称连续小说正文');
    expect(promptText(result.plan)).toContain('AI 控制环境');
    expect(promptText(result.plan)).toContain('角色身份：Observer');
    expect(result.draft.startsWith('我')).toBe(true);
    expect(result.draft).not.toContain('Character ALPHA');
    expect(result.draft).not.toMatch(/User:|Assistant:/);
  });
});
