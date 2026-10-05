/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * VAT shown on receipts, treated as already included in menu prices.
 *
 * Prices in this system have always been what the customer pays, so the
 * only honest presentation is to break the tax out of the total rather
 * than add it on top -- adding it would change what was charged after
 * the fact.
 *
 * Per-restaurant rather than a constant because a receipt itemising VAT
 * is a tax assertion: a restaurant below the registration threshold, or
 * one dealing in exempt supplies, must be able to show none. 16.00 is
 * the Kenyan standard rate and the sensible default, and 0 disables the
 * breakdown entirely rather than printing "VAT 0.00".
 *
 * vat_number carries the seller's KRA PIN. A document showing VAT is
 * expected to identify who collected it, and without this the receipt
 * looks like a tax invoice while missing the one field that makes it
 * one. Nullable: restaurants with no rate set have nothing to show.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE restaurant
      ADD COLUMN vat_rate NUMERIC(5,2) NOT NULL DEFAULT 16.00,
      ADD COLUMN vat_number TEXT;

    ALTER TABLE restaurant
      ADD CONSTRAINT restaurant_vat_rate_sane CHECK (vat_rate >= 0 AND vat_rate < 100);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE restaurant DROP CONSTRAINT IF EXISTS restaurant_vat_rate_sane;
    ALTER TABLE restaurant DROP COLUMN vat_number, DROP COLUMN vat_rate;
  `);
};
