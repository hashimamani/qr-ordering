import PDFDocument from 'pdfkit';
import type { ReceiptDetail } from './receipts.repository';

// pdfkit is excluded from the Lambda's esbuild bundle (see api-stack.ts) --
// it resolves standard fonts through Node's package "imports" field, which
// a single-file bundle breaks.

const MARGIN = 50;

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
 * A customer's receipt. Monochrome for the same reason the QR labels are:
 * it gets printed on whatever the customer has, if at all.
 *
 * Every figure here comes from order_item.unit_price -- the price snapshot
 * taken when the order was placed -- so the document can't drift from what
 * was actually charged when someone later edits the menu.
 */
export async function renderReceiptPdf(receipt: ReceiptDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const contentWidth = doc.page.width - MARGIN * 2;

  doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827').text(receipt.restaurant_name);
  doc.fontSize(11).font('Helvetica').fillColor('#4b5563').text('Receipt');
  doc.moveDown(0.8);

  doc.fontSize(10).fillColor('#374151');
  doc.text(`Table ${receipt.table_number}`);
  doc.text(`Order reference: ${receipt.order_public_token}`);
  doc.text(`Placed: ${nairobi(receipt.submitted_at)}`);
  doc.text(`Paid: ${nairobi(receipt.paid_at)}`);
  doc.moveDown(1);

  // Column layout, right-aligning the numeric columns so the figures line
  // up on the decimal when scanned down.
  const qtyW = 50;
  const priceW = 110;
  const totalW = 110;
  const nameW = contentWidth - qtyW - priceW - totalW;
  const cols = [
    { x: MARGIN, w: nameW, align: 'left' as const },
    { x: MARGIN + nameW, w: qtyW, align: 'right' as const },
    { x: MARGIN + nameW + qtyW, w: priceW, align: 'right' as const },
    { x: MARGIN + nameW + qtyW + priceW, w: totalW, align: 'right' as const },
  ];

  function row(values: string[], bold = false): void {
    // doc.y is captured once and reused for every cell -- reading it per
    // cell would step each column down the page, since .text() advances
    // the cursor after each call.
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    values.forEach((value, i) => {
      doc.text(value, cols[i].x, y, { width: cols[i].w, align: cols[i].align, height: 16, ellipsis: true });
    });
    doc.y = y + 18;
  }

  doc.fontSize(9).fillColor('#6b7280');
  row(['Item', 'Qty', 'Unit price', 'Amount'], true);
  doc.moveTo(MARGIN, doc.y - 4).lineTo(MARGIN + contentWidth, doc.y - 4).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  doc.moveDown(0.2);

  doc.fontSize(10).fillColor('#111827');
  for (const item of receipt.items) {
    if (doc.y + 40 > doc.page.height - MARGIN) doc.addPage();
    row([item.menu_item_name, String(item.quantity), money(item.unit_price), money(item.line_total)]);
  }

  doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + contentWidth, doc.y + 2).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#111827');
  row(['Total', '', '', money(receipt.total)], true);

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor('#6b7280');
  // Stated rather than implied: there is no tax or service-charge concept
  // anywhere in this system, so the document says the total is the sum of
  // the lines instead of leaving a reader to assume a breakdown exists.
  doc.text(
    'Total is the sum of the items listed. No taxes or service charges are applied or itemised.',
    MARGIN,
    doc.y,
    { width: contentWidth },
  );

  if (receipt.prices_reconstructed) {
    doc.moveDown(0.4);
    doc.fillColor('#b45309').text(
      'This order predates itemised price records. Prices shown were reconstructed from the menu and may differ from the amount charged.',
      MARGIN,
      doc.y,
      { width: contentWidth },
    );
  }

  doc.end();
  return done;
}
