// Draws the practitioner-to-agency billing invoice. Pure layout only — no
// DB access, no decryption, no request-scoped label-cache reads. Every
// value it draws arrives already resolved via invoiceData.js, which is
// where that logic lives instead.
//
// Visual system reused from subscriptionInvoicePdf.js (Izaya's own
// subscription-billing invoice) — same color tokens, same FROM/BILL-TO
// block shape, same Letter page/margin conventions — so the two invoice
// types read as part of one family instead of two unrelated designs.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { summarizeInvoiceTotals } = require('./invoiceData');

const NAVY = rgb(0x13 / 255, 0x2A / 255, 0x3E / 255);
const TEAL = rgb(0x0E / 255, 0x6E / 255, 0x67 / 255);
const TEAL_BG = rgb(0xE7 / 255, 0xF7 / 255, 0xF3 / 255);
const SLATE = rgb(0x5C / 255, 0x6B / 255, 0x73 / 255);
const LINE = rgb(0xE2 / 255, 0xEA / 255, 0xE8 / 255);
const PAPER = rgb(0xF7 / 255, 0xFA / 255, 0xF9 / 255);
const AMBER = rgb(0xC8 / 255, 0x89 / 255, 0x0B / 255);
const AMBER_BG = rgb(0xFD / 255, 0xF3 / 255, 0xDC / 255);
const RED = rgb(0xB9 / 255, 0x1C / 255, 0x1C / 255);
const RED_BG = rgb(0xFE / 255, 0xF2 / 255, 0xF2 / 255);

const EIMS_TIER_STYLE = {
  cleared: { fg: TEAL, bg: TEAL_BG },
  pending: { fg: AMBER, bg: AMBER_BG },
  exception: { fg: RED, bg: RED_BG },
  unverified: { fg: SLATE, bg: PAPER },
};

const PAGE = { width: 612, height: 792 }; // Letter
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

// Reserved for invoiceStamper.js's "PAID" corner box, computed from that
// file's own math: boxX = width-40-90 = 482, boxY = height-40-22 = 730,
// so the box spans x:482-572, y:730-752 on every page. Nothing in this
// generator draws inside x >= 470, y >= 722 so the stamp never collides
// with the invoice-number/date block in the header.
const PAID_STAMP_CLEAR = { xMin: 470, yMin: 722 };

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const formatDate = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};
const formatShortDate = (dateStr) => {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).split('-');
  if (!y) return dateStr;
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(-2)}`;
};
const formatPeriod = (start, end) => {
  if (!start || !end) return '';
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
};

// pdf-lib's standard Helvetica can't encode characters outside WinAnsi
// (e.g. certain accented Latin characters, or any non-Latin script) and
// throws rather than silently dropping them — a single unusual name
// anywhere on a 100-line invoice would otherwise fail the whole PDF.
// Replaces anything outside the safe range with '?' rather than crashing.
const safeText = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '?');

// Truncates with an ellipsis so a long name/label can't overflow its
// column into the next one — the previous generator had no such guard.
const fitText = (text, font, size, maxW) => {
  const t = safeText(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let truncated = t;
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}…`, size) > maxW) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
};

// Embeds a company logo from its stored data: URL. Falls back to null
// (caller draws the brand name as text instead) for any type pdf-lib
// can't embed directly (svg, webp) or any decode failure — a malformed
// logo must never fail invoice generation.
async function embedLogo(pdfDoc, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
  try {
    const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
    const isPng = dataUrl.startsWith('data:image/png');
    if (!isJpeg && !isPng) return null;
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    const image = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    const maxW = 140;
    const maxH = 44;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    return { image, width: image.width * scale, height: image.height * scale };
  } catch (err) {
    console.error('invoiceGenerator: logo embed failed, falling back to text brand name:', err.message);
    return null;
  }
}

// maxW caps how wide the pill is allowed to grow (e.g. the EIMS column's
// available slack before the page's right margin) — a label too long for
// that cap shrinks its font down to a floor, then truncates with an
// ellipsis, rather than drawing past the cap and off the page edge the
// way a label like "Cancelled — not billed" once did.
function drawPill(page, { x, y, text, fonts, fg, bg, maxW }) {
  const { bold } = fonts;
  const padX = 7;
  let size = 7.5;
  let label = text.toUpperCase();
  if (maxW) {
    const floor = 5.5;
    while (size > floor && bold.widthOfTextAtSize(label, size) + padX * 2 > maxW) {
      size -= 0.5;
    }
    if (bold.widthOfTextAtSize(label, size) + padX * 2 > maxW) {
      while (label.length > 1 && bold.widthOfTextAtSize(`${label}…`, size) + padX * 2 > maxW) {
        label = label.slice(0, -1);
      }
      label = `${label}…`;
    }
  }
  const textW = bold.widthOfTextAtSize(label, size);
  const w = textW + padX * 2;
  const h = 14;
  page.drawRectangle({ x, y, width: w, height: h, color: bg });
  page.drawText(label, { x: x + padX, y: y + 4.5 - (7.5 - size) / 4, font: bold, size, color: fg });
  return w;
}

