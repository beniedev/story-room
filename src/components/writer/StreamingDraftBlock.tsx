import { memo, useEffect, useRef, useState } from 'react';

export type StreamingDraftView = {
  content: string;
  status: 'streaming' | 'stopped' | 'failed';
  message: string;
  targetBlockId?: string;
  replaceTarget: boolean;
};

export const StreamingDraftBlock = memo(function StreamingDraftBlock({ draft }: { draft: StreamingDraftView }) {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyFeedbackTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
  }, []);
  const copyDraft = async () => {
    if (!draft.content) return;
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draft.content);
        success = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = draft.content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
          textarea.select();
          success = document.execCommand('copy');
        } finally {
          textarea.remove();
        }
      }
    } catch {
      success = false;
    }
    setCopyState(success ? 'success' : 'error');
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = window.setTimeout(() => setCopyState('idle'), 2_000);
  };
  return (
    <div className="streaming-draft-block" data-streaming-status={draft.status}>
      {draft.content ? (
        <div className="streaming-draft-text" role="textbox" aria-readonly="true" aria-label="临时生成草稿" tabIndex={0}>
          {draft.content}
        </div>
      ) : (
        <p className="streaming-draft-empty">{draft.status === 'streaming' ? '正在生成…' : '没有可保留的临时草稿。'}</p>
      )}
      <div className="streaming-draft-footer">
        <p role="status" aria-live="polite">{draft.message}</p>
        {draft.content && draft.status !== 'streaming' && (
          <button type="button" className="quiet-action" onClick={() => void copyDraft()}>
            {copyState === 'success' ? '已复制' : copyState === 'error' ? '未能复制，请选中文字复制' : '复制临时草稿'}
          </button>
        )}
      </div>
    </div>
  );
});
