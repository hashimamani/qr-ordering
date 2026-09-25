import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastVariant = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

type ShowToast = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<ShowToast | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * One global toast stack mounted at the root (see App.tsx) so it survives
 * route changes -- a page navigation shouldn't cut off a notification a
 * previous page just triggered (e.g. redirecting right after a failed
 * action).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, variant = 'error') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.variant}`} onClick={() => dismiss(t.id)}>
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
