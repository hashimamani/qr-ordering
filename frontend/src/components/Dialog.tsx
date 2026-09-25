import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './icons';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Portal-rendered so it always stacks above the page regardless of where
 * it's mounted (no z-index/overflow fights with a parent card or table
 * scroll container). Escape and backdrop click both close it; the panel
 * itself stops propagation so a click inside never bubbles to the
 * backdrop.
 */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel once, when the dialog actually opens -- deliberately
  // depends on `open` alone. Typing in a field inside the dialog re-renders
  // the parent on every keystroke, which recreates the `onClose` closure;
  // if that were in this effect's deps, the effect (and its focus() call)
  // would re-run on every keystroke too, yanking focus off the input and
  // away from it mid-type -- on mobile this closes the on-screen keyboard
  // after every character.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h3>{title}</h3>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
