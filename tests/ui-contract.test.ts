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

  it('keeps the desktop shelf hierarchy compact and removes the clickable brand home', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/<button\b[\s\S]{0,300}className="brand-home"[\s\S]{0,300}<\/button>/);

    const shelfContentStart = source.indexOf('className="shelf-content"');
    const selectorIndex = source.indexOf('className="book-library-drawer"');
    const toolbarIndex = source.indexOf('className="directory-toolbar"');
    expect(shelfContentStart).toBeGreaterThanOrEqual(0);
    expect(selectorIndex).toBeGreaterThan(shelfContentStart);
    expect(selectorIndex).toBeLessThan(toolbarIndex);
  });

  it('keeps the home settings entry as a wide icon-and-label control', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const toolbarStart = source.indexOf('className="directory-toolbar"');
    const chapterListStart = source.indexOf('<ol className="chapter-list"', toolbarStart);
    const toolbar = source.slice(toolbarStart, chapterListStart);

    expect(toolbar).toContain('book-settings-button');
    expect(toolbar).toContain('button-with-icon');
    expect(toolbar).toContain('<span>设定</span>');
    expect(styles).toMatch(/\.book-settings-button\s*\{[\s\S]{0,300}padding-inline:/);
    expect(styles).not.toMatch(/\.icon-button\.book-settings-button\s*\{[\s\S]{0,120}padding:\s*0/);
  });

  it('keeps book actions above the list and gives book settings primary emphasis', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const panelStart = source.indexOf('className="book-library-panel"');
    const panelEnd = source.indexOf('</details>', panelStart);
    const panel = source.slice(panelStart, panelEnd);

    expect(panel.indexOf('className="book-actions-row"')).toBeLessThan(panel.indexOf('className="book-list"'));
    expect(source).toContain('book-settings-button');
    expect(styles).toMatch(/\.book-settings-button\s*\{[\s\S]{0,260}background:\s*var\(--accent-strong\)[\s\S]{0,120}color:\s*var\(--primary-text\)/);
  });

  it('passes the active provider metadata to the writer and emphasizes the context count', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const writerInvocationStart = source.indexOf('<Writer');
    const writerInvocationEnd = source.indexOf('/>', writerInvocationStart);
    const writerInvocation = source.slice(writerInvocationStart, writerInvocationEnd);

    expect(source).toContain('作者模式 · 写作接龙');
    expect(source).not.toContain('作者模式 · 接龙');
    expect(writerInvocation).toMatch(/provider(?:Profile)?Name\s*=/);
    expect(writerInvocation).toMatch(/modelId\s*=/);
    expect(source).toContain('className="writer-provider-line"');
    expect(source).toMatch(/className="writer-provider-line"[\s\S]{0,500}props\.(?:providerName|modelId)/);
    expect(styles).toMatch(/\.writer-context-count\s*\{[\s\S]{0,300}font-weight:\s*(?:7\d{2}|8\d{2})/);
  });

  it('keeps provider testing and saving in one action row with an explicit status', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const actionRowStart = source.indexOf('className="provider-form-actions"');
    const actionRow = source.slice(actionRowStart, actionRowStart + 1800);

    expect(actionRowStart).toBeGreaterThanOrEqual(0);
    expect(actionRow).toMatch(/测试连接/);
    expect(actionRow).toContain('保存连接方案');
    expect(actionRow).toContain('onClick=');
    expect(actionRow).toContain('type="submit"');
    expect(source).toContain('connectionStatus');
    expect(source).toContain('role="status"');
  });

  it('groups prompt layers and renders the distribution as non-card callouts', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(source).toMatch(/layer[\s\S]{0,160}character/);
    expect(source).toMatch(/layer[\s\S]{0,160}world/);
    expect(source).toContain('角色卡');
    expect(source).toContain('世界观设定');
    expect(source).toContain('className="prompt-composition-map"');
    expect(source).toContain('className="prompt-connector-lines"');
    expect(source).toContain('className="prompt-included-names"');
    expect(source).toContain('const combinePromptSources');
    expect(source).toContain('includedNames');
    expect(source).toMatch(/className="prompt-proportion-segment"[\s\S]{0,320}(?:data-(?:tone|color)|promptTone|--prompt-color)/);
    expect(styles).toContain('.prompt-composition-map');
    expect(styles).toContain('.prompt-connector-lines');
    const promptListStyleStart = styles.indexOf('.prompt-composition-list li');
    const promptIndexStyleStart = styles.indexOf('.prompt-composition-index', promptListStyleStart);
    const promptListStyles = styles.slice(promptListStyleStart, promptIndexStyleStart);
    expect(promptListStyleStart).toBeGreaterThanOrEqual(0);
    expect(promptIndexStyleStart).toBeGreaterThan(promptListStyleStart);
    expect(promptListStyles).not.toContain('background: var(--surface)');
    expect(promptListStyles).not.toContain('border-radius: var(--radius-card)');
    expect(styles).toContain('--prompt-tone-1');
    expect(styles).toContain('var(--prompt-color)');
  });

  it('combines character and world prompt sources without losing names or token totals', async () => {
    const { combinePromptSources } = await import('../src/App');
    const items = [
      { id: 'system', layer: 'system', title: '正文合同', reason: '规则', cacheBand: 'stable', estimatedTokens: 10 },
      { id: 'world-1', layer: 'world', title: '移动规则', reason: '设定', cacheBand: 'stable', estimatedTokens: 3 },
      { id: 'world-2', layer: 'world', title: '时间规则', reason: '设定', cacheBand: 'stable', estimatedTokens: 4 },
      { id: 'character-1', layer: 'character', title: '米拉', reason: '角色', cacheBand: 'stable', estimatedTokens: 5 },
      { id: 'character-2', layer: 'character', title: '诺亚', reason: '角色', cacheBand: 'stable', estimatedTokens: 6 },
    ] as const;

    const combined = combinePromptSources(items.map((item) => ({ ...item })));
    expect(combined.map((item) => item.title)).toEqual(['正文合同', '世界观设定', '角色卡']);
    expect(combined.find((item) => item.layer === 'world')).toMatchObject({
      estimatedTokens: 7,
      includedNames: ['移动规则', '时间规则'],
    });
    expect(combined.find((item) => item.layer === 'character')).toMatchObject({
      estimatedTokens: 11,
      includedNames: ['米拉', '诺亚'],
    });
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

  it('keeps mode switching open while role choice stays in the writing menu', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("onClick={() => props.onModeChange('author')}");
    expect(app).toContain("onClick={() => props.onModeChange('character')}");
    expect(app).toContain('id="character-select"');
    expect(app).not.toContain('onSetActiveCharacter');
    expect(app).not.toContain('设为扮演角色');
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
    expect(source).toContain('className="export-dialog"');
    expect(source).toContain('EPUB 电子书');
    expect(source).toContain('Markdown 文档');
    expect(source).toContain('TXT 纯文字');
    expect(source).toContain('JSON 完整备份');
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
    expect(source).toContain('删除所选世界观设定');
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

  it('lists writing style guidance before the plot outline', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const guidanceStart = source.indexOf('global-guidance-drawer');
    const styleLink = source.indexOf("openBookSettingsPage({ kind: 'style' })", guidanceStart);
    const outlineLink = source.indexOf("openBookSettingsPage({ kind: 'outline' })", guidanceStart);

    expect(guidanceStart).toBeGreaterThanOrEqual(0);
    expect(styleLink).toBeGreaterThan(guidanceStart);
    expect(styleLink).toBeLessThan(outlineLink);
  });

  it('uses the updated character and world-setting vocabulary and exposes section loading scope', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const scopeEditorStart = source.indexOf('function SourceLoadScope');
    const characterEditorStart = source.indexOf('function CharacterEditor');
    const worldEditorStart = source.indexOf('function WorldRuleEditor');
    const missingEditorStart = source.indexOf('function MissingSettingsItem');
    const scopeEditor = source.slice(scopeEditorStart, characterEditorStart);
    const characterEditor = source.slice(characterEditorStart, worldEditorStart);
    const worldEditor = source.slice(worldEditorStart, missingEditorStart);

    expect(characterEditor).toContain('角色要点');
    expect(characterEditor).toContain('角色设定');
    expect(characterEditor).not.toContain('角色职责');
    expect(characterEditor).not.toContain('角色资料');
    expect(characterEditor).toContain('加载角色卡');
    expect(characterEditor).toContain('<SourceLoadScope');

    expect(worldEditor).toContain('世界观设定');
    expect(worldEditor).toContain('设定名称');
    expect(worldEditor).toContain('设定内容');
    expect(worldEditor).not.toContain('世界观条例');
    expect(worldEditor).toContain('加载世界观设定');
    expect(worldEditor).toContain('<SourceLoadScope');
    expect(scopeEditor).toContain('className="source-load-tab"');
    expect(scopeEditor.indexOf('className="source-load-toggle"')).toBeLessThan(scopeEditor.indexOf('className="source-scope-disclosure"'));
    expect(scopeEditor.indexOf('className="source-scope-disclosure"')).toBeLessThan(scopeEditor.indexOf('className="source-scope-all"'));
    expect(scopeEditor).toContain('checked={enabled}');
    expect(scopeEditor).toContain('aria-pressed={loadsEverywhere}');
    expect(scopeEditor).toContain('<BookOpenText aria-hidden="true" />');
    expect(scopeEditor).toContain('onScopeChange(loadsEverywhere ? [] : undefined)');
    expect(scopeEditor).toContain('`${selectedIds.size}/${sectionIds.length} 小节`');
    expect(scopeEditor).toContain('loadedSectionIds ?? sectionIds');
    expect(scopeEditor).toContain('open &&');
    expect(scopeEditor).not.toContain('!loadsEverywhere &&');
    expect(styles).toMatch(/\.source-load-tab\s*\{[\s\S]{0,180}grid-template-columns:\s*44px minmax\(0, 1fr\) auto/);
    expect(styles).toMatch(/\.source-scope-all\[aria-pressed="true"\]\s*\{[\s\S]{0,160}background:\s*var\(--surface-active\)/);
    expect(source).toContain('loadedSectionIds');
    expect(source).toContain('function SourceLoadScope');
    expect(source).toContain('className="source-scope-drawer"');
    expect(source).toContain('加载范围');
    expect(source).toContain('全部小节');
    expect(source).not.toContain('onSetActiveCharacter');
    expect(source).not.toContain('设为扮演角色');
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
