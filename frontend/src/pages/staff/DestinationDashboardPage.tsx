import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { DashboardTable, Destination, OrderItemStatus } from '../../api/types';
import { StaffLayout } from '../../components/StaffLayout';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../hooks/useRealtime';
import { BellIcon, FlameIcon } from '../../components/icons';

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
const NEXT_ICON: Partial<Record<OrderItemStatus, JSX.Element>> = {
  received: <FlameIcon size={14} />,
  preparing: <BellIcon size={14} />,
};

export function DestinationDashboardPage({ destination, title }: { destination: Destination; title: string }) {
  const { session } = useAuth();
  const showToast = useToast();
  const [tables, setTables] = useState<DashboardTable[]>([]);
  const [loadError, setLoadError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ tables: DashboardTable[] }>(`/staff/${destination}`, { auth: true })
      .then((data) => setTables(data.tables))
      .catch((err: ApiError) => setLoadError(err.message));
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
      showToast(nextStatus === 'preparing' ? 'Started preparing.' : 'Marked ready.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <StaffLayout title={title} connected={connected}>
      {loadError && <div className="error-banner">{loadError}</div>}
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
                    className="ghost"
                    disabled={pendingId === item.order_item_id}
                    onClick={() => advance(item.order_item_id, next)}
                  >
                    {NEXT_ICON[item.status]}
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
