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

// Deliberately excludes destination -- this is the customer-facing menu
// (resolveTableForOrdering in tables.service.ts), and destination is
// internal kitchen/bar routing info, not something a customer's order
// page needs to know or show.
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

export interface MenuItemWithDestination extends MenuItem {
  destination: 'kitchen' | 'bar';
}

// Admin's own menu view -- same data as listMenuForRestaurant, plus
// destination, since an admin editing the menu needs to see/change which
// queue an item routes to.
export async function listMenuForRestaurantAdmin(
  restaurantId: string,
): Promise<{ categories: MenuCategory[]; items: MenuItemWithDestination[] }> {
  const [categories, items] = await Promise.all([
    query<MenuCategory>(
      'SELECT id, name, sort_order FROM menu_category WHERE restaurant_id = $1 ORDER BY sort_order, name',
      [restaurantId],
    ),
    query<MenuItemWithDestination>(
      `SELECT id, category_id, name, description, price, is_available, destination
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
