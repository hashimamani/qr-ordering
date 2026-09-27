import {
  listOrderItemsByDestination,
  listStationBoard,
  transitionOrderItemStatus,
  type AuditActor,
  type Destination,
  type OrderItemStatus,
  type QueuedOrderItem,
  type StationBoardItem,
  type TransitionOptions,
} from './orderItems.repository';
import { toNairobiDateString } from '../../lib/reportDate';
import { findOrderNotificationContext } from '../orders/orders.repository';
import { findStaffUserById } from '../staff/staff.repository';
import { finalizeOrderIfComplete } from '../orders/orders.service';
import { findOrderByPublicToken } from '../tracking/tracking.repository';
import { getNotificationQueue } from '../notifications/notifications.queue';
import { trackingUrlFor } from '../../lib/urls';
import { broadcastEvent } from '../../realtime/broadcaster';
import { broadcastToTableWaiter } from '../../realtime/waiterBroadcast';
import { logger } from '../../lib/logger';

export async function getQueueForDestination(
  restaurantId: string,
  destination: Destination,
): Promise<{ table_number: string; items: QueuedOrderItem[] }[]> {
  const rows = await listOrderItemsByDestination(restaurantId, destination);
  const byTable = new Map<string, QueuedOrderItem[]>();
  for (const row of rows) {
    if (!byTable.has(row.table_number)) byTable.set(row.table_number, []);
    byTable.get(row.table_number)!.push(row);
  }
  return [...byTable.entries()].map(([table_number, items]) => ({ table_number, items }));
}

/** Max served-today rows the station board will return in one page. */
const STATION_SERVED_LIMIT = 200;

export interface StationBoard {
  pending: StationBoardItem[];
  preparing: StationBoardItem[];
  ready: StationBoardItem[];
  served: StationBoardItem[];
}

/**
 * The admin station board: the same items the station's own queue shows,
 * bucketed by status instead of by table, plus today's completed work.
 * "Today" is resolved here (Africa/Nairobi) rather than in SQL so the
 * timezone decision lives in one place -- the same helper the reporting
 * pipeline uses.
 */
export async function getStationBoard(restaurantId: string, destination: Destination): Promise<StationBoard> {
  const rows = await listStationBoard(
    restaurantId,
    destination,
    toNairobiDateString(new Date()),
    STATION_SERVED_LIMIT,
  );
  return {
    pending: rows.filter((r) => r.status === 'received'),
    preparing: rows.filter((r) => r.status === 'preparing'),
    ready: rows.filter((r) => r.status === 'ready'),
    served: rows.filter((r) => r.status === 'served'),
  };
}

export async function updateOrderItemStatus(
  restaurantId: string,
  orderItemId: string,
  newStatus: OrderItemStatus,
  actor: { id: string; role: AuditActor['role'] },
  opts: TransitionOptions,
): Promise<void> {
  // The JWT carries sub/role but not the display name, and the audit row
  // snapshots the name so it survives the staff member being deleted --
  // so one PK lookup here, rather than duplicating it in both callers.
  const staff = await findStaffUserById(actor.id);
  const result = await transitionOrderItemStatus(restaurantId, orderItemId, newStatus, {
    id: actor.id,
    role: actor.role,
    name: staff?.name ?? 'Unknown',
  }, opts);

  await broadcastEvent(`restaurant:${restaurantId}:${result.destination}`, {
    type: 'item_status_changed',
    order_item_id: orderItemId,
    order_public_token: result.orderPublicToken,
    table_number: result.tableNumber,
    status: result.newStatus,
  });
  await broadcastToTableWaiter(restaurantId, result.tableId, {
    type: 'item_status_changed',
    order_item_id: orderItemId,
    order_public_token: result.orderPublicToken,
    table_number: result.tableNumber,
    status: result.newStatus,
  });

  const trackedOrder = await findOrderByPublicToken(result.orderPublicToken);
  await broadcastEvent(`order:${result.orderPublicToken}`, {
    type: 'status_changed',
    items: trackedOrder.items,
  });

  // Forward moves only. finalizeOrderIfComplete releases the order's
  // websocket room for good once it's paid and fully served, so firing it
  // while an admin is walking a status *backward* would tear down the
  // customer's live tracking for an order that is, by that very action,
  // no longer complete.
  if (!result.isBackward && newStatus === 'served') {
    await finalizeOrderIfComplete(result.orderPublicToken);
  }

  if (result.isFirstReadyForOrder) {
    const context = await findOrderNotificationContext(result.orderId);
    if (context) {
      try {
        await getNotificationQueue().enqueue({
          orderId: result.orderId,
          channel: context.contact_channel,
          contactValue: context.contact_value,
          trigger: 'order_ready',
          templateData: {
            restaurantName: context.restaurant_name,
            trackingUrl: trackingUrlFor(context.public_token),
          },
        });
      } catch (err) {
        logger.error({ err, orderId: result.orderId }, 'failed to enqueue order_ready notification');
      }
    }
  }
}
