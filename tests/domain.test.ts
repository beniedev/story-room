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

  it('places only the active Section note before its manuscript', () => {
    const book = makeBook('book-a', 'ALPHA');
    const current = book.chapters[0]?.sections[0];
    if (!current) throw new Error('fixture section missing');
    current.note = 'Current section note';
    book.chapters[0]?.sections.push({
      id: 'book-a-other-section',
      title: 'Other section',
      content: 'Other manuscript',
      note: 'Other section note',
    });

    const plan = buildContextPlan(book, {
      sectionId: current.id,
      mode: 'author',
      instruction: 'Continue ALPHA',
    });
    const noteIndex = plan.included.findIndex((item) => item.layer === 'note');
    const manuscriptIndex = plan.included.findIndex((item) => item.layer === 'manuscript');

    expect(noteIndex).toBe(manuscriptIndex - 1);
    expect(plan.included[noteIndex]?.sourceId).toBe('book-a-section:note');
    expect(plan.included[noteIndex]?.cacheBand).toBe('dynamic');
    expect(plan.prompt).toContain('Current section note');
    expect(plan.prompt).not.toContain('Other section note');
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
