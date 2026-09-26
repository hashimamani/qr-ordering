import { findRestaurantById } from '../tables/tables.repository';
import { ValidationError } from '../../lib/errors';
import {
  getTotals,
  getRevenueByDay,
  getBreakdownByMenuItem,
  getBreakdownByCategory,
  getBreakdownByWaiter,
  getBreakdownByTable,
  listOrderItemRows,
  getTodayDate,
} from './reports.repository';
import { MAX_RAW_ROWS } from './reports.constants';
import type {
  BreakdownDimension,
  BreakdownRow,
  ReportBundle,
  ReportSummary,
  TodaySummary,
} from './reports.types';

export async function getTodaySummary(restaurantId: string): Promise<TodaySummary> {
  const today = await getTodayDate();
  const totals = await getTotals(restaurantId, today, today);
  return { date: today, ...totals };
}

export async function getSummary(restaurantId: string, from: string, to: string): Promise<ReportSummary> {
  const [totals, byDay] = await Promise.all([
    getTotals(restaurantId, from, to),
    getRevenueByDay(restaurantId, from, to),
  ]);
  return { from, to, totals, by_day: byDay };
}

const BREAKDOWN_FNS: Record<
  BreakdownDimension,
  (restaurantId: string, from: string, to: string) => Promise<BreakdownRow[]>
> = {
  menu_item: getBreakdownByMenuItem,
  category: getBreakdownByCategory,
  waiter: getBreakdownByWaiter,
  table: getBreakdownByTable,
};

export async function getBreakdown(
  restaurantId: string,
  from: string,
  to: string,
  dimension: BreakdownDimension,
): Promise<{ dimension: BreakdownDimension; rows: BreakdownRow[] }> {
  const rows = await BREAKDOWN_FNS[dimension](restaurantId, from, to);
  return { dimension, rows };
}

export async function buildReportBundle(restaurantId: string, from: string, to: string): Promise<ReportBundle> {
  const [restaurant, totals, byDay, byMenuItem, byCategory, byWaiter, byTable] = await Promise.all([
    findRestaurantById(restaurantId),
    getTotals(restaurantId, from, to),
    getRevenueByDay(restaurantId, from, to),
    getBreakdownByMenuItem(restaurantId, from, to),
    getBreakdownByCategory(restaurantId, from, to),
    getBreakdownByWaiter(restaurantId, from, to),
    getBreakdownByTable(restaurantId, from, to),
  ]);
  return {
    restaurant_name: restaurant.name,
    from,
    to,
    generated_at: new Date().toISOString(),
    totals,
    by_day: byDay,
    by_menu_item: byMenuItem,
    by_category: byCategory,
    by_waiter: byWaiter,
    by_table: byTable,
  };
}

export type ExportFormat = 'csv' | 'pdf' | 'xlsx';
export type CsvDataset = 'menu_item' | 'category' | 'waiter' | 'table' | 'order_items';

export interface RenderedExport {
  body: Buffer | string;
  contentType: string;
  filename: string;
}

/**
 * Picks an exporter, enforces MAX_RAW_ROWS, and lazily await-imports the
 * pdf/xlsx exporter modules -- defers evaluating ~12MB of pdfkit/exceljs
 * until the first export request, so order-placement cold starts on this
 * same shared Lambda are unaffected.
 */
export async function renderExport(
  restaurantId: string,
  from: string,
  to: string,
  format: ExportFormat,
  dataset?: CsvDataset,
): Promise<RenderedExport> {
  const filenameBase = `sales-report_${from}_${to}`;

  if (format === 'csv') {
    const { breakdownToCsv, orderItemsToCsv } = await import('./exporters/csv');
    if (dataset === 'order_items' || !dataset) {
      const rows = await listOrderItemRows(restaurantId, from, to, MAX_RAW_ROWS + 1);
      if (rows.length > MAX_RAW_ROWS) {
        throw new ValidationError('Too many rows for a single export -- narrow the date range');
      }
      return {
        body: orderItemsToCsv(rows),
        contentType: 'text/csv; charset=utf-8',
        filename: `${filenameBase}_order-items.csv`,
      };
    }
    const rows = await BREAKDOWN_FNS[dataset](restaurantId, from, to);
    return {
      body: breakdownToCsv(dataset, rows),
      contentType: 'text/csv; charset=utf-8',
      filename: `${filenameBase}_${dataset}.csv`,
    };
  }

  const bundle = await buildReportBundle(restaurantId, from, to);

  if (format === 'pdf') {
    const { toPdf } = await import('./exporters/pdf');
    return { body: await toPdf(bundle), contentType: 'application/pdf', filename: `${filenameBase}.pdf` };
  }

  const { toXlsx } = await import('./exporters/xlsx');
  return {
    body: await toXlsx(bundle),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `${filenameBase}.xlsx`,
  };
}
