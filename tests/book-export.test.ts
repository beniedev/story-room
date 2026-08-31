import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  createBookExport,
  renderBookEpub,
  renderBookMarkdown,
  renderBookText,
} from '../src/bookExport';
import { createExampleBooks } from '../src/fixtures';
import { createSectionMemory } from '../src/sectionMemory';

describe('book exports', () => {
  const book = createExampleBooks()[0];

  it('renders Markdown and TXT with a book/chapter/section table of contents', () => {
    const markdown = renderBookMarkdown(book);
    const text = renderBookText(book);
    const firstChapter = book.chapters[0];
    const firstSection = firstChapter.sections[0];

    expect(markdown).toContain(`# ${book.title}`);
    expect(markdown).toContain(`[1. ${firstChapter.title}](#chapter-${firstChapter.id})`);
    expect(markdown).toContain(`[1.1 ${firstSection.title}](#section-${firstSection.id})`);
    expect(markdown).toContain(firstSection.content);
    expect(text).toContain('目录');
    expect(text).toContain(`1. ${firstChapter.title}`);
    expect(text).toContain(`1.1 ${firstSection.title}`);
    expect(text).toContain(firstSection.content);
  });

  it('builds an EPUB 3 archive with an uncompressed leading mimetype and nested navigation', () => {
    const epub = renderBookEpub(book);
    const view = new DataView(epub.buffer, epub.byteOffset, epub.byteLength);
    const firstNameLength = view.getUint16(26, true);
    const firstName = strFromU8(epub.subarray(30, 30 + firstNameLength));
    const files = unzipSync(epub);
    const nav = strFromU8(files['EPUB/nav.xhtml']);
    const packageDocument = strFromU8(files['EPUB/package.opf']);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(firstName).toBe('mimetype');
    expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain(book.chapters[0].title);
    expect(nav).toContain(book.chapters[0].sections[0].title);
    expect(packageDocument).toContain('<dc:language>zh-CN</dc:language>');
    expect(packageDocument).toContain('<spine>');
  });

  it('renders emphasis for reading formats while keeping recovery data lossless', () => {
    const formatted = structuredClone(book);
    formatted.chapters[0].sections[0].content = String.raw`风从 *窗外* 吹来，\*星号\* 留在纸上。`;

    const markdown = renderBookMarkdown(formatted);
    const text = renderBookText(formatted);
    const epub = unzipSync(renderBookEpub(formatted));
    const section = strFromU8(epub[`EPUB/text/${formatted.chapters[0].sections[0].id}.xhtml`]);
    const json = createBookExport(formatted, 'json');

    expect(markdown).toContain(String.raw`*窗外*`);
    expect(text).toContain('风从 窗外 吹来，*星号* 留在纸上。');
    expect(text).not.toContain(String.raw`*窗外*`);
    expect(section).toContain('<em>窗外</em>');
    expect(section).toContain('*星号*');
    expect(JSON.parse(String(json.content))).toEqual(formatted);
  });

  it('keeps JSON as the complete conversion and recovery format', () => {
    const file = createBookExport(book, 'json');
    expect(file.filename).toBe(`${book.title}.json`);
    expect(JSON.parse(String(file.content))).toEqual(book);
  });

  it('keeps plan and memory in JSON but excludes them from reading formats', () => {
    const complete = structuredClone(book);
    const section = complete.chapters[0]?.sections[0];
    if (!section) throw new Error('section fixture missing');
    section.plan = { goal: 'Synthetic future plan', intendedBeats: ['Synthetic beat'] };
    section.memory = createSectionMemory({
      synopsis: 'Synthetic memory synopsis',
      beats: [],
      continuityFacts: [],
      characterStateChanges: [],
      foreshadowingCandidates: [],
    }, section.content);

    expect(JSON.parse(String(createBookExport(complete, 'json').content))).toEqual(complete);
    expect(renderBookMarkdown(complete)).not.toContain('Synthetic future plan');
    expect(renderBookText(complete)).not.toContain('Synthetic memory synopsis');
    const epub = unzipSync(renderBookEpub(complete));
    const sectionDocument = strFromU8(epub[`EPUB/text/${section.id}.xhtml`]);
    expect(sectionDocument).not.toContain('Synthetic future plan');
    expect(sectionDocument).not.toContain('Synthetic memory synopsis');
  });
});
