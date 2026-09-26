import { Check, X } from 'lucide-react';
import { DialogOperationStatus } from '../shared/DialogOperationStatus';
import type { useBookshelfDialogs } from './useBookshelfDialogs';

export function BookNameDialog({ controller, canWrite }: { controller: ReturnType<typeof useBookshelfDialogs>['name']; canWrite: boolean }) {
  const { nameDialogRef, nameInputRef, nameDialog, nameOperation, nameDialogCopy, closeNameDialog, submitNameDialog, onNameClosed, onNameReturn, onNameChange } = controller;
  return (
      <dialog
        className="name-dialog"
        ref={nameDialogRef}
        onClose={onNameClosed}
        onCancel={(event) => { event.preventDefault(); closeNameDialog(); }}
        aria-labelledby="name-dialog-title"
        aria-busy={nameOperation.phase === 'pending' || undefined}
      >
        <form onSubmit={submitNameDialog}>
          <header className="dialog-heading">
            <h2 id="name-dialog-title">{nameDialogCopy.title}</h2>
            <button type="button" className="icon-button" disabled={nameOperation.phase === 'pending'} onClick={closeNameDialog} aria-label={`取消${nameDialogCopy.title}`} title="取消"><X aria-hidden="true" /></button>
          </header>
          {nameOperation.phase === 'idle' ? (
            <div className="name-dialog-body">
              <label htmlFor="name-dialog-input">{nameDialogCopy.label}</label>
              <input
                id="name-dialog-input"
                ref={nameInputRef}
                required
                name="item-name"
                autoComplete="off"
                value={nameDialog?.value ?? ''}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={nameDialogCopy.placeholder}
                disabled={!canWrite}
              />
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={closeNameDialog}>取消</button>
                <button type="submit" className="primary-action button-with-icon" disabled={!canWrite}><Check aria-hidden="true" />{nameDialogCopy.action}</button>
              </div>
            </div>
          ) : (
            <div className="name-dialog-body dialog-operation-body">
              <DialogOperationStatus
                state={nameOperation}
                onReturn={onNameReturn}
              />
            </div>
          )}
        </form>
      </dialog>
  );
}
