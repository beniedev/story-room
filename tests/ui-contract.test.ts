import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createExampleBooks, upgradeExampleBookContent } from '../src/fixtures';

describe('writing UI contract', () => {
  it('keeps the manuscript out of chat UI structures', async () => {
    const source = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="manuscript"');
    expect(source).not.toMatch(/message-bubble|avatar-turn|chat-message|User:|Assistant:/i);
  });

  it('uses one stylesheet and semantic theme tokens', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain(':root[data-theme="manga"]');
    expect(source).toContain(':root[data-theme="gray"]');
    expect(source).toContain(':root[data-theme="purple"]');
    expect(source).toContain('--header-surface: rgba(247, 249, 252, 0.96)');
    expect(source).toContain('--header-surface: rgba(255, 250, 252, 0.92)');
    expect(source).toContain('--header-surface: #e8e9eb');
    expect(source).toContain('--header-surface: #faf8fd');
    expect(source).toContain('--surface-active: #faecf1');
    expect(source).toContain('--field-focus: rgba(94, 129, 172, 0.18)');
    expect(source).toContain('--field-focus: rgba(217, 111, 149, 0.18)');
    expect(source).toContain('--field-focus: rgba(143, 64, 82, 0.16)');
    expect(source).toContain('--field-focus: rgba(118, 86, 161, 0.16)');
    expect(source).toContain('--scrollbar-thumb: rgba(217, 111, 149, 0.58)');
    expect(source).toContain('--scrollbar-thumb-hover: rgba(217, 111, 149, 0.82)');
    expect(source).toContain('linear-gradient(var(--page-gradient-start) 0%, var(--page-gradient-end) 100%)');
    expect(source).toContain('@supports (appearance: base-select)');
    expect(source).toContain('@media (hover: hover) and (pointer: fine)');
    expect(source).toContain('select::picker(select)');
    expect(source).toContain('select option:checked');
    expect(source).toMatch(/select option::checkmark\s*\{[\s\S]{0,120}order:\s*1[\s\S]{0,120}margin-inline-start:\s*auto/);
    expect(source).toMatch(/\.manuscript-wrap\s*\{[\s\S]{0,220}background:\s*var\(--surface\)/);
    expect(source).toMatch(/\.manuscript\s*\{[\s\S]{0,420}background:\s*var\(--surface\)/);
    expect(source).toMatch(/\.writer-heading\s*\{[\s\S]{0,180}width:\s*min\(100%, var\(--workspace-max\)\)/);
    expect(source).toMatch(/\.writer-heading\s*\{[\s\S]{0,320}background:\s*var\(--header-surface\)/);
    expect(source).toMatch(/::-webkit-scrollbar-thumb\s*\{[\s\S]{0,120}background:\s*var\(--scrollbar-thumb\)/);
    expect(source).toContain('background: var(--field-focus, var(--field))');
    expect(source).toContain('.manuscript');
  });

  it('keeps the restricted first-person mode in the writing menu', async () => {
    const source = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
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
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    expect(writer).toContain('className="writer-context-progress"');
    expect(writer).toContain('className="writer-tool-row"');
    expect(writer).toContain('role="group" aria-label="写作工具"');
    expect(writer).toContain('className="book-settings-button icon-button writer-book-settings-button"');
    expect(writer).toContain('<BookMarked aria-hidden="true" /></button>');
    expect(writer).not.toContain('<BookMarked aria-hidden="true" /><span>设定</span>');
    expect(writer).toContain('className="writer-tool-actions"');
    expect(writer).toContain('className="writer-section-title"');
    expect(writer).toContain('className="writer-action-menu"');
    expect(writer).toContain('className="writer-menu-modes"');
    expect(writer).toContain('打开写作操作');
    expect(writer).toContain('修改小节名称');
    expect(writer).not.toContain('aria-label="导出当前书目"');
    expect(app).toContain('aria-label="导出当前书目"');
    expect(writer).toMatch(/className="primary-action icon-button writer-send-button"[\s\S]{0,520}<Send aria-hidden="true" \/>/);
    expect(writer).toContain('closeActionMenu(true)');
    expect(app).toContain('restoreShelfFocus.current = true');
    expect(writer).not.toContain('上一小节');
    expect(writer).not.toContain('下一小节');
    expect(writer).not.toContain('查看当前 Prompt');
  });

  it('keeps the desktop shelf hierarchy compact and removes the clickable brand home', async () => {
    const source = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/<button\b[\s\S]{0,300}className="brand-home"[\s\S]{0,300}<\/button>/);

    const shelfContentStart = source.indexOf('className="shelf-content"');
    const selectorIndex = source.indexOf('className="book-library-drawer"');
    const toolbarIndex = source.indexOf('className="directory-toolbar"');
    expect(shelfContentStart).toBeGreaterThanOrEqual(0);
    expect(selectorIndex).toBeGreaterThan(shelfContentStart);
    expect(selectorIndex).toBeLessThan(toolbarIndex);
  });

  it('uses one wide desktop workspace while preserving the mobile manuscript gutter', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(styles).toContain('--workspace-max: 72rem');
    expect(styles).toContain('--workspace-wide-max: 78rem');
    for (const selector of [
      '.writer-context-row',
      '.writer-tool-row',
      '.writer-section-title',
      '.manuscript',
      '.block-editor-body',
    ]) {
      const start = styles.indexOf(`${selector} {`);
      const rule = styles.slice(start, styles.indexOf('\n}', start) + 2);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(rule).toContain('var(--workspace-max)');
    }
    expect(styles).toMatch(/\.source-editor-fields,[\s\S]{0,120}\.source-scope-page > \.source-scope-drawer\s*\{[\s\S]{0,160}var\(--workspace-max\)/);
    expect(styles).toMatch(/\.shelf-page\s*\{[\s\S]{0,220}var\(--workspace-wide-max\)/);
    expect(styles).toMatch(/\.writer-page\s*\{[\s\S]{0,260}grid-template-rows:\s*auto minmax\(0, 1fr\)[\s\S]{0,180}overflow:\s*hidden/);
    expect(styles).toMatch(/\.manuscript-wrap\s*\{[\s\S]{0,260}width:\s*min\(100%, var\(--workspace-max\)\)[\s\S]{0,180}overflow-y:\s*auto/);
    expect(styles).toMatch(/html:has\(\.writer-page\),[\s\S]{0,80}body:has\(\.writer-page\)[\s\S]{0,100}overflow:\s*hidden/);
    expect(styles).toMatch(/@media \(max-width: 46rem\)[\s\S]*\.manuscript\s*\{[\s\S]{0,160}padding:\s*1\.2rem 1rem 5\.5rem/);
    expect(styles).not.toContain('width: min(100%, 72ch)');
  });

  it('matches the home settings entry to the shallow icon-only writing control', async () => {
    const source = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const toolbarStart = source.indexOf('className="directory-toolbar"');
    const chapterListStart = source.indexOf('<ol className="chapter-list"', toolbarStart);
    const toolbar = source.slice(toolbarStart, chapterListStart);

    expect(toolbar).toContain('className="book-settings-button icon-button"');
    expect(toolbar).toContain('<BookMarked aria-hidden="true" /></button>');
    expect(toolbar).not.toContain('<span>设定</span>');
    expect(styles).toMatch(/\.book-settings-button\s*\{[\s\S]{0,220}width:\s*44px[\s\S]{0,160}padding:\s*0[\s\S]{0,160}background:\s*var\(--surface\)/);
  });

  it('separates book switching from book creation and current-book management', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const shelf = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const source = `${app}\n${shelf}`;
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const panelStart = source.indexOf('className="book-library-panel"');
    const panelEnd = source.indexOf('</details>', panelStart);
    const panel = source.slice(panelStart, panelEnd);

    expect(source).toContain('<BookPlus aria-hidden="true" />');
    expect(source).toContain('className="book-library-controls"');
    expect(source).toContain('className="book-actions-menu"');
    expect(source).toContain('className="icon-button book-actions-trigger"');
    expect(source).toContain('管理当前书目');
    expect(source).toContain('<Ellipsis aria-hidden="true" />');
    expect(panel).toContain('切换书目');
    expect(panel).not.toContain('修改书名');
    expect(panel).not.toContain('删除书目');
    expect(panel).not.toContain('新建书目');
    expect(source).toContain("if (entry.id !== props.book.id) props.onOpenBook(entry.id);");
    expect(source).toContain('book-settings-button');
    expect(styles).toMatch(/\.book-settings-button\s*\{[\s\S]{0,300}background:\s*var\(--surface\)[\s\S]{0,120}color:\s*var\(--accent-strong\)/);
    expect(styles).toMatch(/\.book-library-panel\s*\{[\s\S]{0,220}position:\s*absolute[\s\S]{0,220}width:\s*100%/);
    expect(styles).toMatch(/\.book-selector-card\s*\{[\s\S]{0,320}background:\s*var\(--surface\)/);
    expect(styles).toContain('.book-library-drawer[open] > .book-selector-card');
    expect(styles).toMatch(/\.book-list button\[aria-current\]\s*\{[\s\S]{0,100}background:\s*var\(--surface\)/);
    expect(styles).toMatch(/\.book-actions-menu-panel\s*\{[\s\S]{0,260}position:\s*absolute[\s\S]{0,220}width:\s*12rem/);
    expect(styles).toMatch(/\.book-actions-trigger\s*\{[\s\S]{0,260}cursor:\s*pointer/);
    expect(styles).toMatch(/\.book-menu-action\s*\{[\s\S]{0,260}cursor:\s*pointer/);
  });

  it('passes the active provider metadata to the writer and emphasizes the context count', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const writerInvocationStart = source.indexOf('<Writer');
    const writerInvocationEnd = source.indexOf('/>', writerInvocationStart);
    const writerInvocation = source.slice(writerInvocationStart, writerInvocationEnd);

    expect(writer).toContain('作者模式 · 写作接龙');
    expect(source).not.toContain('作者模式 · 接龙');
    expect(writerInvocation).toMatch(/provider(?:Profile)?Name\s*=/);
    expect(writerInvocation).toMatch(/modelId\s*=/);
    expect(writer).toContain('className="writer-provider-line"');
    expect(writer).toContain('字数 <strong>{manuscriptWordCount');
    expect(writer).toContain('token <strong>{compactTokenCount(manuscriptTokenCount)');
    expect(writer).not.toContain(' 字符</small>');
    expect(writer).toMatch(/className="writer-provider-line"[\s\S]{0,500}props\.(?:providerName|modelId)/);
    expect(styles).toMatch(/\.writer-context-count\s*\{[\s\S]{0,300}font-weight:\s*(?:7\d{2}|8\d{2})/);
  });

  it('keeps provider testing and saving in one action row with an explicit status', async () => {
    const source = await readFile(new URL('../src/components/ProviderSettings.tsx', import.meta.url), 'utf8');
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

  it('keeps the overview non-modal and uses a native dialog for context selection', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const composition = await readFile(new URL('../src/components/ContextCompositionDrawer.tsx', import.meta.url), 'utf8');
    const tools = await readFile(new URL('../src/components/ContextToolsDrawer.tsx', import.meta.url), 'utf8');
    const focus = await readFile(new URL('../src/components/shared/dialogFocus.ts', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const settingsStart = source.indexOf('function SettingsDrawer');
    const settings = source.slice(settingsStart);
    const contextControlsStart = writer.indexOf('className="writer-context-trigger"');
    const contextControlsEnd = writer.indexOf('className="writer-tool-actions"', contextControlsStart);
    const contextControls = writer.slice(contextControlsStart, contextControlsEnd);
    const leadingStart = writer.indexOf('className="writer-tool-leading"');
    const leadingGroup = writer.slice(leadingStart, leadingStart + 1500);

    expect(composition).toContain('export function ContextCompositionDrawer');
    expect(tools).toContain('export function ContextToolsDrawer');
    expect(composition).toContain('<section');
    expect(source).not.toContain('contextCompositionDialog');
    expect(source).not.toContain('contextToolsDialog');
    expect(writer).toContain('className="writer-context-trigger"');
    expect(contextControls).not.toContain('aria-haspopup="dialog"');
    expect(contextControls).toContain('aria-controls="context-composition-drawer"');
    expect(contextControls).toContain('aria-controls="context-tools-drawer"');
    expect(writer).toMatch(/className="writer-context-progress"[\s\S]{0,180}aria-hidden="true"/);
    expect(settings).not.toContain('prompt-composition');
    expect(composition).not.toContain('TARGET');
    expect(composition).not.toContain('context-budget');
    expect(composition).not.toContain('context-reference-section');
    expect(composition).not.toContain('context-included-details');
    expect(composition).not.toContain('context-exact-messages');
    expect(composition).not.toContain('prompt-composition-note');
    expect(composition).not.toContain('cacheBandLabel');
    expect(composition).not.toContain('semanticRole');
    expect(composition).toContain("title: '正在写'");
    expect(composition).toContain("title: '前文梗概/全文'");
    expect(writer).toContain('writer-context-tools-button');
    expect(leadingGroup.indexOf('writer-book-settings-button')).toBeLessThan(leadingGroup.indexOf('writer-context-tools-button'));
    expect(leadingGroup).toContain('aria-label="选择前文"');
    expect(leadingGroup).toContain('title="选择前文"');
    expect(leadingGroup).toContain('<ListTree aria-hidden="true" />');
    expect(leadingGroup).not.toContain('<FileStack aria-hidden="true" />');
    expect(leadingGroup).not.toContain('<ListChecks aria-hidden="true" />');
    expect(leadingGroup).not.toContain('aria-haspopup="dialog"');
    expect(source).toContain('setContextToolsOpen(false)');
    expect(source).toContain('setContextCompositionOpen(false)');
    expect(source).toContain('contextCompositionTrigger.current?.focus()');
    expect(source).toContain('contextToolsTrigger.current?.focus()');
    expect(focus).toContain('focusFirstDrawerElement');
    expect(focus).not.toContain('trapDrawerFocus');
    expect(focus).toContain('element.getClientRects().length > 0');
    expect(tools).toContain('window.requestAnimationFrame(() => focusFirstDrawerElement(drawer));');
    expect(tools).toContain('window.cancelAnimationFrame(frame)');
    expect(composition).toContain('data-open={open}');
    expect(tools).toContain('<dialog');
    expect(tools).toContain('inert={!open}');
    expect(tools).toContain('drawer.showModal()');
    expect(tools).toContain("if (event.key !== 'Escape' || summaryConfirmDialog.current?.open) return;");
    expect(tools).toContain('onCancel={(event) => {');
    expect(source).toContain("document.addEventListener('keydown', closeOpenContextDrawer)");
    expect(source).toContain("event.key !== 'Escape'");
    expect(writer).toMatch(/className="writer-heading"[\s\S]{0,2600}<ContextCompositionDrawer/);
    expect(composition).toMatch(/layer[\s\S]{0,160}character/);
    expect(composition).toMatch(/layer[\s\S]{0,160}world/);
    expect(composition).toContain('角色卡');
    expect(composition).toContain('世界观设定');
    expect(composition).toContain('className="prompt-composition-map"');
    expect(composition).not.toContain('className="prompt-connector-lines"');
    expect(composition).not.toContain('className="prompt-included-names"');
    expect(composition).toContain('const combinePromptSources');
    expect(composition).toContain('groupPromptComposition');
    expect(composition).toMatch(/className="prompt-proportion-segment"[\s\S]{0,320}(?:data-(?:tone|color)|promptTone|--prompt-color)/);
    expect(styles).toContain('.prompt-composition-map');
    expect(styles).not.toContain('.prompt-connector-lines');
    expect(styles).toContain('.context-composition-drawer[data-open="true"]');
    expect(styles).toContain('.context-tools-drawer[data-open="true"]');
    expect(tools).toContain('前文选择');
    expect(tools).toContain('加载前文');
    expect(tools).toContain('source-scope-drawer context-reference-scope');
    expect(source).not.toContain('context-reference-presets');
    const sharedDrawerStyles = styles.indexOf('.context-composition-drawer,');
    const compositionStyleStart = styles.indexOf('.context-composition-drawer {', sharedDrawerStyles + 1);
    const compositionStyles = styles.slice(compositionStyleStart, styles.indexOf('.context-tools-drawer {', compositionStyleStart));
    const toolStyles = styles.slice(styles.indexOf('.context-tools-drawer {'), styles.indexOf('.context-composition-drawer[data-open="true"]'));
    expect(compositionStyles).toContain('max-height: 0');
    expect(compositionStyles).toContain('position: fixed');
    expect(toolStyles).toContain('position: fixed');
    expect(styles).toContain('transform: translateX(-100%)');
    expect(styles).toMatch(/@starting-style\s*\{[\s\S]*\.context-tools-drawer\[data-open="true"\][\s\S]*transform:\s*translateX\(-100%\)/);
    expect(styles).not.toContain('.context-composition-drawer::backdrop');
    expect(styles).toContain('.context-tools-drawer::backdrop');
    const promptListStyleStart = styles.indexOf('.prompt-composition-list li');
    const promptIndexStyleStart = styles.indexOf('.prompt-composition-index', promptListStyleStart);
    const promptListStyles = styles.slice(promptListStyleStart, promptIndexStyleStart);
    expect(promptListStyleStart).toBeGreaterThanOrEqual(0);
    expect(promptIndexStyleStart).toBeGreaterThan(promptListStyleStart);
    expect(promptListStyles).not.toContain('background: var(--surface)');
    expect(promptListStyles).not.toContain('border-radius: var(--radius-card)');
    expect(promptListStyles).not.toContain('border-inline-start');
    expect(styles).toContain('background: color-mix(in srgb, var(--prompt-color) 34%, var(--surface))');
    expect(styles).toContain('--prompt-tone-1');
    expect(styles).toContain('var(--prompt-color)');
  });

  it('uses the compact checkbox and inline synopsis interaction for previous sections', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const tools = await readFile(new URL('../src/components/ContextToolsDrawer.tsx', import.meta.url), 'utf8');
    const operation = await readFile(new URL('../src/components/shared/DialogOperationStatus.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(tools).toContain('前文选择');
    expect(tools).toContain('source-scope-drawer context-reference-scope');
    expect(tools).toContain('className="source-scope-chapters"');
    expect(tools).toContain('<fieldset');
    expect(tools).toContain('type="checkbox"');
    expect(tools).toContain('className="context-reference-checkbox"');
    expect(tools).toContain('className="context-reference-disclosure"');
    expect(tools).toContain('aria-expanded={expanded}');
    expect(tools).not.toContain('<select');
    expect(tools).not.toContain('sectionReferenceModes');
    expect(tools).toContain('selectAllUnsetReferences');
    expect(tools).not.toContain('清空全部');
    expect(tools).not.toContain('SectionMemoryEditor');
    expect(tools).toContain('<textarea');
    expect(tools).toContain('className="icon-button context-summary-generate"');
    expect(tools).toContain("requestSummaryAction(item, 'generate')");
    expect(tools).toContain('aria-label={summaryBusy');
    expect(tools).toContain('className="primary-action icon-button context-summary-save"');
    expect(tools).toContain('onClick={requestSummarySave}');
    expect(tools).toContain('onSaveMemoriesAndLoad(entries)');
    expect(tools).toContain('aria-label="保存并加载梗概"');
    expect(tools).not.toContain('window.confirm');
    expect(tools).toContain('className="confirm-dialog"');
    expect(tools).toContain('summaryConfirmDialog.current?.showModal()');
    expect(tools).toContain('确认生成');
    expect(tools).toContain('确认保存并加载');
    expect(tools).toContain("pendingSummaryAction === 'save'");
    expect(tools).toContain('正在生成梗概…');
    expect(tools).toContain('已生成梗概');
    expect(operation).toContain('5_000');
    expect(operation).toContain("document.addEventListener('pointerdown', dismiss, true)");
    expect(tools).toContain('<DialogOperationStatus');
    expect(tools).toContain('onContextReferenceChange(item.section.id, !selected)');
    expect(tools).not.toContain('context-budget');
    expect(tools).not.toContain('context-plan');
    expect(tools).not.toContain('context-memory-section');
    expect(styles).toContain('.context-composition-drawer .drawer-heading');
    expect(styles).toContain('.context-tools-drawer .drawer-heading');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('.context-reference-row');
    expect(styles).not.toContain('.context-tools-drawer .context-reference-row');
    expect(styles).toContain('grid-template-columns: 44px minmax(0, 1fr)');
    expect(styles).toContain('.context-summary-editor');
    expect(styles).toContain('.context-summary-actions');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 3.5rem');
    expect(styles).toContain('.context-summary-actions .icon-button');
    expect(styles).toContain('grid-template-rows: 3.5rem 3.5rem');
    expect(styles).toContain('grid-row: 2');
    expect(styles).toContain('.dialog-operation-spinner');
    expect(tools).toContain("<span>{allSelected ? '取消全选' : '全选'}</span>");
    expect(tools).not.toContain('<BookOpenText aria-hidden="true" />');
    expect(tools).toContain('selectAllRef.current.indeterminate = someSelected');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps previous-content selection backward-only and behind the normalized save path', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const tools = await readFile(new URL('../src/components/ContextToolsDrawer.tsx', import.meta.url), 'utf8');
    const source = `${app}\n${tools}`;
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('normalizeBook(await api.loadBook(bookId))');
    expect(source).toContain('const candidate = normalizeBook(book);');
    expect(source).toContain('const updateContextReference');
    expect(source).toContain('source.ordinal >= targetOrdinal');
    expect(source).toContain('if (!source.section.content.trim() && selected) return;');
    expect(source).toContain("if (selected) references.push({ sectionId: sourceSectionId, mode: 'full', reason: 'manual' });");
    expect(source).not.toContain('应用建议');
    expect(source).not.toContain('前一节：梗概 + 全文');
    expect(source).not.toContain('清空前文参考');
    expect(source).not.toContain('value={mode}');
    expect(source).toContain('disabled={busy || (!hasContent && !selected)}');
    expect(source).toContain('这是第一节，暂无前文可选');
    expect(source).toContain("mode: 'summary', reason: 'manual'");
    expect(source).toContain('parseSectionMemoryDraft(result.draft)');
    expect(source).toContain('commitSectionMemoryDraft(source.section, draft, provenance)');
    expect(source).not.toContain('assertGenerationBudget(');
    expect(source).not.toContain('contextDialog');
    expect(styles).toContain('.context-summary-generate');
  });

  it('combines character and world prompt sources without losing names or token totals', async () => {
    const { combinePromptSources } = await import('../src/components/ContextCompositionDrawer');
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

  it('keeps author relay input and persistent section guidance inside the continuous manuscript', async () => {
    const app = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(app).toContain('className="writer-section-note"');
    expect(app).toContain('小节注释');
    expect(app).toContain('authorNote');
    expect(app).toContain('onAuthorNoteChange');
    expect(app).toContain('指导当前小节之后的写作，不进入正文；修改后会保留，并在作者和扮演模式中生效。');
    expect(app).toContain('写下一段正文，让 AI 从这里接着写');
    expect(app).not.toContain('props.section?.note');
    expect(app).not.toContain('onSectionNoteChange');
    expect(app).toContain('className="manuscript-block-group"');
    expect(app).toContain('className="manuscript-block"');
    expect(app).toContain('className="manuscript-block-select icon-button"');
    expect(app).toContain('<MousePointer2 aria-hidden="true" />');
    expect(app).toContain("? '取消选择' : '选择'} ${block.kind === 'user' ? '用户输入' : 'AI 输出'}片段");
    expect(app).not.toContain('aria-describedby={`manuscript-block-content-${block.id}`}');
    expect(app).not.toContain('className="manuscript-block-copy">{renderBlockContent(block)}</span>\n              </button>');
    expect(app).toContain('className="manuscript-block-actions"');
    expect(app).not.toContain('className="writer-block-actions"');
    expect(app).toContain('重新生成所选 AI 输出');
    expect(app).toContain("{block.kind === 'assistant' && <button");
    expect(app).toContain('编辑所选片段');
    expect(app).toContain('删除所选片段');
    expect(app).toContain('只会删除当前选中的这一块用户输入或 AI 输出');
    expect(app).toContain('className="manuscript-dialogue"');
    expect(styles).toContain('--manuscript-user: #4a354d');
    expect(styles).toContain('--manuscript-ai: #7d63c7');
    expect(styles).toContain('--manuscript-emphasis: #7d63c7');
    expect(styles).toContain('--manuscript-dialogue: #9a6b20');
    expect(styles).toMatch(/:root\[data-theme="manga"\] \.manuscript-block em\s*\{[\s\S]{0,100}color:\s*var\(--manuscript-emphasis\)/);
    expect(styles).toContain('.manuscript-block[data-kind="assistant"]');
    expect(styles).toContain('.manuscript-block-group:hover .manuscript-block-select');
    expect(styles).toContain('pointer-events: none');
    expect(styles).toContain('.manuscript-block-actions .icon-button:focus-visible');
    expect(styles).toContain('.writer-heading .icon-button:hover');
    expect(styles).toContain('.writer-menu-trigger:hover');
  });

  it('sends directly, appends the continuation, clears input, and keeps section guidance', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const source = `${app}\n${writer}`;
    expect(source).toContain('const generateContinuation = () => withBusy(async () => {');
    expect(source).toContain('const authorNote = section?.note ??');
    expect(source).toContain('authorNote: noteSnapshot || undefined');
    expect(source).not.toContain('setAuthorNote(');
    expect(source).toContain("setInstruction((current) => current === inputSnapshot ? '' : current)");
    expect(source).toContain("{ id: makeId('block'), kind: 'assistant', content: result.draft }");
    expect(source).toContain('续写已加入当前小节。');
    expect(source).toContain("aria-label={props.busy ? '正在续写' : '发送并续写'}");
    expect(source).not.toContain('className="draft-preview"');
    expect(source).not.toContain('应用到正文');
    expect(source).not.toContain('放弃预览');
    expect(source).not.toContain('Fake Provider 已生成待应用正文');
  });

  it('keeps mode switching open while role choice stays in the writing menu', async () => {
    const app = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    expect(app).toContain("onClick={() => props.onModeChange('author')}");
    expect(app).toContain("onClick={() => props.onModeChange('character')}");
    expect(app).toContain('id="character-select"');
    expect(app).not.toContain('onSetActiveCharacter');
    expect(app).not.toContain('设为扮演角色');
  });

  it('opens a selected block in a full-screen editor with immediate autosave', async () => {
    const app = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(app).toContain("const [editingBlockId, setEditingBlockId] = useState('');");
    expect(app).toContain('const readerScrollPosition = useRef(0);');
    expect(app).toContain('const editingBlock = blocks.find((item) => item.id === editingBlockId);');
    expect(app).toContain('className="block-editor-page"');
    expect(app).toContain('className="block-editor-header"');
    expect(app).toContain('className="block-editor-textarea"');
    expect(app).toContain('onChange={(event) => props.onSectionBlocksChange');
    expect(app).toContain('自动保存');
    expect(app).toContain('manuscriptWrapRef.current?.scrollTop');
    expect(app).toContain('manuscriptWrapRef.current.scrollTop = readerScrollPosition.current');
    expect(app).not.toContain('window.scrollY');
    expect(app).not.toContain('window.scrollTo');
    expect(app).not.toContain('<main className="block-editor-body">');
    expect(app).toContain('readerScrollPosition.current');
    expect(app).not.toContain('editBlockDialog');
    expect(app).not.toContain('edit-block-input');
    expect(styles).toContain('.block-editor-page');
    expect(styles).toContain('.block-editor-textarea');
    expect(styles).toContain('max(1rem, var(--manuscript-font-size, 16px))');
  });

  it('keeps full-book cache device-only and clears legacy host caches', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const shelf = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const source = `${app}\n${shelf}`;
    const readStart = source.indexOf('const readCachedBook');
    const cacheStart = source.indexOf('const cacheBook');
    const removeStart = source.indexOf('const removeCachedBook');
    const clearStart = source.indexOf('const clearHostBookCaches');
    const newerStart = source.indexOf('const newerBook');
    expect(readStart).toBeGreaterThanOrEqual(0);
    expect(cacheStart).toBeGreaterThan(readStart);
    expect(removeStart).toBeGreaterThan(cacheStart);
    expect(clearStart).toBeGreaterThan(removeStart);
    expect(newerStart).toBeGreaterThan(clearStart);

    const readCache = source.slice(readStart, cacheStart);
    const writeCache = source.slice(cacheStart, removeStart);
    const removeCache = source.slice(removeStart, clearStart);
    const clearCache = source.slice(clearStart, newerStart);
    expect(readCache).toContain("if (api.runtime !== 'device') return null;");
    expect(readCache).toContain('localStorage.getItem(bookCacheKey(bookId)');
    expect(writeCache).toContain("if (api.runtime !== 'device') return false;");
    expect(writeCache).toContain('localStorage.setItem(bookCacheKey(book.id)');
    expect(removeCache).toContain("if (api.runtime !== 'device') return;");
    expect(removeCache).toContain('localStorage.removeItem(bookCacheKey(bookId))');
    expect(clearCache).toContain("if (api.runtime === 'device') return;");
    expect(clearCache).toContain('localStorage.length');
    expect(clearCache).toContain('key?.startsWith(bookCachePrefix)');
    expect(clearCache).toContain('localStorage.removeItem(key)');
    expect(source).toMatch(/useEffect\(\(\) => \{\s+clearHostBookCaches\(\);\s+\}, \[\]\);/);
    expect(source).toContain("const cached = api.runtime === 'device' ? readCachedBook(bookId) : null;");
    expect(source).toContain("if (api.runtime === 'device') cacheBook(candidate);");
    expect(source).toContain('正在保存到书库…');
    expect(source).toContain('已自动保存。');
    expect(source).not.toContain('已自动保存到此设备，正在写入本机故事目录…');
    expect(source).not.toContain('已自动保存到此设备和本机故事目录。');
    expect(source).toContain('<Download aria-hidden="true" />');
    expect(source).toContain('className="export-dialog"');
    expect(source).toContain('EPUB 电子书');
    expect(source).toContain('Markdown 文档');
    expect(source).toContain('TXT 纯文字');
    expect(source).toContain('JSON 完整备份');
    expect(source).toContain('className="book-library-drawer"');
    expect(source).toContain('className="book-selector-card"');
    expect(source).not.toContain('id="book-select"');
  });

  it('keeps book creation and source management compact and understandable', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const shelf = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const memory = await readFile(new URL('../src/components/SectionMemoryEditor.tsx', import.meta.url), 'utf8');
    const tools = await readFile(new URL('../src/components/ContextToolsDrawer.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const source = `${app}\n${shelf}\n${writer}\n${memory}\n${tools}`;
    expect(source).toContain("openNameDialog({ kind: 'new-book'");
    expect(source).toContain("openNameDialog({ kind: 'new-section'");
    expect(source).toContain("openCurrentBookNameDialog({ kind: 'rename-book'");
    expect(source).toContain("openNameDialog({ kind: 'rename-chapter'");
    expect(source).not.toContain("openNameDialog({ kind: 'rename-section'");
    expect(source).toContain('id="section-title-dialog-heading"');
    expect(source).toContain('if (id !== sectionId) {');
    expect(source).not.toContain("setDraftInstruction('')");
    expect(source).toContain('toggleChapterSelection');
    expect(source).toContain('toggleSectionSelection');
    expect(shelf).toContain('className="directory-selection-checkbox"');
    expect(shelf).toContain("? 'checked'");
    expect(shelf).toContain("? 'mixed'");
    expect(styles).toContain('.directory-selection-checkbox[data-state="mixed"]::after');
    expect(source).toContain("kind: 'selection'");
    expect(source).toContain('删除所选内容');
    expect(source).toContain('返回本书设定');
    expect(source).toContain('bookSettingsView');
    expect(source).toContain('returnBookSettingsParent');
    expect(source).toContain('compact-book-settings-heading');
    expect(source).toContain('<h2 id="book-settings-title" className="sr-only">{bookSettingsTitle}</h2>');
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
    expect(source).not.toContain('本机书库已打开。');
    expect(source).toContain('className="book-settings-drawer"');
    expect(source).toContain('className="name-dialog"');
    expect(source).toContain('className="confirm-dialog"');
    expect(source).toContain('const titleInputRef = useRef<HTMLInputElement>(null);');
    expect(source).toContain('titleInputRef.current?.select();');
    expect(source).toContain('const focusNameInput = () => {');
    expect(source).toContain('const focusTarget = () => {');
    expect(source).toContain('className="source-group-drawer"');
    expect(source).toContain('章节名称');
    expect(source).toContain('小节名称');
    expect(source).toContain('danger-icon');
    expect(source).not.toContain('window.confirm');
    expect(source).toContain('确认保存前不会写入书目');
    expect(source).toContain('本书设定');
    expect(source).not.toContain('电子书目录');
    expect(source).not.toContain('aria-label="书目视图"');
    expect(source).not.toContain('Canon 与摘要');
    expect(source).not.toContain('<span>装入 Prompt</span>');
    expect(source).not.toContain('剧情记忆');
    expect(source).not.toContain('Book 隔离视图');
    expect(source).not.toContain('StoryGraph');
  });

  it('keeps confirmation dialogs open until the real operation succeeds or fails', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const shelf = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const tools = await readFile(new URL('../src/components/ContextToolsDrawer.tsx', import.meta.url), 'utf8');
    const feedback = await readFile(new URL('../src/components/shared/DialogOperationStatus.tsx', import.meta.url), 'utf8');

    expect(app).toContain('const commitBookChange = async');
    expect(app).toContain('await queueBookSave(candidate)');
    expect(shelf).toContain('await props.onAddSection');
    expect(shelf).toContain("setNameOperation({ phase: 'pending'");
    expect(shelf).toContain("setDeleteOperation({ phase: 'pending', title: '正在删除…' })");
    expect(shelf).toContain("setConfirmOperation({ phase: 'pending', title: `正在保存${sourceLabel}加载范围…` })");
    expect(shelf).toContain('await onConfirm(selectionPatch())');
    expect(writer).toContain('props.onDeleteSectionBlock(selectedBlock.id)');
    expect(writer).toContain("setTitleOperation({ phase: 'pending', title: '正在保存修改…' })");
    expect(tools).toContain("title: '正在保存并加载梗概…'");
    expect(tools).toContain("title: '梗概保存并加载失败'");
    expect(feedback).toContain("role={state.phase === 'error' ? 'alert' : 'status'}");
    expect(feedback).toContain("document.addEventListener('pointerdown', dismiss, true)");
  });

  it('keeps settings compact while supporting reusable provider profiles', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const provider = await readFile(new URL('../src/components/ProviderSettings.tsx', import.meta.url), 'utf8');
    const writer = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const composition = await readFile(new URL('../src/components/ContextCompositionDrawer.tsx', import.meta.url), 'utf8');
    const source = `${app}\n${provider}\n${writer}\n${composition}`;
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('选择皮肤');
    expect(source).toContain('id="theme-select"');
    expect(source).toContain('<option value="paper">蓝雪</option>');
    expect(source).not.toContain('蓝雪 · 默认');
    expect(source).toContain('<option value="manga">粉漫</option>');
    expect(source).toContain('<option value="gray">灰度</option>');
    expect(source).toContain('<option value="purple">紫雅</option>');
    expect(source).toContain('id="provider-profile-select"');
    expect(writer).not.toContain('<span>设定</span>');
    expect(writer).toContain('className="book-settings-button icon-button writer-book-settings-button"');
    expect(source).toContain('模型连接');
    expect(source).toContain('API Key');
    expect(source).toContain('模型 ID');
    expect(source).toContain('最大上下文');
    expect(source).toContain('最大输出');
    expect(source).toContain('保存连接方案');
    const settingsStart = source.indexOf('function SettingsDrawer');
    expect(source.slice(settingsStart)).not.toContain('Prompt 组合');
    expect(source).toContain("if (view !== 'write' || !book || !section) return { plan: null, error: '' };");
    expect(source).toContain('activeProviderProfile.maxContext');
    expect(source).toContain('activeProviderProfile.maxOutput');
    expect(source).toContain('availableInput');
    expect(source).toContain('prompt-proportion-bar');
    expect(source).toContain('promptShareLabel(share)');
    expect(source).toContain('const promptCompositionGroup');
    expect(source).toContain("title: '正在写'");
    expect(source).toContain("title: '前文梗概/全文'");
    expect(source).toContain('API Key 会以明文保存在本机配置文件');
    expect(source).toContain('只有在你信任本机和 Provider 端点时才使用');
    expect(source).toContain('仅在你信任当前页面和目标 URL 时输入 API Key');
    expect(source).toContain('当前页面脚本可读取且不会持久化');
    expect(source).toContain('type="password"');
    expect(source).not.toContain('访问密码');
    expect(source).not.toContain('host-access');
    expect(source).toContain('<h3 id="storage-heading">保存位置</h3>');
    expect(source).toContain('正文和资料保存在本地：');
    expect(source).toContain('可以使用导出功能，导出为其他格式的文件。');
    expect(source).toContain('api.storageLocation()');
    expect(source).not.toContain('本机 host 的故事目录');
    expect(source).not.toContain('保存并连接');
    expect(source).not.toContain('window.prompt');
    expect(source).toContain('event.target === event.currentTarget');
    expect(source).toContain('const restoreProfileBaseline = () => {');
    expect(source).toContain("setDiscardOperation({ phase: 'success', title: '已放弃修改' })");
    expect(source).toMatch(/const finishDiscardAction = \(\) => \{[\s\S]{0,180}applySettingsAction\(action\);/);
    expect(styles).toContain('.instruction-dock textarea:focus');
    expect(styles).toContain('background: var(--surface)');
    expect(source).not.toContain('className="settings-list-row');
    expect(source).not.toContain('className="provider-profile-list');
  });

  it('lists writing style guidance before the plot outline', async () => {
    const source = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const guidanceStart = source.indexOf('global-guidance-drawer');
    const styleLink = source.indexOf("openBookSettingsPage({ kind: 'style' })", guidanceStart);
    const outlineLink = source.indexOf("openBookSettingsPage({ kind: 'outline' })", guidanceStart);

    expect(guidanceStart).toBeGreaterThanOrEqual(0);
    expect(styleLink).toBeGreaterThan(guidanceStart);
    expect(styleLink).toBeLessThan(outlineLink);
  });

  it('uses the updated character and world-setting vocabulary and exposes section loading scope', async () => {
    const source = await readFile(new URL('../src/components/Bookshelf.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const scopeEditorStart = source.indexOf('function SourceLoadScopePage');
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
    expect(characterEditor).toContain('className="icon-button source-scope-open"');
    expect(characterEditor).toContain('<ListTree aria-hidden="true" />');

    expect(worldEditor).toContain('世界观设定');
    expect(worldEditor).toContain('设定名称');
    expect(worldEditor).toContain('设定内容');
    expect(worldEditor).not.toContain('世界观条例');
    expect(worldEditor).toContain('加载世界观设定');
    expect(worldEditor).toContain('className="icon-button source-scope-open"');
    expect(worldEditor).toContain('<ListTree aria-hidden="true" />');
    expect(scopeEditor).toContain('className="source-load-tab"');
    expect(scopeEditor.indexOf('className="source-load-toggle"')).toBeLessThan(scopeEditor.indexOf('className="source-scope-all"'));
    expect(scopeEditor.indexOf('className="source-scope-all"')).toBeLessThan(scopeEditor.indexOf('source-scope-confirm'));
    expect(scopeEditor).toContain('checked={allSelected}');
    expect(scopeEditor).toContain('selectAllRef.current.indeterminate = someSelected');
    expect(scopeEditor).toContain('aria-pressed={allSelected}');
    expect(scopeEditor).not.toContain('<BookOpenText aria-hidden="true" />');
    expect(scopeEditor).toContain("<span>{allSelected ? '取消全选' : '全选'}</span>");
    expect(scopeEditor).toContain('loadedSectionIds ?? sectionIds');
    expect(scopeEditor).toContain('includeInPrompt: orderedIds.length > 0');
    expect(scopeEditor).toContain('await onConfirm(selectionPatch())');
    expect(scopeEditor).toContain('确认载入{sourceLabel}');
    expect(scopeEditor).toContain('<DialogOperationStatus state={confirmOperation}');
    expect(styles).toMatch(/\.source-load-tab\s*\{[\s\S]{0,180}grid-template-columns:\s*44px minmax\(0, 1fr\) auto/);
    expect(styles).toMatch(/\.source-scope-all\[aria-pressed="true"\]\s*\{[\s\S]{0,160}background:\s*var\(--surface-active\)/);
    expect(source).toContain('loadedSectionIds');
    expect(source).toContain('function SourceLoadScopePage');
    expect(source).toContain('className="source-scope-drawer context-reference-scope"');
    expect(source).toContain('加载范围');
    expect(source).toContain("kind: 'character-scope'");
    expect(source).toContain("kind: 'world-scope'");
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

  it('bundles and persists the optional LXGW WenKai font across the full interface', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const materializer = await readFile(new URL('../scripts/materialize-font.mjs', import.meta.url), 'utf8');
    const license = await readFile(new URL('../public/fonts/OFL.txt', import.meta.url), 'utf8');
    expect(source).toContain('manuscriptFontFamilyKey');
    expect(source).toContain('id="manuscript-font-select"');
    expect(source).toContain('<span>全局字体</span>');
    expect(source).not.toContain('<span>正文字体</span>');
    expect(source).toContain('<option value="sans">无衬线</option>');
    expect(source).not.toContain('无衬线 · 默认');
    expect(source).not.toContain('跟随系统');
    expect(source).toContain('<option value="wenkai">霞鹜文楷</option>');
    expect(source).toContain('localStorage.setItem(manuscriptFontFamilyKey');
    expect(styles).toContain('@font-face');
    expect(styles).toContain('/fonts/LXGWWenKaiLite-Regular.ttf');
    expect(styles).toContain(':root[data-manuscript-font="wenkai"]');
    expect(styles).toContain(':root[data-manuscript-font="sans"]');
    expect(styles).toContain('font-family: var(--app-font-family)');
    expect(styles).toContain('--manuscript-font-family: var(--app-font-family)');
    expect(styles).toContain('font-synthesis: weight style');
    expect(styles).toContain('font-family: var(--manuscript-font-family)');
    expect(packageJson).toContain('"prepare:font": "node scripts/materialize-font.mjs"');
    expect(materializer).toContain('brotliDecompressSync');
    expect(materializer).toContain('LXGWWenKaiLite-Regular.ttf.br');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('uses color rather than bold weight to distinguish user and AI prose', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const selector of [
      '.manuscript-block[data-kind="user"]',
      '.block-editor-textarea[data-kind="user"]',
    ]) {
      const start = styles.indexOf(`${selector} {`);
      const rule = styles.slice(start, styles.indexOf('\n}', start) + 2);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(rule).toContain('color: var(--manuscript-user)');
      expect(rule).not.toContain('font-weight');
    }
  });

  it('renders paired prose asterisks as semantic emphasis', async () => {
    const source = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import { parseProseFormatting } from '../proseFormatting'");
    expect(source).toContain('parseProseFormatting(block.content)');
    expect(source).toContain('<em key={`${block.id}-emphasis-${index}`}>');
  });

  it('uses one top-right grip for direct desktop and long-press mobile input resizing', async () => {
    const source = await readFile(new URL('../src/components/Writer.tsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('className="instruction-resize-handle"');
    expect(source).toContain('><span aria-hidden="true" /></button>');
    expect(source).toContain('调整输入框高度：电脑上下拖动，手机长按后拖动');
    expect(source).toContain("event.pointerType === 'mouse'");
    expect(source).toContain('setPointerCapture');
    expect(source).toContain('}, 300)');
    expect(source).toContain("event.key !== 'ArrowUp' && event.key !== 'ArrowDown'");
    expect(styles).toMatch(/\.instruction-dock textarea\s*\{[\s\S]{0,240}resize:\s*none/);
    expect(styles).toMatch(/\.instruction-resize-handle\s*\{[\s\S]{0,300}inset-inline-end:\s*0/);
    expect(styles).toContain('repeating-linear-gradient');
    expect(styles).toContain('cursor: ns-resize');
    expect(styles).toContain('touch-action: none');
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
