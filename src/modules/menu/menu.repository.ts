import { query } from '../../db/pool';

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string;
  is_available: boolean;
}

export interface MenuItemForPricing extends MenuItem {
  restaurant_id: string;
  destination: 'kitchen' | 'bar';
}

export async function listMenuForRestaurant(
  restaurantId: string,
): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  const [categories, items] = await Promise.all([
    query<MenuCategory>(
      'SELECT id, name, sort_order FROM menu_category WHERE restaurant_id = $1 ORDER BY sort_order, name',
      [restaurantId],
    ),
    query<MenuItem>(
      `SELECT id, category_id, name, description, price, is_available
       FROM menu_item
       WHERE restaurant_id = $1
       ORDER BY name`,
      [restaurantId],
    ),
  ]);

  return { categories: categories.rows, items: items.rows };
}

/**
 * Fetches the authoritative, tenant-scoped menu items an order is being
 * placed against. Always called with the ids the customer submitted so
 * price/availability/destination come from the database, never the client.
 */
export async function findMenuItemsByIds(
  restaurantId: string,
  menuItemIds: string[],
): Promise<MenuItemForPricing[]> {
  if (menuItemIds.length === 0) return [];
  const result = await query<MenuItemForPricing>(
    `SELECT id, restaurant_id, category_id, name, description, price, destination, is_available
     FROM menu_item
     WHERE restaurant_id = $1 AND id = ANY($2::uuid[])`,
    [restaurantId, menuItemIds],
  );
  return result.rows;
}
