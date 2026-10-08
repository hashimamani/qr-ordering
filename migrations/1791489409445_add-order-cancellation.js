/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Cancelling an order, by the customer who changed their mind or by
 * staff.
 *
 * Modelled as a status rather than a flag because order_item_status_audit
 * already records every transition with actor, reason and timestamp --
 * so "who cancelled this and why" comes for free, which a cancelled_at
 * column would have needed built separately.
 *
 * 'cancelled' is deliberately outside the received -> preparing -> ready
 * -> served progression. The transition helper compares positions in that
 * line to decide forward/backward, and a cancellation is neither, so it
 * gets its own path instead of being wedged into the ordering.
 *
 * actor_kind exists because a customer is not staff. The audit table
 * required actor_role (a staff_role) and actor_name, neither of which a
 * diner has, and adding 'customer' to staff_role would put a non-login
 * value into the enum that gates logins. actor_role becomes nullable for
 * the same reason; actor_kind says which kind of actor a row describes
 * rather than leaving it implied by a NULL.
 *
 * The fact table gains cancelled_total/cancelled_item_count. Reporting
 * is event-sourced and the fact is written when the order is placed, so
 * without a correcting event a cancelled item keeps counting as revenue
 * forever. Tracking the cancelled value separately rather than merely
 * subtracting it means "how much are we losing to cancellations" stays
 * answerable.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE order_item_status ADD VALUE IF NOT EXISTS 'cancelled';`);
  pgm.sql(`CREATE TYPE audit_actor_kind AS ENUM ('staff', 'customer');`);

  pgm.sql(`
    ALTER TABLE order_item_status_audit
      ADD COLUMN actor_kind audit_actor_kind NOT NULL DEFAULT 'staff',
      ALTER COLUMN actor_role DROP NOT NULL;

    ALTER TABLE report_order_fact
      ADD COLUMN cancelled_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN cancelled_item_count INTEGER NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  // The enum member stays: Postgres has no DROP VALUE, and rebuilding
  // order_item_status would mean rewriting order_item and the audit.
  pgm.sql(`
    ALTER TABLE report_order_fact
      DROP COLUMN cancelled_item_count,
      DROP COLUMN cancelled_total;

    ALTER TABLE order_item_status_audit DROP COLUMN actor_kind;

    DROP TYPE IF EXISTS audit_actor_kind;
  `);
  // actor_role is left nullable: rows written by a customer have no role,
  // so restoring NOT NULL would fail against real data.
};
