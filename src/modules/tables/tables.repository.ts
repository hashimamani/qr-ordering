import { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';

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
    'SELECT id, restaurant_id, table_number, qr_token FROM "table" WHERE restaurant_id = $1 AND qr_token = $2 AND removed_at IS NULL',
    [restaurantId, qrToken],
  );
  const table = result.rows[0];
  if (!table) {
    throw new NotFoundError('Table not found');
  }
  return table;
}

export interface RestaurantTableWithAssignment extends RestaurantTable {
  assigned_waiter_id: string | null;
}

/**
 * Staff-order counterpart to findTableByQrToken -- a waiter placing an
 * order on a customer's behalf (see orders.service.ts's placeStaffOrder)
 * looks the table up by id from their own dashboard, not by qr_token.
 * Includes assigned_waiter_id so the caller can enforce "only your own
 * table" without a second query.
 */
export async function findTableById(restaurantId: string, tableId: string): Promise<RestaurantTableWithAssignment> {
  const result = await query<RestaurantTableWithAssignment>(
    'SELECT id, restaurant_id, table_number, qr_token, assigned_waiter_id FROM "table" WHERE id = $1 AND restaurant_id = $2 AND removed_at IS NULL',
    [tableId, restaurantId],
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

/**
 * The normal way a table gets a waiter -- called on the first order or
 * call-waiter press at a still-unassigned table. Picks whichever `waiter`
 * in the restaurant has gone longest without holding a table (their most
 * recent `assigned_at` across all tables, oldest first; never having held
 * one sorts first). No-ops if the table already has an assignee (first
 * caller wins any race between a simultaneous order and call-waiter
 * press), and returns null without error if the restaurant has no waiters
 * yet. Row-locks the table for the same reason findOrCreateActiveSession
 * does.
 */
export async function assignNextWaiterRoundRobin(restaurantId: string, tableId: string): Promise<string | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ assigned_waiter_id: string | null }>(
      'SELECT assigned_waiter_id FROM "table" WHERE id = $1 FOR UPDATE',
      [tableId],
    );
    const existing = current.rows[0]?.assigned_waiter_id ?? null;
    if (existing) {
      await client.query('COMMIT');
      return existing;
    }

    const next = await client.query<{ id: string }>(
      `SELECT s.id
       FROM staff_user s
       LEFT JOIN (
         SELECT assigned_waiter_id, MAX(assigned_at) AS last_assigned_at
         FROM "table"
         WHERE restaurant_id = $1 AND assigned_waiter_id IS NOT NULL
         GROUP BY assigned_waiter_id
       ) recency ON recency.assigned_waiter_id = s.id
       WHERE s.restaurant_id = $1 AND s.role = 'waiter'
       ORDER BY recency.last_assigned_at ASC NULLS FIRST, s.id
       LIMIT 1`,
      [restaurantId],
    );
    const waiterId = next.rows[0]?.id ?? null;
    if (waiterId) {
      await client.query('UPDATE "table" SET assigned_waiter_id = $1, assigned_at = now() WHERE id = $2', [
        waiterId,
        tableId,
      ]);
    }
    await client.query('COMMIT');
    return waiterId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Assigns a table directly to a specific waiter, no round robin -- used
 * when a waiter places a staff-assisted order for a customer without a
 * QR-capable phone (orders.service.ts's placeStaffOrder): the waiter
 * placing the order is already standing at the table, so they should get
 * it rather than whoever round robin would otherwise pick. A no-op if
 * already assigned (to anyone) -- callers only invoke this when they've
 * already confirmed the table is unassigned.
 */
export async function assignWaiterDirectly(tableId: string, waiterId: string): Promise<void> {
  await query('UPDATE "table" SET assigned_waiter_id = $1, assigned_at = now() WHERE id = $2', [waiterId, tableId]);
}

export interface IdleTable {
  id: string;
  table_number: string;
}

/**
 * Tables with no active/awaiting_payment session -- i.e. a customer
 * hasn't scanned the QR (or one never went out) and no order exists yet.
 * These never show up in listActiveTableSessionsForRestaurant, which
 * only lists existing sessions -- a waiter starting a staff-assisted
 * order for a walk-in with no QR-capable phone needs this list instead,
 * since there's no session to have appeared under yet.
 */
export async function listIdleTablesForRestaurant(restaurantId: string): Promise<IdleTable[]> {
  const result = await query<IdleTable>(
    `SELECT t.id, t.table_number
     FROM "table" t
     WHERE t.restaurant_id = $1
       AND t.removed_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM table_session ts
         WHERE ts.table_id = t.id AND ts.status IN ('active', 'awaiting_payment')
       )
     ORDER BY t.table_number`,
    [restaurantId],
  );
  return result.rows;
}

/** Looks up who's currently assigned to a table -- used at broadcast time. */
export async function findAssignedWaiterForTable(tableId: string): Promise<string | null> {
  const result = await query<{ assigned_waiter_id: string | null }>(
    'SELECT assigned_waiter_id FROM "table" WHERE id = $1',
    [tableId],
  );
  return result.rows[0]?.assigned_waiter_id ?? null;
}

export interface TableContext {
  restaurant_id: string;
  table_id: string;
  table_number: string;
  assigned_waiter_id: string | null;
}

/**
 * Resolves a customer's order token to its table -- for the call-waiter
 * button. Kept separate from tracking.repository.ts's findOrderByPublicToken,
 * which has a deliberate comment restricting it to single-order-scoped
 * data only; this one intentionally joins out to the table.
 */
export async function findTableContextByPublicToken(publicToken: string): Promise<TableContext> {
  const result = await query<TableContext>(
    `SELECT t.restaurant_id, t.id AS table_id, t.table_number, t.assigned_waiter_id
     FROM "order" o
     JOIN table_session ts ON ts.id = o.table_session_id
     JOIN "table" t ON t.id = ts.table_id
     WHERE o.public_token = $1`,
    [publicToken],
  );
  const context = result.rows[0];
  if (!context) throw new NotFoundError('Order not found');
  return context;
}

export interface WaiterOrderItem {
  order_item_id: string;
  menu_item_name: string;
  quantity: number;
  status: 'received' | 'preparing' | 'ready' | 'served';
}

export interface WaiterOrder {
  public_token: string;
  contact_channel: 'sms' | 'email';
  submitted_at: string;
  payment_status: 'unpaid' | 'paid';
  items: WaiterOrderItem[];
}

export interface WaiterTableSession {
  session_id: string;
  session_status: 'active' | 'awaiting_payment' | 'closed';
  table_id: string;
  table_number: string;
  opened_at: string;
  assigned_waiter_id: string | null;
  assigned_waiter_name: string | null;
  orders: WaiterOrder[];
}

/**
 * Each Order is rendered as its own block, never flattened into a
 * table-level total -- orders at the same table are billed independently.
 *
 * `waiterId` scopes the result to that waiter's own tables plus any still-
 * unassigned ones -- pass it only for the `waiter` role; omit it for
 * `admin`, who sees every table. assigned_waiter_name is included so an
 * admin looking at the full board can tell which waiter owns which table
 * -- a waiter viewing their own board already knows (it's either them or
 * unassigned), but the name costs nothing extra to include for them too.
 */
export async function listActiveTableSessionsForRestaurant(
  restaurantId: string,
  waiterId?: string,
): Promise<WaiterTableSession[]> {
  const sessions = await query<{
    session_id: string;
    session_status: WaiterTableSession['session_status'];
    table_id: string;
    table_number: string;
    opened_at: string;
    assigned_waiter_id: string | null;
    assigned_waiter_name: string | null;
  }>(
    `SELECT ts.id AS session_id, ts.status AS session_status, t.id AS table_id, t.table_number, ts.opened_at,
            t.assigned_waiter_id, s.name AS assigned_waiter_name
     FROM table_session ts
     JOIN "table" t ON t.id = ts.table_id
     LEFT JOIN staff_user s ON s.id = t.assigned_waiter_id
     WHERE t.restaurant_id = $1 AND ts.status IN ('active', 'awaiting_payment')
       ${waiterId ? 'AND (t.assigned_waiter_id = $2 OR t.assigned_waiter_id IS NULL)' : ''}
     ORDER BY t.table_number, ts.opened_at`,
    waiterId ? [restaurantId, waiterId] : [restaurantId],
  );

  if (sessions.rows.length === 0) return [];
  const sessionIds = sessions.rows.map((s) => s.session_id);

  const orderRows = await query<{
    table_session_id: string;
    public_token: string;
    contact_channel: WaiterOrder['contact_channel'];
    submitted_at: string;
    payment_status: WaiterOrder['payment_status'];
    order_item_id: string;
    menu_item_name: string;
    quantity: number;
    status: WaiterOrderItem['status'];
  }>(
    `SELECT o.table_session_id, o.public_token, o.contact_channel, o.submitted_at, o.payment_status,
            oi.id AS order_item_id, mi.name AS menu_item_name, oi.quantity, oi.status
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
        payment_status: row.payment_status,
        items: [],
      });
    }
    ordersForSession.get(row.public_token)!.items.push({
      order_item_id: row.order_item_id,
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

export interface CloseSessionResult {
  tableId: string;
  previousAssignedWaiterId: string | null;
}

/**
 * Closing releases the table's waiter assignment automatically (back to
 * NULL, ready for round robin next time) -- waiters never self-release, so
 * this is the only path a table becomes unassigned again short of an
 * admin's emergency handoff. A `waiter` caller may only close a table
 * that's unassigned or assigned to them; `admin` can close any.
 */
export async function closeTableSession(
  restaurantId: string,
  sessionId: string,
  requestingStaff: { id: string; role: string },
): Promise<CloseSessionResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      status: TableSession['status'];
      restaurant_id: string;
      table_id: string;
      assigned_waiter_id: string | null;
    }>(
      `SELECT ts.status, t.restaurant_id, t.id AS table_id, t.assigned_waiter_id
       FROM table_session ts
       JOIN "table" t ON t.id = ts.table_id
       WHERE ts.id = $1
       FOR UPDATE`,
      [sessionId],
    );
    const session = result.rows[0];
    if (!session || session.restaurant_id !== restaurantId) {
      throw new NotFoundError('Table session not found');
    }
    if (session.status === 'closed') {
      throw new ConflictError('Table session is already closed');
    }
    if (
      requestingStaff.role === 'waiter' &&
      session.assigned_waiter_id &&
      session.assigned_waiter_id !== requestingStaff.id
    ) {
      throw new ForbiddenError('This table is assigned to a different waiter');
    }

    // No payment integration yet -- "paid" is a manual waiter action, so
    // this is the one place that manual step gets enforced before a table
    // can be freed up for its next customer.
    const unpaid = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "order" WHERE table_session_id = $1 AND payment_status = 'unpaid'`,
      [sessionId],
    );
    if (unpaid.rows[0].count !== '0') {
      throw new ConflictError('This table has unpaid orders -- mark them paid before closing');
    }

    await client.query('UPDATE table_session SET status = $1, closed_at = now() WHERE id = $2', [
      'closed',
      sessionId,
    ]);
    await client.query('UPDATE "table" SET assigned_waiter_id = NULL, assigned_at = NULL WHERE id = $1', [
      session.table_id,
    ]);
    await client.query('COMMIT');
    return { tableId: session.table_id, previousAssignedWaiterId: session.assigned_waiter_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
