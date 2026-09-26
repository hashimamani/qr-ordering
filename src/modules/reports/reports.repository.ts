import { query } from '../../db/pool';
import type { ReportTotals, DayBucket, BreakdownRow, RawOrderItemRow } from './reports.types';

// Every query below reads only report_order_fact/report_order_item_fact --
// no joins to any operational table (order/order_item/table_session/
// table/menu_item/menu_category/staff_user). from/to are plain YYYY-MM-DD
// calendar dates compared directly against the precomputed report_date
// column, so there's no AT TIME ZONE at read time at all.

export async function getTotals(restaurantId: string, from: string, to: string): Promise<ReportTotals> {
  const result = await query<{
    gross_sales: string;
    paid_sales: string;
    order_count: string;
    item_count: string;
  }>(
    `SELECT
       COALESCE(SUM(gross_total), 0) AS gross_sales,
       COALESCE(SUM(gross_total) FILTER (WHERE payment_status = 'paid'), 0) AS paid_sales,
       COUNT(*) AS order_count,
       COALESCE(SUM(item_count), 0) AS item_count
     FROM report_order_fact
     WHERE restaurant_id = $1 AND report_date BETWEEN $2 AND $3`,
    [restaurantId, from, to],
  );
  const row = result.rows[0];
  const gross = Number(row.gross_sales);
  const paid = Number(row.paid_sales);
  const orderCount = Number(row.order_count);
  return {
    gross_sales: gross.toFixed(2),
    paid_sales: paid.toFixed(2),
    unpaid_sales: (gross - paid).toFixed(2),
    order_count: orderCount,
    item_count: Number(row.item_count),
    average_order_value: (orderCount > 0 ? gross / orderCount : 0).toFixed(2),
  };
}

