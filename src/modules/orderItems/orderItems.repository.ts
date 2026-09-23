import type { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../lib/errors';

export type OrderItemStatus = 'received' | 'preparing' | 'ready' | 'served';
export type Destination = 'kitchen' | 'bar';

const STATUS_ORDER: OrderItemStatus[] = ['received', 'preparing', 'ready', 'served'];

export interface QueuedOrderItem {
  table_number: string;
  order_public_token: string;
  order_item_id: string;
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: OrderItemStatus;
  submitted_at: string;
}

export async function listOrderItemsByDestination(
  restaurantId: string,
  destination: Destination,
): Promise<QueuedOrderItem[]> {
  const result = await query<QueuedOrderItem>(
    `SELECT t.table_number, o.public_token AS order_public_token, oi.id AS order_item_id,
            mi.name AS menu_item_name, oi.quantity, oi.notes, oi.status, o.submitted_at
     FROM order_item oi
     JOIN "order" o ON o.id = oi.order_id
     JOIN table_session ts ON ts.id = o.table_session_id
     JOIN "table" t ON t.id = ts.table_id
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     WHERE o.restaurant_id = $1 AND oi.destination = $2 AND oi.status != 'served'
     ORDER BY t.table_number, o.submitted_at, mi.name`,
    [restaurantId, destination],
  );
  return result.rows;
}

export interface TransitionResult {
  orderId: string;
  orderPublicToken: string;
  tableId: string;
  tableNumber: string;
  destination: Destination;
  newStatus: OrderItemStatus;
  isFirstReadyForOrder: boolean;
}

/**
 * Transitions one order_item's status, scoped to restaurantId so a staff
 * member can never touch another tenant's order — the ownership check and
 * the update happen inside the same row-locked transaction.
 */
export async function transitionOrderItemStatus(
  restaurantId: string,
  orderItemId: string,
  newStatus: OrderItemStatus,
): Promise<TransitionResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{
      id: string;
      status: OrderItemStatus;
      order_id: string;
      destination: Destination;
      restaurant_id: string;
      public_token: string;
      table_id: string;
      table_number: string;
    }>(
      `SELECT oi.id, oi.status, oi.order_id, oi.destination, o.restaurant_id, o.public_token, t.id AS table_id, t.table_number
       FROM order_item oi
       JOIN "order" o ON o.id = oi.order_id
       JOIN table_session ts ON ts.id = o.table_session_id
       JOIN "table" t ON t.id = ts.table_id
       WHERE oi.id = $1
       FOR UPDATE OF oi`,
      [orderItemId],
    );

    const item = current.rows[0];
    if (!item || item.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order item not found');
    }

    const currentIndex = STATUS_ORDER.indexOf(item.status);
    const newIndex = STATUS_ORDER.indexOf(newStatus);
    if (newIndex <= currentIndex) {
      throw new ConflictError(`Cannot move status from "${item.status}" to "${newStatus}"`);
    }

    const readyOrLater = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM order_item WHERE order_id = $1 AND id != $2 AND status IN ('ready', 'served')`,
      [item.order_id, orderItemId],
    );
    const isFirstReadyForOrder = newStatus === 'ready' && readyOrLater.rows[0].count === '0';

    await client.query('UPDATE order_item SET status = $1 WHERE id = $2', [newStatus, orderItemId]);

    await client.query('COMMIT');

    return {
      orderId: item.order_id,
      orderPublicToken: item.public_token,
      tableId: item.table_id,
      tableNumber: item.table_number,
      destination: item.destination,
      newStatus,
      isFirstReadyForOrder,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
