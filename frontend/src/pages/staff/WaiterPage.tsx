import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { IdleTable, WaiterTableSession } from '../../api/types';
import { StaffLayout } from '../../components/StaffLayout';
import { TakeOrderPanel } from '../../components/TakeOrderPanel';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RowMenu } from '../../components/RowMenu';
import { useToast } from '../../components/ToastProvider';
import { CheckIcon, ClipboardListIcon, XIcon } from '../../components/icons';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../hooks/useRealtime';
import { usePushSubscription } from '../../hooks/usePushSubscription';

export function WaiterPage() {
  const { session } = useAuth();
  const showToast = useToast();
  const [sessions, setSessions] = useState<WaiterTableSession[]>([]);
  const [idleTables, setIdleTables] = useState<IdleTable[]>([]);
  const [loadError, setLoadError] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<WaiterTableSession | null>(null);
  const [servingId, setServingId] = useState<string | null>(null);
  const [payingToken, setPayingToken] = useState<string | null>(null);
  const [takingOrderForTableId, setTakingOrderForTableId] = useState<string | null>(null);
  const [startTableId, setStartTableId] = useState('');
  const push = usePushSubscription();

  const load = useCallback(() => {
    apiFetch<{ table_sessions: WaiterTableSession[] }>('/staff/tables', { auth: true })
      .then((data) => setSessions(data.table_sessions))
      .catch((err: ApiError) => setLoadError(err.message));
    apiFetch<{ tables: IdleTable[] }>('/staff/idle-tables', { auth: true })
      .then((data) => setIdleTables(data.tables))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:waiter:${session.staffId}` : null,
    session?.token ?? null,
    () => load(),
  );

  async function closeTable() {
    if (!confirmClose) return;
    const sessionId = confirmClose.session_id;
    setClosingId(sessionId);
    try {
      await apiFetch(`/staff/table-sessions/${sessionId}/close`, { method: 'PATCH', auth: true });
      setConfirmClose(null);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setClosingId(null);
    }
  }

  async function markServed(orderItemId: string) {
    setServingId(orderItemId);
    try {
      await apiFetch(`/staff/order-items/${orderItemId}/status`, {
        method: 'PATCH',
        auth: true,
        body: { status: 'served' },
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setServingId(null);
    }
  }

  async function markPaid(publicToken: string) {
    setPayingToken(publicToken);
    try {
      await apiFetch(`/staff/orders/${publicToken}/payment-status`, { method: 'PATCH', auth: true });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setPayingToken(null);
    }
  }

  return (
    <StaffLayout title="Waiter" connected={connected}>
      {loadError && <div className="error-banner">{loadError}</div>}
      {session?.role === 'waiter' && push.status !== 'enabled' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <button className="secondary" disabled={push.status === 'enabling'} onClick={push.enable}>
            {push.status === 'enabling' ? 'Enabling…' : 'Enable notifications'}
          </button>
        </div>
      )}
      {idleTables.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Start a table</h3>
          <p className="sub">
            For a customer who can't scan the QR code themselves -- pick their table and take the order here.
          </p>
          <div className="grid-2">
            <select value={startTableId} onChange={(e) => setStartTableId(e.target.value)}>
              <option value="">Select a table…</option>
              {idleTables.map((t) => (
                <option key={t.id} value={t.id}>
                  Table {t.table_number}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              disabled={!startTableId}
              onClick={() => {
                setTakingOrderForTableId(startTableId);
                setStartTableId('');
              }}
            >
              Take order
            </button>
          </div>
          {takingOrderForTableId && idleTables.some((t) => t.id === takingOrderForTableId) && (
            <TakeOrderPanel tableId={takingOrderForTableId} onOrderPlaced={() => { setTakingOrderForTableId(null); load(); }} />
          )}
        </div>
      )}
      {sessions.length === 0 && idleTables.length === 0 && <div className="empty-state">No tables yet.</div>}
      {sessions.map((ts) => (
        <div key={ts.session_id} className="table-block">
          <div className="top-bar">
            <h3>
              Table {ts.table_number} <span className="status-pill status-received">{ts.session_status}</span>{' '}
              {ts.assigned_waiter_name ? (
                <span className="status-pill status-assigned">{ts.assigned_waiter_name}</span>
              ) : (
                <span className="status-pill status-unassigned">unassigned</span>
              )}
            </h3>
            <RowMenu
              label={`Actions for table ${ts.table_number}`}
              actions={[
                {
                  label: takingOrderForTableId === ts.table_id ? 'Cancel take order' : 'Take order',
                  icon: <ClipboardListIcon size={16} />,
                  onSelect: () => setTakingOrderForTableId(takingOrderForTableId === ts.table_id ? null : ts.table_id),
                },
                {
                  label: 'Close table',
                  icon: <XIcon size={16} />,
                  danger: true,
                  disabled: closingId === ts.session_id,
                  onSelect: () => setConfirmClose(ts),
                },
              ]}
            />
          </div>
          {takingOrderForTableId === ts.table_id && (
            <TakeOrderPanel
              tableId={ts.table_id}
              onOrderPlaced={() => {
                setTakingOrderForTableId(null);
                load();
              }}
            />
          )}
          {/* Each Order is its own block, never merged -- orders at the
              same table are billed independently. */}
          {ts.orders.map((order) => (
            <div key={order.public_token} className="card order-block">
              <div className="order-block-header">
                <span>
                  Order placed {new Date(order.submitted_at).toLocaleTimeString()} &middot;{' '}
                  <a className="tracking-link" href={`/track/${order.public_token}`} target="_blank" rel="noreferrer">
                    tracking page
                  </a>
                </span>
                <span className={`status-pill status-${order.payment_status}`}>{order.payment_status}</span>
              </div>
              {order.items.map((item) => (
                <div key={item.order_item_id} className="item-row" style={{ marginBottom: 4 }}>
                  <span>
                    {item.quantity}× {item.menu_item_name}
                  </span>
                  <span>
                    <span className={`status-pill status-${item.status}`}>{item.status}</span>
                    {item.status === 'ready' && (
                      <button
                        className="secondary"
                        disabled={servingId === item.order_item_id}
                        onClick={() => markServed(item.order_item_id)}
                      >
                        <CheckIcon size={14} />
                        {servingId === item.order_item_id ? 'Marking served…' : 'Mark served'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {order.payment_status === 'unpaid' && (
                <div className="order-block-footer">
                  <button
                    className="secondary"
                    disabled={payingToken === order.public_token}
                    onClick={() => markPaid(order.public_token)}
                  >
                    <CheckIcon size={14} />
                    {payingToken === order.public_token ? 'Marking paid…' : 'Mark paid'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <ConfirmDialog
        open={!!confirmClose}
        title="Close table"
        message={`Close Table ${confirmClose?.table_number}? Only do this once payment has been collected.`}
        confirmLabel="Close table"
        busy={closingId === confirmClose?.session_id}
        onConfirm={closeTable}
        onCancel={() => setConfirmClose(null)}
      />
    </StaffLayout>
  );
}
