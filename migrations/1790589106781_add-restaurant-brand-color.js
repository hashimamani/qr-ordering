/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Per-restaurant accent colour. One colour, not a whole palette -- the
 * frontend derives the rest of the --brand-* scale from it (see
 * frontend/src/lib/brandPalette.ts), so onboarding asks for a single
 * field instead of seven.
 *
 * Nullable on purpose: NULL means "use the Tab default", so every
 * restaurant that existed before this migration keeps rendering exactly
 * as it did with no backfill and no chance of a surprise restyle.
 *
 * The CHECK is the only validation the database itself can enforce, and
 * it matters more than it looks: this value is interpolated straight into
 * CSS custom properties client-side, so a malformed value should never
 * reach the column in the first place. The API validates the same shape
 * with zod before it ever gets here.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE restaurant
      ADD COLUMN brand_color TEXT
      CONSTRAINT restaurant_brand_color_hex
      CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE restaurant DROP COLUMN brand_color;`);
};
