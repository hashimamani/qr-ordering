/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE staff_role AS ENUM ('admin', 'waiter', 'kitchen', 'bar');
    CREATE TYPE table_session_status AS ENUM ('active', 'awaiting_payment', 'closed');
    CREATE TYPE contact_channel AS ENUM ('sms', 'email');
    CREATE TYPE order_item_status AS ENUM ('received', 'preparing', 'ready', 'served');
    CREATE TYPE order_item_destination AS ENUM ('kitchen', 'bar');
    CREATE TYPE notification_trigger AS ENUM ('order_received', 'order_ready');
    CREATE TYPE notification_status AS ENUM ('sent', 'failed');

    CREATE TABLE restaurant (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE staff_user (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role staff_role NOT NULL,
      phone_or_email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (restaurant_id, phone_or_email)
    );
    CREATE INDEX idx_staff_user_restaurant_id ON staff_user(restaurant_id);

    CREATE TABLE "table" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      table_number TEXT NOT NULL,
      qr_token TEXT NOT NULL UNIQUE,
      UNIQUE (restaurant_id, table_number)
    );
    CREATE INDEX idx_table_restaurant_id ON "table"(restaurant_id);

    CREATE TABLE table_session (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id UUID NOT NULL REFERENCES "table"(id) ON DELETE CASCADE,
      status table_session_status NOT NULL DEFAULT 'active',
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX idx_table_session_table_id ON table_session(table_id);
    CREATE INDEX idx_table_session_table_id_status ON table_session(table_id, status);

    CREATE TABLE menu_category (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_menu_category_restaurant_id ON menu_category(restaurant_id);

    -- destination is set per menu item (kitchen vs bar) and copied onto each
    -- OrderItem at order-creation time, so a later menu change never rewrites
    -- the routing of an order already in flight.
    CREATE TABLE menu_item (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      category_id UUID NOT NULL REFERENCES menu_category(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
      destination order_item_destination NOT NULL DEFAULT 'kitchen',
      is_available BOOLEAN NOT NULL DEFAULT true
    );
    CREATE INDEX idx_menu_item_restaurant_id ON menu_item(restaurant_id);
    CREATE INDEX idx_menu_item_category_id ON menu_item(category_id);

    CREATE TABLE "order" (
      id BIGSERIAL PRIMARY KEY,
      public_token TEXT NOT NULL UNIQUE,
      table_session_id UUID NOT NULL REFERENCES table_session(id) ON DELETE RESTRICT,
      -- denormalized for tenant-isolation checks without a join back through
      -- table_session -> table on every order query
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
      contact_channel contact_channel NOT NULL,
      -- required contact for the stateless tracking-link recovery flow; also
      -- the intended future lookup key for a statement-by-phone-number
      -- feature (out of scope for v1) -- that feature must only ever send
      -- the statement back to this same contact_value, never to whoever
      -- requested it.
      contact_value TEXT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_order_public_token ON "order"(public_token);
    CREATE INDEX idx_order_table_session_id ON "order"(table_session_id);
    CREATE INDEX idx_order_restaurant_id ON "order"(restaurant_id);

    CREATE TABLE order_item (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id BIGINT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
      menu_item_id UUID NOT NULL REFERENCES menu_item(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      notes TEXT,
      status order_item_status NOT NULL DEFAULT 'received',
      destination order_item_destination NOT NULL
    );
    CREATE INDEX idx_order_item_order_id ON order_item(order_id);

    CREATE TABLE notification_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id BIGINT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
      channel contact_channel NOT NULL,
      trigger notification_trigger NOT NULL,
      sent_at TIMESTAMPTZ,
      status notification_status NOT NULL,
      provider_response TEXT
    );
    CREATE INDEX idx_notification_log_order_id ON notification_log(order_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS notification_log;
    DROP TABLE IF EXISTS order_item;
    DROP TABLE IF EXISTS "order";
    DROP TABLE IF EXISTS menu_item;
    DROP TABLE IF EXISTS menu_category;
    DROP TABLE IF EXISTS table_session;
    DROP TABLE IF EXISTS "table";
    DROP TABLE IF EXISTS staff_user;
    DROP TABLE IF EXISTS restaurant;

    DROP TYPE IF EXISTS notification_status;
    DROP TYPE IF EXISTS notification_trigger;
    DROP TYPE IF EXISTS order_item_destination;
    DROP TYPE IF EXISTS order_item_status;
    DROP TYPE IF EXISTS contact_channel;
    DROP TYPE IF EXISTS table_session_status;
    DROP TYPE IF EXISTS staff_role;
  `);
};
