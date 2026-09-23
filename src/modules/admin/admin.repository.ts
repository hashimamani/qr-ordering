import { PoolClient } from 'pg';
import { pool, query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

export async function insertRestaurantWithAdmin(input: {
  restaurantName: string;
  restaurantSlug: string;
  adminName: string;
  adminPhoneOrEmail: string;
  adminPasswordHash: string;
}): Promise<{ restaurantId: string; adminStaffUserId: string }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const restaurant = await client.query<{ id: string }>(
      'INSERT INTO restaurant (name, slug) VALUES ($1, $2) RETURNING id',
      [input.restaurantName, input.restaurantSlug],
    );
    const restaurantId = restaurant.rows[0].id;

    const admin = await client.query<{ id: string }>(
      `INSERT INTO staff_user (restaurant_id, name, role, phone_or_email, password_hash)
       VALUES ($1, $2, 'admin', $3, $4)
       RETURNING id`,
      [restaurantId, input.adminName, input.adminPhoneOrEmail, input.adminPasswordHash],
    );

    await client.query('COMMIT');
    return { restaurantId, adminStaffUserId: admin.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

// The one deliberately cross-tenant query in this codebase -- no
// restaurant_id filter, by design. Only reachable via
// requirePlatformAdminAuth (src/middleware/platformAdminAuth.ts), never
// via requireStaffAuth, so it doesn't weaken the tenant-isolation
// guarantee every staff/admin route otherwise depends on.
export async function listAllRestaurants(): Promise<RestaurantSummary[]> {
  const result = await query<RestaurantSummary>(
    'SELECT id, name, slug, created_at FROM restaurant ORDER BY created_at DESC',
  );
  return result.rows;
}

export interface MenuCategoryRow {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
}

export async function insertMenuCategory(
  restaurantId: string,
  input: { name: string; sortOrder: number },
): Promise<MenuCategoryRow> {
  const result = await query<MenuCategoryRow>(
    'INSERT INTO menu_category (restaurant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [restaurantId, input.name, input.sortOrder],
  );
  return result.rows[0];
}

export async function updateMenuCategoryById(
  restaurantId: string,
  categoryId: string,
  patch: { name?: string; sortOrder?: number },
): Promise<MenuCategoryRow> {
  const result = await query<MenuCategoryRow>(
    `UPDATE menu_category
     SET name = COALESCE($3, name), sort_order = COALESCE($4, sort_order)
     WHERE id = $1 AND restaurant_id = $2
     RETURNING *`,
    [categoryId, restaurantId, patch.name ?? null, patch.sortOrder ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError('Menu category not found');
  return row;
}

export async function deleteMenuCategoryById(restaurantId: string, categoryId: string): Promise<void> {
  const result = await query('DELETE FROM menu_category WHERE id = $1 AND restaurant_id = $2', [
    categoryId,
    restaurantId,
  ]);
  if (result.rowCount === 0) throw new NotFoundError('Menu category not found');
}

export interface MenuItemRow {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string;
  destination: 'kitchen' | 'bar';
  is_available: boolean;
}

export async function categoryBelongsToRestaurant(restaurantId: string, categoryId: string): Promise<boolean> {
  const result = await query('SELECT 1 FROM menu_category WHERE id = $1 AND restaurant_id = $2', [
    categoryId,
    restaurantId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function insertMenuItem(
  restaurantId: string,
  input: {
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    destination: 'kitchen' | 'bar';
    isAvailable: boolean;
  },
): Promise<MenuItemRow> {
  const result = await query<MenuItemRow>(
    `INSERT INTO menu_item (restaurant_id, category_id, name, description, price, destination, is_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      restaurantId,
      input.categoryId,
      input.name,
      input.description ?? null,
      input.price,
      input.destination,
      input.isAvailable,
    ],
  );
  return result.rows[0];
}

export async function updateMenuItemById(
  restaurantId: string,
  itemId: string,
  patch: {
    categoryId?: string;
    name?: string;
    description?: string;
    price?: number;
    destination?: 'kitchen' | 'bar';
    isAvailable?: boolean;
  },
): Promise<MenuItemRow> {
  const result = await query<MenuItemRow>(
    `UPDATE menu_item
     SET category_id = COALESCE($3, category_id),
         name = COALESCE($4, name),
         description = COALESCE($5, description),
         price = COALESCE($6, price),
         destination = COALESCE($7, destination),
         is_available = COALESCE($8, is_available)
     WHERE id = $1 AND restaurant_id = $2
     RETURNING *`,
    [
      itemId,
      restaurantId,
      patch.categoryId ?? null,
      patch.name ?? null,
      patch.description ?? null,
      patch.price ?? null,
      patch.destination ?? null,
      patch.isAvailable ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError('Menu item not found');
  return row;
}

export async function deleteMenuItemById(restaurantId: string, itemId: string): Promise<void> {
  const result = await query('DELETE FROM menu_item WHERE id = $1 AND restaurant_id = $2', [itemId, restaurantId]);
  if (result.rowCount === 0) throw new NotFoundError('Menu item not found');
}

export interface TableRow {
  id: string;
  restaurant_id: string;
  table_number: string;
  qr_token: string;
}

export async function insertTable(
  restaurantId: string,
  input: { tableNumber: string; qrToken: string },
): Promise<TableRow> {
  const result = await query<TableRow>(
    'INSERT INTO "table" (restaurant_id, table_number, qr_token) VALUES ($1, $2, $3) RETURNING *',
    [restaurantId, input.tableNumber, input.qrToken],
  );
  return result.rows[0];
}

export async function listTablesForRestaurant(restaurantId: string): Promise<TableRow[]> {
  const result = await query<TableRow>(
    'SELECT * FROM "table" WHERE restaurant_id = $1 ORDER BY table_number',
    [restaurantId],
  );
  return result.rows;
}
