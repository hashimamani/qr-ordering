import {
  findRestaurantBySlug,
  findTableByQrToken,
  findOrCreateActiveSession,
  listActiveTableSessionsForRestaurant,
  closeTableSession,
  type WaiterTableSession,
} from './tables.repository';
import { listMenuForRestaurant } from '../menu/menu.repository';
import { broadcastEvent } from '../../realtime/broadcaster';

export interface ResolveTableResult {
  restaurant: { name: string; slug: string };
  table_session_status: 'active' | 'awaiting_payment' | 'closed';
  menu: {
    categories: { id: string; name: string; sort_order: number }[];
    items: {
      id: string;
      category_id: string;
      name: string;
      description: string | null;
      price: string;
      is_available: boolean;
    }[];
  };
}

export async function resolveTableForOrdering(
  restaurantSlug: string,
  qrToken: string,
): Promise<ResolveTableResult> {
  const restaurant = await findRestaurantBySlug(restaurantSlug);
  const table = await findTableByQrToken(restaurant.id, qrToken);
  const session = await findOrCreateActiveSession(table.id);
  const menu = await listMenuForRestaurant(restaurant.id);

  return {
    restaurant: { name: restaurant.name, slug: restaurant.slug },
    table_session_status: session.status,
    menu,
  };
}

export async function getWaiterView(restaurantId: string): Promise<WaiterTableSession[]> {
  return listActiveTableSessionsForRestaurant(restaurantId);
}

export async function closeSession(restaurantId: string, sessionId: string): Promise<void> {
  await closeTableSession(restaurantId, sessionId);
  await broadcastEvent(`restaurant:${restaurantId}:waiter`, {
    type: 'session_closed',
    table_session_id: sessionId,
  });
}
