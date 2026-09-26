import { broadcastEvent } from '../../../realtime/broadcaster';
import { findStaffUserById } from '../../staff/staff.repository';
import {
  insertOrderFact,
  insertOrderItemFacts,
  updateOrderFactWaiter,
  updateOrderFactPaymentStatus,
} from './reportingEvents.repository';
import type { ReportingEvent } from './reportingEvents.types';

/**
 * Dispatches one reporting event to its fact-table write, then broadcasts
 * to the admin's live room -- deliberately fired from here, after the
 * fact row is actually committed, not from the request handler. If the
 * broadcast fired earlier (optimistically, before this write happens),
 * the admin dashboard's refetch could land before the data it's fetching
 * exists yet.
 */
export async function processReportingEvent(event: ReportingEvent): Promise<void> {
  switch (event.type) {
    case 'order_placed':
      await insertOrderFact(event);
      await insertOrderItemFacts(event);
      await broadcastEvent(`restaurant:${event.restaurantId}:admin`, { type: 'sales_changed' });
      return;
    case 'order_waiter_assigned': {
      // One cheap indexed lookup of a staff member's own (slowly-changing)
      // name -- not a report-time aggregation over transactional data, so
      // this doesn't reintroduce the class of problem self-contained
      // events exist to prevent.
      const waiter = await findStaffUserById(event.waiterId);
      await updateOrderFactWaiter(event.orderId, event.restaurantId, event.waiterId, waiter?.name ?? null);
      return;
    }
    case 'order_paid':
      await updateOrderFactPaymentStatus(event.orderId, event.restaurantId);
      await broadcastEvent(`restaurant:${event.restaurantId}:admin`, { type: 'sales_changed' });
      return;
  }
}
