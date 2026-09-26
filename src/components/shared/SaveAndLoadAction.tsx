import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DialogOperationStatus, idleDialogOperation, useDismissSuccessfulDialog, type DialogOperationState } from './DialogOperationStatus';

export function SaveAndLoadAction({ id, label, onConfirm, canEdit = true }: {
  id: string;
  label: string;
  onConfirm: () => Promise<void>;
  canEdit?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [operation, setOperation] = useState<DialogOperationState>(idleDialogOperation);

  useDismissSuccessfulDialog(operation.phase === 'success', () => dialogRef.current?.close());

  const closeDialog = () => {
    if (operation.phase === 'pending') return;
    dialogRef.current?.close();
  };

  const saveAndLoad = async () => {
    if (!canEdit) return;
    if (operation.phase === 'pending') return;
    setOperation({ phase: 'pending', title: `正在保存并加载${label}…` });
    try {
      await onConfirm();
      setOperation({ phase: 'success', title: `${label}保存并加载成功` });
    } catch (error) {
      setOperation({
        phase: 'error',
        title: `${label}保存并加载失败`,
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="primary-action icon-button source-save-load"
        onClick={() => {
          setOperation(idleDialogOperation);
          dialogRef.current?.showModal();
        }}
        aria-haspopup="dialog"
        disabled={!canEdit}
        aria-label={`保存并加载${label}`}
        title="保存并加载"
      >
        <Check aria-hidden="true" />
      </button>
      <dialog
        className="confirm-dialog"
        ref={dialogRef}
        onClose={(event) => {
          event.stopPropagation();
          setOperation(idleDialogOperation);
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }}
        aria-labelledby={`${id}-save-load-title`}
        aria-describedby={operation.phase === 'idle' ? `${id}-save-load-description` : undefined}
        aria-busy={operation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id={`${id}-save-load-title`}>保存并加载{label}</h2>
          <button type="button" className="icon-button" disabled={operation.phase === 'pending'} onClick={closeDialog} aria-label="取消保存并加载" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {operation.phase === 'idle' ? (
            <>
              <p id={`${id}-save-load-description`}>会保存当前编辑内容，并按当前加载范围进入后续生成的 Prompt；取消不会更改已保存内容。</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" autoFocus onClick={closeDialog}>取消</button>
                <button type="button" className="primary-action button-with-icon" onClick={() => void saveAndLoad()}><Check aria-hidden="true" />确认保存并加载</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={operation} onReturn={() => setOperation(idleDialogOperation)} />
          )}
        </div>
      </dialog>
    </>
  );
}
