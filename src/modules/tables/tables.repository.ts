import { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

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
