import type { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { StaffRole } from '../../lib/domain';

/**
 * Cancelling order items.
 *
 * Separate from transitionOrderItemStatus because that helper decides
 * forward/backward by comparing positions in received -> preparing ->
 * ready -> served, and a cancellation is neither direction. Wedging it
 * into that ordering would make every comparison lie.
 *
 * Still writes order_item_status_audit, so a cancellation carries the
 * same who/when/why trail as any other status change.
 */

export interface CancelActor {
  kind: 'staff' | 'customer';
  /** Null for a customer, who has no staff record. */
  staffId: string | null;
  name: string;
  role: StaffRole | null;
}

export interface CancelledItem {
  id: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface CancelResult {
  orderId: string;
  publicToken: string;
  restaurantId: string;
  tableId: string;
  items: CancelledItem[];
  cancelledTotal: string;
  /** True when nothing is left to prepare or serve on the order. */
  orderFullyCancelled: boolean;
}

/** A served item has already reached the customer; there is nothing to call off. */
const CANCELLABLE = ['received', 'preparing', 'ready'];

interface Options {
  /** Restrict to one item; otherwise every cancellable item on the order. */
  orderItemId?: string;
  /**
   * The customer may only call off an order nothing has started on. Staff
   * are trusted to decide about food already in progress; a diner is not,
   * because the restaurant eats that cost.
   */
  requireNothingStarted?: boolean;
  reason?: string | null;
}

export async function cancelOrderItems(
  restaurantId: string,
  publicToken: string,
  actor: CancelActor,
  opts: Options = {},
): Promise<CancelResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE on the order items: without it, a cancellation racing a
    // station marking something 'preparing' could cancel food that just
    // started cooking.
    const order = await client.query<{
      id: string;
      restaurant_id: string;
      payment_status: string;
      table_id: string;
    }>(
      `SELECT o.id, o.restaurant_id, o.payment_status, t.id AS table_id
         FROM "order" o
         JOIN table_session ts ON ts.id = o.table_session_id
         JOIN "table" t ON t.id = ts.table_id
        WHERE o.public_token = $1`,
      [publicToken],
    );
    const found = order.rows[0];
    if (!found || found.restaurant_id !== restaurantId) throw new NotFoundError('Order not found');

    // Cancelling something already paid for is a refund, and Tab records
    // payment without being able to move money. Refusing is the honest
    // answer rather than leaving an accounting hole.
    if (found.payment_status === 'paid') {
      throw new ConflictError('This order has already been paid for and cannot be cancelled.');
    }

    const all = await client.query<{ id: string; status: string; quantity: number; unit_price: string }>(
      `SELECT id, status, quantity, unit_price FROM order_item WHERE order_id = $1 FOR UPDATE`,
      [found.id],
    );
    if (all.rows.length === 0) throw new NotFoundError('Order has no items');

    if (opts.orderItemId && !all.rows.some((r) => r.id === opts.orderItemId)) {
      throw new NotFoundError('Order item not found');
    }

    // Everything that is not already cancelled. The checks below have to
    // reason about these rather than every row, or a second cancel
    // attempt reads an already-cancelled item as "not received" and tells
    // the customer their food is being prepared -- false, and alarming.
    const live = all.rows.filter((r) => r.status !== 'cancelled');
    if (live.length === 0) {
      throw new ConflictError('This order has already been cancelled.');
    }

    if (opts.requireNothingStarted && live.some((r) => r.status !== 'received')) {
      throw new ConflictError(
        'Your order is already being prepared. Please ask a member of staff to cancel it.',
      );
    }

    const targets = live.filter(
      (r) => CANCELLABLE.includes(r.status) && (!opts.orderItemId || r.id === opts.orderItemId),
    );
    if (targets.length === 0) {
      throw new ConflictError('There is nothing left to cancel on this order.');
    }

    for (const item of targets) {
      await client.query(`UPDATE order_item SET status = 'cancelled' WHERE id = $1`, [item.id]);
      await client.query(
        `INSERT INTO order_item_status_audit
           (restaurant_id, order_item_id, order_id, actor_staff_id, actor_name, actor_role, actor_kind,
            from_status, to_status, is_override, is_backward, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cancelled', $9, false, $10)`,
        [
          restaurantId,
          item.id,
          found.id,
          actor.staffId,
          actor.name,
          actor.role,
          actor.kind,
          item.status,
          // is_override. Cancelling an item a station had already picked
          // up means wasting work that was underway, which is exactly the
          // thing an owner reviews later -- so it is flagged the same way
          // a manual status override is. is_backward stays false below:
          // cancellation is outside the received->served line, not a step
          // back along it.
          item.status !== 'received',
          opts.reason ?? null,
        ],
      );
    }

    const cancelled: CancelledItem[] = targets.map((t) => ({
      id: t.id,
      quantity: t.quantity,
      unit_price: t.unit_price,
      line_total: (Number(t.unit_price) * t.quantity).toFixed(2),
    }));
    const cancelledTotal = cancelled
      .reduce((sum, i) => sum + Number(i.line_total), 0)
      .toFixed(2);

    const remaining = all.rows.filter(
      (r) => !targets.some((t) => t.id === r.id) && r.status !== 'cancelled',
    );

    await client.query('COMMIT');

    return {
      orderId: found.id,
      publicToken,
      restaurantId,
      tableId: found.table_id,
      items: cancelled,
      cancelledTotal,
      orderFullyCancelled: remaining.length === 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
