import type { AddressInfo } from 'node:net';
import { createStoryServer } from '../server/main.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryStore } from '../server/store.ts';
import { createLegacyFixtureBook } from '../src/fixtures.ts';
import type { Book } from '../src/types.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('story store', () => {
  it('round-trips manuscript bytes while keeping source types separate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    const content = 'Line one.\r\n\r\n第二行保留原始换行。';
    const book: Book = {
      id: 'round-trip-book',
      title: 'Round Trip',
      plotOutline: 'Follow the signal.',
      writingBrief: 'Keep it quiet.',
      characters: [],
      worldRules: [{ id: 'rule-one', title: 'Rule', content: 'A rule.', includeInPrompt: true }],
      canonFacts: [{ id: 'fact-one', title: 'Fact', content: 'A fact.', includeInPrompt: true }],
      summaries: [{
        id: 'summary-one',
        title: 'Summary',
        content: 'A summary.',
        includeInPrompt: true,
        sourceSectionIds: ['section-one'],
      }],
      chapters: [{ id: 'chapter-one', title: 'Chapter', sections: [{ id: 'section-one', title: 'Section', content }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.saveBook(book);
    const loaded = await store.loadBook(book.id);

    expect(loaded.chapters[0]?.sections[0]?.content).toBe(content);
    expect(loaded.plotOutline).toBe('Follow the signal.');
    expect(await readFile(path.join(root, 'books', book.id, 'canon', 'fact-one.json'), 'utf8')).toContain('A fact.');
    expect(await readFile(path.join(root, 'books', book.id, 'summaries', 'summary-one.json'), 'utf8')).toContain('sourceSectionIds');
    expect(await readFile(path.join(root, 'books', book.id, 'world', 'rule-one.md'), 'utf8')).toBe('A rule.');
  });

  it('serializes concurrent saves so the library keeps both Books', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
    const store = new StoryStore(root);
    const makeBook = (id: string, content: string): Book => ({
      id,
      title: id,
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [{ id: `${id}-chapter`, title: 'Chapter', sections: [{ id: `${id}-section`, title: 'Section', content }] }],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await Promise.all([
      store.saveBook(makeBook('book-one', 'One')),
      store.saveBook(makeBook('book-two', 'Two')),
    ]);

    expect((await store.listBooks()).map((item) => item.id)).toEqual(expect.arrayContaining(['book-one', 'book-two']));
    expect((await store.loadBook('book-one')).chapters[0]?.sections[0]?.content).toBe('One');
    expect((await store.loadBook('book-two')).chapters[0]?.sections[0]?.content).toBe('Two');
  });

  it('upgrades present legacy fixtures without restoring a deliberately deleted example', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const store = new StoryStore(root);
    await store.listBooks();
    await store.saveBook(createLegacyFixtureBook('the-observatory', 'The Observatory', 'Mira'));
    const customized = createLegacyFixtureBook('harbor-at-noon', 'Harbor at Noon', 'Rowan');
    customized.writingBrief = 'Keep this user edit.';
    await store.saveBook(customized);
    await store.deleteBook('south-of-snowline');

    const reopened = new StoryStore(root);
    const library = await reopened.listBooks();
    expect(library.map((item) => item.id)).toEqual(expect.arrayContaining([
      'the-observatory',
      'harbor-at-noon',
    ]));
    expect(library.map((item) => item.id)).not.toContain('south-of-snowline');
    await expect(reopened.loadBook('south-of-snowline')).rejects.toThrow();
    expect((await reopened.loadBook('the-observatory')).characters).toHaveLength(5);
    expect((await reopened.loadBook('harbor-at-noon')).writingBrief).toBe('Keep this user edit.');
  });

  it('fails closed when the library file is malformed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    const library = path.join(root, 'library.json');
    await writeFile(library, '{not-json}\n', 'utf8');
    const store = new StoryStore(root);

    await expect(store.listBooks()).rejects.toThrow();
    await expect(store.saveBook({
      id: 'safe-book',
      title: 'Safe Book',
      writingBrief: '',
      characters: [],
      worldRules: [],
      canonFacts: [],
      summaries: [],
      chapters: [],
      branches: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })).rejects.toThrow();
    expect(await readFile(library, 'utf8')).toBe('{not-json}\n');
  });

  it('returns actionable HTTP statuses without exposing internal errors', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'story-harness-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'library.json'), '[]\n', 'utf8');
    const server = createStoryServer(new StoryStore(root));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const missing = await fetch(`${base}/api/books/missing-book`);
      expect(missing.status).toBe(404);

      const malformed = await fetch(`${base}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(malformed.status).toBe(400);

      const wrongMethod = await fetch(`${base}/api/health`, { method: 'POST' });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('allow')).toBe('GET');

      const created = await fetch(`${base}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Temporary Book' }),
      });
      const createdBook = await created.json() as Book;
      const deleted = await fetch(`${base}/api/books/${createdBook.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect(await fetch(`${base}/api/books/${createdBook.id}`)).toHaveProperty('status', 404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
