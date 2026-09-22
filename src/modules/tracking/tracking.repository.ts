import { query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

export interface TrackedOrderItem {
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: 'received' | 'preparing' | 'ready' | 'served';
}

export interface TrackedOrder {
  public_token: string;
  submitted_at: string;
  items: TrackedOrderItem[];
}

/**
 * The only data this query is allowed to leak is scoped to a single order,
 * addressed by its unguessable public_token — never join out to restaurant,
 * table, or contact_value beyond what this order's own row needs.
 */
export async function findOrderByPublicToken(publicToken: string): Promise<TrackedOrder> {
  const orderResult = await query<{ public_token: string; submitted_at: string }>(
    'SELECT public_token, submitted_at FROM "order" WHERE public_token = $1',
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
