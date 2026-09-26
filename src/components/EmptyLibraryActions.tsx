import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { idleDialogOperation, type DialogOperationState } from './shared/DialogOperationStatus';

export function EmptyLibraryActions({
  open,
  busy,
  onOpenChange,
  onCreateBook,
  onImport,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateBook: (title: string) => Promise<void>;
  onImport: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [operation, setOperation] = useState<DialogOperationState>(idleDialogOperation);

  useEffect(() => {
    if (open) {
      setOperation(idleDialogOperation);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      titleInputRef.current?.focus();
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || operation.phase === 'pending') return;
    setOperation({ phase: 'pending', title: '正在新建书目…' });
    try {
      await onCreateBook(trimmedTitle);
      setOperation({ phase: 'success', title: '新建书目成功' });
      onOpenChange(false);
      setTitle('');
    } catch (error) {
      setOperation({
        phase: 'error',
        title: '新建书目失败',
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  return (
    <section className="empty-library-state" aria-labelledby="empty-library-title">
      <h1 id="empty-library-title">书库还是空的</h1>
      <p>新建一本书开始写作，或导入 JSON 备份继续工作。</p>
      <div className="empty-library-actions">
        <button type="button" className="primary-action" onClick={() => onOpenChange(true)} disabled={busy}>
          新建书目
        </button>
        <button type="button" className="quiet-action" onClick={onImport} disabled={busy}>
          导入 JSON 备份
        </button>
      </div>
      <dialog
        ref={dialogRef}
        className="name-dialog"
        aria-labelledby="empty-book-dialog-title"
        onClose={() => {
          if (operation.phase !== 'pending') onOpenChange(false);
        }}
      >
        <form method="dialog" onSubmit={submit}>
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">故事书屋</span>
              <h2 id="empty-book-dialog-title">新建书目</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => onOpenChange(false)} disabled={operation.phase === 'pending'} aria-label="关闭新建书目对话框" title="关闭"><X aria-hidden="true" /></button>
          </div>
          <label className="dialog-field">
            <span>书名</span>
            <input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入书名" disabled={operation.phase === 'pending'} />
          </label>
          {operation.phase === 'error' && <p className="dialog-error" role="alert">{operation.detail}</p>}
          {operation.phase === 'success' && <p className="dialog-success" role="status">{operation.title}</p>}
          <div className="dialog-actions">
            <button type="button" className="quiet-action" onClick={() => onOpenChange(false)} disabled={operation.phase === 'pending'}>取消</button>
            <button type="submit" className="primary-action" disabled={!title.trim() || operation.phase === 'pending'}>
              {operation.phase === 'pending' ? '正在新建…' : '确认新建'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
