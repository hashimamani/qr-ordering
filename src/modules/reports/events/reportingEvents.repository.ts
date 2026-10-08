import { query, pool } from '../../../db/pool';
import { toNairobiDateString } from '../../../lib/reportDate';
import type { OrderPlacedEvent } from './reportingEvents.types';

/**
 * The only code that writes to the reporting fact tables. Every write is
 * idempotent -- SQS+Lambda is at-least-once delivery even within a FIFO
 * message group, so a redelivered event must never double-count or error.
 */
export async function insertOrderFact(event: OrderPlacedEvent): Promise<void> {
  const reportDate = toNairobiDateString(event.submittedAt);
  const grossTotal = event.items
    .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
    .toFixed(2);
  const itemCount = event.items.reduce((sum, item) => sum + item.quantity, 0);

  await pool.query(
    `INSERT INTO report_order_fact
       (order_id, restaurant_id, submitted_at, report_date, table_id, table_number, gross_total, item_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      event.orderId,
      event.restaurantId,
      event.submittedAt,
      reportDate,
      event.tableId,
      event.tableNumber,
      grossTotal,
      itemCount,
    ],
  );
}

export async function insertOrderItemFacts(event: OrderPlacedEvent): Promise<void> {
  if (event.items.length === 0) return;
  const reportDate = toNairobiDateString(event.submittedAt);
  const n = event.items.length;

  await pool.query(
    `INSERT INTO report_order_item_fact
       (order_item_id, order_id, restaurant_id, report_date, menu_item_id, menu_item_name,
        category_id, category_name, destination, quantity, unit_price, line_total)
     SELECT * FROM unnest(
       $1::uuid[], $2::bigint[], $3::uuid[], $4::date[], $5::uuid[], $6::text[],
       $7::uuid[], $8::text[], $9::order_item_destination[], $10::int[], $11::numeric[], $12::numeric[]
     )
     ON CONFLICT (order_item_id) DO NOTHING`,
    [
      event.items.map((i) => i.orderItemId),
      Array(n).fill(event.orderId),
      Array(n).fill(event.restaurantId),
      Array(n).fill(reportDate),
      event.items.map((i) => i.menuItemId),
      event.items.map((i) => i.menuItemName),
      event.items.map((i) => i.categoryId),
      event.items.map((i) => i.categoryName),
      event.items.map((i) => i.destination),
      event.items.map((i) => i.quantity),
      event.items.map((i) => i.unitPrice),
      event.items.map((i) => (Number(i.unitPrice) * i.quantity).toFixed(2)),
    ],
  );
}

export async function updateOrderFactWaiter(
  orderId: string,
  restaurantId: string,
  waiterId: string,
  waiterName: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE report_order_fact SET waiter_id = $1, waiter_name = $2, updated_at = now()
     WHERE order_id = $3 AND restaurant_id = $4`,
    [waiterId, waiterName, orderId, restaurantId],
  );
}

export async function updateOrderFactPaymentStatus(orderId: string, restaurantId: string): Promise<void> {
  await pool.query(
    `UPDATE report_order_fact SET payment_status = 'paid', updated_at = now()
     WHERE order_id = $1 AND restaurant_id = $2`,
    [orderId, restaurantId],
  );
}

/**
 * Moves cancelled value out of the sales figures and into its own
 * columns, so "what did we sell" and "what did we lose to cancellations"
 * are both answerable from one row.
 *
 * GREATEST(0, ...) guards the floor: a duplicated event (SQS is
 * at-least-once) must not drive a total negative. The matching item
 * facts are deleted so per-item and per-category breakdowns stop
 * counting them too -- a breakdown that disagrees with the headline
 * figure is worse than either alone.
 */
export async function applyCancellationToFact(event: {
  orderId: string;
  restaurantId: string;
  cancelledTotal: string;
  cancelledItemCount: number;
  orderItemIds: string[];
}): Promise<void> {
  await query(
    `UPDATE report_order_fact
        SET gross_total = GREATEST(0, gross_total - $3::numeric),
            item_count = GREATEST(0, item_count - $4::int),
            cancelled_total = cancelled_total + $3::numeric,
            cancelled_item_count = cancelled_item_count + $4::int,
            updated_at = now()
      WHERE order_id = $1 AND restaurant_id = $2`,
    [event.orderId, event.restaurantId, event.cancelledTotal, event.cancelledItemCount],
  );

  if (event.orderItemIds.length > 0) {
    await query('DELETE FROM report_order_item_fact WHERE order_item_id = ANY($1::uuid[])', [
      event.orderItemIds,
    ]);
  }
}
