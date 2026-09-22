import { PoolClient } from 'pg';
import { pool } from '../../db/pool';

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
