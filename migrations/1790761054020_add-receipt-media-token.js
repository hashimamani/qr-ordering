/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * A single-use, short-lived token that lets the messaging provider fetch
 * the receipt PDF so it can be attached to a WhatsApp message.
 *
 * The problem this solves: the receipt PDF sits behind a download grant
 * that's issued only after the customer answers the last-4 challenge.
 * Africa's Talking' servers obviously can't answer that, so without this
 * they simply can't fetch the file -- and weakening the customer-facing
 * endpoint to let them would undo the access control we just built.
 *
 * So the send path mints a separate credential scoped to exactly one
 * fetch: hashed at rest like the receipt token itself, expiring in
 * minutes, and cleared the moment it's used. The URL handed to the
 * provider is therefore inert almost immediately, which matters because
 * it will sit in their request logs.
 *
 * If Africa's Talking turns out to accept media uploaded by bytes, that's
 * strictly better -- no URL is exposed at all -- and this becomes dead
 * weight we can drop without touching anything else.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE order_receipt
      ADD COLUMN media_fetch_token_hash TEXT,
      ADD COLUMN media_fetch_expires_at TIMESTAMPTZ;

    CREATE INDEX idx_order_receipt_media_token ON order_receipt(media_fetch_token_hash);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_order_receipt_media_token;
    ALTER TABLE order_receipt
      DROP COLUMN media_fetch_token_hash,
      DROP COLUMN media_fetch_expires_at;
  `);
};
