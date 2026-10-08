/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Two-level menus: main categories (Food, Drinks) holding sub-categories
 * (Mbuzi, Beer Bottles) holding items.
 *
 * Driven by Chillax Zone's 273 items in 21 flat categories, which render
 * as one unscrollable wall on a phone. Grouping is the only thing that
 * makes a menu that size usable.
 *
 * A nullable self-reference rather than a separate menu_group table,
 * because it leaves every existing menu correct with no data migration:
 * a category with no parent simply is a main category, which is exactly
 * what the single-level tenants already have. Items keep hanging off
 * whichever category holds them, so a main category can carry items
 * directly and a small venue never has to invent a second level.
 *
 * Depth is capped at two in the service layer, not here -- expressing
 * "your parent must not itself have a parent" as a CHECK would need a
 * subquery, which Postgres does not allow in one.
 *
 * ON DELETE RESTRICT, not CASCADE: deleting "Drinks" must not silently
 * take 205 items with it. The admin has to empty a category first, the
 * same rule menu_item already enforces against its category.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE menu_category
      ADD COLUMN parent_id UUID REFERENCES menu_category(id) ON DELETE RESTRICT;

    CREATE INDEX idx_menu_category_parent ON menu_category(parent_id) WHERE parent_id IS NOT NULL;

    -- A category cannot be its own parent. The deeper cycle (a -> b -> a)
    -- is impossible anyway once depth is capped at two.
    ALTER TABLE menu_category
      ADD CONSTRAINT menu_category_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE menu_category DROP CONSTRAINT IF EXISTS menu_category_not_self_parent;
    DROP INDEX IF EXISTS idx_menu_category_parent;
    ALTER TABLE menu_category DROP COLUMN parent_id;
  `);
};
