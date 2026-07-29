const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const NAVY = rgb(0x13 / 255, 0x2A / 255, 0x3E / 255);
const TEAL = rgb(0x0E / 255, 0x6E / 255, 0x67 / 255);
const SLATE = rgb(0x5C / 255, 0x6B / 255, 0x73 / 255);
const LINE = rgb(0xE2 / 255, 0xEA / 255, 0xE8 / 255);
const PAPER = rgb(0xF7 / 255, 0xFA / 255, 0xF9 / 255);
const AMBER = rgb(0xC8 / 255, 0x89 / 255, 0x0B / 255);
const AMBER_BG = rgb(0xFD / 255, 0xF3 / 255, 0xDC / 255);
const RED = rgb(0xB9 / 255, 0x1C / 255, 0x1C / 255);
const RED_BG = rgb(0xFE / 255, 0xF2 / 255, 0xF2 / 255);

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const formatDate = (isoOrDate) => {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(`${isoOrDate}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const formatPeriod = (start, end) => {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  return `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })} – ${e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
};

const STATUS_LABEL = { paid: 'PAID', pending: 'PENDING', failed: 'PAYMENT FAILED', void: 'VOID' };
const STATUS_COLOR = {
  paid: { fg: TEAL, bg: rgb(0xE7 / 255, 0xF7 / 255, 0xF3 / 255) },
  pending: { fg: AMBER, bg: AMBER_BG },
  failed: { fg: RED, bg: RED_BG },
  void: { fg: SLATE, bg: PAPER },
};

