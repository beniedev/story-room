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

  it('keeps the restricted first-person mode in the writing menu', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('角色模式 · 第一视角');
    expect(source).toContain('第一人称连续正文生成');
    expect(source).toContain('selectedCharacterId');
    expect(source).toContain('className="writer-menu-modes"');
  });

  it('keeps mobile reflow and touch/focus contracts explicit', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('@media (max-width: 24rem)');
    expect(source).toContain('.source-open-row {');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain('font-size: 1rem');
    expect(source).toContain('env(safe-area-inset-bottom)');
    expect(source).toContain(':focus-visible');
  });

  it('keeps the writing surface reader-first and moves secondary actions into one menu', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="writer-context-progress"');
    expect(source).toContain('className="writer-tool-row"');
    expect(source).toContain('role="group" aria-label="写作工具"');
    expect(source).toContain('className="book-settings-button button-with-icon writer-book-settings-button"');
    expect(source).toContain('<BookMarked aria-hidden="true" /><span>设定</span>');
    expect(source).toContain('className="writer-tool-actions"');
    expect(source).toContain('className="writer-section-title"');
    expect(source).toContain('className="writer-action-menu"');
    expect(source).toContain('className="writer-menu-modes"');
    expect(source).toContain('打开写作操作');
    expect(source).toContain('修改小节名称');
    expect(source).toContain('closeActionMenu(true)');
    expect(source).toContain('restoreShelfFocus.current = true');
    expect(source).not.toContain('上一小节');
    expect(source).not.toContain('下一小节');
    expect(source).not.toContain('查看当前 Prompt');
  });

  it('keeps section notes and editable turns inside the continuous manuscript', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(app).toContain('className="writer-section-note"');
    expect(app).toContain('本节注释');
    expect(app).toContain('发送时排列在当前正文前');
    expect(app).toContain('className="manuscript-block"');
    expect(app).toContain('className="writer-block-actions"');
    expect(app).toContain('重新生成所选 AI 输出');
    expect(app).toContain('编辑所选片段');
    expect(app).toContain('删除所选片段');
    expect(app).toContain('只会删除当前选中的这一块用户输入或 AI 输出');
    expect(app).toContain('className="manuscript-dialogue"');
    expect(styles).toContain('--manuscript-user: #4a354d');
    expect(styles).toContain('--manuscript-ai: #73539a');
    expect(styles).toContain('--manuscript-dialogue: #94600d');
    expect(styles).toContain('.manuscript-block[data-kind="assistant"]');
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
    expect(source).not.toContain("openNameDialog({ kind: 'rename-section'");
    expect(source).toContain('id="section-title-dialog-heading"');
    expect(source).toContain('if (id !== sectionId) {');
    expect(source).toContain("setDraftInstruction('')");
    expect(source).toContain('toggleChapterSelection');
    expect(source).toContain('toggleSectionSelection');
    expect(source).toContain("kind: 'selection'");
    expect(source).toContain('删除所选内容');
    expect(source).toContain('返回本书设定');
    expect(source).toContain('bookSettingsView');
    expect(source).toContain('returnBookSettingsRoot');
    expect(source).toContain("openBookSettingsPage({ kind: 'character'");
    expect(source).toContain("openBookSettingsPage({ kind: 'world'");
    expect(source).not.toContain('bookSettingsOpenRequest');
    expect(source).toContain("kind: 'source-selection'");
    expect(source).toContain('删除所选角色卡');
    expect(source).toContain('删除所选世界观条例');
    expect(source).not.toContain('editingCharacterId');
    expect(source).not.toContain('editingWorldId');
    expect(source).toContain('className="source-editor-page"');
    expect(source).toContain('全局指引');
    expect(source).toContain('剧情大纲');
    expect(source).toContain('写作风格指导');
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
    expect(source).not.toContain('剧情记忆');
    expect(source).not.toContain('Book 隔离视图');
    expect(source).not.toContain('StoryGraph');
  });

  it('keeps settings compact while supporting reusable provider profiles', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('选择皮肤');
    expect(source).toContain('id="theme-select"');
    expect(source).toContain('id="provider-profile-select"');
    expect(source).toContain('<span>设定</span>');
    expect(source).toContain('模型连接');
    expect(source).toContain('API Key');
    expect(source).toContain('模型 ID');
    expect(source).toContain('最大上下文');
    expect(source).toContain('最大输出');
    expect(source).toContain('保存连接方案');
    expect(source).toContain('Prompt 组合');
    expect(source).toContain("if (view !== 'write' || !book || !section) return null;");
    expect(source).toContain('通用顺序 · 选中小节后显示占比');
    expect(source).toContain('主页概览 · 竖条等高表示通用顺序');
    expect(source).toContain('当前小节 · 竖条按估算 tokens 比例显示');
    expect(source).toContain('prompt-proportion-bar');
    expect(source).toContain('promptShareLabel(share)');
    expect(source).toContain('稳定前缀到这里');
    expect(source).toContain('每轮变化');
    expect(source).toContain('API Key 不会写入书稿、私有书库或浏览器持久化');
    expect(source).toContain('type="password"');
    expect(source).not.toContain('className="settings-list-row');
    expect(source).not.toContain('className="provider-profile-list');
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
