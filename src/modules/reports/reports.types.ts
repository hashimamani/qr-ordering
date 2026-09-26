// Money is always a decimal string, matching how `pg` returns NUMERIC and
// the existing convention elsewhere (e.g. MenuItem.price: string) -- never
// a JS number, to avoid float drift on sums.

export interface ReportTotals {
  gross_sales: string;
  paid_sales: string;
  unpaid_sales: string;
  order_count: number;
  item_count: number;
  average_order_value: string;
}

export interface DayBucket {
  day: string;
  gross_sales: string;
  paid_sales: string;
  order_count: number;
}

export type BreakdownDimension = 'menu_item' | 'category' | 'waiter' | 'table';

export interface BreakdownRow {
  key: string | null;
  label: string;
  quantity: number;
  gross_sales: string;
  paid_sales: string;
  order_count: number;
  share_of_sales: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  totals: ReportTotals;
  by_day: DayBucket[];
}

export interface TodaySummary extends ReportTotals {
  date: string;
}

export interface RawOrderItemRow {
  submitted_local: string;
  table_number: string;
  waiter_name: string;
  category_name: string | null;
  menu_item_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  payment_status: 'unpaid' | 'paid';
}

export interface ReportBundle {
  restaurant_name: string;
  from: string;
  to: string;
  generated_at: string;
  totals: ReportTotals;
  by_day: DayBucket[];
  by_menu_item: BreakdownRow[];
  by_category: BreakdownRow[];
  by_waiter: BreakdownRow[];
  by_table: BreakdownRow[];
}
