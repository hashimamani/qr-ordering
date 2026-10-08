import { query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

export interface TrackedOrderItem {
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: 'received' | 'preparing' | 'ready' | 'served' | 'cancelled';
}

export interface TrackedOrder {
  public_token: string;
  submitted_at: string;
  restaurant_name: string;
  brand_color: string | null;
  items: TrackedOrderItem[];
}

/**
 * The only data this query is allowed to leak is scoped to a single order,
 * addressed by its unguessable public_token — never join out to table or
 * contact_value beyond what this order's own row needs.
 *
 * Restaurant name and brand_color are a deliberate, narrow exception,
 * added so the tracking page can carry the restaurant's own identity
 * rather than generic Tab chrome. It discloses nothing new: whoever holds
 * this link either scanned that restaurant's QR code in the building or
 * was sent the link by the person who did, and the order-received email
 * already names the restaurant in its subject line. The exception stops
 * at these two columns — table number, contact details and anything else
 * about the restaurant stay out.
 */
export async function findOrderByPublicToken(publicToken: string): Promise<TrackedOrder> {
  const orderResult = await query<{
    public_token: string;
    submitted_at: string;
    restaurant_name: string;
    brand_color: string | null;
  }>(
    `SELECT o.public_token, o.submitted_at, r.name AS restaurant_name, r.brand_color
     FROM "order" o
     JOIN restaurant r ON r.id = o.restaurant_id
     WHERE o.public_token = $1`,
    [publicToken],
  );
  const order = orderResult.rows[0];
  if (!order) {
    throw new NotFoundError('Order not found');
  }

  const itemsResult = await query<TrackedOrderItem>(
    `SELECT mi.name AS menu_item_name, oi.quantity, oi.notes, oi.status
     FROM order_item oi
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     JOIN "order" o ON o.id = oi.order_id
     WHERE o.public_token = $1
     ORDER BY mi.name`,
    [publicToken],
  );

  return { ...order, items: itemsResult.rows };
}

/**
 * Resolves which restaurant an order belongs to from its public token.
 *
 * Kept out of TrackedOrder on purpose: that payload goes to a diner and
 * should carry nothing beyond their own order. The cancel route needs the
 * restaurant to scope the write, so it looks it up rather than the
 * customer-facing response growing a field for the server's benefit.
 */
export async function findRestaurantIdForOrder(publicToken: string): Promise<string | undefined> {
  const result = await query<{ restaurant_id: string }>(
    'SELECT restaurant_id FROM "order" WHERE public_token = $1',
    [publicToken],
  );
  return result.rows[0]?.restaurant_id;
}
