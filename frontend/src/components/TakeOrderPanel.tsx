import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { MenuCategory, MenuItem, PlaceOrderResponse } from '../api/types';
import { useToast } from './ToastProvider';

interface StaffMenuResponse {
  categories: MenuCategory[];
  items: MenuItem[];
}

/**
 * Staff-assisted ordering -- for a customer at the table who can't scan
 * the QR code themselves. Same cart/contact UX as the customer OrderPage,
 * just posting to /staff/tables/:tableId/orders instead of the public
 * per-table endpoint. contact_value is still required, same as a
 * customer order -- the customer's own phone/email if they have one,
 * otherwise any working contact the waiter enters (their own, or the
 * restaurant's).
 */
export function TakeOrderPanel({ tableId, onOrderPlaced }: { tableId: string; onOrderPlaced: () => void }) {
  const showToast = useToast();
  const [menu, setMenu] = useState<StaffMenuResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<StaffMenuResponse>('/staff/menu', { auth: true })
      .then(setMenu)
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    menu?.items.forEach((item) => {
      if (!map.has(item.category_id)) map.set(item.category_id, []);
      map.get(item.category_id)!.push(item);
    });
    return map;
  }, [menu]);

  function setQty(itemId: string, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(itemId);
      else next.set(itemId, qty);
      return next;
    });
  }

  const totalItems = [...cart.values()].reduce((a, b) => a + b, 0);

  async function submitOrder() {
    if (!contact.trim()) {
      showToast('A contact (the customer’s, yours, or the restaurant’s) is required.');
      return;
    }
    setSubmitting(true);
    try {
      const items = [...cart.entries()].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
      await apiFetch<PlaceOrderResponse>(`/staff/tables/${tableId}/orders`, {
        method: 'POST',
        auth: true,
        body: { items, contact_channel: channel, contact_value: contact.trim() },
      });
      setCart(new Map());
      setContact('');
      onOrderPlaced();
      showToast('Order placed.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      {loadError && <div className="error-banner">{loadError}</div>}
      {!menu && !loadError && <div className="sub">Loading menu…</div>}
      {menu?.categories.map((category) => {
        const items = itemsByCategory.get(category.id) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={category.id}>
            <div className="category-title">{category.name}</div>
            {items.map((item) => (
              <div key={item.id} className={`item-row ${item.is_available ? '' : 'unavailable'}`}>
                <div>
                  <div className="item-name">{item.name}</div>
                  <div className="item-price">
                    KSh {Number(item.price).toFixed(0)}
                    {!item.is_available && ' (unavailable)'}
                  </div>
                </div>
                {item.is_available && (
                  <div className="qty-controls">
                    <button onClick={() => setQty(item.id, (cart.get(item.id) ?? 0) - 1)}>-</button>
                    <span>{cart.get(item.id) ?? 0}</span>
                    <button onClick={() => setQty(item.id, (cart.get(item.id) ?? 0) + 1)}>+</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {totalItems > 0 && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`channel-${tableId}`}>Contact via</label>
          <select id={`channel-${tableId}`} value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')}>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <label htmlFor={`contact-${tableId}`}>Customer's phone/email, or your own</label>
          <input
            id={`contact-${tableId}`}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={channel === 'sms' ? '0712345678 or +254712345678' : 'you@example.com'}
          />
          <button className="primary" disabled={submitting} onClick={submitOrder}>
            {submitting ? 'Placing order…' : `Place order (${totalItems} item${totalItems > 1 ? 's' : ''})`}
          </button>
        </div>
      )}
    </div>
  );
}
