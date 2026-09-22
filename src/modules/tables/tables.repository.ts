import { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../lib/errors';

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  table_number: string;
  qr_token: string;
}

export interface TableSession {
  id: string;
  table_id: string;
  status: 'active' | 'awaiting_payment' | 'closed';
  opened_at: string;
  closed_at: string | null;
}

export async function findRestaurantBySlug(slug: string): Promise<Restaurant> {
  const result = await query<Restaurant>(
    'SELECT id, name, slug FROM restaurant WHERE slug = $1',
    [slug],
  );
  const restaurant = result.rows[0];
  if (!restaurant) {
    throw new NotFoundError('Restaurant not found');
  }
  return restaurant;
}

export async function findRestaurantById(id: string): Promise<Restaurant> {
  const result = await query<Restaurant>('SELECT id, name, slug FROM restaurant WHERE id = $1', [id]);
  const restaurant = result.rows[0];
  if (!restaurant) {
    throw new NotFoundError('Restaurant not found');
  }
  return restaurant;
}

/**
 * Table lookup is always scoped to restaurant_id, in addition to the
 * globally-unique qr_token — defense in depth so a table can never resolve
 * under the wrong restaurant even if a future change makes qr_token
 * non-global.
 */
export async function findTableByQrToken(
  restaurantId: string,
  qrToken: string,
): Promise<RestaurantTable> {
  const result = await query<RestaurantTable>(
    'SELECT id, restaurant_id, table_number, qr_token FROM "table" WHERE restaurant_id = $1 AND qr_token = $2',
    [restaurantId, qrToken],
  );
  const table = result.rows[0];
  if (!table) {
    throw new NotFoundError('Table not found');
  }
  return table;
}

/**
 * Finds the currently active session for a table, or opens a new one.
 * Runs inside a transaction with a row lock scope on the table to avoid a
 * race between two simultaneous scans creating two "active" sessions.
 */
export async function findOrCreateActiveSession(tableId: string): Promise<TableSession> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM "table" WHERE id = $1 FOR UPDATE', [tableId]);

    const existing = await client.query<TableSession>(
      `SELECT id, table_id, status, opened_at, closed_at
       FROM table_session
       WHERE table_id = $1 AND status = 'active'
       ORDER BY opened_at DESC
       LIMIT 1`,
      [tableId],
    );

    if (existing.rows[0]) {
      await client.query('COMMIT');
      return existing.rows[0];
    }

    const created = await client.query<TableSession>(
      `INSERT INTO table_session (table_id, status)
       VALUES ($1, 'active')
       RETURNING id, table_id, status, opened_at, closed_at`,
      [tableId],
    );
    await client.query('COMMIT');
    return created.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface WaiterOrderItem {
  menu_item_name: string;
  quantity: number;
  status: 'received' | 'preparing' | 'ready' | 'served';
}

export interface WaiterOrder {
  public_token: string;
  contact_channel: 'sms' | 'email';
  submitted_at: string;
  items: WaiterOrderItem[];
}

export interface WaiterTableSession {
  session_id: string;
  session_status: 'active' | 'awaiting_payment' | 'closed';
  table_number: string;
  opened_at: string;
  orders: WaiterOrder[];
}

/**
 * Each Order is rendered as its own block, never flattened into a
 * table-level total -- orders at the same table are billed independently.
 */
export async function listActiveTableSessionsForRestaurant(
  restaurantId: string,
): Promise<WaiterTableSession[]> {
  const sessions = await query<{
    session_id: string;
    session_status: WaiterTableSession['session_status'];
    table_number: string;
    opened_at: string;
  }>(
    `SELECT ts.id AS session_id, ts.status AS session_status, t.table_number, ts.opened_at
     FROM table_session ts
     JOIN "table" t ON t.id = ts.table_id
     WHERE t.restaurant_id = $1 AND ts.status IN ('active', 'awaiting_payment')
     ORDER BY t.table_number, ts.opened_at`,
    [restaurantId],
  );

  if (sessions.rows.length === 0) return [];
  const sessionIds = sessions.rows.map((s) => s.session_id);

  const orderRows = await query<{
    table_session_id: string;
    public_token: string;
    contact_channel: WaiterOrder['contact_channel'];
    submitted_at: string;
    menu_item_name: string;
    quantity: number;
    status: WaiterOrderItem['status'];
  }>(
    `SELECT o.table_session_id, o.public_token, o.contact_channel, o.submitted_at,
            mi.name AS menu_item_name, oi.quantity, oi.status
     FROM "order" o
     JOIN order_item oi ON oi.order_id = o.id
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     WHERE o.table_session_id = ANY($1::uuid[])
     ORDER BY o.submitted_at, mi.name`,
    [sessionIds],
  );

  const ordersBySession = new Map<string, Map<string, WaiterOrder>>();
  for (const row of orderRows.rows) {
    if (!ordersBySession.has(row.table_session_id)) {
      ordersBySession.set(row.table_session_id, new Map());
    }
    const ordersForSession = ordersBySession.get(row.table_session_id)!;
    if (!ordersForSession.has(row.public_token)) {
      ordersForSession.set(row.public_token, {
        public_token: row.public_token,
        contact_channel: row.contact_channel,
        submitted_at: row.submitted_at,
        items: [],
      });
    }
    ordersForSession.get(row.public_token)!.items.push({
      menu_item_name: row.menu_item_name,
      quantity: row.quantity,
      status: row.status,
    });
  }

  return sessions.rows.map((session) => ({
    ...session,
    orders: [...(ordersBySession.get(session.session_id)?.values() ?? [])],
  }));
}

export async function closeTableSession(restaurantId: string, sessionId: string): Promise<void> {
  const result = await query<{ id: string; status: TableSession['status']; restaurant_id: string }>(
    `SELECT ts.id, ts.status, t.restaurant_id
     FROM table_session ts
     JOIN "table" t ON t.id = ts.table_id
     WHERE ts.id = $1`,
    [sessionId],
  );
  const session = result.rows[0];
  if (!session || session.restaurant_id !== restaurantId) {
    throw new NotFoundError('Table session not found');
  }
  if (session.status === 'closed') {
    throw new ConflictError('Table session is already closed');
  }

  await query('UPDATE table_session SET status = $1, closed_at = now() WHERE id = $2', ['closed', sessionId]);
}
