import { describe, expect, it } from 'vitest';
import { buildContextPlan, fakeGenerate } from '../server/domain.ts';
import type { Book } from '../src/types.ts';

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
    expect(plan.prompt).toContain('Outline ALPHA');
    expect(plan.prompt).toContain('Brief ALPHA');
    expect(plan.prompt).toContain('World context ALPHA');
    expect(plan.prompt).not.toContain('Canon context ALPHA');
    expect(plan.prompt).not.toContain('Summary context ALPHA');
    expect(plan.prompt).not.toContain('BRAVO');
    expect([...plan.included, ...plan.excluded].map((item) => item.sourceId)).not.toContain('book-a-summary');
    expect([...plan.included, ...plan.excluded].map((item) => item.sourceId)).not.toContain('book-a-canon');
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

  it('places a transient author note before the manuscript and ignores legacy Section notes', () => {
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
      authorNote: '请让灯光熄灭后，人物听见门外的脚步。',
      instruction: '',
    });
    const noteIndex = plan.included.findIndex((item) => item.layer === 'note');
    const manuscriptIndex = plan.included.findIndex((item) => item.layer === 'manuscript');

    expect(noteIndex).toBe(manuscriptIndex - 1);
    expect(plan.included[noteIndex]?.title).toBe('小节注释');
    expect(plan.included[noteIndex]?.sourceId).toBe('request:author-note');
    expect(plan.included[noteIndex]?.cacheBand).toBe('dynamic');
    expect(plan.prompt).toContain('请让灯光熄灭后');
    expect(plan.prompt).not.toContain('Legacy persisted section note');
    expect(plan.prompt).not.toContain('Other legacy section note');
    expect(plan.included.some((item) => item.layer === 'instruction')).toBe(false);
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
    expect(result.plan.prompt).toContain('第一人称连续小说正文');
    expect(result.plan.prompt).toContain('AI 控制环境');
    expect(result.plan.prompt).toContain('角色身份：Observer');
    expect(result.draft.startsWith('我')).toBe(true);
    expect(result.draft).not.toContain('Character ALPHA');
    expect(result.draft).not.toMatch(/User:|Assistant:/);
  });
});
