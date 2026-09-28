/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * One receipt link per paid order.
 *
 * order_id is UNIQUE so issuing can be an INSERT ... ON CONFLICT DO
 * NOTHING: re-marking an already-paid order must not mint a second live
 * link, which would leave an old one valid that nobody knows about.
 *
 * token_hash, not the token: this link grants access to a financial
 * document, so a database leak must not hand the reader a working link
 * for every recent order. Same reasoning as order_item_status_audit's
 * actor snapshot -- store what you need, not what you were given.
 *
 * failed_attempts backs the brute-force cap. The link's second factor is
 * the last 4 digits of the contact number, which is only 10,000
 * combinations; IP rate limiting alone is sidesteppable by rotating
 * addresses, so the counter lives with the receipt itself and burns the
 * link once exceeded.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TYPE notification_trigger ADD VALUE IF NOT EXISTS 'receipt';
  `);

  pgm.sql(`
    CREATE TABLE order_receipt (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id BIGINT NOT NULL UNIQUE REFERENCES "order"(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      last_viewed_at TIMESTAMPTZ
    );
  `);
};

exports.down = (pgm) => {
  // The enum value is deliberately not removed: Postgres has no
  // DROP VALUE, and rebuilding the type would require rewriting
  // notification_log. An unused enum member is harmless.
  pgm.sql(`DROP TABLE order_receipt;`);
};
