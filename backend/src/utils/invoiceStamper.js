const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');

// Overlays a "PAID" watermark + paid date onto an existing single-page invoice PDF.
// Draws on every page in case a future invoice layout spans more than one.
const stampInvoicePaid = async (pdfBytes, paidAt) => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const paidDateLabel = new Date(paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();

    // Large diagonal watermark, centered
    const watermarkText = 'PAID';
    const watermarkSize = 120;
    const watermarkWidth = bold.widthOfTextAtSize(watermarkText, watermarkSize);
    page.drawText(watermarkText, {
      x: (width - watermarkWidth) / 2,
      y: height / 2 - watermarkSize / 3,
      size: watermarkSize,
      font: bold,
      color: rgb(0.75, 0.1, 0.1),
      opacity: 0.25,
      rotate: degrees(35),
    });

    // Small info box, top-right corner
    const boxW = 150;
    const boxH = 34;
    const boxX = width - 40 - boxW;
    const boxY = height - 40 - boxH;
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.75, 0.1, 0.1),
      borderWidth: 1.5,
    });
    page.drawText('PAID', { x: boxX + 8, y: boxY + 18, font: bold, size: 12, color: rgb(0.75, 0.1, 0.1) });
    page.drawText(paidDateLabel, { x: boxX + 8, y: boxY + 6, font: regular, size: 8, color: rgb(0.3, 0.3, 0.3) });
  }

  return Buffer.from(await pdfDoc.save());
};

module.exports = { stampInvoicePaid };
