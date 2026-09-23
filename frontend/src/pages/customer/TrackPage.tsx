import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { TrackedOrder } from '../../api/types';
import { StatusPill } from '../../components/StatusPill';
import { useRealtime } from '../../hooks/useRealtime';

export function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<TrackedOrder>(`/track/${token}`)
      .then(setOrder)
      .catch((err: ApiError) => setError(err.message));
  }, [token]);

  useEffect(load, [load]);

  const { connected } = useRealtime(token ? `order:${token}` : null, null, () => load());

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
        {error && <div className="error-banner">{error}</div>}
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
