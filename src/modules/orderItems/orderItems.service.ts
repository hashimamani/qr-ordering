import {
  listOrderItemsByDestination,
  transitionOrderItemStatus,
  type Destination,
  type OrderItemStatus,
  type QueuedOrderItem,
} from './orderItems.repository';
import { findOrderNotificationContext } from '../orders/orders.repository';
import { findOrderByPublicToken } from '../tracking/tracking.repository';
import { getNotificationQueue } from '../notifications/notifications.queue';
import { trackingUrlFor } from '../../lib/urls';
import { broadcast } from '../../realtime/socketServer';
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

export async function updateOrderItemStatus(
  restaurantId: string,
  orderItemId: string,
  newStatus: OrderItemStatus,
): Promise<void> {
  const result = await transitionOrderItemStatus(restaurantId, orderItemId, newStatus);

  broadcast(`restaurant:${restaurantId}:${result.destination}`, {
    type: 'item_status_changed',
    order_item_id: orderItemId,
    order_public_token: result.orderPublicToken,
    table_number: result.tableNumber,
    status: result.newStatus,
  });
  broadcast(`restaurant:${restaurantId}:waiter`, {
    type: 'item_status_changed',
    order_item_id: orderItemId,
    order_public_token: result.orderPublicToken,
    table_number: result.tableNumber,
    status: result.newStatus,
  });

  const trackedOrder = await findOrderByPublicToken(result.orderPublicToken);
  broadcast(`order:${result.orderPublicToken}`, {
    type: 'status_changed',
    items: trackedOrder.items,
  });

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