// ctx shape — see invoiceData.js and the invoice redesign plan for how
// each field is sourced:
//   mode: 'agency' | 'independent' | 'override'
//   invoice: { number, batchId, issuedAt, periodStart, periodEnd }
//   brand:   { name, logoDataUrl, contactLine }
//   from:    { title, name, lines: string[] }
//   billTo:  { title, name, lines: string[] }
//   details: { discipline, taxIdMasked, processedBy }
//   certificationParty: string
//   lines: InvoiceLine[]
//   warnings: string[]
async function generateInvoicePDF(ctx) {
  const { mode, invoice, brand, from, billTo, details, certificationParty, lines, warnings = [] } = ctx;

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const logo = await embedLogo(pdfDoc, brand.logoDataUrl);

  let page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  // ── Header: brand left, invoice identity right ──
  const headerTopY = y;
  if (logo) {
    page.drawImage(logo.image, { x: MARGIN, y: headerTopY - logo.height, width: logo.width, height: logo.height });
    page.drawText(fitText(brand.name, bold, 11, 220), { x: MARGIN, y: headerTopY - logo.height - 14, font: bold, size: 11, color: NAVY });
  } else {
    page.drawText(fitText(brand.name, bold, 16, 260), { x: MARGIN, y: headerTopY - 16, font: bold, size: 16, color: NAVY });
  }
  if (brand.contactLine) {
    const contactY = logo ? headerTopY - logo.height - 28 : headerTopY - 30;
    page.drawText(fitText(brand.contactLine, regular, 8, 300), { x: MARGIN, y: contactY, font: regular, size: 8, color: SLATE });
  }

  if (mode === 'override') {
    const ribbonText = 'OVERRIDE INVOICE — declined/returned sessions approved by admin';
    const ribbonY = headerTopY - (logo ? logo.height + 44 : 46);
    page.drawRectangle({ x: MARGIN, y: ribbonY - 14, width: 330, height: 16, color: RED_BG });
    page.drawText(ribbonText, { x: MARGIN + 6, y: ribbonY - 10, font: bold, size: 7, color: RED });
  }

  const titleText = 'INVOICE';
  const titleW = bold.widthOfTextAtSize(titleText, 20);
  page.drawText(titleText, { x: MARGIN + CONTENT_WIDTH - titleW, y: headerTopY - 16, font: bold, size: 20, color: NAVY });

  const metaLines = [
    `No. ${invoice.number}`,
    `Issued ${formatDate(invoice.issuedAt)}`,
    invoice.periodStart ? `Service period ${formatPeriod(invoice.periodStart, invoice.periodEnd)}` : null,
  ].filter(Boolean);
  let metaY = headerTopY - 30;
  metaLines.forEach((line) => {
    const w = regular.widthOfTextAtSize(line, 8.5);
    page.drawText(line, { x: MARGIN + CONTENT_WIDTH - w, y: metaY, font: regular, size: 8.5, color: SLATE });
    metaY -= 12;
  });

  const pillStyle = mode === 'override' ? { label: 'OVERRIDE', fg: RED, bg: RED_BG } : { label: 'ISSUED', fg: TEAL, bg: TEAL_BG };
  const pillW = bold.widthOfTextAtSize(pillStyle.label, 8) + 20;
  drawPill(page, { x: MARGIN + CONTENT_WIDTH - pillW, y: metaY - 2, text: pillStyle.label, fonts, fg: pillStyle.fg, bg: pillStyle.bg });

  y = headerTopY - 82;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: LINE });
  y -= 24;

  // ── FROM / BILL TO / DETAILS ──
  const colW = CONTENT_WIDTH / 3;
  const triCols = [
    { x: MARGIN, title: from.title, name: from.name, lines: from.lines },
    { x: MARGIN + colW, title: billTo.title, name: billTo.name, lines: billTo.lines },
    {
      x: MARGIN + colW * 2,
      title: 'DETAILS',
      name: null,
      lines: [
        details.discipline ? `Discipline: ${details.discipline}` : null,
        details.taxIdMasked ? `Tax ID: ${details.taxIdMasked}` : null,
        details.processedBy ? `Processed by: ${details.processedBy}` : null,
      ].filter(Boolean),
    },
  ];

  const triTopY = y;
  triCols.forEach((col) => {
    page.drawText(col.title, { x: col.x, y: triTopY, font: bold, size: 7.5, color: SLATE });
  });
  let triY = triTopY - 16;
  const maxTriLines = Math.max(...triCols.map((c) => (c.name ? 1 : 0) + c.lines.length));
  for (let i = 0; i < maxTriLines; i++) {
    triCols.forEach((col) => {
      const isNameRow = col.name && i === 0;
      const text = isNameRow ? col.name : col.lines[col.name ? i - 1 : i];
      if (text) {
        page.drawText(fitText(text, isNameRow ? bold : regular, isNameRow ? 10.5 : 9, colW - 14), {
          x: col.x, y: triY, font: isNameRow ? bold : regular, size: isNameRow ? 10.5 : 9, color: isNameRow ? NAVY : SLATE,
        });
      }
    });
    triY -= 14;
  }
  y = triY - 10;

  // ── Summary tiles ──
  const distinctChildren = new Set(lines.map((l) => l.childId || l.childName)).size;
  const { totalHours, totalDue, totalHeld } = summarizeInvoiceTotals(lines);
  const tiles = [
    { label: 'Sessions', value: String(lines.length) },
    { label: 'Children served', value: String(distinctChildren) },
    { label: 'Total hours', value: totalHours.toFixed(2) },
    { label: 'Due now (cleared)', value: money(totalDue) },
  ];
  const tileW = CONTENT_WIDTH / tiles.length;
  const tileH = 38;
  tiles.forEach((t, i) => {
    const tx = MARGIN + tileW * i;
    page.drawRectangle({ x: tx, y: y - tileH, width: tileW - 1, height: tileH, color: PAPER });
    const valW = bold.widthOfTextAtSize(t.value, 15);
    page.drawText(t.value, { x: tx + (tileW - 1 - valW) / 2, y: y - 20, font: bold, size: 15, color: NAVY });
    const lblW = regular.widthOfTextAtSize(t.label.toUpperCase(), 6.5);
    page.drawText(t.label.toUpperCase(), { x: tx + (tileW - 1 - lblW) / 2, y: y - tileH + 8, font: regular, size: 6.5, color: SLATE });
  });
  y -= tileH + 14;

  // ── Exceptions callout ──
  // A manually-"Allow"-ed field mismatch (deriveEimsStatus's 'Exception'
  // label) stays tier:'cleared' — it's still payable — so the tier check
  // alone wouldn't surface it here; checked by label explicitly so a human
  // override is still visible as something worth a second look, even
  // though it isn't held back from payment.
  const exceptionLines = lines.filter((l) => l.eims.tier !== 'cleared' || l.eims.label === 'Exception' || l.anomalies.length > 0);
  if (exceptionLines.length > 0 || warnings.length > 0) {
    const shown = exceptionLines.slice(0, 5);
    const extra = exceptionLines.length - shown.length;
    const calloutLines = [
      ...shown.map((l) => `${formatShortDate(l.serviceDate)} · ${fitText(l.childName, regular, 8, 160)} · ${l.eims.note || l.eims.label}`),
      extra > 0 ? `+${extra} more, see EIMS column` : null,
      ...warnings,
    ].filter(Boolean);
    const calloutH = 16 + calloutLines.length * 11;
    page.drawRectangle({ x: MARGIN, y: y - calloutH, width: CONTENT_WIDTH, height: calloutH, color: AMBER_BG });
    const headerText = exceptionLines.length > 0
      ? `${exceptionLines.length} session${exceptionLines.length === 1 ? '' : 's'} held back (${money(totalHeld)}) — not included in Total Due until verified`
      : 'Review before payment';
    page.drawText(headerText, { x: MARGIN + 8, y: y - 13, font: bold, size: 8.5, color: rgb(0.4, 0.3, 0) });
    let calloutY = y - 24;
    calloutLines.forEach((line) => {
      page.drawText(fitText(line, regular, 7.5, CONTENT_WIDTH - 16), { x: MARGIN + 8, y: calloutY, font: regular, size: 7.5, color: rgb(0.47, 0.35, 0) });
      calloutY -= 11;
    });
    y -= calloutH + 12;
  }

  // ── Itemized table ──
  // EIMS column widened to 64pt to actually fit its short-word labels
  // (verified against pdf-lib's own widthOfTextAtSize at 7.5pt bold — the
  // longest, "Self-reported", needs ~62pt including pill padding); the
  // extra 18pt is reclaimed from Service and Time, which had slack.
  const cols = [
    { label: 'Date', w: 48 },
    { label: 'Child', w: 112 },
    { label: 'Service', w: 118 },
    { label: 'Time', w: 68 },
    { label: 'Hrs', w: 34, num: true },
    { label: 'Rate', w: 42, num: true },
    { label: 'Amount', w: 46, num: true },
    { label: 'EIMS', w: 64 },
  ];
  const rowH = 26;
  const headerH = 16;

  const drawTableHeader = (pg, yy) => {
    pg.drawRectangle({ x: MARGIN, y: yy - headerH, width: CONTENT_WIDTH, height: headerH, color: NAVY });
    let cx = MARGIN;
    cols.forEach((col) => {
      pg.drawText(col.label.toUpperCase(), { x: cx + 4, y: yy - headerH + 5, font: bold, size: 7, color: rgb(1, 1, 1) });
      cx += col.w;
    });
    return yy - headerH;
  };

  y = drawTableHeader(page, y);

  lines.forEach((line, i) => {
    if (y - rowH < MARGIN + 40) {
      page = pdfDoc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
      page.drawText(`${invoice.number} · ${from.name}`, { x: MARGIN, y, font: regular, size: 8, color: SLATE });
      y -= 16;
      y = drawTableHeader(page, y);
    }
    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: PAPER });
    }

    const ln1Y = y - 10;
    const ln2Y = y - 20;
    let cx = MARGIN;

    // Date
    page.drawText(formatShortDate(line.serviceDate), { x: cx + 4, y: ln1Y, font: regular, size: 8, color: NAVY });
    page.drawText(`#${line.assessmentId}`, { x: cx + 4, y: ln2Y, font: regular, size: 6.8, color: SLATE });
    cx += cols[0].w;

    // Child
    page.drawText(fitText(line.childName, regular, 8, cols[1].w - 8), { x: cx + 4, y: ln1Y, font: regular, size: 8, color: NAVY });
    page.drawText(fitText(`ID ${line.childId} · ${line.county}`, regular, 6.8, cols[1].w - 8), { x: cx + 4, y: ln2Y, font: regular, size: 6.8, color: SLATE });
    cx += cols[1].w;

    // Service
    page.drawText(fitText(line.serviceLabel, regular, 8, cols[2].w - 8), { x: cx + 4, y: ln1Y, font: regular, size: 8, color: NAVY });
    page.drawText(fitText(`${line.locationLabel} · ${line.groupSizeLabel}`, regular, 6.8, cols[2].w - 8), { x: cx + 4, y: ln2Y, font: regular, size: 6.8, color: SLATE });
    cx += cols[2].w;

    // Time + anomaly
    page.drawText(fitText(line.timeLabel || '—', regular, 8, cols[3].w - 8), { x: cx + 4, y: ln1Y, font: regular, size: 8, color: NAVY });
    if (line.anomalies.length > 0) {
      page.drawText(fitText(line.anomalies[0], regular, 6.8, cols[3].w - 8), { x: cx + 4, y: ln2Y, font: regular, size: 6.8, color: RED });
    }
    cx += cols[3].w;

    // Hrs (right-aligned)
    const hrsText = line.hours.toFixed(2);
    const hrsW = regular.widthOfTextAtSize(hrsText, 8);
    page.drawText(hrsText, { x: cx + cols[4].w - 4 - hrsW, y: ln1Y, font: regular, size: 8, color: NAVY });
    cx += cols[4].w;

    // Rate (right-aligned)
    const rateText = money(line.rate);
    const rateW = regular.widthOfTextAtSize(rateText, 8);
    page.drawText(rateText, { x: cx + cols[5].w - 4 - rateW, y: ln1Y, font: regular, size: 8, color: NAVY });
    cx += cols[5].w;

    // Amount (right-aligned, bold)
    const amtText = money(line.lineTotal);
    const amtW = bold.widthOfTextAtSize(amtText, 8);
    page.drawText(amtText, { x: cx + cols[6].w - 4 - amtW, y: ln1Y, font: bold, size: 8, color: NAVY });
    cx += cols[6].w;

    // EIMS pill — capped to the remaining space to the page's right
    // margin (not just the nominal 46pt column) so a long label shrinks
    // or truncates instead of running off the page edge.
    // 'Exception' is tier:'cleared' (still payable) but should never look
    // identical to a genuine untouched 'Matched' line — styled amber
    // (same as 'pending'/Mismatch) instead of the tier's teal.
    const style = line.eims.label === 'Exception'
      ? EIMS_TIER_STYLE.pending
      : (EIMS_TIER_STYLE[line.eims.tier] || EIMS_TIER_STYLE.unverified);
    const eimsPillMaxW = MARGIN + CONTENT_WIDTH - (cx + 2) - 2;
    drawPill(page, { x: cx + 2, y: y - 18, text: line.eims.label, fonts, fg: style.fg, bg: style.bg, maxW: eimsPillMaxW });

    y -= rowH;
  });

  // ── Totals (2-column) — fit check before drawing totals + certification together ──
  const neededBottomH = 295;
  if (y - neededBottomH < MARGIN) {
    page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  } else {
    y -= 18;
  }

  const hoursByService = {};
  const hoursByCounty = {};
  lines.forEach((l) => {
    hoursByService[l.serviceLabel] = (hoursByService[l.serviceLabel] || 0) + l.hours;
    const county = l.county || 'UNSPECIFIED';
    hoursByCounty[county] = (hoursByCounty[county] || 0) + l.hours;
  });

  const leftColW = 300;
  const rightColX = MARGIN + leftColW + 16;
  const rightColW = CONTENT_WIDTH - leftColW - 16;

  let leftY = y;
  page.drawText('HOURS BY SERVICE TYPE', { x: MARGIN, y: leftY, font: bold, size: 7.5, color: SLATE });
  leftY -= 14;
  Object.keys(hoursByService).sort().forEach((label) => {
    page.drawText(fitText(label, regular, 8.5, leftColW - 60), { x: MARGIN, y: leftY, font: regular, size: 8.5, color: NAVY });
    const hrsText = `${hoursByService[label].toFixed(2)} hrs`;
    const hrsW = bold.widthOfTextAtSize(hrsText, 8.5);
    page.drawText(hrsText, { x: MARGIN + leftColW - hrsW, y: leftY, font: bold, size: 8.5, color: NAVY });
    leftY -= 13;
  });
  leftY -= 10;
  page.drawText('HOURS BY COUNTY', { x: MARGIN, y: leftY, font: bold, size: 7.5, color: SLATE });
  leftY -= 14;
  Object.keys(hoursByCounty).sort().forEach((county) => {
    page.drawText(county, { x: MARGIN, y: leftY, font: regular, size: 8.5, color: NAVY });
    const hrsText = `${hoursByCounty[county].toFixed(2)} hrs`;
    const hrsW = bold.widthOfTextAtSize(hrsText, 8.5);
    page.drawText(hrsText, { x: MARGIN + leftColW - hrsW, y: leftY, font: bold, size: 8.5, color: NAVY });
    leftY -= 13;
  });

  const tierOrder = ['cleared', 'pending', 'exception', 'unverified'];
  const tierLabel = { cleared: 'Cleared for payment', pending: 'Pending verification', exception: 'Exceptions', unverified: 'Not verified' };
  let rightY = y;
  page.drawText('PAYMENT BREAKDOWN', { x: rightColX, y: rightY, font: bold, size: 7.5, color: SLATE });
  rightY -= 16;
  tierOrder.forEach((tier) => {
    const tierLines = lines.filter((l) => l.eims.tier === tier);
    if (tierLines.length === 0) return;
    const tierSum = tierLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const style = EIMS_TIER_STYLE[tier];
    page.drawRectangle({ x: rightColX, y: rightY - 3, width: 5, height: 5, color: style.fg });
    page.drawText(`${tierLabel[tier]} (${tierLines.length})`, { x: rightColX + 10, y: rightY - 5, font: regular, size: 8.5, color: NAVY });
    const amtText = money(tierSum);
    const amtW = bold.widthOfTextAtSize(amtText, 8.5);
    page.drawText(amtText, { x: rightColX + rightColW - amtW, y: rightY - 5, font: bold, size: 8.5, color: NAVY });
    rightY -= 15;
  });
  rightY -= 4;
  page.drawLine({ start: { x: rightColX, y: rightY }, end: { x: rightColX + rightColW, y: rightY }, thickness: 1.2, color: NAVY });
  rightY -= 16;
  page.drawText('Total hours (all sessions)', { x: rightColX, y: rightY, font: regular, size: 8.5, color: NAVY });
  const totalHrsText = totalHours.toFixed(2);
  const totalHrsW = regular.widthOfTextAtSize(totalHrsText, 8.5);
  page.drawText(totalHrsText, { x: rightColX + rightColW - totalHrsW, y: rightY, font: regular, size: 8.5, color: NAVY });
  rightY -= 13;
  if (totalHeld > 0) {
    page.drawText('Held pending verification', { x: rightColX, y: rightY, font: regular, size: 8.5, color: AMBER });
    const heldText = money(totalHeld);
    const heldW = regular.widthOfTextAtSize(heldText, 8.5);
    page.drawText(heldText, { x: rightColX + rightColW - heldW, y: rightY, font: regular, size: 8.5, color: AMBER });
    rightY -= 13;
  }
  rightY -= 7;
  page.drawText('TOTAL DUE NOW', { x: rightColX, y: rightY, font: bold, size: 10, color: NAVY });
  const dueText = money(totalDue);
  const dueW = bold.widthOfTextAtSize(dueText, 14);
  page.drawText(dueText, { x: rightColX + rightColW - dueW, y: rightY - 1, font: bold, size: 14, color: TEAL });
  if (totalHeld > 0) {
    rightY -= 13;
    const footnote = 'Excludes sessions not yet cleared — reissue once verified.';
    page.drawText(footnote, { x: rightColX, y: rightY, font: regular, size: 6.8, color: SLATE });
  }

  y = Math.min(leftY, rightY) - 24;

  // ── Certification ──
  const certLines = [
    `I certify that the services listed above were provided as authorized in each child's Individualized Family Service Plan (IFSP), that the dates and hours reported are true and accurate, and that they comply with the contractual agreement between ${certificationParty || 'the agency'} and the New Jersey Department of Health, Early Intervention System (NJEIS).`,
    '',
    `I acknowledge that hours exceeding those authorized under that agreement may be declined for payment at the discretion of ${certificationParty || 'the agency'}.`,
  ];
  // Wrap each paragraph to the box width manually (pdf-lib has no built-in wrap).
  const certMaxW = CONTENT_WIDTH - 24;
  const wrapLine = (text, font, size, maxW) => {
    if (!text) return [''];
    const words = text.split(' ');
    const out = [];
    let cur = '';
    words.forEach((w) => {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    });
    if (cur) out.push(cur);
    return out;
  };
  const wrappedCert = certLines.flatMap((l) => wrapLine(l, regular, 8.3, certMaxW));
  const certBoxH = 40 + wrappedCert.length * 12 + 26;

  if (y - certBoxH < MARGIN) {
    page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  }

  page.drawRectangle({ x: MARGIN, y: y - certBoxH, width: CONTENT_WIDTH, height: certBoxH, borderColor: NAVY, borderWidth: 1.4 });
  const certTitle = "CLAIMANT'S CERTIFICATION";
  const certTitleW = bold.widthOfTextAtSize(certTitle, 9);
  page.drawText(certTitle, { x: MARGIN + (CONTENT_WIDTH - certTitleW) / 2, y: y - 16, font: bold, size: 9, color: NAVY });
  let certY = y - 32;
  wrappedCert.forEach((line) => {
    if (line) page.drawText(line, { x: MARGIN + 12, y: certY, font: regular, size: 8.3, color: rgb(0.24, 0.29, 0.33) });
    certY -= 12;
  });
  certY -= 8;
  page.drawText('Signature _______________________', { x: MARGIN + 12, y: certY, font: bold, size: 8.3, color: NAVY });
  page.drawText(`Printed name: ${safeText(from.name)}`, { x: MARGIN + 220, y: certY, font: bold, size: 8.3, color: NAVY });
  page.drawText('Date __________', { x: MARGIN + CONTENT_WIDTH - 100, y: certY, font: bold, size: 8.3, color: NAVY });

  // ── Footer: page numbers + batch ref (drawn last, once page count is known) ──
  const pages = pdfDoc.getPages();
  pages.forEach((pg, idx) => {
    pg.drawText(`Page ${idx + 1} of ${pages.length} · Batch ref ${invoice.batchId || 'pending'} · Generated by Izaya EIS`, {
      x: MARGIN, y: 24, font: regular, size: 6.5, color: SLATE,
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateInvoicePDF, PAID_STAMP_CLEAR };
