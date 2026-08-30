import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createExampleBooks } from '../src/fixtures';

describe('writing UI contract', () => {
  it('keeps the manuscript out of chat UI structures', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="manuscript"');
    expect(source).not.toMatch(/message-bubble|avatar-turn|chat-message|User:|Assistant:/i);
  });

  it('uses one stylesheet and semantic theme tokens', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain(':root[data-theme="manga"]');
    expect(source).toContain('--surface-active: #faecf1');
    expect(source).toContain('.manuscript');
  });

  it('makes the restricted first-person mode and prompt plan visible', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('角色模式 · 第一视角');
    expect(source).toContain('第一人称连续正文生成');
    expect(source).toContain('selectedCharacterId');
    expect(source).toContain('Prompt 计划');
    expect(source).toContain('按实际装入顺序排列');
    expect(source).toContain('aria-describedby="prompt-dialog-description"');
    expect(source).toContain('data-dialog-close');
    expect(source).toContain('onCancel=');
  });

  it('keeps mobile reflow and touch/focus contracts explicit', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('@media (max-width: 24rem)');
    expect(source).toContain('.source-card {');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain('font-size: 1rem');
    expect(source).toContain('env(safe-area-inset-bottom)');
    expect(source).toContain(':focus-visible');
  });

  it('uses local-first autosave, a real export action, and a compact book drawer', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("localStorage.setItem(bookCacheKey(book.id)");
    expect(source).toContain('<Download aria-hidden="true" />');
    expect(source).toContain('download = `${safeTitle}.json`');
    expect(source).toContain('className="book-library-drawer"');
    expect(source).toContain('<summary className="book-selector-card">');
    expect(source).not.toContain('id="book-select"');
  });

  it('keeps book creation and source management compact and understandable', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("openNameDialog({ kind: 'new-book'");
    expect(source).toContain("openNameDialog({ kind: 'new-section'");
    expect(source).toContain("openNameDialog({ kind: 'rename-book'");
    expect(source).toContain("openNameDialog({ kind: 'rename-chapter'");
    expect(source).toContain("openNameDialog({ kind: 'rename-section'");
    expect(source).toContain("openDeleteDialog({ kind: 'chapter'");
    expect(source).toContain("openDeleteDialog({ kind: 'section'");
    expect(source).toContain('修改角色卡');
    expect(source).toContain('删除角色卡');
    expect(source).toContain('已确认设定');
    expect(source).toContain('前文摘要');
    expect(source).toContain('className="book-settings-drawer"');
    expect(source).toContain('className="name-dialog"');
    expect(source).toContain('className="confirm-dialog"');
    expect(source).toContain('className="source-group-drawer"');
    expect(source).toContain('章节名称');
    expect(source).toContain('小节名称');
    expect(source).toContain('danger-icon');
    expect(source).not.toContain('window.confirm');
    expect(source).toContain('本书设定');
    expect(source).not.toContain('电子书目录');
    expect(source).not.toContain('aria-label="书目视图"');
    expect(source).not.toContain('Canon 与摘要');
    expect(source).not.toContain('<span>装入 Prompt</span>');
  });

  it('provides three example books with the requested character and chapter depth', () => {
    const books = createExampleBooks();
    expect(books).toHaveLength(3);
    expect(books.map((book) => book.characters.length)).toEqual([5, 4, 2]);
    expect(books.every((book) => book.chapters.length >= 2 && book.chapters.length <= 3)).toBe(true);
    expect(books.every((book) => book.chapters.every((chapter) => chapter.sections.length >= 2 && chapter.sections.length <= 3))).toBe(true);
    expect(books.some((book) => book.chapters.some((chapter) => chapter.sections.some((section) => section.content.trim())))).toBe(true);
  });
});
