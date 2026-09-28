import { query } from '../../db/pool';

export interface ReceiptLookup {
  receipt_id: string;
  order_id: string;
  expires_at: string;
  failed_attempts: number;
  contact_channel: 'sms' | 'email';
  contact_value: string;
}

export interface ReceiptLineItem {
  menu_item_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface ReceiptDetail {
  order_public_token: string;
  submitted_at: string;
  /**
   * When payment was taken. There is no order.paid_at column, but the
   * receipt row is created inside markOrderPaid, so its issued_at *is*
   * the moment of payment -- accurate, rather than inventing a timestamp
   * at render time (which would show the download time on a document
   * whose whole job is to record when money changed hands).
   */
  paid_at: string;
  restaurant_name: string;
  brand_color: string | null;
  table_number: string;
  items: ReceiptLineItem[];
  total: string;
  /**
   * True when the order predates the unit_price column, so its prices
   * were backfilled from the menu rather than captured at order time.
   * Surfaced to the viewer instead of quietly presenting an approximation
   * as exact.
   */
  prices_reconstructed: boolean;
}

/**
 * Issues a receipt link. ON CONFLICT DO NOTHING against the UNIQUE
 * order_id makes this idempotent: re-marking an already-paid order must
 * not mint a second live link, which would leave an earlier one valid
 * that nobody is tracking.
 *
 * Returns false when a receipt already existed, so the caller knows not
 * to send a second message with a token that won't work.
 */
export async function insertReceipt(
  orderId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<boolean> {
  const result = await query(
    `INSERT INTO order_receipt (order_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, tokenHash, expiresAt],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Resolves a presented token to the bare facts needed to run the
 * challenge -- deliberately no order contents, so nothing about the order
 * can leak before the viewer has proved who they are.
 */
export async function findReceiptByTokenHash(tokenHash: string): Promise<ReceiptLookup | undefined> {
  const result = await query<ReceiptLookup>(
    `SELECT r.id AS receipt_id, r.order_id, r.expires_at, r.failed_attempts,
            o.contact_channel, o.contact_value
     FROM order_receipt r
     JOIN "order" o ON o.id = r.order_id
     WHERE r.token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0];
}

export async function recordFailedAttempt(receiptId: string): Promise<number> {
  const result = await query<{ failed_attempts: number }>(
    `UPDATE order_receipt SET failed_attempts = failed_attempts + 1
     WHERE id = $1 RETURNING failed_attempts`,
    [receiptId],
  );
  return result.rows[0]?.failed_attempts ?? 0;
}

export async function markReceiptViewed(receiptId: string): Promise<void> {
  // Successful view also clears the failure count: someone who mistyped a
  // few times then got it right shouldn't be closer to burning their own
  // link on the next visit.
  await query(
    'UPDATE order_receipt SET last_viewed_at = now(), failed_attempts = 0 WHERE id = $1',
    [receiptId],
  );
}

const UNIT_PRICE_MIGRATION = '1790601314668_add-order-item-unit-price';
let backfillRunAt: Date | null | undefined;

/**
 * When the unit_price backfill ran. Orders submitted before it had their
 * prices reconstructed from the menu rather than captured at order time,
 * so their receipts say so instead of presenting an approximation as
 * exact.
 *
 * Cached per process: it's a fact about a migration that has already run,
 * so it can never change underneath us.
 */
async function getBackfillRunAt(): Promise<Date | null> {
  if (backfillRunAt !== undefined) return backfillRunAt;
  try {
    const result = await query<{ run_on: Date }>(
      'SELECT run_on FROM pgmigrations WHERE name = $1',
      [UNIT_PRICE_MIGRATION],
    );
    backfillRunAt = result.rows[0]?.run_on ?? null;
  } catch {
    // Never fail a receipt over a provenance label.
    backfillRunAt = null;
  }
  return backfillRunAt;
}

/**
 * The receipt contents. Prices come from order_item.unit_price -- the
 * snapshot taken at order time -- never from menu_item, which admins edit.
 * That is the whole reason the column exists.
 */
export async function findReceiptDetail(orderId: string): Promise<ReceiptDetail | undefined> {
  const orderResult = await query<{
    public_token: string;
    submitted_at: string;
    paid_at: string;
    restaurant_name: string;
    brand_color: string | null;
    table_number: string;
  }>(
    `SELECT o.public_token, o.submitted_at, rc.issued_at AS paid_at,
            r.name AS restaurant_name, r.brand_color, t.table_number
     FROM "order" o
     JOIN restaurant r ON r.id = o.restaurant_id
     JOIN table_session ts ON ts.id = o.table_session_id
     JOIN "table" t ON t.id = ts.table_id
     JOIN order_receipt rc ON rc.order_id = o.id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order) return undefined;

  const itemsResult = await query<ReceiptLineItem>(
    `SELECT mi.name AS menu_item_name, oi.quantity, oi.unit_price,
            (oi.quantity * oi.unit_price)::numeric(12,2) AS line_total
     FROM order_item oi
     JOIN menu_item mi ON mi.id = oi.menu_item_id
     WHERE oi.order_id = $1
     ORDER BY mi.name`,
    [orderId],
  );

  const total = itemsResult.rows.reduce((sum, row) => sum + Number(row.line_total), 0);

  const backfilledAt = await getBackfillRunAt();
  const prices_reconstructed =
    backfilledAt !== null && new Date(order.submitted_at) < backfilledAt;

  return {
    order_public_token: order.public_token,
    submitted_at: order.submitted_at,
    paid_at: order.paid_at,
    restaurant_name: order.restaurant_name,
    brand_color: order.brand_color,
    table_number: order.table_number,
    items: itemsResult.rows,
    total: total.toFixed(2),
    prices_reconstructed,
  };
}
