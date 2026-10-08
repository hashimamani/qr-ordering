import { cancelOrderItems, type CancelActor, type CancelResult } from './cancellation.repository';
import { getReportingQueue } from '../reports/events/reportingEvents.queue';
import { broadcastEvent } from '../../realtime/broadcaster';
import { broadcastToTableWaiter } from '../../realtime/waiterBroadcast';
import { findStaffUserById } from '../staff/staff.repository';
import type { StaffRole } from '../../lib/domain';
import { logger } from '../../lib/logger';

/**
 * Cancelling, and everything that has to happen afterwards.
 *
 * The write itself is one transaction in the repository. This layer deals
 * with the consequences -- correcting the reports, waking the stations so
 * a chef stops cooking something nobody is paying for, and telling the
 * customer's tracking page.
 *
 * The reporting enqueue is non-blocking on purpose, matching how order
 * placement treats it: a reporting hiccup must never undo a cancellation
 * the customer has already been told succeeded. It is logged loudly
 * because a lost event leaves the sales figures overstated.
 */

async function announce(result: CancelResult): Promise<void> {
  try {
    await getReportingQueue().enqueue({
      type: 'order_items_cancelled',
      orderId: result.orderId,
      restaurantId: result.restaurantId,
      cancelledTotal: result.cancelledTotal,
      // Quantities, not line count. report_order_fact.item_count is the
      // sum of quantities, so subtracting lines would leave the figure
      // permanently overstated -- an order of 2+1 cancelled in full
      // dropped from 3 to 1 rather than 0.
      cancelledItemCount: result.items.reduce((n, i) => n + i.quantity, 0),
      orderItemIds: result.items.map((i) => i.id),
    });
  } catch (err) {
    logger.error(
      { err, orderId: result.orderId, cancelledTotal: result.cancelledTotal },
      'cancellation succeeded but its reporting event was not enqueued; sales figures are overstated',
    );
  }

  // Every station, not just the one the items belonged to: a cancelled
  // order usually spans kitchen and bar, and a chef still cooking a
  // cancelled dish is the specific waste this exists to prevent.
  await Promise.all(
    ['kitchen', 'bar', 'services'].map((destination) =>
      broadcastEvent(`restaurant:${result.restaurantId}:${destination}`, { type: 'queue_changed' }).catch(
        (err) => logger.error({ err, destination }, 'failed to broadcast cancellation to a station'),
      ),
    ),
  );

  await broadcastEvent(`order:${result.publicToken}`, { type: 'order_changed' }).catch((err) =>
    logger.error({ err }, 'failed to broadcast cancellation to the tracking page'),
  );

  await broadcastToTableWaiter(result.restaurantId, result.tableId, { type: 'tables_changed' }).catch(
    (err) => logger.error({ err }, 'failed to notify the waiter of a cancellation'),
  );
}

/**
 * The customer calling off their own order from the tracking page.
 *
 * Gated on nothing having started: once a station has picked the order
 * up, the restaurant is already out of pocket and that is a decision for
 * staff, not a diner tapping a button.
 */
export async function cancelOrderAsCustomer(
  restaurantId: string,
  publicToken: string,
  orderItemId?: string,
): Promise<CancelResult> {
  const actor: CancelActor = { kind: 'customer', staffId: null, name: 'Customer', role: null };
  const result = await cancelOrderItems(restaurantId, publicToken, actor, {
    orderItemId,
    requireNothingStarted: true,
  });
  logger.info(
    { orderId: result.orderId, items: result.items.length, total: result.cancelledTotal },
    'order cancelled by customer',
  );
  await announce(result);
  return result;
}

/**
 * Staff cancelling, with no started-work restriction: they can see the
 * food and are the ones entitled to decide it is wasted. The reason is
 * optional but recorded, because a cancellation after preparation began
 * is exactly the thing an owner later asks about.
 */
export async function cancelOrderAsStaff(
  restaurantId: string,
  publicToken: string,
  staff: { id: string; role: StaffRole },
  opts: { orderItemId?: string; reason?: string | null } = {},
): Promise<CancelResult> {
  // The JWT carries sub and role but not the display name, and the audit
  // row snapshots the name so it survives the account being deleted.
  const record = await findStaffUserById(staff.id);
  const actor: CancelActor = {
    kind: 'staff',
    staffId: staff.id,
    name: record?.name ?? 'Unknown staff',
    role: staff.role,
  };
  const result = await cancelOrderItems(restaurantId, publicToken, actor, opts);
  logger.info(
    {
      orderId: result.orderId,
      items: result.items.length,
      total: result.cancelledTotal,
      actorId: staff.id,
      reason: opts.reason ?? null,
    },
    'order cancelled by staff',
  );
  await announce(result);
  return result;
}
