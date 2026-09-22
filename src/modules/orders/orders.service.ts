import { findRestaurantBySlug, findTableByQrToken, findOrCreateActiveSession } from '../tables/tables.repository';
import { findMenuItemsByIds } from '../menu/menu.repository';
import { insertOrder, type CreateOrderItemInput } from './orders.repository';
import { generateToken } from '../../lib/token';
import { trackingUrlFor } from '../../lib/urls';
import { ValidationError } from '../../lib/errors';
import { assertContactValueMatchesChannel, type CreateOrderInput } from './orders.validation';
import { getNotificationQueue } from '../notifications/notifications.queue';
import { broadcastEvent } from '../../realtime/broadcaster';
import { logger } from '../../lib/logger';

export interface PlaceOrderResult {
  public_token: string;
  tracking_url: string;
}

export async function placeOrder(
  restaurantSlug: string,
  qrToken: string,
  input: CreateOrderInput,
): Promise<PlaceOrderResult> {
  assertContactValueMatchesChannel(input);

  const restaurant = await findRestaurantBySlug(restaurantSlug);
  const table = await findTableByQrToken(restaurant.id, qrToken);
  const session = await findOrCreateActiveSession(table.id);

  const requestedIds = input.items.map((item) => item.menu_item_id);
  const menuItems = await findMenuItemsByIds(restaurant.id, requestedIds);
  const menuItemById = new Map(menuItems.map((item) => [item.id, item]));

  const orderItems: CreateOrderItemInput[] = input.items.map((requested) => {
    const menuItem = menuItemById.get(requested.menu_item_id);
    if (!menuItem) {
      throw new ValidationError(`Menu item ${requested.menu_item_id} does not belong to this restaurant`);
    }
    if (!menuItem.is_available) {
      throw new ValidationError(`"${menuItem.name}" is not currently available`);
    }
    return {
      menu_item_id: menuItem.id,
      quantity: requested.quantity,
      notes: requested.notes,
      destination: menuItem.destination,
    };
  });

  const publicToken = generateToken();

  const order = await insertOrder({
    publicToken,
    tableSessionId: session.id,
    restaurantId: restaurant.id,
    contactChannel: input.contact_channel,
    contactValue: input.contact_value,
    items: orderItems,
  });

  const trackingUrl = trackingUrlFor(order.public_token);

  // Enqueue must never block or fail order submission -- the order has
  // already been committed at this point regardless of what happens here.
  try {
    await getNotificationQueue().enqueue({
      orderId: order.id,
      channel: input.contact_channel,
      contactValue: input.contact_value,
      trigger: 'order_received',
      templateData: { restaurantName: restaurant.name, trackingUrl },
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'failed to enqueue order_received notification');
  }

  const destinationsInOrder = new Set(orderItems.map((item) => item.destination));
  for (const destination of destinationsInOrder) {
    await broadcastEvent(`restaurant:${restaurant.id}:${destination}`, {
      type: 'new_order',
      table_number: table.table_number,
      order_public_token: order.public_token,
    });
  }
  await broadcastEvent(`restaurant:${restaurant.id}:waiter`, {
    type: 'order_placed',
    table_number: table.table_number,
    order_public_token: order.public_token,
  });

  return {
    public_token: order.public_token,
    tracking_url: trackingUrl,
  };
}
