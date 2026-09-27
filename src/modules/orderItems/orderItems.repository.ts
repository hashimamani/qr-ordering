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

export interface StationBoardItem {
  order_item_id: string;
  order_id: string;
  order_public_token: string;
  table_id: string;
  table_number: string;
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: OrderItemStatus;
  submitted_at: string;
  /**
   * The table's *current* assignee. Correct and most useful for the three
   * live columns -- their sessions are open by definition, and "who do I
   * hand this to now" is the question the board is answering.
   */
  waiter_name: string | null;
  /**
   * Who actually moved the item to 'served', from the audit trail. The
   * live join above can't answer this once the session closes
   * (closeTableSession NULLs "table".assigned_waiter_id), so the served
   * column falls back to this. NULL for items served before the audit
   * table existed.
   */
  served_by_name: string | null;
}

/**
 * One query behind the admin station board: every unserved item for the
 * destination, plus the ones served so far today. The date bound is what
 * keeps the served column from growing without limit, and is passed in
 * (already resolved to a Nairobi calendar date) rather than computed here
 * so the caller owns the timezone decision -- same split the reports
 * module uses.
 */
export async function listStationBoard(
  restaurantId: string,
  destination: Destination,
  servedFromDate: string,
  servedLimit: number,
): Promise<StationBoardItem[]> {
  const result = await query<StationBoardItem>(
    `SELECT oi.id AS order_item_id, o.id::text AS order_id, o.public_token AS order_public_token,
            t.id AS table_id, t.table_number,
            mi.name AS menu_item_name, oi.quantity, oi.notes, oi.status, o.submitted_at,
            su.name AS waiter_name,
            served.actor_name AS served_by_name
     FROM order_item oi
     JOIN "order" o ON o.id = oi.order_id
     JOIN table_session ts ON ts.id = o.table_session_id
     JOIN "table" t ON t.id = ts.table_id
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     LEFT JOIN staff_user su ON su.id = t.assigned_waiter_id
     LEFT JOIN LATERAL (
       SELECT a.actor_name
       FROM order_item_status_audit a
       WHERE a.order_item_id = oi.id AND a.to_status = 'served'
       ORDER BY a.created_at DESC
       LIMIT 1
     ) served ON oi.status = 'served'
     WHERE o.restaurant_id = $1
       AND oi.destination = $2
       AND (
         oi.status != 'served'
         OR o.submitted_at AT TIME ZONE 'Africa/Nairobi' >= $3::date
       )
     ORDER BY o.submitted_at, mi.name
     LIMIT $4`,
    [restaurantId, destination, servedFromDate, servedLimit],
  );
  return result.rows;
}

export interface AuditActor {
  id: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
  name: string;
}

export interface TransitionOptions {
  /** Admin-only: permits walking a status back to correct a mis-tap. */
  allowBackward: boolean;
  /** True when an admin acts from their own console, outside the station's own queue. */
  isOverride: boolean;
  reason?: string;
}

export interface ActivityEntry {
  id: string;
  actor_name: string;
  actor_role: string;
  from_status: OrderItemStatus;
  to_status: OrderItemStatus;
  is_override: boolean;
  is_backward: boolean;
  reason: string | null;
  created_at: string;
  menu_item_name: string;
  table_number: string;
  order_public_token: string;
}

export async function listRecentActivity(restaurantId: string, limit: number): Promise<ActivityEntry[]> {
  const result = await query<ActivityEntry>(
    `SELECT a.id, a.actor_name, a.actor_role, a.from_status, a.to_status,
            a.is_override, a.is_backward, a.reason, a.created_at,
            mi.name AS menu_item_name, t.table_number, o.public_token AS order_public_token
     FROM order_item_status_audit a
     JOIN order_item oi ON oi.id = a.order_item_id
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     JOIN "order" o ON o.id = a.order_id
     JOIN table_session ts ON ts.id = o.table_session_id
     JOIN "table" t ON t.id = ts.table_id
     WHERE a.restaurant_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [restaurantId, limit],
  );
  return result.rows;
}

export interface TransitionResult {
  orderId: string;
  orderPublicToken: string;
  tableId: string;
  tableNumber: string;
  destination: Destination;
  fromStatus: OrderItemStatus;
  isBackward: boolean;
  newStatus: OrderItemStatus;
  isFirstReadyForOrder: boolean;
}

/**
 * Transitions one order_item's status, scoped to restaurantId so a staff
 * member can never touch another tenant's order — the ownership check,
 * the update and the audit row all happen inside the same row-locked
 * transaction.
 *
 * Staff may only move an item forward (opts.allowBackward false); an
 * admin overriding from their console may also walk it back to undo a
 * station's mis-tap. Either way the move is recorded — see the
 * add-order-item-status-audit migration for why every transition is
 * logged rather than just the overrides.
 */
export async function transitionOrderItemStatus(
  restaurantId: string,
  orderItemId: string,
  newStatus: OrderItemStatus,
  actor: AuditActor,
  opts: TransitionOptions,
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
    const isBackward = newIndex < currentIndex;
    if (newIndex === currentIndex) {
      throw new ConflictError(`Item is already "${item.status}"`);
    }
    if (isBackward && !opts.allowBackward) {
      throw new ConflictError(`Cannot move status from "${item.status}" to "${newStatus}"`);
    }

    const readyOrLater = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM order_item WHERE order_id = $1 AND id != $2 AND status IN ('ready', 'served')`,
      [item.order_id, orderItemId],
    );
    // Only ever true on a forward move -- walking an item *back* into
    // 'ready' must not re-trigger the customer's "your order is ready"
    // notification, which the service layer keys off this flag.
    const isFirstReadyForOrder =
      !isBackward && newStatus === 'ready' && readyOrLater.rows[0].count === '0';

    await client.query('UPDATE order_item SET status = $1 WHERE id = $2', [newStatus, orderItemId]);

    await client.query(
      `INSERT INTO order_item_status_audit
         (restaurant_id, order_item_id, order_id, actor_staff_id, actor_name, actor_role,
          from_status, to_status, is_override, is_backward, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        restaurantId,
        orderItemId,
        item.order_id,
        actor.id,
        actor.name,
        actor.role,
        item.status,
        newStatus,
        opts.isOverride,
        isBackward,
        opts.reason ?? null,
      ],
    );

    await client.query('COMMIT');

    return {
      orderId: item.order_id,
      orderPublicToken: item.public_token,
      tableId: item.table_id,
      tableNumber: item.table_number,
      destination: item.destination,
      fromStatus: item.status,
      isBackward,
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
