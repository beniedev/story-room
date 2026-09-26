import { describe, expect, it } from 'vitest';
import { storedId, validId, validateBook } from '../server/bookValidation.ts';
import { StoreDataError, StoreInputError } from '../server/storeErrors.ts';
import * as store from '../server/store.ts';
import type { Book } from '../src/types.ts';

const makeBook = (): Book => ({
  id: 'validation-book',
  title: 'Validation Book',
  writingBrief: '',
  characters: [{
    id: 'lead', name: 'Lead', role: 'lead', title: 'Lead', content: '', includeInPrompt: true,
  }],
  worldRules: [],
  canonFacts: [],
  summaries: [],
  chapters: [{
    id: 'chapter', title: 'Chapter', sections: [
      { id: 'source', title: 'Source', content: 'Source.' },
      { id: 'target', title: 'Target', content: 'Target.' },
    ],
  }],
  branches: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('Book validation without filesystem access', () => {
  it('accepts legacy optional fields and does not normalize or mutate input', () => {
    const book = makeBook();
    book.chapters[0].sections[1].contextReferences = [];
    const before = structuredClone(book);
    expect(() => validateBook(book)).not.toThrow();
    expect(book).toEqual(before);
  });

  it.each<[string, (book: Book) => void, string]>([
    ['path ID', (book) => { book.id = '../other'; }, '无效的 Book 或资料 ID'],
    ['duplicate character', (book) => { book.characters.push({ ...book.characters[0] }); }, '角色卡 ID 不得重复'],
    ['duplicate section across chapters', (book) => {
      book.chapters.push({ id: 'other-chapter', title: '', sections: [{ ...book.chapters[0].sections[0] }] });
    }, 'Section ID 必须在整本 Book 内唯一'],
    ['foreign source scope', (book) => { book.characters[0].loadedSectionIds = ['foreign']; }, '资料加载范围必须指向当前 Book'],
    ['foreign summary', (book) => {
      book.summaries.push({ id: 'summary', title: '', content: '', includeInPrompt: true, sourceSectionIds: ['foreign'] });
    }, 'Summary 来源必须指向当前 Book'],
    ['foreign branch', (book) => { book.branches.push({ id: 'branch', title: '', fromSectionId: 'foreign' }); }, 'Branch 来源必须指向当前 Book'],
    ['foreign viewpoint', (book) => {
      book.chapters[0].sections[1].plan = { goal: '', intendedBeats: [], povCharacterId: 'foreign' };
    }, 'POV 角色必须存在于当前 Book'],
    ['foreign context', (book) => {
      book.chapters[0].sections[1].contextReferences = [{ sectionId: 'foreign', mode: 'full', reason: 'manual' }];
    }, '前文参考必须指向当前 Book'],
    ['self context', (book) => {
      book.chapters[0].sections[1].contextReferences = [{ sectionId: 'target', mode: 'full', reason: 'manual' }];
    }, '前文参考不能指向自身'],
    ['duplicate context', (book) => {
      book.chapters[0].sections[1].contextReferences = [
        { sectionId: 'source', mode: 'full', reason: 'manual' },
        { sectionId: 'source', mode: 'summary', reason: 'manual' },
      ];
    }, '不得重复引用同一个 Section'],
    ['candidate mirror', (book) => {
      book.chapters[0].sections[1].blocks = [{
        id: 'answer', kind: 'assistant', content: 'Wrong mirror.',
        candidates: [{ id: 'candidate', content: 'Candidate.' }], adoptedCandidateId: 'candidate',
      }];
    }, 'block.content 必须镜像 adopted candidate'],
    ['unadopted candidate', (book) => {
      book.chapters[0].sections[1].blocks = [{ id: 'answer', kind: 'assistant', content: 'Not adopted.', candidates: [] }];
    }, '没有 adopted candidate 时'],
  ])('rejects %s with the public input-error contract', (_label, change, message) => {
    const book = makeBook();
    change(book);
    const before = structuredClone(book);
    expect(() => validateBook(book)).toThrow(StoreInputError);
    expect(() => validateBook(book)).toThrow(message);
    expect(book).toEqual(before);
  });

  it('preserves the error constructor exposed by the store entry point', () => {
    expect(store.StoreInputError).toBe(StoreInputError);
    expect(store.StoreDataError).toBe(StoreDataError);
    expect(new StoreInputError('invalid')).toMatchObject({ statusCode: 400, name: 'StoreInputError' });
    expect(new StoreDataError()).toMatchObject({ statusCode: 500, name: 'StoreDataError' });
  });

  it.each(['../other', '', 'two/parts', 'two\\parts'])('distinguishes invalid request IDs from corrupt stored IDs: %s', (id) => {
    expect(() => validId(id)).toThrow(StoreInputError);
    expect(() => storedId(id)).toThrow(StoreDataError);
  });
});
