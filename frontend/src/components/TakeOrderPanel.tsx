import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { ContactChannel, MenuCategory, MenuItem, PlaceOrderResponse } from '../api/types';
import { useToast } from './ToastProvider';

interface StaffMenuResponse {
  categories: MenuCategory[];
  items: MenuItem[];
  /** Only the channels this deployment can actually deliver on. */
  available_channels: ContactChannel[];
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
  // Null until the menu loads, then defaulted to the first channel the
  // server offers -- WhatsApp where available. Hardcoding 'sms' was how
  // this form came to offer a channel list that had not included
  // WhatsApp since the day it was added.
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<StaffMenuResponse>('/staff/menu', { auth: true })
      .then((data) => {
        setMenu(data);
        setChannel((prev) => prev ?? data.available_channels[0] ?? null);
      })
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
  // WhatsApp and SMS are both addressed by the same E.164 number, so they
  // share a field and a placeholder; only email differs.
  const isPhoneChannel = channel === 'sms' || channel === 'whatsapp';

  async function submitOrder() {
    if (!channel) {
      showToast('No contact channel is available right now.');
      return;
    }
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
          <select
            id={`channel-${tableId}`}
            value={channel ?? ''}
            onChange={(e) => setChannel(e.target.value as ContactChannel)}
          >
            {(menu?.available_channels ?? []).map((c) => (
              <option key={c} value={c}>
                {c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'Email'}
              </option>
            ))}
          </select>
          <label htmlFor={`contact-${tableId}`}>
            {isPhoneChannel ? "Customer's phone number, or your own" : "Customer's email, or your own"}
          </label>
          <input
            id={`contact-${tableId}`}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={isPhoneChannel ? '0712345678 or +254712345678' : 'you@example.com'}
          />
          <button className="primary" disabled={submitting} onClick={submitOrder}>
            {submitting ? 'Placing order…' : `Place order (${totalItems} item${totalItems > 1 ? 's' : ''})`}
          </button>
        </div>
      )}
    </div>
  );
}
