import { ArrowLeft, ChevronDown, ChevronRight, Globe2, ListChecks, Plus, ScrollText, Trash2, UsersRound, X } from 'lucide-react';
import { toggleSourceSelection } from '../../sourceSelection';
import { CharacterEditor, GuideEditor, MissingSettingsItem, WorldRuleEditor } from '../BookSettingsEditors';
import { SourceLoadScopePage } from '../SourceLoadScopePage';
import { SourceList } from '../SourceList';
import type { BookshelfProps, DeleteDialogState, NameDialogState } from './types';
import type { useBookSettings } from './useBookSettings';

type BookSettingsDrawerProps = Pick<BookshelfProps, 'book' | 'onBookChange'> & {
  canWrite: boolean;
  controller: ReturnType<typeof useBookSettings>;
  openNameDialog: (dialog: NameDialogState) => void;
  openDeleteDialog: (dialog: DeleteDialogState) => void;
};

export function BookSettingsDrawer(props: BookSettingsDrawerProps) {
  const { canWrite, openNameDialog, openDeleteDialog } = props;
  const {
    bookSettingsDialog, bookSettingsBackButton, bookSettingsView, openSettingsSections,
    sourceSelectionMode, selectedSourceIds, setSelectedSourceIds, toggleSourceSelectionMode,
    moveSource, openBookSettingsPage, openSourceScope, returnBookSettingsParent,
    closeBookSettings, resetBookSettings, setSettingsSectionOpen,
    settingsCharacter, settingsWorldRule, bookSettingsTitle,
  } = props.controller;
  return (
      <dialog
        className="book-settings-drawer"
        ref={bookSettingsDialog}
        onClick={(event) => { if (event.target === event.currentTarget) closeBookSettings(); }}
        onClose={resetBookSettings}
        onCancel={(event) => { event.preventDefault(); closeBookSettings(); }}
        aria-labelledby="book-settings-title"
      >
        <header className={`drawer-heading${bookSettingsView.kind !== 'root' ? ' compact-book-settings-heading' : ''}`}>
          {bookSettingsView.kind !== 'root' ? (
            <>
              <button
                ref={bookSettingsBackButton}
                type="button"
                className="icon-button"
                onClick={returnBookSettingsParent}
                aria-label="返回本书设定"
                title="返回本书设定"
              ><ArrowLeft aria-hidden="true" /></button>
              <h2 id="book-settings-title" className="sr-only">{bookSettingsTitle}</h2>
            </>
          ) : (
            <div className="drawer-title-row">
              <div>
                <p className="eyebrow">全局指引 · 角色 · 世界</p>
                <h2 id="book-settings-title">本书设定</h2>
              </div>
            </div>
          )}
          <button type="button" className="icon-button" autoFocus={bookSettingsView.kind === 'root'} onClick={closeBookSettings} aria-label="关闭本书设定" title="关闭本书设定"><X aria-hidden="true" /></button>
        </header>
        <div className="book-settings-content">
          {bookSettingsView.kind === 'root' ? (
            <section className="prompt-settings" aria-labelledby="prompt-settings-heading">
              <h2 id="prompt-settings-heading" className="sr-only">本书设定内容</h2>

              <details className="source-group-drawer global-guidance-drawer" open={openSettingsSections.has('guidance')} onToggle={(event) => setSettingsSectionOpen('guidance', event.currentTarget.open)}>
                <summary>
                  <ScrollText aria-hidden="true" />
                  <span><strong>全局指引</strong><small>作用于本书全部章与节</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="guide-link-list">
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'style' })}>
                    <span><strong>写作风格指导</strong><small>指定行文风格、语气和语言表达。</small></span>
                    <ChevronRight className="icon-directional" aria-hidden="true" />
                  </button>
                  <button type="button" className="guide-link-row" onClick={() => openBookSettingsPage({ kind: 'outline' })}>
                    <span><strong>剧情大纲</strong><small>规划情节走向，生成时作为本书的长期指导。</small></span>
                    <ChevronRight className="icon-directional" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="source-group-drawer" open={openSettingsSections.has('characters')} onToggle={(event) => setSettingsSectionOpen('characters', event.currentTarget.open)}>
                <summary>
                  <UsersRound aria-hidden="true" />
                  <span><strong>角色卡</strong><small>{props.book.characters.length} 个角色</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="source-group-content">
                  <div className="source-group-actions">
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-character', value: '' })} disabled={!canWrite} aria-label="新建角色卡" title="新建角色卡"><Plus aria-hidden="true" /></button>
                    {sourceSelectionMode === 'character' && <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={!canWrite || selectedSourceIds.size === 0}
                      onClick={() => openDeleteDialog({ kind: 'source-selection', sourceKind: 'character', ids: [...selectedSourceIds] })}
                      aria-label="删除所选角色卡"
                      title={selectedSourceIds.size ? '删除所选角色卡' : '请先选择角色卡'}
                    ><Trash2 aria-hidden="true" /></button>}
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'character'}
                      disabled={!canWrite}
                      onClick={() => toggleSourceSelectionMode('character')}
                      aria-label={sourceSelectionMode === 'character' ? '退出角色卡选择' : '选择角色卡'}
                      title={sourceSelectionMode === 'character' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'character' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                  </div>
                  <SourceList key={`${props.book.id}:characters`} label="角色卡"
                    items={props.book.characters.map((item) => ({ id: item.id, title: item.name, detail: item.role }))}
                    selecting={sourceSelectionMode === 'character'} selectedIds={selectedSourceIds} disabled={!canWrite}
                    onSelect={(id) => setSelectedSourceIds((current) => toggleSourceSelection(current, id))}
                    onOpen={(id) => openBookSettingsPage({ kind: 'character', id })}
                    onMove={(id, beforeId) => moveSource('character', id, beforeId)} />
                </div>
              </details>

              <details className="source-group-drawer" open={openSettingsSections.has('world')} onToggle={(event) => setSettingsSectionOpen('world', event.currentTarget.open)}>
                <summary>
                  <Globe2 aria-hidden="true" />
                  <span><strong>世界观设定</strong><small>{props.book.worldRules.length} 条设定</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="source-group-content">
                  <div className="source-group-actions">
                    <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openNameDialog({ kind: 'new-world', value: '' })} disabled={!canWrite} aria-label="新建世界观设定" title="新建世界观设定"><Plus aria-hidden="true" /></button>
                    {sourceSelectionMode === 'world' && <button
                      type="button"
                      className="icon-button danger-icon"
                      aria-haspopup="dialog"
                      disabled={!canWrite || selectedSourceIds.size === 0}
                      onClick={() => openDeleteDialog({ kind: 'source-selection', sourceKind: 'world', ids: [...selectedSourceIds] })}
                      aria-label="删除所选世界观设定"
                      title={selectedSourceIds.size ? '删除所选世界观设定' : '请先选择世界观设定'}
                    ><Trash2 aria-hidden="true" /></button>}
                    <button
                      type="button"
                      className="icon-button"
                      aria-pressed={sourceSelectionMode === 'world'}
                      disabled={!canWrite}
                      onClick={() => toggleSourceSelectionMode('world')}
                      aria-label={sourceSelectionMode === 'world' ? '退出世界观设定选择' : '选择世界观设定'}
                      title={sourceSelectionMode === 'world' ? '退出选择' : '选择'}
                    >{sourceSelectionMode === 'world' ? <X aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</button>
                  </div>
                  <SourceList key={`${props.book.id}:world`} label="世界观设定"
                    items={props.book.worldRules.map((item) => ({ id: item.id, title: item.title, detail: '世界观' }))}
                    selecting={sourceSelectionMode === 'world'} selectedIds={selectedSourceIds} disabled={!canWrite}
                    onSelect={(id) => setSelectedSourceIds((current) => toggleSourceSelection(current, id))}
                    onOpen={(id) => openBookSettingsPage({ kind: 'world', id })}
                    onMove={(id, beforeId) => moveSource('world', id, beforeId)} />
                </div>
              </details>

            </section>
          ) : bookSettingsView.kind === 'outline' ? (
            <GuideEditor
              key="outline"
              id="plot-outline"
              title="剧情大纲"
              description="记录本书的情节走向、阶段目标与关键转折；生成时会作为全书的长期指导。"
              placeholder="记录主要情节、阶段目标与关键转折……"
              value={props.book.plotOutline ?? ''}
              canEdit={canWrite}
              onSave={(value) => props.onBookChange((current) => ({ ...current, plotOutline: value }))}
            />
          ) : bookSettingsView.kind === 'style' ? (
            <GuideEditor
              key="style"
              id="global-guidance"
              title="写作风格指导"
              description="指定本书的行文风格、语气和语言表达；适用于书内全部章节与小节。"
              placeholder="例如：克制、清澈；少用解释性旁白……"
              value={props.book.writingBrief}
              canEdit={canWrite}
              onSave={(value) => props.onBookChange((current) => ({ ...current, writingBrief: value }))}
            />
          ) : bookSettingsView.kind === 'character' ? (
            settingsCharacter
              ? <CharacterEditor
                  key={settingsCharacter.id}
                  bookTitle={props.book.title}
                  character={settingsCharacter}
                  onSave={(patch) => props.onBookChange((current) => ({
                    ...current,
                    characters: current.characters.map((item) => item.id === settingsCharacter.id
                      ? { ...item, ...patch, title: patch.name }
                      : item),
                  }))}
                  onOpenScope={() => openSourceScope({ kind: 'character-scope', id: settingsCharacter.id })}
                  canEdit={canWrite}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : bookSettingsView.kind === 'world' ? (
            settingsWorldRule
              ? <WorldRuleEditor
                  key={settingsWorldRule.id}
                  bookTitle={props.book.title}
                  rule={settingsWorldRule}
                  onSave={(patch) => props.onBookChange((current) => ({
                    ...current,
                    worldRules: current.worldRules.map((item) => item.id === settingsWorldRule.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                  onOpenScope={() => openSourceScope({ kind: 'world-scope', id: settingsWorldRule.id })}
                  canEdit={canWrite}
                />
              : <MissingSettingsItem label="世界观设定" />
          ) : bookSettingsView.kind === 'character-scope' ? (
            settingsCharacter
              ? <SourceLoadScopePage
                  key={`character-scope-${settingsCharacter.id}`}
                  sourceId={settingsCharacter.id}
                  title="加载角色卡"
                  bookTitle={props.book.title}
                  enabled={settingsCharacter.includeInPrompt}
                  chapters={props.book.chapters}
                  loadedSectionIds={settingsCharacter.loadedSectionIds}
                  canEdit={canWrite}
                  onConfirm={(patch) => props.onBookChange((current) => ({
                    ...current,
                    characters: current.characters.map((item) => item.id === settingsCharacter.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                />
              : <MissingSettingsItem label="角色卡" />
          ) : (
            settingsWorldRule
              ? <SourceLoadScopePage
                  key={`world-scope-${settingsWorldRule.id}`}
                  sourceId={settingsWorldRule.id}
                  title="加载世界观设定"
                  bookTitle={props.book.title}
                  enabled={settingsWorldRule.includeInPrompt}
                  chapters={props.book.chapters}
                  loadedSectionIds={settingsWorldRule.loadedSectionIds}
                  canEdit={canWrite}
                  onConfirm={(patch) => props.onBookChange((current) => ({
                    ...current,
                    worldRules: current.worldRules.map((item) => item.id === settingsWorldRule.id
                      ? { ...item, ...patch }
                      : item),
                  }))}
                />
              : <MissingSettingsItem label="世界观设定" />
          )}
        </div>
      </dialog>
  );
}
