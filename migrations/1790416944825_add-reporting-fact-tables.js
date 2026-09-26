/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Two dedicated reporting fact tables, decoupled from the operational
 * schema -- report queries never join order/order_item/table_session/
 * table/menu_item/menu_category/staff_user. Going forward these are
 * populated only by the async reporting worker (see
 * src/modules/reports/events/), off a dedicated SQS FIFO queue, never
 * synchronously from the request path. The INSERT...SELECT below is a
 * ONE-TIME historical backfill for orders that already existed before
 * this migration ran -- the only place a live join against operational
 * tables + current menu prices/current table assignment ever happens.
 * It's a best-effort approximation: price is wrong only for items whose
 * price changed before this migration ran; waiter attribution is wrong
 * for any table reassigned/closed since (weaker than the price backfill,
 * since table.assigned_waiter_id resets on every session close).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE report_order_fact (
      order_id BIGINT PRIMARY KEY REFERENCES "order"(id) ON DELETE CASCADE,
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      submitted_at TIMESTAMPTZ NOT NULL,
      report_date DATE NOT NULL,
      table_id UUID REFERENCES "table"(id),
      table_number TEXT NOT NULL,
      waiter_id UUID REFERENCES staff_user(id) ON DELETE SET NULL,
      waiter_name TEXT,
      payment_status order_payment_status NOT NULL DEFAULT 'unpaid',
      gross_total NUMERIC(12,2) NOT NULL CHECK (gross_total >= 0),
      item_count INTEGER NOT NULL CHECK (item_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_report_order_fact_restaurant_date ON report_order_fact(restaurant_id, report_date);
    CREATE INDEX idx_report_order_fact_waiter ON report_order_fact(waiter_id);

    CREATE TABLE report_order_item_fact (
      order_item_id UUID PRIMARY KEY REFERENCES order_item(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES report_order_fact(order_id) ON DELETE CASCADE,
      restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
      report_date DATE NOT NULL,
      menu_item_id UUID NOT NULL REFERENCES menu_item(id) ON DELETE RESTRICT,
      menu_item_name TEXT NOT NULL,
      category_id UUID REFERENCES menu_category(id) ON DELETE SET NULL,
      category_name TEXT,
      destination order_item_destination NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
      line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_report_order_item_fact_restaurant_date ON report_order_item_fact(restaurant_id, report_date);
    CREATE INDEX idx_report_order_item_fact_order_id ON report_order_item_fact(order_id);

    INSERT INTO report_order_fact (order_id, restaurant_id, submitted_at, report_date, table_id, table_number, waiter_id, waiter_name, payment_status, gross_total, item_count)
    SELECT o.id, o.restaurant_id, o.submitted_at, (o.submitted_at AT TIME ZONE 'Africa/Nairobi')::date,
           t.id, t.table_number, t.assigned_waiter_id, su.name, o.payment_status,
           COALESCE(SUM(oi.quantity * mi.price), 0), COALESCE(SUM(oi.quantity), 0)
    FROM "order" o
    JOIN table_session ts ON ts.id = o.table_session_id
    JOIN "table" t ON t.id = ts.table_id
    LEFT JOIN staff_user su ON su.id = t.assigned_waiter_id
    LEFT JOIN order_item oi ON oi.order_id = o.id
    LEFT JOIN menu_item mi ON mi.id = oi.menu_item_id
    GROUP BY o.id, t.id, su.name;

    INSERT INTO report_order_item_fact (order_item_id, order_id, restaurant_id, report_date, menu_item_id, menu_item_name, category_id, category_name, destination, quantity, unit_price, line_total)
    SELECT oi.id, oi.order_id, o.restaurant_id, (o.submitted_at AT TIME ZONE 'Africa/Nairobi')::date,
           mi.id, mi.name, mc.id, mc.name, oi.destination, oi.quantity, mi.price, oi.quantity * mi.price
    FROM order_item oi
    JOIN "order" o ON o.id = oi.order_id
    JOIN menu_item mi ON mi.id = oi.menu_item_id
    LEFT JOIN menu_category mc ON mc.id = mi.category_id;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE report_order_item_fact;
    DROP TABLE report_order_fact;
  `);
};
