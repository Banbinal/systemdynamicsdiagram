import { useEffect } from 'react';

export type ToastKind = 'info' | 'ok' | 'error';

interface ToastProps {
  readonly message: string;
  readonly kind?: ToastKind;
  readonly onDismiss: () => void;
  /** Auto-dismiss after this many ms. Pass 0 to disable. */
  readonly durationMs?: number;
}

export function Toast({ message, kind = 'info', onDismiss, durationMs = 2500 }: ToastProps) {
  useEffect(() => {
    if (durationMs <= 0) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDismiss]);

  return (
    <div className="toast" role="status" aria-live="polite" data-kind={kind}>
      <span className="toast__icon" aria-hidden="true">
        {kind === 'ok' ? '✓' : kind === 'error' ? '!' : 'i'}
      </span>
      <span>{message}</span>
      <button
        className="toast__close"
        onClick={onDismiss}
        aria-label="Dismiss"
        type="button"
      >
        ×
      </button>
    </div>
  );
}
