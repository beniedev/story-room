import { Trash2, X } from 'lucide-react';
import { DialogOperationStatus } from '../shared/DialogOperationStatus';
import type { useBookshelfDialogs } from './useBookshelfDialogs';

export function BookDeleteDialog({ controller, canWrite }: { controller: ReturnType<typeof useBookshelfDialogs>['deletion']; canWrite: boolean }) {
  const { deleteDialogRef, deleteOperation, deleteDialogCopy, closeDeleteDialog, confirmDelete, onDeleteClosed, onDeleteReturn } = controller;
  return (
      <dialog
        className="confirm-dialog"
        ref={deleteDialogRef}
        onClose={onDeleteClosed}
        onCancel={(event) => { event.preventDefault(); closeDeleteDialog(); }}
        aria-labelledby="confirm-dialog-title"
        aria-describedby={deleteOperation.phase === 'idle' ? 'confirm-dialog-description' : undefined}
        aria-busy={deleteOperation.phase === 'pending' || undefined}
      >
        <header className="dialog-heading">
          <h2 id="confirm-dialog-title">{deleteDialogCopy.title}</h2>
          <button type="button" className="icon-button" disabled={deleteOperation.phase === 'pending'} onClick={closeDeleteDialog} aria-label={`取消${deleteDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {deleteOperation.phase === 'idle' ? (
            <>
              <p id="confirm-dialog-description">{deleteDialogCopy.message}</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={closeDeleteDialog}>取消</button>
                <button type="button" className="danger-action button-with-icon" disabled={!canWrite} onClick={() => void confirmDelete()}><Trash2 aria-hidden="true" />{deleteDialogCopy.action}</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={deleteOperation} onReturn={onDeleteReturn} />
          )}
        </div>
      </dialog>
  );
}
