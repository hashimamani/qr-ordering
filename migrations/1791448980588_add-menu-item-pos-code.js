/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * The item's identifier in the restaurant's own POS.
 *
 * Restaurants arriving with an existing till (Chillax Zone runs
 * SambaPOS) need their Tab menu to line up with it, and the only stable
 * join key is the POS's own product id -- names drift the moment someone
 * fixes a typo on either side.
 *
 * Nullable because it is genuinely optional: a venue with no POS has
 * nothing to map to, and the price list Chillax first sent did not
 * include codes at all, so items may be loaded before codes are known.
 *
 * Unique per restaurant, not globally: two tenants will inevitably both
 * have a product "1001". Partial, so the many NULLs do not collide.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE menu_item ADD COLUMN pos_code TEXT;

    CREATE UNIQUE INDEX idx_menu_item_pos_code
      ON menu_item(restaurant_id, pos_code)
      WHERE pos_code IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_menu_item_pos_code;
    ALTER TABLE menu_item DROP COLUMN pos_code;
  `);
};
