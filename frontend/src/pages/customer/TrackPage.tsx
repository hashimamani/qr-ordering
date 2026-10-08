import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { TrackedOrder } from '../../api/types';
import { StatusPill } from '../../components/StatusPill';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';
import { PhoneIcon } from '../../components/icons';
import { useRealtime } from '../../hooks/useRealtime';
import { useBrandColor } from '../../hooks/useBrandColor';

const CALL_WAITER_COOLDOWN_MS = 30_000;

export function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const showToast = useToast();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [loadError, setLoadError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [calling, setCalling] = useState(false);
  const [calledAt, setCalledAt] = useState<number | null>(null);
  useBrandColor(order?.brand_color);

  // Mirrors the server rule exactly: offered only while every item is
  // still 'received'. Showing it later would be a button that always
  // fails, which is worse than not showing one.
  const canCancel =
    !!order && order.items.length > 0 && order.items.every((i) => i.status === 'received');

  async function cancelOrder() {
    setCancelling(true);
    try {
      await apiFetch(`/track/${token}/cancel`, { method: 'POST', body: {} });
      setConfirmCancel(false);
      load();
      showToast('Your order has been cancelled.', 'success');
    } catch (err) {
      // The kitchen may have started between the page rendering and the
      // tap; the server is the authority, so surface what it said.
      showToast(err instanceof ApiError ? err.message : 'Could not cancel the order.');
      load();
    } finally {
      setCancelling(false);
    }
  }

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<TrackedOrder>(`/track/${token}`)
      .then(setOrder)
      .catch((err: ApiError) => setLoadError(err.message));
  }, [token]);

  useEffect(load, [load]);

  const { connected } = useRealtime(token ? `order:${token}` : null, null, () => load());

  const onCooldown = calledAt !== null && Date.now() - calledAt < CALL_WAITER_COOLDOWN_MS;

  async function callWaiter() {
    if (!token || calling || onCooldown) return;
    setCalling(true);
    try {
      await apiFetch(`/track/${token}/call-waiter`, { method: 'POST' });
      setCalledAt(Date.now());
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setCalling(false);
    }
  }

  return (
    <>
      <header>
        <div className="top-bar">
          <h1>{order?.restaurant_name ?? 'Your order'}</h1>
          <div className="sub">
            <span className={`conn-dot ${connected ? 'live' : ''}`} /> {connected ? 'live' : 'connecting…'}
          </div>
        </div>
        {order && (
          <div className="sub">
            Your order &middot; placed {new Date(order.submitted_at).toLocaleTimeString()}
          </div>
        )}
      </header>
      <main>
        {loadError && <div className="error-banner">{loadError}</div>}
        <div className="card" style={{ marginBottom: 16 }}>
          <button className="secondary" disabled={calling || onCooldown} onClick={callWaiter}>
            <PhoneIcon size={16} />
            {onCooldown ? 'Waiter has been notified' : calling ? 'Calling…' : 'Call waiter'}
          </button>
        </div>
        {canCancel && (
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="sub" style={{ marginTop: 0 }}>
              Changed your mind? You can cancel while the kitchen hasn’t started.
            </p>
            <button className="danger" disabled={cancelling} onClick={() => setConfirmCancel(true)}>
              {cancelling ? 'Cancelling…' : 'Cancel my order'}
            </button>
          </div>
        )}

        {order?.items.map((item, i) => (
          <div key={i} className={`card item-row ${item.status === 'cancelled' ? 'unavailable' : ''}`}>
            <div>
              <div className="item-name">
                {item.quantity}× {item.menu_item_name}
              </div>
              {item.notes && <div className="item-desc">{item.notes}</div>}
            </div>
            <StatusPill status={item.status} />
          </div>
        ))}
      </main>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel your order?"
        message="Your whole order will be called off. You can place a new one afterwards."
        confirmLabel="Yes, cancel it"
        danger
        busy={cancelling}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={cancelOrder}
      />
    </>
  );
}
