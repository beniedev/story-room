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
    expect(result.plan.prompt).toContain('第一人称连续小说正文');
    expect(result.plan.prompt).toContain('AI 控制环境');
    expect(result.plan.prompt).toContain('角色身份：Observer');
    expect(result.draft.startsWith('我')).toBe(true);
    expect(result.draft).not.toContain('Character ALPHA');
    expect(result.draft).not.toMatch(/User:|Assistant:/);
  });
});
