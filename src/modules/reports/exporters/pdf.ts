// pdfkit is excluded from the Lambda's esbuild bundle (see the `bundling`
// prop on ApiFunction in infra/lib/api-stack.ts) -- both of its module
// variants resolve their standard fonts/ICC profile in ways that need
// pdfkit's own on-disk directory and package.json intact at runtime, which
// bundling into a single flattened file breaks.
import PDFDocument from 'pdfkit';
import type { BreakdownRow, DayBucket, ReportBundle } from '../reports.types';
import { HISTORICAL_ACCURACY_NOTE } from '../reports.constants';

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 20;

function fmtMoney(v: string): string {
  return `KSh ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawTitleBlock(doc: PDFKit.PDFDocument, bundle: ReportBundle): void {
  doc.fontSize(18).font('Helvetica-Bold').text(bundle.restaurant_name);
  doc.fontSize(12).font('Helvetica').text('Sales report');
  doc.fontSize(10).fillColor('#555').text(`${bundle.from} to ${bundle.to}`);
  doc.text(`Generated ${new Date(bundle.generated_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} (Africa/Nairobi) -- amounts in KSh`);
  doc.fillColor('#000');
  doc.moveDown(1);
}

function drawTotalsGrid(doc: PDFKit.PDFDocument, bundle: ReportBundle): void {
  const t = bundle.totals;
  const cells: [string, string][] = [
    ['Gross sales', fmtMoney(t.gross_sales)],
    ['Paid sales', fmtMoney(t.paid_sales)],
    ['Outstanding', fmtMoney(t.unpaid_sales)],
    ['Orders', String(t.order_count)],
    ['Items sold', String(t.item_count)],
    ['Average order value', fmtMoney(t.average_order_value)],
  ];
  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 3;
  const startY = doc.y;
  cells.forEach(([label, value], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = PAGE_MARGIN + col * colWidth;
    const y = startY + row * 40;
    doc.fontSize(9).fillColor('#555').text(label, x, y);
    doc.fontSize(14).fillColor('#000').text(value, x, y + 12);
  });
  doc.y = startY + Math.ceil(cells.length / 3) * 40 + 10;
}

function drawBarChart(doc: PDFKit.PDFDocument, byDay: DayBucket[]): void {
  doc.fontSize(12).font('Helvetica-Bold').text('Revenue by day', PAGE_MARGIN, doc.y);
  doc.font('Helvetica');
  const chartWidth = doc.page.width - PAGE_MARGIN * 2;
  const chartHeight = 100;
  const top = doc.y + 8;
  const max = Math.max(...byDay.map((d) => Number(d.gross_sales)), 1);
  const barWidth = Math.max(2, chartWidth / Math.max(byDay.length, 1) - 2);

  byDay.forEach((d, i) => {
    const value = Number(d.gross_sales);
    const barHeight = Math.max(1, (value / max) * chartHeight);
    const x = PAGE_MARGIN + i * (chartWidth / byDay.length);
    doc.rect(x, top + chartHeight - barHeight, barWidth, barHeight).fill('#2563eb');
  });
  doc.fillColor('#000');
  doc.y = top + chartHeight + 16;
}

/**
 * Page-breaking table helper shared by all four breakdowns -- checks
 * remaining space before each row and starts a new page (redrawing the
 * header) when it would overflow the bottom margin.
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  title: string,
  columns: { label: string; width: number }[],
  rows: (string | number)[][],
): void {
  // Passing an explicit `height` on every .text() call below is load-
  // bearing, not cosmetic: without it, pdfkit's own automatic pagination
  // (it silently calls addPage() whenever a text call would overflow the
  // bottom margin) fights with this function's manual page-break checks.
  // Confirmed live: omitting it made each column of a header row that
  // started near the bottom of a page land on its OWN new page (one
  // addPage per doc.text call), instead of the whole header/row sharing
  // one page. An explicit height clips instead of paginating, leaving
  // pagination entirely to the checks below.
  const CELL_OPTS = { height: ROW_HEIGHT, ellipsis: true };

  if (doc.y + ROW_HEIGHT * 2 > doc.page.height - PAGE_MARGIN) {
    doc.addPage({ layout: 'landscape', margin: PAGE_MARGIN });
  }
  doc.fontSize(12).font('Helvetica-Bold').text(title, PAGE_MARGIN, doc.y, { height: ROW_HEIGHT });
  doc.moveDown(0.3);

  const drawHeader = () => {
    // headerY captured once and reused for every column -- doc.text()
    // advances doc.y on each call, so reading doc.y fresh per column (the
    // original bug here) made each header label land progressively lower
    // than the last instead of sharing one row.
    const headerY = doc.y;
    let x = PAGE_MARGIN;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#555');
    for (const col of columns) {
      doc.text(col.label, x, headerY, { width: col.width, ...CELL_OPTS });
      x += col.width;
    }
    doc.fillColor('#000');
    doc.y = headerY + ROW_HEIGHT;
  };

  drawHeader();
  doc.font('Helvetica').fontSize(9);

  for (const row of rows) {
    if (doc.y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN) {
      doc.addPage({ layout: 'landscape', margin: PAGE_MARGIN });
      drawHeader();
      doc.font('Helvetica').fontSize(9);
    }
    let x = PAGE_MARGIN;
    const rowY = doc.y;
    for (let i = 0; i < row.length; i++) {
      doc.text(String(row[i]), x, rowY, { width: columns[i].width, ...CELL_OPTS });
      x += columns[i].width;
    }
    doc.y = rowY + ROW_HEIGHT;
  }
  doc.moveDown(1);
}

function breakdownRowsFor(rows: BreakdownRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.label,
    r.quantity,
    fmtMoney(r.gross_sales),
    fmtMoney(r.paid_sales),
    r.order_count,
    `${(r.share_of_sales * 100).toFixed(1)}%`,
  ]);
}

const BREAKDOWN_COLUMNS = [
  { label: 'Name', width: 220 },
  { label: 'Qty', width: 80 },
  { label: 'Gross', width: 140 },
  { label: 'Paid', width: 140 },
  { label: 'Orders', width: 80 },
  { label: 'Share', width: 80 },
];

export async function toPdf(bundle: ReportBundle): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  drawTitleBlock(doc, bundle);
  drawTotalsGrid(doc, bundle);
  drawBarChart(doc, bundle.by_day);

  drawTable(doc, 'By menu item', BREAKDOWN_COLUMNS, breakdownRowsFor(bundle.by_menu_item));
  drawTable(doc, 'By category', BREAKDOWN_COLUMNS, breakdownRowsFor(bundle.by_category));
  drawTable(doc, 'By waiter', BREAKDOWN_COLUMNS, breakdownRowsFor(bundle.by_waiter));
  drawTable(doc, 'By table', BREAKDOWN_COLUMNS, breakdownRowsFor(bundle.by_table));

  doc.fontSize(8).fillColor('#777').text(HISTORICAL_ACCURACY_NOTE, PAGE_MARGIN, doc.page.height - PAGE_MARGIN - 20, {
    width: doc.page.width - PAGE_MARGIN * 2,
  });

  doc.end();
  return done;
}
