/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Snapshots the price each line was actually sold at onto order_item.
 *
 * Until now the only price in the operational schema lived on menu_item,
 * which admins edit freely -- so anything reconstructing an order's value
 * after the fact read *today's* price, not the one the customer paid.
 * That was tolerable while nothing operational depended on it (reporting
 * solved it separately, in report_order_item_fact, via its own snapshot).
 * It stops being tolerable the moment we hand the customer a receipt.
 *
 * The backfill below is best-effort and wrong for any item whose price
 * changed before this ran -- exactly the same caveat as the reporting
 * backfill, and the reason receipts for pre-migration orders are labelled
 * as reconstructed rather than presented as exact.
 *
 * Done in three steps rather than one: the column has to exist and be
 * populated before NOT NULL can be added, and adding it nullable first
 * means the table is never rewritten while unpopulated.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE order_item
      ADD COLUMN unit_price NUMERIC(10,2)
      CONSTRAINT order_item_unit_price_nonneg CHECK (unit_price IS NULL OR unit_price >= 0);

    UPDATE order_item oi
      SET unit_price = mi.price
      FROM menu_item mi
      WHERE mi.id = oi.menu_item_id;

    ALTER TABLE order_item ALTER COLUMN unit_price SET NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE order_item DROP COLUMN unit_price;`);
};
