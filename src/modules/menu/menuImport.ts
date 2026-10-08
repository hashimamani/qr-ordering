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

/**
 * Files existing top-level categories under newly created main ones.
 *
 * Separate from importMenuForSlug because it runs against a menu that is
 * already loaded: the import refuses a non-empty menu by design, and
 * this is the operation that exists precisely for one.
 *
 * Only categories move. Items keep their category_id, so no price and no
 * pos_code can drift as a side effect of reorganising the menu.
 */
export async function regroupCategories(
  slug: string,
  groups: Record<string, string[]>,
): Promise<{ created: number; moved: number }> {
  const found = await query<{ id: string; name: string }>(
    'SELECT id, name FROM restaurant WHERE slug = $1',
    [slug],
  );
  const restaurant = found.rows[0];
  if (!restaurant) throw new MenuImportError(`No restaurant with slug "${slug}"`);

  let created = 0;
  let moved = 0;

  await withTransaction(async (client) => {
    const existing = await client.query<{ id: string; name: string; parent_id: string | null }>(
      'SELECT id, name, parent_id FROM menu_category WHERE restaurant_id = $1',
      [restaurant.id],
    );
    const byName = new Map(existing.rows.map((r) => [r.name, r]));

    let sortOrder = 0;
    for (const [mainName, subNames] of Object.entries(groups)) {
      // Reusing an existing main by name makes this safe to re-run: a
      // second pass re-parents the same children rather than creating a
      // duplicate "Drinks".
      let main = byName.get(mainName);
      if (!main) {
        const inserted = await client.query<{ id: string; name: string; parent_id: string | null }>(
          'INSERT INTO menu_category (restaurant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, parent_id',
          [restaurant.id, mainName, sortOrder],
        );
        main = inserted.rows[0];
        byName.set(mainName, main);
        created += 1;
      }
      sortOrder += 1;

      for (const subName of subNames) {
        const sub = byName.get(subName);
        // A category named in the plan but absent from the menu is worth
        // failing on: silently skipping it leaves items stranded at the
        // top level with nobody told.
        if (!sub) throw new MenuImportError(`No category named "${subName}" for ${restaurant.name}`);
        if (sub.parent_id === main.id) continue;
        await client.query('UPDATE menu_category SET parent_id = $2 WHERE id = $1', [sub.id, main.id]);
        moved += 1;
      }
    }
  });

  return { created, moved };
}
