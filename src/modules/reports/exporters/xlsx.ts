import ExcelJS from 'exceljs';
import type { BreakdownRow, ReportBundle } from '../reports.types';
import { HISTORICAL_ACCURACY_NOTE } from '../reports.constants';

const MONEY_FORMAT = '#,##0.00';
const PERCENT_FORMAT = '0.0%';

function addSummarySheet(workbook: ExcelJS.Workbook, bundle: ReportBundle): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 24 }, { width: 20 }];

  sheet.addRow([bundle.restaurant_name]).font = { bold: true, size: 14 };
  sheet.addRow(['Sales report']);
  sheet.addRow([`${bundle.from} to ${bundle.to}`]);
  sheet.addRow([`Generated ${bundle.generated_at} (Africa/Nairobi)`]);
  sheet.addRow([]);

  const t = bundle.totals;
  const rows: [string, number | string][] = [
    ['Gross sales (KSh)', Number(t.gross_sales)],
    ['Paid sales (KSh)', Number(t.paid_sales)],
    ['Outstanding (KSh)', Number(t.unpaid_sales)],
    ['Orders', t.order_count],
    ['Items sold', t.item_count],
    ['Average order value (KSh)', Number(t.average_order_value)],
  ];
  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value]);
    if (typeof value === 'number' && label.includes('KSh')) row.getCell(2).numFmt = MONEY_FORMAT;
  }

  sheet.addRow([]);
  const noteRow = sheet.addRow([HISTORICAL_ACCURACY_NOTE]);
  noteRow.font = { italic: true, size: 9, color: { argb: 'FF777777' } };
  sheet.mergeCells(noteRow.number, 1, noteRow.number, 2);
  sheet.getRow(noteRow.number).getCell(1).alignment = { wrapText: true };
}

function addBreakdownSheet(workbook: ExcelJS.Workbook, name: string, rows: BreakdownRow[]): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: 'Name', key: 'label', width: 28 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Gross sales', key: 'gross_sales', width: 16 },
    { header: 'Paid sales', key: 'paid_sales', width: 16 },
    { header: 'Orders', key: 'order_count', width: 10 },
    { header: 'Share of sales', key: 'share_of_sales', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  for (const r of rows) {
    sheet.addRow({
      label: r.label,
      quantity: r.quantity,
      gross_sales: Number(r.gross_sales),
      paid_sales: Number(r.paid_sales),
      order_count: r.order_count,
      share_of_sales: r.share_of_sales,
    });
  }
  sheet.getColumn('gross_sales').numFmt = MONEY_FORMAT;
  sheet.getColumn('paid_sales').numFmt = MONEY_FORMAT;
  sheet.getColumn('share_of_sales').numFmt = PERCENT_FORMAT;
}

function addByDaySheet(workbook: ExcelJS.Workbook, bundle: ReportBundle): void {
  const sheet = workbook.addWorksheet('By day');
  sheet.columns = [
    { header: 'Day', key: 'day', width: 14 },
    { header: 'Gross sales', key: 'gross_sales', width: 16 },
    { header: 'Paid sales', key: 'paid_sales', width: 16 },
    { header: 'Orders', key: 'order_count', width: 10 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  for (const d of bundle.by_day) {
    sheet.addRow({
      day: d.day,
      gross_sales: Number(d.gross_sales),
      paid_sales: Number(d.paid_sales),
      order_count: d.order_count,
    });
  }
  sheet.getColumn('gross_sales').numFmt = MONEY_FORMAT;
  sheet.getColumn('paid_sales').numFmt = MONEY_FORMAT;
}

export async function toXlsx(bundle: ReportBundle): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QR Ordering';
  workbook.created = new Date();

  addSummarySheet(workbook, bundle);
  addByDaySheet(workbook, bundle);
  addBreakdownSheet(workbook, 'By menu item', bundle.by_menu_item);
  addBreakdownSheet(workbook, 'By category', bundle.by_category);
  addBreakdownSheet(workbook, 'By waiter', bundle.by_waiter);
  addBreakdownSheet(workbook, 'By table', bundle.by_table);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
