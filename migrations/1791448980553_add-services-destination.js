/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * A third fulfilment destination alongside kitchen and bar.
 *
 * Driven by a real menu: Chillax Zone sells carwash and laundry next to
 * its food and drink -- 17 items that belong to neither station. Without
 * this they would have to be labelled 'kitchen', putting "HEAVY CAR" and
 * "BEDCOVER" on a chef's screen, which is the kind of mislabelling that
 * quietly trains staff to ignore their own queue.
 *
 * The staff role is added in step with the destination because the two
 * are paired everywhere else: a station exists so somebody can be given
 * exactly that queue and nothing else. admin continues to see all of
 * them.
 *
 * Postgres has no DROP VALUE, so down() leaves both members in place --
 * rebuilding either enum would mean rewriting menu_item, order_item and
 * staff_user. An unused member is inert.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE order_item_destination ADD VALUE IF NOT EXISTS 'services';`);
  pgm.sql(`ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'services';`);
};

exports.down = () => {
  // Deliberately empty: see above.
};
