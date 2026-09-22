import 'dotenv/config';
import autocannon, { type Result } from 'autocannon';
import { pool } from '../src/db/pool';

const BASE_URL = process.env.LOADTEST_BASE_URL ?? 'http://localhost:3010';

function summarize(label: string, result: Result): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  requests/sec:   ${result.requests.average.toFixed(1)}`);
  console.log(`  latency p50:    ${result.latency.p50}ms`);
  console.log(`  latency p99:    ${result.latency.p99}ms`);
  console.log(`  latency max:    ${result.latency.max}ms`);
  console.log(`  2xx:            ${result['2xx']}`);
  console.log(`  non-2xx:        ${result.non2xx}`);
  console.log(`  errors:         ${result.errors}`);
  console.log(`  timeouts:       ${result.timeouts}`);
}

async function main(): Promise<void> {
  const restaurant = await pool.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM restaurant WHERE slug = 'amani-grill'",
  );
  if (restaurant.rows.length === 0) {
    throw new Error('Seed data not found -- run `npm run seed` first');
  }
  const { id: restaurantId, slug } = restaurant.rows[0];

  const table = await pool.query<{ qr_token: string }>(
    'SELECT qr_token FROM "table" WHERE restaurant_id = $1 ORDER BY table_number LIMIT 1',
    [restaurantId],
  );
  const qrToken = table.rows[0].qr_token;

  const menuItem = await pool.query<{ id: string }>(
    'SELECT id FROM menu_item WHERE restaurant_id = $1 AND is_available = true LIMIT 1',
    [restaurantId],
  );
  const menuItemId = menuItem.rows[0].id;

  console.log(`Load testing against ${BASE_URL} (restaurant: ${slug}, table qr_token: ${qrToken})`);

  // 1. GET /r/{slug}/t/{qrToken} -- fires on every QR scan, the highest-
  // volume read path during a busy dinner service.
  const resolveResult = await autocannon({
    url: `${BASE_URL}/r/${slug}/t/${qrToken}`,
    connections: 20,
    duration: 15,
  });
  summarize('GET /r/{slug}/t/{qrToken} (menu resolution)', resolveResult);

  // 2. POST /r/{slug}/t/{qrToken}/orders -- the write path: DB transaction
  // + notification enqueue + realtime broadcast per request.
  const orderResult = await autocannon({
    url: `${BASE_URL}/r/${slug}/t/${qrToken}/orders`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ menu_item_id: menuItemId, quantity: 1 }],
      contact_channel: 'sms',
      contact_value: '+254700000000',
    }),
    connections: 10,
    duration: 15,
  });
  summarize('POST /r/{slug}/t/{qrToken}/orders (order submission)', orderResult);

  // 3. GET /track/{public_token} -- rate-limited to 30 req/min/IP by
  // design (see src/lib/rateLimit.ts). Place one real order via a plain
  // fetch to get a token to hit repeatedly -- realistic, since a customer
  // refreshing their own tracking page hits the same token many times.
  const placeResponse = await fetch(`${BASE_URL}/r/${slug}/t/${qrToken}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ menu_item_id: menuItemId, quantity: 1 }],
      contact_channel: 'sms',
      contact_value: '+254700000001',
    }),
  });
  const { public_token: publicToken } = (await placeResponse.json()) as { public_token: string };

  const trackResult = await autocannon({
    url: `${BASE_URL}/track/${publicToken}`,
    connections: 1,
    amount: 20,
  });
  summarize('GET /track/{public_token} (below rate limit -- baseline latency)', trackResult);

  const burstResult = await autocannon({
    url: `${BASE_URL}/track/${publicToken}`,
    connections: 10,
    amount: 60,
  });
  summarize('GET /track/{public_token} (burst of 60 -- should show 429s above the 30/min limit)', burstResult);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
