import { query, withTransaction } from '../../db/pool';
import type { FulfilmentDestination } from '../../lib/domain';

/**
 * Bulk-loads a restaurant's menu.
 *
 * Lives here rather than in the import script because production's
 * database is inside the VPC with no bastion, so the only way to write to
 * it is from a Lambda. Parsing the client's spreadsheet happens locally,
 * where the file is; this is the half that has to run in the cloud, and
 * both callers share it so the guards cannot differ between a local dry
 * run and the real thing.
 */

export interface ImportItem {
  name: string;
  price: number;
  /** The item's id in the restaurant's own POS, where one is known. */
  pos_code?: string | null;
}

export interface ImportCategory {
  name: string;
  destination: FulfilmentDestination;
  items: ImportItem[];
}

export interface ImportResult {
  restaurant: { id: string; name: string; slug: string };
  categories: number;
  items: number;
}

export class MenuImportError extends Error {}

export async function importMenuForSlug(
  slug: string,
  categories: ImportCategory[],
): Promise<ImportResult> {
  const found = await query<{ id: string; name: string; slug: string }>(
    'SELECT id, name, slug FROM restaurant WHERE slug = $1',
    [slug],
  );
  const restaurant = found.rows[0];
  if (!restaurant) throw new MenuImportError(`No restaurant with slug "${slug}"`);

  // Refusing on a non-empty menu is the whole safety story for a bulk
  // load: there is no natural key to upsert on, so a second run would
  // silently double every item rather than fail.
  const existing = await query<{ n: string }>(
    'SELECT count(*) AS n FROM menu_item WHERE restaurant_id = $1',
    [restaurant.id],
  );
  if (Number(existing.rows[0].n) > 0) {
    throw new MenuImportError(
      `${restaurant.name} already has ${existing.rows[0].n} menu items; this only populates an empty menu`,
    );
  }

  let itemCount = 0;
  // One transaction: a half-loaded menu is worse than none, because staff
  // have to work out which half arrived.
  await withTransaction(async (client) => {
    let sortOrder = 0;
    for (const category of categories) {
      const cat = await client.query<{ id: string }>(
        'INSERT INTO menu_category (restaurant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [restaurant.id, category.name, sortOrder],
      );
      sortOrder += 1;
      for (const item of category.items) {
        await client.query(
          `INSERT INTO menu_item (restaurant_id, category_id, name, price, destination, pos_code, is_available)
           VALUES ($1, $2, $3, $4, $5::order_item_destination, $6, true)`,
          [restaurant.id, cat.rows[0].id, item.name, item.price, category.destination, item.pos_code ?? null],
        );
        itemCount += 1;
      }
    }
  });

  return { restaurant, categories: categories.length, items: itemCount };
}
