import {
  findRestaurantBySlug,
  findRestaurantById,
  findTableByQrToken,
  findTableById,
  findOrCreateActiveSession,
  assignNextWaiterRoundRobin,
  assignWaiterDirectly,
  type Restaurant,
  type RestaurantTable,
} from '../tables/tables.repository';
import { findMenuItemsByIds } from '../menu/menu.repository';
import { insertOrder, type CreateOrderItemInput } from './orders.repository';
import { generateToken } from '../../lib/token';
import { trackingUrlFor } from '../../lib/urls';
import { ForbiddenError, ValidationError } from '../../lib/errors';
import { assertContactValueMatchesChannel, normalizeContactValue, type CreateOrderInput } from './orders.validation';
import { getNotificationQueue } from '../notifications/notifications.queue';
import { broadcastEvent } from '../../realtime/broadcaster';
import { broadcastToTableWaiter } from '../../realtime/waiterBroadcast';
import { sendPushToStaff } from '../../realtime/webPush';
import { logger } from '../../lib/logger';

export interface PlaceOrderResult {
  public_token: string;
  tracking_url: string;
}

/**
 * Shared by both entry points below -- validates items against the menu,
 * inserts the order, enqueues the order_received notification, and
 * broadcasts to the kitchen/bar destinations. Does NOT touch waiter
 * assignment or the waiter-facing broadcast/push -- those differ between
 * a customer's own order (round robin) and a staff-assisted one (direct
 * assign to the ordering waiter), so each caller handles that itself.
 */
async function createOrderForTable(
  restaurant: Restaurant,
  table: RestaurantTable,
  rawInput: CreateOrderInput,
): Promise<{ order: { id: string; public_token: string }; trackingUrl: string; destinations: Set<'kitchen' | 'bar'> }> {
  const input = normalizeContactValue(rawInput);
  assertContactValueMatchesChannel(input);

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

  return { order, trackingUrl, destinations: destinationsInOrder };
}

export async function placeOrder(
  restaurantSlug: string,
  qrToken: string,
  input: CreateOrderInput,
): Promise<PlaceOrderResult> {
  const restaurant = await findRestaurantBySlug(restaurantSlug);
  const table = await findTableByQrToken(restaurant.id, qrToken);

  const { order, trackingUrl } = await createOrderForTable(restaurant, table, input);

  // The first order at a still-unassigned table claims a waiter via round
  // robin -- a no-op if it's already assigned (returning shift, or a
  // second order at the same table).
  const assignedWaiterId = await assignNextWaiterRoundRobin(restaurant.id, table.id);
  await broadcastToTableWaiter(restaurant.id, table.id, {
    type: 'order_placed',
    table_number: table.table_number,
    order_public_token: order.public_token,
  });
  if (assignedWaiterId) {
    await sendPushToStaff(assignedWaiterId, {
      title: `Table ${table.table_number}`,
      body: 'New order placed',
    });
  }

  return {
    public_token: order.public_token,
    tracking_url: trackingUrl,
  };
}

/**
 * Staff-assisted ordering -- for a customer at the table who can't scan
 * the QR code themselves (no smartphone, etc). The waiter enters the
 * order on their own dashboard instead. contact_value/contact_channel
 * are still required exactly like a customer order -- the customer's own
 * phone/email if they have one, otherwise any working contact the waiter
 * provides (their own, or the restaurant's) -- so the notification
 * pipeline and /track/:token both work completely unchanged.
 */
export async function placeStaffOrder(
  restaurantId: string,
  tableId: string,
  input: CreateOrderInput,
  requestingStaff: { id: string; role: string },
): Promise<PlaceOrderResult> {
  const restaurant = await findRestaurantById(restaurantId);
  const table = await findTableById(restaurantId, tableId);

  if (
    requestingStaff.role === 'waiter' &&
    table.assigned_waiter_id &&
    table.assigned_waiter_id !== requestingStaff.id
  ) {
    throw new ForbiddenError('This table is assigned to a different waiter');
  }

  const { order, trackingUrl } = await createOrderForTable(restaurant, table, input);

  // Unlike the customer path, a staff-placed order on an unassigned table
  // doesn't go through round robin when a waiter is the one placing it --
  // they're already standing at the table, so they get it directly rather
  // than the lottery potentially handing it to someone else. Admin has no
  // table of their own to claim it onto, so admin-placed orders still go
  // through round robin same as a customer order would.
  let assignedWaiterId = table.assigned_waiter_id;
  if (!assignedWaiterId) {
    if (requestingStaff.role === 'waiter') {
      await assignWaiterDirectly(table.id, requestingStaff.id);
      assignedWaiterId = requestingStaff.id;
    } else {
      assignedWaiterId = await assignNextWaiterRoundRobin(restaurant.id, table.id);
    }
  }
  await broadcastToTableWaiter(restaurant.id, table.id, {
    type: 'order_placed',
    table_number: table.table_number,
    order_public_token: order.public_token,
  });
  if (assignedWaiterId && assignedWaiterId !== requestingStaff.id) {
    await sendPushToStaff(assignedWaiterId, {
      title: `Table ${table.table_number}`,
      body: 'New order placed',
    });
  }

  return {
    public_token: order.public_token,
    tracking_url: trackingUrl,
  };
}
