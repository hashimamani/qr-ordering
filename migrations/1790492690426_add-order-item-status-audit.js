/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Full lifecycle history for every order_item status transition -- who
 * moved it, from what to what, and whether they were reaching outside
 * their own station to do it.
 *
 * Written synchronously, inside the same transaction as the UPDATE it
 * describes (see transitionOrderItemStatus). That's the opposite choice
 * from the reporting fact tables, deliberately: those are an eventually
 * consistent read model that must never block an order, whereas an audit
 * row that can silently go missing when its write fails is worse than no
 * audit at all.
 *
 * Every transition is logged, not only admin overrides. The extra INSERT
 * is free on a path that is already a transaction, `WHERE is_override`
 * recovers the override-only view, and having the complete history is
 * what lets the admin station board name who actually served an item --
 * "table".assigned_waiter_id is NULL'd on session close, so it can't
 * answer that question after the fact.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE order_item_status_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      order_item_id UUID NOT NULL REFERENCES order_item(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
      -- actor_name is snapshotted alongside the FK for the same reason
      -- report_order_fact.waiter_name is: DELETE /admin/staff/:id is a
      -- real hard delete, and an audit trail that forgets who did
      -- something the moment they leave isn't an audit trail.
      actor_staff_id UUID REFERENCES staff_user(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      actor_role staff_role NOT NULL,
      from_status order_item_status NOT NULL,
      to_status order_item_status NOT NULL,
      is_override BOOLEAN NOT NULL,
      is_backward BOOLEAN NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Serves the admin activity feed (newest first, per tenant).
    CREATE INDEX idx_oisa_restaurant_created ON order_item_status_audit(restaurant_id, created_at DESC);
    -- Serves the station board's lateral lookup of "who served this item".
    CREATE INDEX idx_oisa_order_item ON order_item_status_audit(order_item_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE order_item_status_audit;`);
};
