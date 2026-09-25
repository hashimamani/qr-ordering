import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { TrackedOrder } from '../../api/types';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/ToastProvider';
import { PhoneIcon } from '../../components/icons';
import { useRealtime } from '../../hooks/useRealtime';

const CALL_WAITER_COOLDOWN_MS = 30_000;

export function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const showToast = useToast();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [loadError, setLoadError] = useState('');
  const [calling, setCalling] = useState(false);
  const [calledAt, setCalledAt] = useState<number | null>(null);

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
          <h1>Your order</h1>
          <div className="sub">
            <span className={`conn-dot ${connected ? 'live' : ''}`} /> {connected ? 'live' : 'connecting…'}
          </div>
        </div>
        {order && <div className="sub">Placed {new Date(order.submitted_at).toLocaleTimeString()}</div>}
      </header>
      <main>
        {loadError && <div className="error-banner">{loadError}</div>}
        <div className="card" style={{ marginBottom: 16 }}>
          <button className="secondary" disabled={calling || onCooldown} onClick={callWaiter}>
            <PhoneIcon size={16} />
            {onCooldown ? 'Waiter has been notified' : calling ? 'Calling…' : 'Call waiter'}
          </button>
        </div>
        {order?.items.map((item, i) => (
          <div key={i} className="card item-row">
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
    </>
  );
}
