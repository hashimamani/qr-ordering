import { Dialog } from './Dialog';
import { AlertTriangleIcon } from './icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Replaces window.confirm() everywhere -- a native browser dialog is
 * both bad UX (no styling, no room for context) and blocks in the same
 * headless-browser testing sandbox this app is verified in. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="dialog-message">
        {danger && (
          <div className="dialog-icon-badge">
            <AlertTriangleIcon size={20} />
          </div>
        )}
        <p>{message}</p>
      </div>
    </Dialog>
  );
}
