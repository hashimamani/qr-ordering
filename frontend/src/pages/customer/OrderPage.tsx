import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { ResolveTableResponse, PlaceOrderResponse, ContactChannel } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { useToast } from '../../components/ToastProvider';
import { useBrandColor } from '../../hooks/useBrandColor';
import { MenuBrowser } from '../../components/MenuBrowser';

export function OrderPage() {
  const [params] = useSearchParams();
  const slug = params.get('slug');
  const qrToken = params.get('t');
  const navigate = useNavigate();
  const showToast = useToast();

  const [data, setData] = useState<ResolveTableResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // Deliberately not defaulted to a hardcoded channel. The server says
  // which channels can actually deliver (available_channels) and this
  // follows it -- a hardcoded 'whatsapp' default once shipped while the
  // API had no WhatsApp credentials, so every such order silently sent
  // nothing. Null until the table resolves.
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  useBrandColor(data?.restaurant.brand_color);

  // WhatsApp and SMS are both addressed by the same E.164 number, so the
  // field is shared and switching between them needs no re-entry.
  const isPhoneChannel = channel === 'whatsapp' || channel === 'sms';

  // Preference order: WhatsApp first where it's available, since that's
  // the whole point of adding it -- but only ever among channels the
  // server says it can actually send on.
  const offered = data?.available_channels ?? [];
  useEffect(() => {
    if (!channel && offered.length > 0) setChannel(offered[0]);
  }, [channel, offered]);

  useEffect(() => {
    if (!slug || !qrToken) {
      setLoadError('Missing ?slug= and ?t= in the URL.');
      return;
    }
    apiFetch<ResolveTableResponse>(`/r/${slug}/t/${qrToken}`)
      .then(setData)
      .catch((err: ApiError) => setLoadError(err.message));
  }, [slug, qrToken]);


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
    if (!slug || !qrToken || !contact.trim() || !channel) {
      showToast('Enter a contact number or email so we can send your tracking link.');
      return;
    }
    setSubmitting(true);
    try {
      const items = [...cart.entries()].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
      const result = await apiFetch<PlaceOrderResponse>(`/r/${slug}/t/${qrToken}/orders`, {
        method: 'POST',
        body: { items, contact_channel: channel, contact_value: contact.trim() },
      });
      navigate(`/track/${result.public_token}`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
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
        {loadError && <div className="error-banner">{loadError}</div>}

        {data && (
          <MenuBrowser
            categories={data.menu.categories}
            items={data.menu.items}
            quantityFor={(id) => cart.get(id) ?? 0}
            onQuantityChange={setQty}
          />
        )}

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
            Get your updates and receipt by
          </label>
          <select
            id="channel"
            value={channel ?? ''}
            onChange={(e) => setChannel(e.target.value as ContactChannel)}
          >
            {offered.map((c) => (
              <option key={c} value={c}>
                {c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'Email'}
              </option>
            ))}
          </select>
          <label htmlFor="contact">
            {isPhoneChannel ? 'Phone number' : 'Email address'}
          </label>
          <input
            id="contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            inputMode={isPhoneChannel ? 'tel' : 'email'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={isPhoneChannel ? '0712345678 or +254712345678' : 'you@example.com'}
          />
          {/* Meta requires opt-in even for utility templates, so the notice
              has to be visible at the point the number is given. Submitting
              is what records contact_consent_at server-side. */}
          <p className="consent-note">
            {channel === 'whatsapp'
              ? "We'll message your order updates and receipt on WhatsApp. Standard rates may apply."
              : channel === 'sms'
                ? "We'll text your order updates and receipt to this number."
                : "We'll email your order updates and receipt to this address."}{' '}
            {/* Linked at the point the number is handed over, not buried in a
                footer -- this is the moment contact_consent_at is recorded,
                so it is the moment the notice has to be reachable. */}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy
            </a>
          </p>
          <button className="primary" disabled={submitting} onClick={submitOrder}>
            {submitting ? 'Placing order…' : `Place order · KSh ${totalPrice.toLocaleString()}`}
          </button>
        </div>
      </Dialog>
    </>
  );
}
