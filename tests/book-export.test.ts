import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  createBookExport,
  renderBookEpub,
  renderBookMarkdown,
  renderBookText,
} from '../src/bookExport';
import { createExampleBooks } from '../src/fixtures';

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

  it('keeps JSON as the complete conversion and recovery format', () => {
    const file = createBookExport(book, 'json');
    expect(file.filename).toBe(`${book.title}.json`);
    expect(JSON.parse(String(file.content))).toEqual(book);
  });
});
