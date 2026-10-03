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
import {
  insertOrder,
  markOrderAsPaid,
  isOrderFullyComplete,
  findOrderNotificationContext,
  findOrderIdByPublicToken,
  type CreateOrderItemInput,
} from './orders.repository';
import { generateToken } from '../../lib/token';
import { trackingUrlFor } from '../../lib/urls';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertContactValueMatchesChannel, normalizeContactValue, type CreateOrderInput } from './orders.validation';
import { getNotificationQueue } from '../notifications/notifications.queue';
import { availableChannels } from '../notifications/notifications.providers';
import { getReportingQueue } from '../reports/events/reportingEvents.queue';
import {
  issueReceiptForOrder,
  reissueReceiptForOrder,
  mintReceiptMediaUrl,
  type IssuedReceipt,
} from '../receipts/receipts.service';
import { broadcastEvent, closeRoom } from '../../realtime/broadcaster';
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

  // Browsers cache the order form, so a stale bundle can still submit a
  // channel this deployment can't deliver on. Rejecting here is
  // deliberate: the alternative is accepting an order the customer can
  // never be messaged about, which is exactly the silent failure this
  // check exists to end. They're standing at the table and can re-pick in
  // seconds.
  if (!availableChannels().includes(input.contact_channel)) {
    throw new ValidationError(
      `We can't send to ${input.contact_channel} right now -- please choose another way to receive your order updates`,
    );
  }

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
      unit_price: menuItem.price,
    };
  });

  const publicToken = generateToken();

  const { order, items: createdItems } = await insertOrder({
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

  // Same non-blocking contract as the notification enqueue above -- this
  // is the only place the reporting fact tables ever hear about a new
  // order, and it must never affect order submission. The event is
  // self-contained (menu item name/category/price snapshotted right now,
  // from data already in hand) so a delayed/retried worker can never pick
  // up a since-changed price -- see modules/reports/events/.
  try {
    await getReportingQueue().enqueue({
      type: 'order_placed',
      orderId: order.id,
      restaurantId: restaurant.id,
      submittedAt: order.submitted_at,
      tableId: table.id,
      tableNumber: table.table_number,
      items: orderItems.map((item, i) => {
        const menuItem = menuItemById.get(item.menu_item_id)!;
        return {
          orderItemId: createdItems[i].id,
          menuItemId: menuItem.id,
          menuItemName: menuItem.name,
          categoryId: menuItem.category_id,
          categoryName: menuItem.category_name,
          destination: item.destination,
          quantity: item.quantity,
          unitPrice: menuItem.price,
        };
      }),
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'failed to enqueue order_placed reporting event');
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
    await enqueueOrderWaiterAssigned(order.id, restaurant.id, assignedWaiterId);
  }

  return {
    public_token: order.public_token,
    tracking_url: trackingUrl,
  };
}

/**
 * Best-effort, non-blocking -- same contract as every other reporting
 * enqueue in this file. Waiter assignment can only be known after the
 * order already exists (see the round-robin/direct-assign comments below),
 * so this always fires after order placement's own response is already
 * being prepared, never in a position to affect it.
 */
async function enqueueOrderWaiterAssigned(orderId: string, restaurantId: string, waiterId: string): Promise<void> {
  try {
    await getReportingQueue().enqueue({ type: 'order_waiter_assigned', orderId, restaurantId, waiterId });
  } catch (err) {
    logger.error({ err, orderId }, 'failed to enqueue order_waiter_assigned reporting event');
  }
}

export async function markOrderPaid(restaurantId: string, publicToken: string): Promise<void> {
  const { id: orderId } = await markOrderAsPaid(restaurantId, publicToken);
  try {
    await getReportingQueue().enqueue({ type: 'order_paid', orderId, restaurantId });
  } catch (err) {
    logger.error({ err, orderId }, 'failed to enqueue order_paid reporting event');
  }
  await issueAndSendReceipt(orderId);
  await finalizeOrderIfComplete(publicToken);
}

/**
 * Mints the receipt link and sends it to the contact on the order --
 * never to whoever triggered the payment, per the rule recorded on
 * order.contact_value in the initial schema.
 *
 * Entirely best-effort: a waiter marking a table paid is the critical
 * path, and a paid-but-un-receipted order is recoverable in a way that a
 * payment which 500s is not. Nothing in here may throw outward.
 */
/**
 * Staff-initiated resend. Necessary because there is no automatic channel
 * fallback: a failed WhatsApp send, or an expired link, otherwise leaves
 * the customer with no receipt and no recourse.
 *
 * Sends to the contact already stored on the order -- never to an address
 * supplied by whoever clicked -- preserving the rule recorded on
 * order.contact_value: the receipt goes back to the contact who placed the
 * order, not to whoever asks for it.
 */
export async function resendReceipt(restaurantId: string, publicToken: string): Promise<void> {
  const { id: orderId } = await findOrderIdByPublicToken(restaurantId, publicToken);
  const issued = await reissueReceiptForOrder(orderId);
  if (!issued) throw new NotFoundError('This order has no receipt to resend');
  await sendReceiptMessage(orderId, issued);
}

async function issueAndSendReceipt(orderId: string): Promise<void> {
  try {
    const issued = await issueReceiptForOrder(orderId);
    // undefined means a link already existed; only the original token
    // works, so sending again would deliver a dead link.
    if (!issued) return;
    await sendReceiptMessage(orderId, issued);
  } catch (err) {
    logger.error({ err, orderId }, 'failed to issue or send receipt');
  }
}

/**
 * Shared by the on-payment send and the staff resend, so both deliver an
 * identical message through an identical path -- a resend that differed
 * from the original would be its own class of bug.
 */
async function sendReceiptMessage(orderId: string, issued: IssuedReceipt): Promise<void> {
  const context = await findOrderNotificationContext(orderId);
  if (!context) {
    logger.error({ orderId }, 'receipt issued but order has no contact context; not sending');
    return;
  }

  // WhatsApp attaches the PDF via a DOCUMENT header, which needs a URL the
  // provider can fetch -- the customer-facing one is behind the last-4
  // challenge. Only minted for WhatsApp; SMS and email carry the link
  // alone, as before.
  const receiptMediaUrl =
    context.contact_channel === 'whatsapp' ? await mintReceiptMediaUrl(issued.token) : undefined;

  await getNotificationQueue().enqueue({
    orderId,
    channel: context.contact_channel,
    contactValue: context.contact_value,
    trigger: 'receipt',
    templateData: {
      restaurantName: context.restaurant_name,
      trackingUrl: trackingUrlFor(context.public_token),
      receiptUrl: issued.url,
      receiptMediaUrl,
    },
  });
}

/**
 * Releases the order's `order:{token}` websocket room once it needs no
 * more realtime updates -- paid, and every item served. Called after
 * both transitions that could complete an order: the last item being
 * marked served (orderItems.service.ts), and payment being marked paid
 * (above). A tracking page left open past this point would otherwise
 * hold its connection (and the connections-table row backing it) for as
 * long as the tab stays open, for an order that will never change again.
 */
export async function finalizeOrderIfComplete(publicToken: string): Promise<void> {
  if (!(await isOrderFullyComplete(publicToken))) return;
  await broadcastEvent(`order:${publicToken}`, { type: 'order_complete' });
  await closeRoom(`order:${publicToken}`);
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
  if (assignedWaiterId) {
    await enqueueOrderWaiterAssigned(order.id, restaurant.id, assignedWaiterId);
  }

  return {
    public_token: order.public_token,
    tracking_url: trackingUrl,
  };
}
