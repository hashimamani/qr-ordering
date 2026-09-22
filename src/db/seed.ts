import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool } from './pool';
import { generateToken } from '../lib/token';

async function seed(): Promise<void> {
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

    await client.query('COMMIT');

    const tables = await client.query<{ table_number: string; qr_token: string }>(
      'SELECT table_number, qr_token FROM "table" WHERE restaurant_id = $1 ORDER BY table_number',
      [finalRestaurantId],
    );

    console.log('Seeded restaurant: amani-grill');
    for (const t of tables.rows) {
      console.log(`  Table ${t.table_number}: GET /r/amani-grill/t/${t.qr_token}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
