import type { RefObject } from 'react';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import { TextArea } from './shared/TextArea';
import type { Book, SectionMemory, SectionMemoryDraft } from '../types';

export type ContextReferenceSection = {
  chapter: Book['chapters'][number];
  section: Book['chapters'][number]['sections'][number];
  chapterIndex: number;
  sectionIndex: number;
  ordinal: number;
};

export type MemorySummaryAction = 'generate' | 'save' | 'delete' | 'rollback' | 'clear-history';

const memoryArrayFields = [
  { field: 'beats' as const, label: '关键节拍' },
  { field: 'continuityFacts' as const, label: '连续性事实' },
  { field: 'characterStateChanges' as const, label: '角色状态变化' },
  { field: 'foreshadowingCandidates' as const, label: '伏笔候选' },
];

export function SectionMemoryEditor({
  item,
  memoryStatus,
  memoryDraft,
  summaryError,
  summaryBusy,
  busy,
  memoryBackRef,
  onBack,
  onSynopsisChange,
  onArrayItemChange,
  onAddArrayItem,
  onRemoveArrayItem,
  onRequestAction,
  onCancelGeneration,
}: {
  item: ContextReferenceSection;
  memoryStatus: string;
  memoryDraft: SectionMemoryDraft;
  summaryError?: string;
  summaryBusy: boolean;
  busy: boolean;
  memoryBackRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onSynopsisChange: (value: string) => void;
  onArrayItemChange: (
    field: keyof Omit<SectionMemoryDraft, 'synopsis'>,
    index: number,
    value: string,
  ) => void;
  onAddArrayItem: (field: keyof Omit<SectionMemoryDraft, 'synopsis'>) => void;
  onRemoveArrayItem: (field: keyof Omit<SectionMemoryDraft, 'synopsis'>, index: number) => void;
  onRequestAction: (action: MemorySummaryAction) => void;
  onCancelGeneration: () => void;
}) {
  const previousMemory: SectionMemory | undefined = item.section.previousMemory;

  return (
    <div className="context-memory-editor" aria-label={`${item.section.title} Memory 编辑`}>
      <button
        type="button"
        className="quiet-action button-with-icon context-memory-back"
        ref={memoryBackRef}
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />返回前文选择
      </button>
      <header className="context-memory-heading">
        <div>
          <small>前文 Memory</small>
          <h3>{item.section.title}</h3>
        </div>
        <span className="context-memory-status">{memoryStatus}</span>
      </header>
      <p className="helper-copy">五个字段完整复核后，点击保存才会写入书目并允许梗概加载。</p>
      <label className="context-memory-field">
        <span>摘要</span>
        <TextArea
          id={`context-memory-synopsis-${item.section.id}`}
          value={memoryDraft.synopsis}
          onChange={(event) => onSynopsisChange(event.target.value)}
          aria-invalid={Boolean(summaryError) || undefined}
          aria-describedby={summaryError ? `context-memory-error-${item.section.id}` : undefined}
          placeholder="填写这一节的摘要…"
          spellCheck
        />
      </label>
      {memoryArrayFields.map(({ field, label }) => (
        <fieldset className="context-memory-array" key={field}>
          <legend>{label}</legend>
          {memoryDraft[field].map((value, index) => (
            <div className="context-memory-array-row" key={`${field}-${index}`}>
              <input
                type="text"
                value={value}
                onChange={(event) => onArrayItemChange(field, index, event.target.value)}
                aria-label={`${item.section.title}${label}${index + 1}`}
              />
              <button
                type="button"
                className="quiet-action"
                onClick={() => onRemoveArrayItem(field, index)}
              >删除</button>
            </div>
          ))}
          <button
            type="button"
            className="quiet-action"
            onClick={() => onAddArrayItem(field)}
          >添加一项</button>
        </fieldset>
      ))}
      <div className="context-summary-actions">
        <button
          type="button"
          className="icon-button context-summary-generate"
          disabled={(busy && !summaryBusy) || !item.section.content.trim()}
          onClick={() => summaryBusy ? onCancelGeneration() : onRequestAction('generate')}
          aria-busy={summaryBusy || undefined}
          aria-label={summaryBusy ? '取消生成该节 Memory' : '生成该节 Memory'}
          title={summaryBusy ? '取消生成该节 Memory' : '生成该节 Memory'}
        >
          <Sparkles aria-hidden="true" />
        </button>
        <button
          type="button"
          className="primary-action icon-button context-summary-save"
          disabled={busy || summaryBusy || !memoryDraft.synopsis.trim()}
          onClick={() => onRequestAction('save')}
          aria-label="确认保存并加载 Memory"
          title={memoryDraft.synopsis.trim() ? '确认保存并加载 Memory' : '请先填写或生成摘要'}
        >
          <Check aria-hidden="true" />
        </button>
      </div>
      {item.section.memory && (
        <div className="context-memory-history">
          <strong>当前版本</strong>
          <button
            type="button"
            className="quiet-action"
            disabled={busy || summaryBusy}
            onClick={() => onRequestAction('delete')}
          >删除当前 Memory</button>
        </div>
      )}
      <div className="context-memory-history">
        <strong>上一版本：{previousMemory ? '有' : '无'}</strong>
        {previousMemory && (
          <>
            <details className="context-memory-previous">
              <summary>查看上一版本五字段</summary>
              <div className="context-memory-previous-content">
                <strong>摘要</strong>
                <p>{previousMemory.synopsis || '尚无内容'}</p>
                {memoryArrayFields.map(({ field, label }) => (
                  <div key={field}>
                    <strong>{label}</strong>
                    {previousMemory[field].length ? (
                      <ul>{previousMemory[field].map((value, index) => <li key={`${field}-previous-${index}`}>{value || '尚无内容'}</li>)}</ul>
                    ) : <p>尚无内容</p>}
                  </div>
                ))}
              </div>
            </details>
            <button
              type="button"
              className="quiet-action"
              disabled={busy || summaryBusy}
              onClick={() => onRequestAction('rollback')}
            >回滚上一版本</button>
            <button
              type="button"
              className="quiet-action"
              disabled={busy || summaryBusy}
              onClick={() => onRequestAction('clear-history')}
            >清除上一版本</button>
          </>
        )}
      </div>
      {summaryError && (
        <p className="context-summary-error" id={`context-memory-error-${item.section.id}`} role="alert">{summaryError}</p>
      )}
    </div>
  );
}
