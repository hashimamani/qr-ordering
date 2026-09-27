import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../api/client';
import type { WaiterTableSession } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useRealtime } from '../../../hooks/useRealtime';
import { useToast } from '../../../components/ToastProvider';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { BanknoteIcon, BellIcon } from '../../../components/icons';

/**
 * Live floor state across every table, not one waiter's own.
 *
 * Reuses /staff/tables rather than adding an admin endpoint: getWaiterView
 * already returns all sessions for any non-waiter role, so an admin
 * hitting it gets the whole floor. Updates arrive on the admin room,
 * which broadcastToTableWaiter mirrors every waiter-facing event into.
 */
export function FloorSection() {
  const { session } = useAuth();
  const showToast = useToast();
  const [sessions, setSessions] = useState<WaiterTableSession[]>([]);
  const [loadError, setLoadError] = useState('');
  const [payingToken, setPayingToken] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<WaiterTableSession | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ table_sessions: WaiterTableSession[] }>('/staff/tables', { auth: true })
      .then((data) => setSessions(data.table_sessions))
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:admin` : null,
    session?.token ?? null,
    // The admin room also carries the reporting worker's sales_changed
    // events; those say nothing about floor state, so ignore them here
    // rather than refetching the whole floor on every order placed.
    (event) => {
      if (event.type !== 'sales_changed') load();
    },
  );

  async function markPaid(publicToken: string) {
    setPayingToken(publicToken);
    try {
      await apiFetch(`/staff/orders/${publicToken}/payment-status`, { method: 'PATCH', auth: true });
      load();
      showToast('Order marked paid.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setPayingToken(null);
    }
  }

  async function acknowledgeCall(sessionId: string) {
    setAcknowledgingId(sessionId);
    try {
      await apiFetch(`/staff/table-sessions/${sessionId}/acknowledge-call`, { method: 'PATCH', auth: true });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function closeTable() {
    if (!confirmClose) return;
    const sessionId = confirmClose.session_id;
    setClosingId(sessionId);
    try {
      await apiFetch(`/staff/table-sessions/${sessionId}/close`, { method: 'PATCH', auth: true });
      setConfirmClose(null);
      load();
      showToast('Table closed.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setClosingId(null);
    }
  }

  const calling = sessions.filter((s) => s.calling_since);
  const unpaidCount = sessions.reduce(
    (sum, s) => sum + s.orders.filter((o) => o.payment_status === 'unpaid').length,
    0,
  );

  return (
    <>
      <div className="admin-section-header">
        <div>
          <h2>Floor</h2>
          <p className="sub">
            <span className={`conn-dot ${connected ? 'live' : ''}`} />
            {connected ? 'Live' : 'Reconnecting…'} &middot; {sessions.length} open table
            {sessions.length === 1 ? '' : 's'} &middot; {unpaidCount} unpaid order
            {unpaidCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {loadError && <div className="error-banner">{loadError}</div>}

      {calling.length > 0 && (
        <div className="floor-alert">
          <BellIcon size={15} />
          {calling.map((s) => `Table ${s.table_number}`).join(', ')}{' '}
          {calling.length === 1 ? 'is' : 'are'} calling for a waiter
        </div>
      )}

      {sessions.length === 0 && <div className="empty-state">No open tables right now.</div>}

      <div className="floor-grid">
        {sessions.map((ts) => (
          <article key={ts.session_id} className="floor-card">
            <header className="floor-card-header">
              <span className="floor-table">Table {ts.table_number}</span>
              <span className={`status-pill status-${ts.session_status === 'active' ? 'received' : 'unpaid'}`}>
                {ts.session_status.replace('_', ' ')}
              </span>
            </header>

            <div className="floor-card-meta">
              {ts.assigned_waiter_name ? (
                <span className="status-pill status-assigned">{ts.assigned_waiter_name}</span>
              ) : (
                <span className="status-pill status-unassigned">unassigned</span>
              )}
              {ts.calling_since && (
                <button
                  className="calling-bell"
                  disabled={acknowledgingId === ts.session_id}
                  onClick={() => acknowledgeCall(ts.session_id)}
                  title="Customer is calling -- click to acknowledge"
                  aria-label={`Acknowledge call from table ${ts.table_number}`}
                >
                  <BellIcon size={13} />
                </button>
              )}
            </div>

            {ts.orders.length === 0 && <p className="station-empty">No orders yet.</p>}
            {ts.orders.map((order) => (
              <div key={order.public_token} className="floor-order">
                <div className="floor-order-header">
                  <span>{new Date(order.submitted_at).toLocaleTimeString()}</span>
                  <span className={`status-pill status-${order.payment_status}`}>{order.payment_status}</span>
                </div>
                <div className="floor-order-items">
                  {order.items.map((i) => (
                    <span key={i.order_item_id} className="floor-order-item">
                      {i.quantity}× {i.menu_item_name}
                      <span className={`status-dot status-${i.status}`} title={i.status} />
                    </span>
                  ))}
                </div>
                {order.payment_status === 'unpaid' && (
                  <button
                    className="ghost"
                    disabled={payingToken === order.public_token}
                    onClick={() => markPaid(order.public_token)}
                  >
                    <BanknoteIcon size={14} />
                    {payingToken === order.public_token ? 'Marking paid…' : 'Mark paid'}
                  </button>
                )}
              </div>
            ))}

            <footer className="floor-card-footer">
              <button className="secondary" onClick={() => setConfirmClose(ts)}>
                Close table
              </button>
            </footer>
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmClose}
        title="Close table"
        message={`Close Table ${confirmClose?.table_number}? Only do this once payment has been collected.`}
        confirmLabel="Close table"
        busy={closingId === confirmClose?.session_id}
        onConfirm={closeTable}
        onCancel={() => setConfirmClose(null)}
      />
    </>
  );
}
