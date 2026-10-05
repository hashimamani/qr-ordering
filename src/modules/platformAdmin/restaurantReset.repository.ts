import { query, withTransaction } from '../../db/pool';
import type { PoolClient } from 'pg';

export type RestaurantMode = 'test' | 'live';

export interface ResetCounts {
  orders: number;
  table_sessions: number;
}

export async function findRestaurantMode(
  restaurantId: string,
): Promise<{ id: string; name: string; slug: string; mode: RestaurantMode } | undefined> {
  const result = await query<{ id: string; name: string; slug: string; mode: RestaurantMode }>(
    'SELECT id, name, slug, mode FROM restaurant WHERE id = $1',
    [restaurantId],
  );
  return result.rows[0];
}

export async function setRestaurantMode(restaurantId: string, mode: RestaurantMode): Promise<boolean> {
  const result = await query('UPDATE restaurant SET mode = $2::restaurant_mode WHERE id = $1', [
    restaurantId,
    mode,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Clears a restaurant's trading history, leaving its configuration alone.
 *
 * Only two DELETEs are needed, because the schema already cascades from
 * `order`: order_item, order_item_status_audit, order_receipt,
 * notification_log and report_order_fact all have ON DELETE CASCADE on
 * their order_id, and report_order_item_fact cascades from
 * report_order_fact in turn. Listing those tables here by hand would be
 * a second, silently-drifting copy of the foreign keys -- a table added
 * later with a cascading order_id would be cleaned up by this code
 * automatically, whereas a hand-written list would quietly miss it.
 *
 * Order matters and is not a style choice: `order.table_session_id`
 * references table_session with ON DELETE RESTRICT, so sessions cannot
 * go first -- Postgres would refuse.
 *
 * Deliberately untouched: menu_category, menu_item, table, staff_user
 * and push_subscription. Chiefly because `table` carries qr_token, which
 * is what the printed QR codes on the physical tables encode -- deleting
 * tables would silently invalidate every code already stuck to a table.
 *
 * One transaction, so a failure part-way leaves the restaurant with its
 * history intact rather than half-deleted.
 */
export async function resetRestaurantTransactionalData(restaurantId: string): Promise<ResetCounts> {
  return withTransaction(async (client: PoolClient) => {
    // Re-read the mode inside the transaction. The service checks it
    // before calling, but between that check and this delete the
    // restaurant could have been flipped to live; FOR UPDATE makes the
    // check and the delete atomic rather than merely sequential.
    const guard = await client.query<{ mode: RestaurantMode }>(
      'SELECT mode FROM restaurant WHERE id = $1 FOR UPDATE',
      [restaurantId],
    );
    if (guard.rows[0]?.mode !== 'test') {
      throw new Error('restaurant is not in test mode');
    }

    const orders = await client.query('DELETE FROM "order" WHERE restaurant_id = $1', [restaurantId]);

    const sessions = await client.query(
      'DELETE FROM table_session WHERE table_id IN (SELECT id FROM "table" WHERE restaurant_id = $1)',
      [restaurantId],
    );

    return {
      orders: orders.rowCount ?? 0,
      table_sessions: sessions.rowCount ?? 0,
    };
  });
}

/** What a reset would remove, for showing before it is confirmed. */
export async function countRestaurantTransactionalData(restaurantId: string): Promise<ResetCounts> {
  const result = await query<{ orders: string; table_sessions: string }>(
    `SELECT
       (SELECT count(*) FROM "order" WHERE restaurant_id = $1) AS orders,
       (SELECT count(*) FROM table_session ts
          JOIN "table" t ON t.id = ts.table_id
         WHERE t.restaurant_id = $1) AS table_sessions`,
    [restaurantId],
  );
  return {
    orders: Number(result.rows[0]?.orders ?? 0),
    table_sessions: Number(result.rows[0]?.table_sessions ?? 0),
  };
}
