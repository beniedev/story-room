import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createExampleBooks, upgradeExampleBookContent } from '../src/fixtures';

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

  it('keeps author relay input and temporary notes inside the continuous manuscript', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(app).toContain('className="writer-section-note"');
    expect(app).toContain('小节注释');
    expect(app).toContain('authorNote');
    expect(app).toContain('onAuthorNoteChange');
    expect(app).toContain('只指导当前小节的下一次续写，不进入正文；发送后自动清空。');
    expect(app).toContain('写下一段正文，让 AI 从这里接着写');
    expect(app).not.toContain('props.section?.note');
    expect(app).not.toContain('onSectionNoteChange');
    expect(app).toContain('className="manuscript-block-group"');
    expect(app).toContain('className="manuscript-block"');
    expect(app).toContain('className="manuscript-block-actions"');
    expect(app).not.toContain('className="writer-block-actions"');
    expect(app).toContain('重新生成所选 AI 输出');
    expect(app).toContain("{block.kind === 'assistant' && <button");
    expect(app).toContain('编辑所选片段');
    expect(app).toContain('删除所选片段');
    expect(app).toContain('只会删除当前选中的这一块用户输入或 AI 输出');
    expect(app).toContain('className="manuscript-dialogue"');
    expect(styles).toContain('--manuscript-user: #4a354d');
    expect(styles).toContain('--manuscript-ai: #73539a');
    expect(styles).toContain('--manuscript-dialogue: #94600d');
    expect(styles).toContain('.manuscript-block[data-kind="assistant"]');
    expect(styles).toContain('color: color-mix(in srgb, var(--muted) 48%, transparent)');
    expect(styles).toContain('.manuscript-block-actions .icon-button:focus-visible');
  });

  it('sends directly, appends the continuation, and clears transient inputs only after success', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('const generateContinuation = () => withBusy(async () => {');
    expect(app).toContain("authorNote: modeSnapshot === 'author' ? noteSnapshot : undefined");
    expect(app).toContain("setAuthorNote((current) => current === noteSnapshot ? '' : current)");
    expect(app).toContain("setInstruction((current) => current === inputSnapshot ? '' : current)");
    expect(app).toContain("{ id: makeId('block'), kind: 'assistant', content: result.draft }");
    expect(app).toContain('续写已加入当前小节。');
    expect(app).toContain("aria-label={props.busy ? '正在续写' : '发送并续写'}");
    expect(app).not.toContain('className="draft-preview"');
    expect(app).not.toContain('应用到正文');
    expect(app).not.toContain('放弃预览');
    expect(app).not.toContain('Fake Provider 已生成待应用正文');
  });

  it('keeps mode switching open and links an active role to character mode', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("onClick={() => props.onModeChange('author')}");
    expect(app).toContain("onClick={() => props.onModeChange('character')}");
    expect(app).toContain('onSetActiveCharacter={(id) => {');
    expect(app).toContain('setSelectedCharacterId(id);');
    expect(app).toContain("setMode('character');");
  });

  it('opens a selected block in a full-screen editor with immediate autosave', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(app).toContain("const [editingBlockId, setEditingBlockId] = useState('');");
    expect(app).toContain('const readerScrollPosition = useRef(0);');
    expect(app).toContain('const editingBlock = blocks.find((item) => item.id === editingBlockId);');
    expect(app).toContain('className="block-editor-page"');
    expect(app).toContain('className="block-editor-header"');
    expect(app).toContain('className="block-editor-textarea"');
    expect(app).toContain('onChange={(event) => props.onSectionBlocksChange');
    expect(app).toContain('自动保存');
    expect(app).toContain('window.scrollY');
    expect(app).toContain('window.scrollTo');
    expect(app).toContain('readerScrollPosition.current');
    expect(app).not.toContain('editBlockDialog');
    expect(app).not.toContain('edit-block-input');
    expect(styles).toContain('.block-editor-page');
    expect(styles).toContain('.block-editor-textarea');
    expect(styles).toContain('max(1rem, var(--manuscript-font-size, 16px))');
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
    expect(source).not.toContain("setDraftInstruction('')");
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
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
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
    expect(source).toContain('event.target === event.currentTarget');
    expect(styles).toContain('.instruction-dock textarea:focus');
    expect(styles).toContain('background: var(--surface)');
    expect(source).not.toContain('className="settings-list-row');
    expect(source).not.toContain('className="provider-profile-list');
  });

  it('provides a persisted 12–24px font-size stepper without a slider', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('manuscriptFontSizeKey');
    expect(source).toContain('minManuscriptFontSize = 12');
    expect(source).toContain('maxManuscriptFontSize = 24');
    expect(source).toContain('defaultManuscriptFontSize = 16');
    expect(source).toContain('localStorage.getItem(manuscriptFontSizeKey)');
    expect(source).toContain('localStorage.setItem(manuscriptFontSizeKey');
    expect(source).toContain("setProperty('--manuscript-font-size'");
    expect(source).toContain('className="font-size-setting"');
    expect(source).toContain('className="font-size-stepper"');
    expect(source).toContain('aria-label="减小正文字号"');
    expect(source).toContain('aria-label="增大正文字号"');
    expect(source).toContain('<output');
    expect(source).not.toContain('type="range"');
    expect(styles).toContain('var(--manuscript-font-size, 16px)');
  });

  it('bundles and persists the optional LXGW WenKai manuscript font', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const materializer = await readFile(new URL('../scripts/materialize-font.mjs', import.meta.url), 'utf8');
    const license = await readFile(new URL('../public/fonts/OFL.txt', import.meta.url), 'utf8');
    expect(source).toContain('manuscriptFontFamilyKey');
    expect(source).toContain('id="manuscript-font-select"');
    expect(source).toContain('<option value="system">跟随系统</option>');
    expect(source).toContain('<option value="wenkai">霞鹜文楷</option>');
    expect(source).toContain('localStorage.setItem(manuscriptFontFamilyKey');
    expect(styles).toContain('@font-face');
    expect(styles).toContain('/fonts/LXGWWenKaiLite-Regular.ttf');
    expect(styles).toContain(':root[data-manuscript-font="wenkai"]');
    expect(styles).toContain('font-family: var(--manuscript-font-family)');
    expect(packageJson).toContain('"prepare:font": "node scripts/materialize-font.mjs"');
    expect(materializer).toContain('brotliDecompressSync');
    expect(materializer).toContain('LXGWWenKaiLite-Regular.ttf.br');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('provides three example books with the requested character and chapter depth', () => {
    const books = createExampleBooks();
    expect(books).toHaveLength(3);
    expect(books.map((book) => book.characters.length)).toEqual([5, 4, 2]);
    expect(books.every((book) => book.chapters.length >= 2 && book.chapters.length <= 3)).toBe(true);
    expect(books.every((book) => book.chapters.every((chapter) => chapter.sections.length >= 2 && chapter.sections.length <= 3))).toBe(true);
    expect(books.some((book) => book.chapters.some((chapter) => chapter.sections.some((section) => section.content.trim())))).toBe(true);
    const opening = books[0].chapters[0].sections[0];
    expect(opening.blocks).toHaveLength(6);
    expect(opening.blocks?.map((block) => block.kind)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(opening.content).toBe(opening.blocks?.map((block) => block.content).join('\n\n'));
  });

  it('upgrades only the untouched synthetic opening example', () => {
    const [example] = createExampleBooks();
    const previous = structuredClone(example);
    const opening = previous.chapters[0].sections[0];
    opening.content = '夜班开始后的第七码，米拉发现了那束光。\n\n它没有出现在任何预报里，却沿着观测窗的边缘稳定移动，像一行被刻意留下的句子。她关掉自动校准，玻璃上的微光仍然没有消失。';
    delete opening.blocks;
    previous.title = '用户保留的书名';

    const upgraded = upgradeExampleBookContent(previous, example);
    expect(upgraded?.title).toBe('用户保留的书名');
    expect(upgraded?.chapters[0].sections[0].blocks).toHaveLength(6);

    opening.content += '用户已经修改。';
    expect(upgradeExampleBookContent(previous, example)).toBeNull();
  });
});
