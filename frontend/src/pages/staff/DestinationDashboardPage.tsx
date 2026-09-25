import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { DashboardTable, Destination, OrderItemStatus } from '../../api/types';
import { StaffLayout } from '../../components/StaffLayout';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../hooks/useRealtime';

// Stops at 'ready' -- marking an item 'served' is the waiter's call, not
// kitchen/bar's (they're not the ones actually bringing it to the table).
const NEXT_STATUS: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
  received: 'preparing',
  preparing: 'ready',
};
const NEXT_LABEL: Partial<Record<OrderItemStatus, string>> = {
  received: 'Start preparing',
  preparing: 'Mark ready',
};

export function DestinationDashboardPage({ destination, title }: { destination: Destination; title: string }) {
  const { session } = useAuth();
  const [tables, setTables] = useState<DashboardTable[]>([]);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ tables: DashboardTable[] }>(`/staff/${destination}`, { auth: true })
      .then((data) => setTables(data.tables))
      .catch((err: ApiError) => setError(err.message));
  }, [destination]);

  useEffect(load, [load]);

  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:${destination}` : null,
    session?.token ?? null,
    () => load(),
  );

  async function advance(orderItemId: string, nextStatus: OrderItemStatus) {
    setPendingId(orderItemId);
    try {
      await apiFetch(`/staff/order-items/${orderItemId}/status`, {
        method: 'PATCH',
        auth: true,
        body: { status: nextStatus },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <StaffLayout title={title} connected={connected}>
      {error && <div className="error-banner">{error}</div>}
      {tables.length === 0 && <div className="empty-state">No {destination} items waiting.</div>}
      {tables.map((table) => (
        <div key={table.table_number} className="table-block">
          <h3>Table {table.table_number}</h3>
          {table.items.map((item) => {
            const next = NEXT_STATUS[item.status];
            return (
              <div key={item.order_item_id} className="card item-row">
                <div>
                  <div className="item-name">
                    {item.quantity}× {item.menu_item_name}
                  </div>
                  {item.notes && <div className="item-desc">{item.notes}</div>}
                  <span className={`status-pill status-${item.status}`}>{item.status}</span>
                </div>
                {next && (
                  <button
                    className="secondary"
                    disabled={pendingId === item.order_item_id}
                    onClick={() => advance(item.order_item_id, next)}
                  >
                    {NEXT_LABEL[item.status]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </StaffLayout>
  );
}
