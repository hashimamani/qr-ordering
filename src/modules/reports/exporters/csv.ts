import type { BreakdownDimension, BreakdownRow, RawOrderItemRow } from '../reports.types';

const BOM = '﻿';

// Cells starting with any of these are prefixed with a leading quote --
// menu item/category/waiter names are admin-controlled free text landing
// in a file someone opens in Excel, and a name like "=CMD(...)" would
// otherwise be interpreted as a formula (a real, if low-severity, CSV
// injection vector).
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function escapeCell(value: string | number | null): string {
  let cell = value === null ? '' : String(value);
  if (FORMULA_PREFIX_RE.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
  menu_item: 'Menu item',
  category: 'Category',
  waiter: 'Waiter',
  table: 'Table',
};

export function breakdownToCsv(dimension: BreakdownDimension, rows: BreakdownRow[]): string {
  const headers = [DIMENSION_LABELS[dimension], 'Quantity', 'Gross sales', 'Paid sales', 'Orders', 'Share of sales'];
  const body = rows.map((r) => [
    r.label,
    r.quantity,
    r.gross_sales,
    r.paid_sales,
    r.order_count,
    (r.share_of_sales * 100).toFixed(1) + '%',
  ]);
  return toCsv(headers, body);
}

export function orderItemsToCsv(rows: RawOrderItemRow[]): string {
  const headers = [
    'Submitted (Nairobi time)',
    'Table',
    'Waiter',
    'Category',
    'Menu item',
    'Quantity',
    'Unit price',
    'Line total',
    'Payment status',
  ];
  const body = rows.map((r) => [
    r.submitted_local,
    r.table_number,
    r.waiter_name,
    r.category_name,
    r.menu_item_name,
    r.quantity,
    r.unit_price,
    r.line_total,
    r.payment_status,
  ]);
  return toCsv(headers, body);
}
