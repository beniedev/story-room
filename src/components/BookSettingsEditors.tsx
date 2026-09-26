import { useState } from 'react';
import { ListTree } from 'lucide-react';
import type { CharacterCard, WorldRule } from '../types';
import { TextArea } from './shared/TextArea';
import { SaveAndLoadAction } from './shared/SaveAndLoadAction';

export function GuideEditor({ id, title, description, placeholder, value, onSave, canEdit = true }: {
  id: string;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <article className="guide-editor-page">
      <header className="guide-editor-heading">
        <p className="eyebrow">全局指引 · 作用于本书全部章与节</p>
        <div className="source-editor-title-row">
          <h1>{title}</h1>
          <SaveAndLoadAction id={id} label={title} onConfirm={() => onSave(draft)} canEdit={canEdit} />
        </div>
        <p>{description}</p>
      </header>
      <label className="guide-editor-field">
        <span className="sr-only">{title}</span>
        <TextArea value={draft} readOnly={!canEdit} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} spellCheck />
      </label>
    </article>
  );
}

export function CharacterEditor({ bookTitle, character, onSave, onOpenScope, canEdit = true }: {
  bookTitle: string;
  character: CharacterCard;
  onSave: (patch: Pick<CharacterCard, 'name' | 'role' | 'content'>) => Promise<void>;
  onOpenScope: () => void;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(() => ({
    name: character.name,
    role: character.role,
    content: character.content,
  }));
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 角色卡</p>
        <div className="source-editor-title-row">
          <h1>{draft.name || character.name}</h1>
          <div className="source-editor-actions">
            <button type="button" className="icon-button source-scope-open" onClick={onOpenScope} aria-label={`选择${draft.name || character.name}的加载范围`} title="加载角色卡">
              <ListTree aria-hidden="true" />
            </button>
            <SaveAndLoadAction id={`character-${character.id}`} label="角色卡" onConfirm={() => onSave(draft)} canEdit={canEdit} />
          </div>
        </div>
        <p>这里的资料只属于当前书目，并在生成时描述这个角色。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${draft.name || character.name}角色卡内容`}>
        <label>角色名<input value={draft.name} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>角色要点<input value={draft.role} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} /></label>
        <label>角色设定<TextArea value={draft.content} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} spellCheck /></label>
      </section>
    </article>
  );
}

export function WorldRuleEditor({ bookTitle, rule, onSave, onOpenScope, canEdit = true }: {
  bookTitle: string;
  rule: WorldRule;
  onSave: (patch: Pick<WorldRule, 'title' | 'content'>) => Promise<void>;
  onOpenScope: () => void;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(() => ({ title: rule.title, content: rule.content }));
  return (
    <article className="source-editor-page">
      <header className="source-editor-heading">
        <p className="eyebrow">{bookTitle} · 世界观设定</p>
        <div className="source-editor-title-row">
          <h1>{draft.title || rule.title}</h1>
          <div className="source-editor-actions">
            <button type="button" className="icon-button source-scope-open" onClick={onOpenScope} aria-label={`选择${draft.title || rule.title}的加载范围`} title="加载世界观设定">
              <ListTree aria-hidden="true" />
            </button>
            <SaveAndLoadAction id={`world-${rule.id}`} label="世界观设定" onConfirm={() => onSave(draft)} canEdit={canEdit} />
          </div>
        </div>
        <p>这条设定只属于当前书目，可按小节决定是否加载。</p>
      </header>
      <section className="source-editor-fields" aria-label={`${draft.title || rule.title}世界观设定内容`}>
        <label>设定名称<input value={draft.title} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label>设定内容<TextArea value={draft.content} readOnly={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} spellCheck /></label>
      </section>
    </article>
  );
}

export function MissingSettingsItem({ label }: { label: string }) {
  return (
    <section className="source-editor-page empty-settings-item" aria-labelledby="missing-settings-item-title">
      <h1 id="missing-settings-item-title">找不到这条{label}</h1>
      <p>它可能已经被删除。请返回本书设定重新选择。</p>
    </section>
  );
}
