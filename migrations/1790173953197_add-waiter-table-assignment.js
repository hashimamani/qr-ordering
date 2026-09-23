/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE "table" ADD COLUMN assigned_waiter_id UUID REFERENCES staff_user(id) ON DELETE SET NULL;
    ALTER TABLE "table" ADD COLUMN assigned_at TIMESTAMPTZ;
    CREATE INDEX idx_table_assigned_waiter_id ON "table"(assigned_waiter_id);

    CREATE TABLE push_subscription (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_user_id UUID NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_push_subscription_staff_user_id ON push_subscription(staff_user_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE push_subscription;
    DROP INDEX idx_table_assigned_waiter_id;
    ALTER TABLE "table" DROP COLUMN assigned_at;
    ALTER TABLE "table" DROP COLUMN assigned_waiter_id;
  `);
};
