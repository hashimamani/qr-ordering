import { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

export interface CreateOrderItemInput {
  menu_item_id: string;
  quantity: number;
  notes?: string;
  destination: 'kitchen' | 'bar';
}

export interface CreateOrderInput {
  publicToken: string;
  tableSessionId: string;
  restaurantId: string;
  contactChannel: 'sms' | 'email';
  contactValue: string;
  items: CreateOrderItemInput[];
}

export interface CreatedOrder {
  id: string;
  public_token: string;
  submitted_at: string;
}

export interface CreatedOrderItem {
  id: string;
  menu_item_id: string;
}

/**
 * order_item ids come back alongside the order so the caller can snapshot
 * them (as order_item_id) onto the order_placed reporting event -- purely
 * for that purpose, this table is never written to for its own sake here.
 */
export async function insertOrder(
  input: CreateOrderInput,
): Promise<{ order: CreatedOrder; items: CreatedOrderItem[] }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query<CreatedOrder>(
      `INSERT INTO "order" (public_token, table_session_id, restaurant_id, contact_channel, contact_value)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, public_token, submitted_at`,
      [
        input.publicToken,
        input.tableSessionId,
        input.restaurantId,
        input.contactChannel,
        input.contactValue,
      ],
    );
    const order = orderResult.rows[0];

    const items: CreatedOrderItem[] = [];
    for (const item of input.items) {
      const itemResult = await client.query<CreatedOrderItem>(
        `INSERT INTO order_item (order_id, menu_item_id, quantity, notes, destination)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, menu_item_id`,
        [order.id, item.menu_item_id, item.quantity, item.notes ?? null, item.destination],
      );
      items.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');
    return { order, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface OrderNotificationContext {
  contact_channel: 'sms' | 'email';
  contact_value: string;
  restaurant_name: string;
  public_token: string;
}

/**
 * Fetches exactly what the notification pipeline needs for one order —
 * used both right after order creation and from the order_ready trigger,
 * so the queue payload never has to carry contact_value itself beyond
 * what's needed to place the send.
 */
export async function findOrderNotificationContext(orderId: string): Promise<OrderNotificationContext | undefined> {
  const result = await query<OrderNotificationContext>(
    `SELECT o.contact_channel, o.contact_value, r.name AS restaurant_name, o.public_token
     FROM "order" o
     JOIN restaurant r ON r.id = o.restaurant_id
     WHERE o.id = $1`,
    [orderId],
  );
  return result.rows[0];
}

/**
 * Manual "mark paid" -- no payment integration exists yet, so this is a
 * waiter's own record-keeping until a real processor sets this by default.
 * Addressed by public_token, not the internal id, matching every other
 * staff-facing order lookup (Order.id is never serialized anywhere).
 */
export async function markOrderAsPaid(restaurantId: string, publicToken: string): Promise<{ id: string }> {
  const result = await query<{ id: string }>(
    `UPDATE "order" SET payment_status = 'paid' WHERE public_token = $1 AND restaurant_id = $2 RETURNING id`,
    [publicToken, restaurantId],
  );
  if (result.rowCount === 0) {
    throw new NotFoundError('Order not found');
  }
  return result.rows[0];
}

/**
 * True once an order needs no further realtime updates -- paid, and
 * every item served. The caller uses this to release the order's
 * websocket room instead of leaving it open for a tracking page that
 * will never receive another event.
 */
export async function isOrderFullyComplete(publicToken: string): Promise<boolean> {
  const result = await query<{ complete: boolean }>(
    `SELECT o.payment_status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM order_item WHERE order_id = o.id AND status != 'served') AS complete
     FROM "order" o
     WHERE o.public_token = $1`,
    [publicToken],
  );
  return result.rows[0]?.complete ?? false;
}
