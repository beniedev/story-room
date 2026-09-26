import { describe, expect, it } from 'vitest';
import { buildContextPlan, ContextPlanInputError, estimateMessages } from '../src/contextPlan';
import { budgetFor, normalizedLimits } from '../src/context/contextBudget';
import { messagesFor } from '../src/context/promptMessages';
import { assertReferenceMemoryAvailability, referenceBlocks } from '../src/context/referenceBlocks';
import { createExampleBooks } from '../src/fixtures';
import { normalizeBook } from '../src/sectionMemory';
import type { GenerationRequest } from '../src/types';

const fixture = () => {
  const book = normalizeBook(structuredClone(createExampleBooks()[0]));
  const chapter = book.chapters[0];
  const source = chapter.sections[0];
  const section = chapter.sections[1];
  section.note = 'Synthetic section guidance.';
  section.contextReferences = [{ sectionId: source.id, mode: 'full', reason: 'manual' }];
  const request: Omit<GenerationRequest, 'bookId'> = { sectionId: section.id, mode: 'author', instruction: 'Synthetic next input.' };
  return { book, chapter, source, section, request };
};

describe('pure context planner stages', () => {
  it('keeps reference location, exclusion and Book identity in the reference stage', () => {
    const { book, source, section, request } = fixture();
    section.contextReferences!.push({ sectionId: 'foreign-section', mode: 'full', reason: 'manual' });
    const plan = buildContextPlan(book, request);
    const references = referenceBlocks(book, plan.target, section);
    expect(references.map((item) => item.included)).toEqual([true, false]);
    expect(references[0].content).toBe(source.content);
    expect(references.every((item) => item.bookId === book.id && item.source?.bookId === book.id)).toBe(true);
    expect(references[0].source?.sectionId).toBe(source.id);
    expect(references[1].reason).toContain('不属于当前 Book');
  });

  it('keeps reference failures on the error constructor exposed by the façade', () => {
    const { book, source, section, request } = fixture();
    const target = buildContextPlan(book, request).target;
    section.contextReferences![0].mode = 'summary';
    source.memory = undefined;
    expect(() => assertReferenceMemoryAvailability(book, target, section)).toThrow(ContextPlanInputError);
    expect(() => buildContextPlan(book, request)).toThrow(ContextPlanInputError);
  });

  it('uses assistant history only for an included note, then adds the final user continuation', () => {
    const { book, chapter, section, request } = fixture();
    for (const note of ['', 'Synthetic section guidance.']) {
      section.note = note;
      const plan = buildContextPlan(book, request);
      const messages = messagesFor(plan.target, request, 'continue-section', undefined, plan.included, chapter, section, book);
      expect(messages).toEqual(plan.messages);
      expect(messages.map((message) => message.role)).toEqual(note ? ['system', 'user', 'assistant', 'user'] : ['system', 'user']);
      if (note) {
        expect(messages[2].content).toBe(note);
        expect(messages[3].blockIds).toEqual([]);
      }
      expect(estimateMessages(messages)).toBe(plan.estimatedTokens);
    }
  });

  it('reports overflow without trimming messages or changing the source signature', () => {
    const { book, request } = fixture();
    const defaultPlan = buildContextPlan(book, request);
    const limitedPlan = buildContextPlan(book, request, { maxContext: 1024, maxOutput: 512 });
    expect(limitedPlan.budget.overflow).toBe(true);
    expect(limitedPlan.messages).toEqual(defaultPlan.messages);
    expect(limitedPlan.included).toEqual(defaultPlan.included);
    expect(limitedPlan.sourceSignature).toBe(defaultPlan.sourceSignature);
    expect(limitedPlan.budget).toEqual(budgetFor(normalizedLimits({ maxContext: 1024, maxOutput: 512 }), limitedPlan.estimatedTokens));
    expect(normalizedLimits({ maxContext: NaN, maxOutput: 512 })).toEqual(normalizedLimits());
  });
});
