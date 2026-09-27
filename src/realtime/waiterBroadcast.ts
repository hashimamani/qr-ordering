import { broadcastEvent } from './broadcaster';
import { findAssignedWaiterForTable } from '../modules/tables/tables.repository';
import { listWaiterIdsForRestaurant } from '../modules/staff/staff.repository';

/**
 * Sends a waiter-facing realtime event to the table's assigned waiter's
 * personal room only -- not the whole restaurant. Falls back to every
 * waiter in the restaurant only in the edge case where the table still
 * has no assignee (a restaurant with zero waiters; round robin normally
 * resolves a real one before this is ever called).
 */
export async function broadcastToTableWaiter(
  restaurantId: string,
  tableId: string,
  event: Record<string, unknown>,
): Promise<void> {
  // The admin console's Floor section watches every table, not just one
  // waiter's, and waiter rooms are per-staff-member so it can't simply
  // join them all. Mirroring each waiter-facing event into the shared
  // admin room here covers all four call sites at once.
  //
  // The admin room is shared with the reporting worker's 'sales_changed'
  // broadcasts, so admin-side listeners must switch on event.type rather
  // than refetching on anything that arrives.
  await broadcastEvent(`restaurant:${restaurantId}:admin`, event);

  const assignedWaiterId = await findAssignedWaiterForTable(tableId);
  if (assignedWaiterId) {
    await broadcastEvent(`restaurant:${restaurantId}:waiter:${assignedWaiterId}`, event);
    return;
  }
  const waiterIds = await listWaiterIdsForRestaurant(restaurantId);
  await Promise.all(waiterIds.map((id) => broadcastEvent(`restaurant:${restaurantId}:waiter:${id}`, event)));
}
