import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { ResolveTableResponse, PlaceOrderResponse } from '../../api/types';
import { Dialog } from '../../components/Dialog';

export function OrderPage() {
  const [params] = useSearchParams();
  const slug = params.get('slug');
  const qrToken = params.get('t');
  const navigate = useNavigate();

  const [data, setData] = useState<ResolveTableResponse | null>(null);
  const [error, setError] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    if (!slug || !qrToken) {
      setError('Missing ?slug= and ?t= in the URL.');
      return;
    }
    apiFetch<ResolveTableResponse>(`/r/${slug}/t/${qrToken}`)
      .then(setData)
      .catch((err: ApiError) => setError(err.message));
  }, [slug, qrToken]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, ResolveTableResponse['menu']['items']>();
    data?.menu.items.forEach((item) => {
      if (!map.has(item.category_id)) map.set(item.category_id, []);
      map.get(item.category_id)!.push(item);
    });
    return map;
  }, [data]);

  const itemById = useMemo(() => new Map(data?.menu.items.map((i) => [i.id, i]) ?? []), [data]);

  function setQty(itemId: string, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(itemId);
      else next.set(itemId, qty);
      return next;
    });
  }

  const totalItems = [...cart.values()].reduce((a, b) => a + b, 0);
  const totalPrice = [...cart.entries()].reduce((sum, [id, qty]) => sum + Number(itemById.get(id)?.price ?? 0) * qty, 0);

  async function submitOrder() {
    if (!slug || !qrToken || !contact.trim()) {
      setError('Enter a contact number or email so we can send your tracking link.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const items = [...cart.entries()].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
      const result = await apiFetch<PlaceOrderResponse>(`/r/${slug}/t/${qrToken}/orders`, {
        method: 'POST',
        body: { items, contact_channel: channel, contact_value: contact.trim() },
      });
      navigate(`/track/${result.public_token}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <header>
        <h1>{data?.restaurant.name ?? 'Loading…'}</h1>
        <div className="sub">
          {data ? (data.table_session_status === 'active' ? 'Table open — browse and order' : data.table_session_status) : ''}
        </div>
      </header>
      <main>
        {error && <div className="error-banner">{error}</div>}

        {data?.menu.categories.map((category) => {
          const items = itemsByCategory.get(category.id) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={category.id}>
              <div className="category-title">{category.name}</div>
              {items.map((item) => (
                <div key={item.id} className={`card item-row ${item.is_available ? '' : 'unavailable'}`}>
                  <div>
                    <div className="item-name">{item.name}</div>
                    {item.description && <div className="item-desc">{item.description}</div>}
                    <div className="item-price">
                      KSh {Number(item.price).toLocaleString()}
                      {!item.is_available && ' (unavailable)'}
                    </div>
                  </div>
                  {item.is_available && (
                    <div className="qty-controls">
                      <button onClick={() => setQty(item.id, (cart.get(item.id) ?? 0) - 1)} aria-label={`Remove one ${item.name}`}>
                        −
                      </button>
                      <span>{cart.get(item.id) ?? 0}</span>
                      <button onClick={() => setQty(item.id, (cart.get(item.id) ?? 0) + 1)} aria-label={`Add one ${item.name}`}>
                        +
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {totalItems > 0 && <div className="cart-bar-spacer" />}
      </main>

      {totalItems > 0 && (
        <div className="cart-bar">
          <div className="cart-bar-inner">
            <button className="primary" onClick={() => setCheckoutOpen(true)}>
              <span className="cart-bar-count">{totalItems}</span>
              {`  ${totalItems === 1 ? 'item' : 'items'} · KSh ${totalPrice.toLocaleString()} · Review order`}
            </button>
          </div>
        </div>
      )}

      <Dialog open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Confirm your order">
        <div>
          {[...cart.entries()].map(([id, qty]) => {
            const item = itemById.get(id);
            if (!item) return null;
            return (
              <div key={id} className="item-row">
                <span>
                  {qty}× {item.name}
                </span>
                <span className="item-price">KSh {(Number(item.price) * qty).toLocaleString()}</span>
              </div>
            );
          })}
          <div className="item-row cart-total-row">
            <span>Total</span>
            <span>KSh {totalPrice.toLocaleString()}</span>
          </div>

          <label htmlFor="channel" style={{ marginTop: 16 }}>
            Get your tracking link by
          </label>
          <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')}>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <label htmlFor="contact">
            {channel === 'sms' ? 'Phone number' : 'Email address'}
          </label>
          <input
            id="contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={channel === 'sms' ? '0712345678 or +254712345678' : 'you@example.com'}
          />
          <button className="primary" disabled={submitting} onClick={submitOrder}>
            {submitting ? 'Placing order…' : `Place order · KSh ${totalPrice.toLocaleString()}`}
          </button>
        </div>
      </Dialog>
    </>
  );
}
