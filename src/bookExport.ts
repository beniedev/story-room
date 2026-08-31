import { strToU8, zipSync } from 'fflate';
import type { Book } from './types';

export type BookExportFormat = 'epub' | 'markdown' | 'text' | 'json';

export interface BookExportFile {
  filename: string;
  mimeType: string;
  content: BlobPart;
}

const safeFilename = (title: string) => (
  title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'story-book'
);

const normalizeText = (value: string) => value.replace(/\r\n?/g, '\n').trim();

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const sectionParagraphs = (content: string) => {
  const paragraphs = normalizeText(content).split(/\n{2,}/).filter(Boolean);
  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs.map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, '<br/>')}</p>`).join('\n');
};

const numberedSections = (book: Book) => book.chapters.flatMap((chapter, chapterIndex) => (
  chapter.sections.map((section, sectionIndex) => ({
    chapter,
    section,
    chapterNumber: chapterIndex + 1,
    sectionNumber: sectionIndex + 1,
  }))
));

export const renderBookMarkdown = (book: Book) => {
  const lines = [`# ${book.title}`, '', '## 目录', ''];
  book.chapters.forEach((chapter, chapterIndex) => {
    lines.push(`- [${chapterIndex + 1}. ${chapter.title}](#chapter-${chapter.id})`);
    chapter.sections.forEach((section, sectionIndex) => {
      lines.push(`  - [${chapterIndex + 1}.${sectionIndex + 1} ${section.title}](#section-${section.id})`);
    });
  });

  book.chapters.forEach((chapter, chapterIndex) => {
    lines.push('', `<a id="chapter-${chapter.id}"></a>`, `## ${chapterIndex + 1}. ${chapter.title}`);
    chapter.sections.forEach((section, sectionIndex) => {
      lines.push('', `<a id="section-${section.id}"></a>`, `### ${chapterIndex + 1}.${sectionIndex + 1} ${section.title}`, '');
      lines.push(normalizeText(section.content));
    });
  });
  return `${lines.join('\n').trim()}\n`;
};

export const renderBookText = (book: Book) => {
  const lines = [book.title, '', '目录', ''];
  book.chapters.forEach((chapter, chapterIndex) => {
    lines.push(`${chapterIndex + 1}. ${chapter.title}`);
    chapter.sections.forEach((section, sectionIndex) => {
      lines.push(`  ${chapterIndex + 1}.${sectionIndex + 1} ${section.title}`);
    });
  });

  book.chapters.forEach((chapter, chapterIndex) => {
    lines.push('', '────────────────────', '', `${chapterIndex + 1}. ${chapter.title}`);
    chapter.sections.forEach((section, sectionIndex) => {
      lines.push('', `${chapterIndex + 1}.${sectionIndex + 1} ${section.title}`, '', normalizeText(section.content));
    });
  });
  return `${lines.join('\n').trim()}\n`;
};

const xhtmlDocument = (title: string, body: string, stylesheet = '../styles/book.css') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="${stylesheet}"/></head>
<body>${body}</body>
</html>`;

export const renderBookEpub = (book: Book) => {
  const sections = numberedSections(book);
  const updatedAt = new Date(book.updatedAt);
  const modifiedAt = Number.isNaN(updatedAt.getTime()) ? new Date(0) : updatedAt;
  const manifestItems = sections.map(({ section }, index) => (
    `<item id="section-${index + 1}" href="text/${section.id}.xhtml" media-type="application/xhtml+xml"/>`
  )).join('\n    ');
  const spineItems = sections.map((_, index) => `<itemref idref="section-${index + 1}"/>`).join('\n    ');
  const navigation = book.chapters.map((chapter, chapterIndex) => {
    const children = chapter.sections.map((section, sectionIndex) => (
      `<li><a href="text/${section.id}.xhtml">${chapterIndex + 1}.${sectionIndex + 1} ${escapeXml(section.title)}</a></li>`
    )).join('');
    const first = chapter.sections[0];
    const label = `${chapterIndex + 1}. ${escapeXml(chapter.title)}`;
    return first
      ? `<li><a href="text/${first.id}.xhtml">${label}</a><ol>${children}</ol></li>`
      : `<li><span>${label}</span><ol><li><span>空章</span></li></ol></li>`;
  }).join('');

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'EPUB/package.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:story-native:${escapeXml(book.id)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modifiedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles/book.css" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`),
    'EPUB/nav.xhtml': strToU8(xhtmlDocument('目录', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>目录</h1><ol>${navigation}</ol></nav>`, 'styles/book.css')),
    'EPUB/styles/book.css': strToU8('body{font-family:serif;line-height:1.8;margin:5%;}h1,h2{line-height:1.35;}p{text-indent:2em;margin:0 0 .9em;}'),
  };

  sections.forEach(({ chapter, section, chapterNumber, sectionNumber }) => {
    const body = `<header><p class="chapter">${chapterNumber}. ${escapeXml(chapter.title)}</p><h1>${chapterNumber}.${sectionNumber} ${escapeXml(section.title)}</h1></header>${sectionParagraphs(section.content)}`;
    files[`EPUB/text/${section.id}.xhtml`] = strToU8(xhtmlDocument(section.title, body));
  });

  return zipSync(files, { level: 6 });
};

export const createBookExport = (book: Book, format: BookExportFormat): BookExportFile => {
  const title = safeFilename(book.title);
  if (format === 'epub') return {
    filename: `${title}.epub`,
    mimeType: 'application/epub+zip',
    content: renderBookEpub(book),
  };
  if (format === 'markdown') return {
    filename: `${title}.md`,
    mimeType: 'text/markdown;charset=utf-8',
    content: renderBookMarkdown(book),
  };
  if (format === 'text') return {
    filename: `${title}.txt`,
    mimeType: 'text/plain;charset=utf-8',
    content: renderBookText(book),
  };
  return {
    filename: `${title}.json`,
    mimeType: 'application/json;charset=utf-8',
    content: `${JSON.stringify(book, null, 2)}\n`,
  };
};
