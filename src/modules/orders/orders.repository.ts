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

export async function insertOrder(input: CreateOrderInput): Promise<CreatedOrder> {
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

    for (const item of input.items) {
      await client.query(
        `INSERT INTO order_item (order_id, menu_item_id, quantity, notes, destination)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.menu_item_id, item.quantity, item.notes ?? null, item.destination],
      );
    }

    await client.query('COMMIT');
    return order;
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
export async function markOrderAsPaid(restaurantId: string, publicToken: string): Promise<void> {
  const result = await query(
    `UPDATE "order" SET payment_status = 'paid' WHERE public_token = $1 AND restaurant_id = $2`,
    [publicToken, restaurantId],
  );
  if (result.rowCount === 0) {
    throw new NotFoundError('Order not found');
  }
}
