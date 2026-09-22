import { findRestaurantBySlug, findTableByQrToken, findOrCreateActiveSession } from '../tables/tables.repository';
import { findMenuItemsByIds } from '../menu/menu.repository';
import { insertOrder, type CreateOrderItemInput } from './orders.repository';
import { generateToken } from '../../lib/token';
import { ValidationError } from '../../lib/errors';
import { assertContactValueMatchesChannel, type CreateOrderInput } from './orders.validation';

export interface PlaceOrderResult {
  public_token: string;
  tracking_url: string;
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

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

  // Notification dispatch (SQS -> SMS/email) is wired in a later phase; the
  // order must succeed regardless of notification delivery, so it is
  // intentionally not on this synchronous path yet.

  return {
    public_token: order.public_token,
    tracking_url: `${PUBLIC_BASE_URL}/track/${order.public_token}`,
  };
}
