import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// pdfkit is excluded from the Lambda's esbuild bundle (see the `bundling`
// prop on ApiFunction in infra/lib/api-stack.ts) -- it resolves its
// standard fonts through Node's package "imports" field, which a
// single-file bundle breaks. Same reason the reports PDF exporter works.

export interface QrLabelInput {
  tableNumber: string;
  orderingUrl: string;
}

const PAGE_MARGIN = 28;
const COLS = 2;
const ROWS = 3;

/**
 * QR module size drives whether these actually scan once printed. At 150pt
 * the printed code is ~5.3cm square, which a phone reads comfortably from
 * across a table; much below ~3cm and it starts needing to be held close.
 * This is the reason the labels are generated server-side at a fixed size
 * rather than printed from the browser, where the page may be scaled.
 */
const QR_SIZE = 150;

/** Error correction M tolerates a little print smudging and still decodes. */
const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 0, width: 600 };

function drawCutGuides(doc: PDFKit.PDFDocument, cellW: number, cellH: number): void {
  doc.save().lineWidth(0.5).dash(4, { space: 3 }).strokeColor('#b8c0cc');

  for (let c = 1; c < COLS; c++) {
    const x = PAGE_MARGIN + c * cellW;
    doc.moveTo(x, PAGE_MARGIN).lineTo(x, PAGE_MARGIN + ROWS * cellH).stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    const y = PAGE_MARGIN + r * cellH;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + COLS * cellW, y).stroke();
  }

  doc.undash().restore();
}

/**
 * A sheet of cut-out QR labels, six to an A4 page.
 *
 * Deliberately monochrome: these get printed in bulk, often on whatever
 * printer the restaurant has, and black-on-white is both cheapest and the
 * highest-contrast option for a scanner.
 */
export async function renderQrLabelsPdf(
  restaurantName: string,
  labels: QrLabelInput[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const cellW = (doc.page.width - PAGE_MARGIN * 2) / COLS;
  const cellH = (doc.page.height - PAGE_MARGIN * 2) / ROWS;
  const perPage = COLS * ROWS;

  // Rendered up front rather than inside the layout loop: QRCode.toBuffer
  // is async, and awaiting mid-draw interleaves badly with pdfkit's
  // cursor-based API.
  const qrBuffers = await Promise.all(
    labels.map((label) => QRCode.toBuffer(label.orderingUrl, QR_OPTIONS)),
  );

  labels.forEach((label, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    if (slot === 0) drawCutGuides(doc, cellW, cellH);

    const col = slot % COLS;
    const row = Math.floor(slot / COLS);
    const x = PAGE_MARGIN + col * cellW;
    const y = PAGE_MARGIN + row * cellH;

    // Vertically centre the whole block (name + QR + number + hint) in its
    // cell so every label sits the same distance from its cut lines.
    const blockH = 16 + QR_SIZE + 10 + 22 + 14;
    let cursorY = y + (cellH - blockH) / 2;

    doc.fillColor('#111827').font('Helvetica').fontSize(11);
    doc.text(restaurantName, x, cursorY, { width: cellW, align: 'center', height: 14, ellipsis: true });
    cursorY += 16;

    doc.image(qrBuffers[i], x + (cellW - QR_SIZE) / 2, cursorY, { width: QR_SIZE, height: QR_SIZE });
    cursorY += QR_SIZE + 10;

    doc.font('Helvetica-Bold').fontSize(17);
    doc.text(`Table ${label.tableNumber}`, x, cursorY, {
      width: cellW,
      align: 'center',
      height: 20,
      ellipsis: true,
    });
    cursorY += 22;

    doc.font('Helvetica').fontSize(9).fillColor('#4b5563');
    doc.text('Scan to see the menu and order', x, cursorY, {
      width: cellW,
      align: 'center',
      height: 12,
    });
  });

  doc.end();
  return done;
}
