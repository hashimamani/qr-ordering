import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { WaiterTableSession } from '../../api/types';
import { StaffLayout } from '../../components/StaffLayout';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../hooks/useRealtime';
import { usePushSubscription } from '../../hooks/usePushSubscription';

export function WaiterPage() {
  const { session } = useAuth();
  const [sessions, setSessions] = useState<WaiterTableSession[]>([]);
  const [error, setError] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const push = usePushSubscription();

  const load = useCallback(() => {
    apiFetch<{ table_sessions: WaiterTableSession[] }>('/staff/tables', { auth: true })
      .then((data) => setSessions(data.table_sessions))
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:waiter:${session.staffId}` : null,
    session?.token ?? null,
    () => load(),
  );

  async function closeTable(sessionId: string) {
    if (!confirm('Close this table? Only do this once payment has been collected.')) return;
    setClosingId(sessionId);
    try {
      await apiFetch(`/staff/table-sessions/${sessionId}/close`, { method: 'PATCH', auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setClosingId(null);
    }
  }

  return (
    <StaffLayout title="Waiter" connected={connected}>
      {error && <div className="error-banner">{error}</div>}
      {session?.role === 'waiter' && push.status !== 'enabled' && (
        <div className="card" style={{ marginBottom: 16 }}>
          {push.error && <div className="error-banner">{push.error}</div>}
          <button className="secondary" disabled={push.status === 'enabling'} onClick={push.enable}>
            {push.status === 'enabling' ? 'Enabling…' : 'Enable notifications'}
          </button>
        </div>
      )}
      {sessions.length === 0 && <div className="empty-state">No active tables.</div>}
      {sessions.map((ts) => (
        <div key={ts.session_id} className="table-block">
          <div className="top-bar">
            <h3>
              Table {ts.table_number} <span className="status-pill status-received">{ts.session_status}</span>{' '}
              {!ts.assigned_waiter_id && <span className="status-pill">unassigned</span>}
            </h3>
            <button className="secondary danger" disabled={closingId === ts.session_id} onClick={() => closeTable(ts.session_id)}>
              Close table
            </button>
          </div>
          {/* Each Order is its own block, never merged -- orders at the
              same table are billed independently. */}
          {ts.orders.map((order) => (
            <div key={order.public_token} className="card order-block">
              <div className="order-block-header">
                Order placed {new Date(order.submitted_at).toLocaleTimeString()} &middot;{' '}
                <a className="tracking-link" href={`/track/${order.public_token}`} target="_blank" rel="noreferrer">
                  tracking page
                </a>
              </div>
              {order.items.map((item, i) => (
                <div key={i} className="item-row" style={{ marginBottom: 4 }}>
                  <span>
                    {item.quantity}× {item.menu_item_name}
                  </span>
                  <span className={`status-pill status-${item.status}`}>{item.status}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </StaffLayout>
  );
}
