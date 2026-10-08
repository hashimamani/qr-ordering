import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { ShieldAlertIcon } from './icons';
import type { OrderItemStatus } from '../api/types';

const STATUS_LABEL: Record<OrderItemStatus, string> = {
  received: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

interface OverrideDialogProps {
  open: boolean;
  itemName: string;
  tableNumber: string;
  fromStatus: OrderItemStatus;
  toStatus: OrderItemStatus;
  isBackward: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Every status change an admin makes from a station board goes through
 * here. The point isn't friction for its own sake -- it's that the admin
 * is acting over the head of whoever owns that station, so the action
 * names itself as an override, states the exact transition, and offers a
 * reason that gets stored on the audit row.
 */
export function OverrideDialog({
  open,
  itemName,
  tableNumber,
  fromStatus,
  toStatus,
  isBackward,
  busy = false,
  onConfirm,
  onCancel,
}: OverrideDialogProps) {
  const [reason, setReason] = useState('');

  // Clear between openings -- a reason typed for one item must never
  // silently attach itself to the next override.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Admin override"
      footer={
        <>
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger-solid" onClick={() => onConfirm(reason.trim())} disabled={busy}>
            {busy ? 'Applying…' : 'Override'}
          </button>
        </>
      }
    >
      <div className="dialog-message">
        <div className="dialog-icon-badge">
          <ShieldAlertIcon size={20} />
        </div>
        <div>
          <p style={{ marginTop: 0 }}>
            You're changing this item on behalf of the {isBackward ? 'station' : 'station team'}, not as part
            of the normal flow. It will be recorded against your name.
          </p>
          <div className="override-transition">
            <span className={`status-pill status-${fromStatus}`}>{STATUS_LABEL[fromStatus]}</span>
            <span className="override-arrow" aria-label="changes to">
              →
            </span>
            <span className={`status-pill status-${toStatus}`}>{STATUS_LABEL[toStatus]}</span>
          </div>
          <p className="override-target">
            {itemName} &middot; Table {tableNumber}
          </p>
          {isBackward && (
            <p className="override-warning">
              This moves the item <strong>backwards</strong>. The customer won't be re-notified, but anyone
              watching the tracking page has already seen the later status.
            </p>
          )}
          <label className="override-reason">
            <span className="override-reason-label">
              Reason <span className="override-reason-hint">(optional)</span>
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. kitchen tapped the wrong item"
              maxLength={500}
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
}
