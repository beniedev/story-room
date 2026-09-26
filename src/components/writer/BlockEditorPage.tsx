import { ArrowLeft, Check } from 'lucide-react';
import { TextArea } from '../shared/TextArea';
import type { SectionBlock } from '../../types';

type BlockEditorPageProps = {
  block: SectionBlock;
  bookTitle: string;
  chapterTitle: string;
  sectionTitle: string;
  onClose: () => void;
  onChange: (content: string) => void;
};

export function BlockEditorPage({ block, bookTitle, chapterTitle, sectionTitle, onClose, onChange }: BlockEditorPageProps) {
  const editorLabel = block.kind === 'user' ? '用户输入' : 'AI 输出';
  return (
    <article className="block-editor-page" aria-labelledby="block-editor-title">
      <header className="block-editor-header">
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="返回正文"
          title="返回正文"
        ><ArrowLeft aria-hidden="true" /></button>
        <div className="block-editor-heading">
          <h1 id="block-editor-title">编辑{editorLabel}</h1>
          <p title={`${bookTitle} · ${chapterTitle} · ${sectionTitle}`}>
            {bookTitle} · {chapterTitle} · {sectionTitle} · 自动保存
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="完成编辑并返回正文"
          title="完成"
        ><Check aria-hidden="true" /></button>
      </header>
      <div className="block-editor-body">
        <label className="sr-only" htmlFor="block-editor-textarea">{editorLabel}内容</label>
        <TextArea
          key={block.id}
          id="block-editor-textarea"
          className="block-editor-textarea"
          data-kind={block.kind}
          autoFocus
          value={block.content}
          onChange={(event) => onChange(event.target.value)}
          spellCheck
        />
      </div>
    </article>
  );
}
