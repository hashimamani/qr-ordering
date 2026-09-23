import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool } from './pool';
import { generateToken } from '../lib/token';
import { hashPassword } from '../lib/password';

export interface SeedResult {
  restaurantSlug: string;
  tables: { table_number: string; qr_token: string }[];
  staffPassword: string;
  staff: { role: string; contact: string }[];
}

/**
 * Idempotent: re-running only fills in what's missing (ON CONFLICT DO
 * NOTHING for tables/staff, a guard on existing categories for the
 * menu) -- safe to invoke against an already-seeded database, which is
 * exactly what happens when this runs both locally (npm run seed) and via
 * lambda-seed.ts against the deployed RDS instance, which has no other
 * way to reach it (private subnet, no bastion host).
 */
export async function seedDatabase(): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const restaurantId = randomUUID();
    await client.query(
      `INSERT INTO restaurant (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [restaurantId, 'Amani Grill', 'amani-grill'],
    );

    const restaurant = await client.query<{ id: string }>(
      'SELECT id FROM restaurant WHERE slug = $1',
      ['amani-grill'],
    );
    const finalRestaurantId = restaurant.rows[0].id;

    const table1Token = generateToken();
    const table2Token = generateToken();
    await client.query(
      `INSERT INTO "table" (restaurant_id, table_number, qr_token)
       VALUES ($1, '1', $2), ($1, '2', $3)
       ON CONFLICT (restaurant_id, table_number) DO NOTHING`,
      [finalRestaurantId, table1Token, table2Token],
    );

    // menu_category/menu_item have no natural unique key to ON CONFLICT
    // on, so re-running the seed guards against duplicating the menu by
    // checking whether this restaurant already has any categories.
    const existingCategories = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM menu_category WHERE restaurant_id = $1',
      [finalRestaurantId],
    );

    if (existingCategories.rows[0].count === '0') {
      const drinksCategory = await client.query<{ id: string }>(
        `INSERT INTO menu_category (restaurant_id, name, sort_order)
         VALUES ($1, 'Drinks', 1)
         RETURNING id`,
        [finalRestaurantId],
      );
      const mainsCategory = await client.query<{ id: string }>(
        `INSERT INTO menu_category (restaurant_id, name, sort_order)
         VALUES ($1, 'Mains', 2)
         RETURNING id`,
        [finalRestaurantId],
      );

      await client.query(
        `INSERT INTO menu_item (restaurant_id, category_id, name, description, price, destination)
         VALUES
           ($1, $2, 'Tusker Lager', 'Cold 500ml', 350.00, 'bar'),
           ($1, $2, 'Fresh Passion Juice', 'Locally sourced', 250.00, 'bar'),
           ($1, $3, 'Nyama Choma Plate', 'Grilled beef, kachumbari, ugali', 950.00, 'kitchen'),
           ($1, $3, 'Grilled Tilapia', 'Whole fish, side of fries', 1100.00, 'kitchen')`,
        [finalRestaurantId, drinksCategory.rows[0].id, mainsCategory.rows[0].id],
      );
    }

    const demoPassword = 'password123';
    const demoPasswordHash = await hashPassword(demoPassword);
    const demoStaff: { name: string; role: 'admin' | 'waiter' | 'kitchen' | 'bar'; contact: string }[] = [
      { name: 'Amani Admin', role: 'admin', contact: 'admin@amani-grill.test' },
      { name: 'Wanjiru Waiter', role: 'waiter', contact: 'waiter@amani-grill.test' },
      { name: 'Kamau Kitchen', role: 'kitchen', contact: 'kitchen@amani-grill.test' },
      { name: 'Baraka Bar', role: 'bar', contact: 'bar@amani-grill.test' },
    ];
    for (const staff of demoStaff) {
      await client.query(
        `INSERT INTO staff_user (restaurant_id, name, role, phone_or_email, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (restaurant_id, phone_or_email) DO NOTHING`,
        [finalRestaurantId, staff.name, staff.role, staff.contact, demoPasswordHash],
      );
    }

    await client.query('COMMIT');

    const tables = await client.query<{ table_number: string; qr_token: string }>(
      'SELECT table_number, qr_token FROM "table" WHERE restaurant_id = $1 ORDER BY table_number',
      [finalRestaurantId],
    );

    return {
      restaurantSlug: 'amani-grill',
      tables: tables.rows,
      staffPassword: demoPassword,
      staff: demoStaff.map((s) => ({ role: s.role, contact: s.contact })),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function printResult(result: SeedResult): void {
  // The frontend (React/Vite) is a separate app on its own origin now --
  // FRONTEND_BASE_URL, not PUBLIC_BASE_URL (the API's own origin, used
  // for tracking-link construction inside the backend itself).
  const frontendBase = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';

  console.log(`Seeded restaurant: ${result.restaurantSlug}\n`);
  console.log('Order as a customer:');
  for (const t of result.tables) {
    console.log(`  Table ${t.table_number}: ${frontendBase}/order?slug=${result.restaurantSlug}&t=${t.qr_token}`);
  }
  console.log(`\nStaff login (${frontendBase}/staff/login), password "${result.staffPassword}" for all:`);
  for (const staff of result.staff) {
    console.log(`  ${staff.role}: ${staff.contact}`);
  }
}

// Only runs when executed directly (`npm run seed`), not when imported by
// lambda-seed.ts.
if (require.main === module) {
  seedDatabase()
    .then((result) => {
      printResult(result);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