// Generates Izaya's own subscription-billing invoice (what the agency owes
// Izaya) as a standalone PDF — distinct from generateInvoicePDF in
// invoiceGenerator.js, which is the agency's pay invoice to a practitioner.
// No template AcroForm involved (unlike the NJEIS form filler); this is
// drawn from scratch since there's no state-issued layout to match.
async function generateSubscriptionInvoicePdf(invoice, companySettings) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter
  const { width, height } = page.getSize();
  const margin = 48;
  const contentWidth = width - margin * 2;

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'izaya-logo.png'));
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoDims = logoImage.scale(120 / logoImage.width);

  let y = height - margin;

  // ── Header: logo + tagline (left), INVOICE title + number/date (right) ──
  page.drawImage(logoImage, { x: margin, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
  page.drawText('EARLY INTERVENTION SIMPLIFIED', { x: margin, y: y - logoDims.height - 12, font: bold, size: 7, color: SLATE });

  const invoiceNumber = `SUB-${invoice.period_start.replace(/-/g, '').slice(0, 6)}`;
  const titleText = 'INVOICE';
  const titleW = bold.widthOfTextAtSize(titleText, 22);
  page.drawText(titleText, { x: margin + contentWidth - titleW, y: y - 18, font: bold, size: 22, color: NAVY });
  const numLabel = `No. ${invoiceNumber}`;
  const numW = regular.widthOfTextAtSize(numLabel, 10);
  page.drawText(numLabel, { x: margin + contentWidth - numW, y: y - 34, font: regular, size: 10, color: SLATE });
  const dateLabel = `Issued ${formatDate(invoice.created_at || new Date())}`;
  const dateW = regular.widthOfTextAtSize(dateLabel, 10);
  page.drawText(dateLabel, { x: margin + contentWidth - dateW, y: y - 48, font: regular, size: 10, color: SLATE });

  y -= 80;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 1, color: LINE });
  y -= 28;

  // ── From / To ──
  const colW = contentWidth / 2;
  page.drawText('FROM', { x: margin, y, font: bold, size: 8, color: SLATE });
  page.drawText('BILL TO', { x: margin + colW, y, font: bold, size: 8, color: SLATE });
  y -= 16;

  const fromLines = ['Izaya Consulting LLC', 'support@izayaedge.com', 'izayaedge.com'];
  const toLines = [
    companySettings?.legal_entity_name || companySettings?.display_name || 'Your Agency',
    companySettings?.address || '',
    companySettings?.phone || '',
    companySettings?.billing_email || '',
  ].filter(Boolean);

  const maxLines = Math.max(fromLines.length, toLines.length);
  for (let i = 0; i < maxLines; i++) {
    const isFirst = i === 0;
    if (fromLines[i]) page.drawText(fromLines[i], { x: margin, y, font: isFirst ? bold : regular, size: isFirst ? 11 : 10, color: isFirst ? NAVY : SLATE });
    if (toLines[i]) page.drawText(toLines[i], { x: margin + colW, y, font: isFirst ? bold : regular, size: isFirst ? 11 : 10, color: isFirst ? NAVY : SLATE });
    y -= 15;
  }

  y -= 12;

  // ── Status badge + billing period ──
  const statusKey = STATUS_LABEL[invoice.status] ? invoice.status : 'pending';
  const statusText = STATUS_LABEL[statusKey];
  const statusColors = STATUS_COLOR[statusKey];
  const statusW = bold.widthOfTextAtSize(statusText, 9);
  page.drawRectangle({ x: margin, y: y - 16, width: statusW + 20, height: 20, color: statusColors.bg });
  page.drawText(statusText, { x: margin + 10, y: y - 10, font: bold, size: 9, color: statusColors.fg });

  const periodText = `Billing Period: ${formatPeriod(invoice.period_start, invoice.period_end)}`;
  const periodW = regular.widthOfTextAtSize(periodText, 10);
  page.drawText(periodText, { x: margin + contentWidth - periodW, y: y - 11, font: regular, size: 10, color: SLATE });

  y -= 40;

  // ── Line items table ──
  const cols = [
    { label: 'DESCRIPTION', x: margin, w: contentWidth - 260 },
    { label: 'QTY', x: margin + contentWidth - 260, w: 70 },
    { label: 'RATE', x: margin + contentWidth - 190, w: 90 },
    { label: 'AMOUNT', x: margin + contentWidth - 100, w: 100 },
  ];

  page.drawRectangle({ x: margin, y: y - 22, width: contentWidth, height: 22, color: PAPER });
  cols.forEach((col) => page.drawText(col.label, { x: col.x + 6, y: y - 15, font: bold, size: 8, color: SLATE }));
  y -= 22;

  const drawRow = (description, qty, rate, amount) => {
    page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.5, color: LINE });
    y -= 20;
    page.drawText(description, { x: cols[0].x + 6, y, font: regular, size: 10, color: NAVY });
    page.drawText(String(qty), { x: cols[1].x + 6, y, font: regular, size: 10, color: NAVY });
    page.drawText(rate, { x: cols[2].x + 6, y, font: regular, size: 10, color: NAVY });
    const amountW = bold.widthOfTextAtSize(amount, 10);
    page.drawText(amount, { x: cols[3].x + cols[3].w - 6 - amountW, y, font: bold, size: 10, color: NAVY });
    y -= 8;
  };

  drawRow(
    'Active practitioners this period',
    invoice.active_practitioner_count,
    money(invoice.price_per_practitioner),
    money(invoice.practitioner_charge)
  );

  if (Number(invoice.extra_staff_seats) > 0) {
    drawRow(
      `Office staff seats beyond the included ${invoice.included_staff_seats}`,
      invoice.extra_staff_seats,
      money(invoice.extra_staff_seat_price),
      money(invoice.extra_staff_charge)
    );
  }

  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 1, color: NAVY });
  y -= 26;

  const totalLabel = 'TOTAL';
  page.drawText(totalLabel, { x: cols[2].x + 6, y, font: bold, size: 12, color: NAVY });
  const totalText = money(invoice.total_amount);
  const totalW = bold.widthOfTextAtSize(totalText, 14);
  page.drawText(totalText, { x: cols[3].x + cols[3].w - 6 - totalW, y: y - 1, font: bold, size: 14, color: TEAL });

  if (invoice.paid_at) {
    y -= 20;
    const paidText = `Paid ${formatDate(invoice.paid_at)}`;
    const paidW = regular.widthOfTextAtSize(paidText, 9);
    page.drawText(paidText, { x: cols[3].x + cols[3].w - 6 - paidW, y, font: regular, size: 9, color: SLATE });
  }

  // ── Terms footer ──
  const footerY = margin + 70;
  page.drawLine({ start: { x: margin, y: footerY + 30 }, end: { x: margin + contentWidth, y: footerY + 30 }, thickness: 0.5, color: LINE });
  page.drawText('A practitioner counts as active for the entire billing period the moment they submit one session log; charges are not prorated.', {
    x: margin, y: footerY + 12, font: regular, size: 8, color: SLATE,
  });
  page.drawText(`Office staff: the first ${invoice.included_staff_seats} seats are included at no extra cost; each additional seat is billed at ${money(invoice.extra_staff_seat_price)}/month.`, {
    x: margin, y: footerY, font: regular, size: 8, color: SLATE,
  });
  page.drawText('Questions about this invoice? support@izayaedge.com', { x: margin, y: footerY - 16, font: regular, size: 8, color: SLATE });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateSubscriptionInvoicePdf };
