import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../api/client';
import type { Destination, OrderItemStatus, StationBoard, StationItem } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useRealtime } from '../../../hooks/useRealtime';
import { useToast } from '../../../components/ToastProvider';
import { OverrideDialog } from '../../../components/OverrideDialog';
import { ShieldAlertIcon, UndoIcon } from '../../../components/icons';

const COLUMNS: { key: keyof StationBoard; label: string; status: OrderItemStatus }[] = [
  { key: 'pending', label: 'Pending', status: 'received' },
  { key: 'preparing', label: 'Preparing', status: 'preparing' },
  { key: 'ready', label: 'Ready', status: 'ready' },
  { key: 'served', label: 'Served today', status: 'served' },
];

// The forward step offered on each column's cards. 'served' is terminal,
// so it has none.
const ADVANCE_TO: Partial<Record<OrderItemStatus, { status: OrderItemStatus; label: string }>> = {
  received: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'served', label: 'Mark served' },
};

const STEP_BACK_TO: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
  preparing: 'received',
  ready: 'preparing',
  served: 'ready',
};

const EMPTY_BOARD: StationBoard = { pending: [], preparing: [], ready: [], served: [] };

interface PendingOverride {
  item: StationItem;
  toStatus: OrderItemStatus;
  isBackward: boolean;
}

function elapsedLabel(submittedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(submittedAt).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export function StationBoardSection({ destination, title }: { destination: Destination; title: string }) {
  const { session } = useAuth();
  const showToast = useToast();
  const [board, setBoard] = useState<StationBoard>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState('');
  const [override, setOverride] = useState<PendingOverride | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<StationBoard>(`/admin/stations/${destination}`, { auth: true })
      .then(setBoard)
      .catch((err: ApiError) => setLoadError(err.message));
  }, [destination]);

  useEffect(load, [load]);

  // The station's own room, same one the kitchen/bar screens join --
  // admin is authorized for every destination (see roomAuth.ts).
  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:${destination}` : null,
    session?.token ?? null,
    () => load(),
  );

  async function applyOverride(reason: string) {
    if (!override) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/order-items/${override.item.order_item_id}/status`, {
        method: 'PATCH',
        auth: true,
        body: { status: override.toStatus, ...(reason ? { reason } : {}) },
      });
      setOverride(null);
      load();
      showToast('Override applied and logged.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const totalLive = board.pending.length + board.preparing.length + board.ready.length;

  return (
    <>
      <div className="admin-section-header">
        <div>
          <h2>{title}</h2>
          <p className="sub">
            <span className={`conn-dot ${connected ? 'live' : ''}`} />
            {connected ? 'Live' : 'Reconnecting…'} &middot; {totalLive} item{totalLive === 1 ? '' : 's'} in
            progress
          </p>
        </div>
        <div className="override-notice">
          <ShieldAlertIcon size={15} />
          Changes made here are admin overrides and are logged
        </div>
      </div>

      {loadError && <div className="error-banner">{loadError}</div>}

      <div className="station-board">
        {COLUMNS.map((col) => {
          const items = board[col.key];
          return (
            <section key={col.key} className={`station-column station-column-${col.key}`}>
              <header className="station-column-header">
                <span className="station-column-title">{col.label}</span>
                <span className="station-column-count">{items.length}</span>
              </header>
              <div className="station-column-body">
                {items.length === 0 && <p className="station-empty">Nothing here.</p>}
                {items.map((item) => {
                  const advance = ADVANCE_TO[item.status];
                  const back = STEP_BACK_TO[item.status];
                  return (
                    <article key={item.order_item_id} className="station-card">
                      <div className="station-card-title">
                        <span className="station-qty">{item.quantity}×</span> {item.menu_item_name}
                      </div>
                      <div className="station-card-meta">
                        <span className="station-table">Table {item.table_number}</span>
                        <span className="station-waiter">
                          {item.status === 'served'
                            ? item.served_by_name
                              ? `served by ${item.served_by_name}`
                              : 'served by —'
                            : item.waiter_name
                              ? item.waiter_name
                              : 'unassigned'}
                        </span>
                      </div>
                      {item.notes && <div className="station-notes">{item.notes}</div>}
                      <div className="station-card-footer">
                        <span className="station-time">{elapsedLabel(item.submitted_at)}</span>
                        <span className="station-actions">
                          {back && (
                            <button
                              className="station-back"
                              title={`Move back to ${back}`}
                              aria-label={`Move ${item.menu_item_name} back to ${back}`}
                              onClick={() =>
                                setOverride({ item, toStatus: back, isBackward: true })
                              }
                            >
                              <UndoIcon size={14} />
                            </button>
                          )}
                          {advance && (
                            <button
                              className="station-advance"
                              onClick={() =>
                                setOverride({ item, toStatus: advance.status, isBackward: false })
                              }
                            >
                              {advance.label}
                            </button>
                          )}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <p className="report-footnote">
        "Served today" covers the current day in Africa/Nairobi. Items served before status auditing was
        added show "—" for who served them.
      </p>

      <OverrideDialog
        open={!!override}
        itemName={override?.item.menu_item_name ?? ''}
        tableNumber={override?.item.table_number ?? ''}
        fromStatus={override?.item.status ?? 'received'}
        toStatus={override?.toStatus ?? 'preparing'}
        isBackward={override?.isBackward ?? false}
        busy={busy}
        onConfirm={applyOverride}
        onCancel={() => setOverride(null)}
      />
    </>
  );
}
