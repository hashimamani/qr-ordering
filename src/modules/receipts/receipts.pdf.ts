import PDFDocument from 'pdfkit';
import type { ReceiptDetail } from './receipts.repository';
import { readableBrandInk } from '../../lib/brandInk';

// pdfkit is excluded from the Lambda's esbuild bundle (see api-stack.ts) --
// it resolves standard fonts through Node's package "imports" field, which
// a single-file bundle breaks.

const MARGIN = 50;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

function money(value: string | number): string {
  return `KSh ${Number(value).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function nairobi(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

/**
 * A customer's receipt.
 *
 * Carries the restaurant's brand colour, but only through
 * readableBrandInk -- a brand chosen to sit behind white text on screen
 * can be invisible printed as text on white paper, and this document is
 * meant to survive whatever printer it meets. Colour is used on the rule,
 * the name and the total only; the body stays near-black so the thing
 * remains legible in greyscale.
 *
 * Every figure comes from order_item.unit_price -- the price snapshot
 * taken when the order was placed -- so the document cannot drift from
 * what was actually charged when someone later edits the menu.
 */
export async function renderReceiptPdf(receipt: ReceiptDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const contentWidth = doc.page.width - MARGIN * 2;
  const right = MARGIN + contentWidth;
  const brand = readableBrandInk(receipt.brand_color);

  function rule(y: number, color = RULE, width = 0.5): void {
    doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(width).strokeColor(color).stroke();
  }

  // ---- header -------------------------------------------------------
  doc.fontSize(22).font('Helvetica-Bold').fillColor(brand).text(receipt.restaurant_name, MARGIN, MARGIN);
  const headerTop = MARGIN;
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor(MUTED)
    .text('RECEIPT', MARGIN, headerTop + 4, { width: contentWidth, align: 'right', characterSpacing: 1.5 });

  doc.y = Math.max(doc.y, headerTop + 30);
  if (receipt.vat_number) {
    doc.fontSize(9).font('Helvetica').fillColor(MUTED).text(`PIN: ${receipt.vat_number}`, MARGIN, doc.y);
  }
  doc.moveDown(0.5);
  rule(doc.y, brand, 2);
  doc.moveDown(0.9);

  // ---- order metadata, two columns ----------------------------------
  // Read row-wise, so the pairs matter: identity on the first row,
  // timestamps on the second. Left/right alone would give the reader
  // Table, Paid, Placed, Reference in that order.
  const metaLeft: Array<[string, string]> = [
    ['Table', receipt.table_number],
    ['Placed', nairobi(receipt.submitted_at)],
  ];
  const metaRight: Array<[string, string]> = [
    ['Reference', receipt.order_public_token.slice(0, 8).toUpperCase()],
    ['Paid', nairobi(receipt.paid_at)],
  ];
  const metaTop = doc.y;
  const half = contentWidth / 2;

  function metaColumn(entries: Array<[string, string]>, x: number): number {
    let y = metaTop;
    for (const [label, value] of entries) {
      doc.fontSize(8).font('Helvetica').fillColor(MUTED).text(label.toUpperCase(), x, y, {
        width: half - 10,
        characterSpacing: 0.6,
      });
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(value, x, y + 11, { width: half - 10 });
      y += 30;
    }
    return y;
  }
  const afterMeta = Math.max(metaColumn(metaLeft, MARGIN), metaColumn(metaRight, MARGIN + half));
  doc.y = afterMeta + 4;

  // ---- items ---------------------------------------------------------
  const qtyW = 45;
  const priceW = 105;
  const totalW = 110;
  const nameW = contentWidth - qtyW - priceW - totalW;
  const cols = [
    { x: MARGIN, w: nameW, align: 'left' as const },
    { x: MARGIN + nameW, w: qtyW, align: 'right' as const },
    { x: MARGIN + nameW + qtyW, w: priceW, align: 'right' as const },
    { x: MARGIN + nameW + qtyW + priceW, w: totalW, align: 'right' as const },
  ];

  function row(values: string[], opts: { bold?: boolean; color?: string; size?: number } = {}): void {
    // doc.y is captured once and reused for every cell -- reading it per
    // cell would step each column down the page, since .text() advances
    // the cursor after each call.
    const y = doc.y;
    doc.fontSize(opts.size ?? 10).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(opts.color ?? INK);
    values.forEach((value, i) => {
      doc.text(value, cols[i].x, y, { width: cols[i].w, align: cols[i].align, height: 16, ellipsis: true });
    });
    doc.y = y + (opts.size ?? 10) + 8;
  }

  row(['ITEM', 'QTY', 'UNIT PRICE', 'AMOUNT'], { bold: true, color: MUTED, size: 8 });
  rule(doc.y - 3);
  doc.moveDown(0.3);

  for (const item of receipt.items) {
    if (doc.y + 90 > doc.page.height - MARGIN) doc.addPage();
    row([item.menu_item_name, String(item.quantity), money(item.unit_price), money(item.line_total)]);
  }

  rule(doc.y + 2);
  doc.moveDown(0.6);

  // ---- totals --------------------------------------------------------
  // Right-aligned block rather than reusing the item columns: the label
  // needs room for "VAT (16%), included" without colliding with figures.
  const labelW = 150;
  const valueW = 120;
  const totalsX = right - labelW - valueW;

  function totalLine(label: string, value: string, opts: { bold?: boolean; size?: number; color?: string } = {}): void {
    const y = doc.y;
    const size = opts.size ?? 10;
    doc.fontSize(size).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(opts.color ?? MUTED);
    doc.text(label, totalsX, y, { width: labelW, align: 'right' });
    doc.fillColor(opts.color ?? INK);
    doc.text(value, totalsX + labelW, y, { width: valueW, align: 'right' });
    doc.y = y + size + 7;
  }

  const vat = receipt.vat;
  if (vat) {
    totalLine('Subtotal', money(vat.net));
    totalLine(`VAT (${vat.ratePercent}%)`, money(vat.vat));
    doc.moveDown(0.2);
    doc
      .moveTo(totalsX, doc.y)
      .lineTo(right, doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.4);
  }
  totalLine('Total', money(receipt.total), { bold: true, size: 13, color: brand });

  if (vat) {
    doc.moveDown(0.2);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(MUTED)
      .text('Prices include VAT. The total is the amount charged.', totalsX, doc.y, {
        width: labelW + valueW,
        align: 'right',
      });
  }

  if (receipt.prices_reconstructed) {
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#b45309').text(
      'This order predates itemised price records. Prices shown were reconstructed from the menu and may differ from the amount charged.',
      MARGIN,
      doc.y,
      { width: contentWidth },
    );
  }

  // ---- footer --------------------------------------------------------
  // Pinned to the bottom of the page rather than flowing after the
  // content, so a two-item receipt and a thirty-item one both end the
  // same way instead of leaving the attribution floating mid-page.
  const footerY = doc.page.height - MARGIN - 26;
  // A receipt long enough to reach the footer zone gets a fresh page for
  // it rather than printing the attribution over the last line items.
  if (doc.y > footerY - 12) doc.addPage();
  doc.y = footerY;
  rule(doc.y, RULE);
  doc.moveDown(0.5);
  doc.fontSize(8).font('Helvetica').fillColor(MUTED).text(
    'Tab is a QR ordering system by AmaniLabs. For more information visit amanilabs.co.ke',
    MARGIN,
    doc.y,
    { width: contentWidth, align: 'center' },
  );

  doc.end();
  return done;
}