export async function getRevenueByDay(restaurantId: string, from: string, to: string): Promise<DayBucket[]> {
  // generate_series LEFT JOINed to the fact table so zero-sale days come
  // back as explicit 0 rows -- without this the trend chart would silently
  // compress gaps and misrepresent a quiet stretch as a shorter one.
  // to_char, not d::date -- pg's default type parser turns a bare date/
  // timestamp column into a JS Date object, not the plain YYYY-MM-DD
  // string this API contract (and the frontend's date parsing) expects.
  const result = await query<{ day: string; gross_sales: string; paid_sales: string; order_count: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(f.gross_total), 0) AS gross_sales,
            COALESCE(SUM(f.gross_total) FILTER (WHERE f.payment_status = 'paid'), 0) AS paid_sales,
            COUNT(f.order_id) AS order_count
     FROM generate_series($2::date, $3::date, interval '1 day') d
     LEFT JOIN report_order_fact f ON f.report_date = d::date AND f.restaurant_id = $1
     GROUP BY d
     ORDER BY d`,
    [restaurantId, from, to],
  );
  return result.rows.map((r) => ({
    day: r.day,
    gross_sales: Number(r.gross_sales).toFixed(2),
    paid_sales: Number(r.paid_sales).toFixed(2),
    order_count: Number(r.order_count),
  }));
}

interface RawBreakdownRow {
  key: string | null;
  label: string | null;
  quantity: string;
  gross_sales: string;
  paid_sales: string;
  order_count: string;
}

function toBreakdownRows(rows: RawBreakdownRow[], fallbackLabel: string): BreakdownRow[] {
  const totalGross = rows.reduce((sum, r) => sum + Number(r.gross_sales), 0);
  return rows
    .map((r) => ({
      key: r.key,
      label: r.label ?? fallbackLabel,
      quantity: Number(r.quantity),
      gross_sales: Number(r.gross_sales).toFixed(2),
      paid_sales: Number(r.paid_sales).toFixed(2),
      order_count: Number(r.order_count),
      share_of_sales: totalGross > 0 ? Number(r.gross_sales) / totalGross : 0,
    }))
    .sort((a, b) => Number(b.gross_sales) - Number(a.gross_sales));
}

export async function getBreakdownByMenuItem(restaurantId: string, from: string, to: string): Promise<BreakdownRow[]> {
  const result = await query<RawBreakdownRow>(
    `SELECT i.menu_item_id AS key, i.menu_item_name AS label,
            SUM(i.quantity) AS quantity, SUM(i.line_total) AS gross_sales,
            SUM(i.line_total) FILTER (WHERE f.payment_status = 'paid') AS paid_sales,
            COUNT(DISTINCT i.order_id) AS order_count
     FROM report_order_item_fact i
     JOIN report_order_fact f ON f.order_id = i.order_id
     WHERE i.restaurant_id = $1 AND i.report_date BETWEEN $2 AND $3
     GROUP BY i.menu_item_id, i.menu_item_name`,
    [restaurantId, from, to],
  );
  return toBreakdownRows(result.rows, 'Unknown item');
}

export async function getBreakdownByCategory(restaurantId: string, from: string, to: string): Promise<BreakdownRow[]> {
  const result = await query<RawBreakdownRow>(
    `SELECT i.category_id AS key, i.category_name AS label,
            SUM(i.quantity) AS quantity, SUM(i.line_total) AS gross_sales,
            SUM(i.line_total) FILTER (WHERE f.payment_status = 'paid') AS paid_sales,
            COUNT(DISTINCT i.order_id) AS order_count
     FROM report_order_item_fact i
     JOIN report_order_fact f ON f.order_id = i.order_id
     WHERE i.restaurant_id = $1 AND i.report_date BETWEEN $2 AND $3
     GROUP BY i.category_id, i.category_name`,
    [restaurantId, from, to],
  );
  return toBreakdownRows(result.rows, 'Uncategorized');
}

export async function getBreakdownByWaiter(restaurantId: string, from: string, to: string): Promise<BreakdownRow[]> {
  const result = await query<RawBreakdownRow>(
    `SELECT waiter_id AS key, waiter_name AS label,
            SUM(item_count) AS quantity, SUM(gross_total) AS gross_sales,
            SUM(gross_total) FILTER (WHERE payment_status = 'paid') AS paid_sales,
            COUNT(*) AS order_count
     FROM report_order_fact
     WHERE restaurant_id = $1 AND report_date BETWEEN $2 AND $3
     GROUP BY waiter_id, waiter_name`,
    [restaurantId, from, to],
  );
  return toBreakdownRows(result.rows, 'Unassigned');
}

export async function getBreakdownByTable(restaurantId: string, from: string, to: string): Promise<BreakdownRow[]> {
  const result = await query<RawBreakdownRow>(
    `SELECT table_id AS key, table_number AS label,
            SUM(item_count) AS quantity, SUM(gross_total) AS gross_sales,
            SUM(gross_total) FILTER (WHERE payment_status = 'paid') AS paid_sales,
            COUNT(*) AS order_count
     FROM report_order_fact
     WHERE restaurant_id = $1 AND report_date BETWEEN $2 AND $3
     GROUP BY table_id, table_number`,
    [restaurantId, from, to],
  );
  return toBreakdownRows(result.rows, 'Unknown table');
}

export async function listOrderItemRows(
  restaurantId: string,
  from: string,
  to: string,
  limit: number,
): Promise<RawOrderItemRow[]> {
  const result = await query<RawOrderItemRow>(
    `SELECT to_char(f.submitted_at AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI') AS submitted_local,
            f.table_number, COALESCE(f.waiter_name, 'Unassigned') AS waiter_name,
            i.category_name, i.menu_item_name, i.quantity, i.unit_price, i.line_total, f.payment_status
     FROM report_order_item_fact i
     JOIN report_order_fact f ON f.order_id = i.order_id
     WHERE i.restaurant_id = $1 AND i.report_date BETWEEN $2 AND $3
     ORDER BY f.submitted_at, i.order_item_id
     LIMIT $4`,
    [restaurantId, from, to, limit],
  );
  return result.rows;
}

// "Today" is inherently a query-time concept, not a stored fact -- the one
// remaining place AT TIME ZONE runs at read time.
export async function getTodayDate(): Promise<string> {
  const result = await query<{ today: string }>(
    `SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS today`,
  );
  return result.rows[0].today;
}
