import { useEffect, useRef } from 'react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';

export type DialogOperationState = {
  phase: 'idle' | 'pending' | 'success' | 'error';
  title: string;
  detail?: string;
};

export const idleDialogOperation: DialogOperationState = { phase: 'idle', title: '' };

export function useDismissSuccessfulDialog(
  succeeded: boolean,
  onDismiss: () => void,
  delay = 5_000,
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!succeeded) return undefined;
    const dismiss = () => dismissRef.current();
    const timer = window.setTimeout(dismiss, delay);
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [delay, succeeded]);
}

export function DialogOperationStatus({
  state,
  onReturn,
}: {
  state: DialogOperationState;
  onReturn?: () => void;
}) {
  if (state.phase === 'idle') return null;
  const Icon = state.phase === 'pending'
    ? LoaderCircle
    : state.phase === 'success' ? Check : CircleAlert;

  return (
    <div
      className="dialog-operation-status"
      data-phase={state.phase}
      role={state.phase === 'error' ? 'alert' : 'status'}
      aria-live={state.phase === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <Icon className={state.phase === 'pending' ? 'dialog-operation-spinner' : undefined} aria-hidden="true" />
      <strong>{state.title}</strong>
      {state.detail && <p>{state.detail}</p>}
      {state.phase === 'error' && onReturn && (
        <button type="button" className="quiet-action" onClick={onReturn}>返回</button>
      )}
    </div>
  );
}
