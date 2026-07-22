const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Converts a "YYYY-MM-DD" service_date into "MM-DD-YYYY" for display on the invoice.
const formatServiceDate = (dateStr) => {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  if (!y || !m || !d) return dateStr;
  return `${m.padStart(2, '0')}-${d.padStart(2, '0')}-${y}`;
};

const generateInvoicePDF = async (practitioner, encounters) => {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]); // Letter size

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 40;
  const contentWidth = width - margin * 2;
  let y = height - margin;

  // ── Title ──
  const title = 'BILLING INVOICE PROGRESSIVE STEPS';
  const titleW = bold.widthOfTextAtSize(title, 14);
  page.drawText(title, { x: (width - titleW) / 2, y, font: bold, size: 14, color: rgb(0,0,0) });
  y -= 30;

  // ── Info rows ──
  const drawInfoRow = (label, value) => {
    page.drawText(label, { x: margin, y, font: bold, size: 10, color: rgb(0,0,0) });
    page.drawText(value || '', { x: margin + 130, y, font: regular, size: 10, color: rgb(0,0,0) });
    page.drawLine({ start: { x: margin + 130, y: y - 2 }, end: { x: margin + contentWidth, y: y - 2 }, thickness: 0.5, color: rgb(0,0,0) });
    y -= 22;
  };

  drawInfoRow('Company Name:', 'Progressive Steps');
  drawInfoRow("Therapist's Name:", `${practitioner.first_name || ''} ${practitioner.last_name || ''}`);
  drawInfoRow('Address:', practitioner.address || '');
  drawInfoRow('Phone:', practitioner.phone_number || '');
  drawInfoRow('EIN/SSN #:', practitioner.ssn || '');
  y -= 8;

  // ── Therapy types ──
  const therapyLine = 'DI___    CDA___    OT___    PT___    ST___    SW___    IT___';
  const therapyW = bold.widthOfTextAtSize(therapyLine, 10);
  page.drawText(therapyLine, { x: (width - therapyW) / 2, y, font: bold, size: 10, color: rgb(0,0,0) });
  y -= 20;

  // ── Table ──
  const cols = [
    { label: 'Child ID#',      w: 58  },
    { label: 'County',         w: 68  },
    { label: "Child's Name",   w: 155 },
    { label: 'Service Date',   w: 72  },
    { label: 'Hours',          w: 55  },
    { label: 'Rate of Pay',    w: 62  },
    { label: 'EIMS (Y/N)',     w: 62  },
  ];

  const headerH = 24;
  const rowH    = 20;

  // Draws the column-header band at the current `y` and returns the y just
  // below it — pulled out so it can be re-drawn at the top of each new page
  // the data-row loop below spills onto.
  const drawTableHeader = () => {
    const tableTop = y;
    page.drawRectangle({ x: margin, y: tableTop - headerH, width: contentWidth, height: headerH, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0,0,0), borderWidth: 0.5 });

    let hx = margin;
    cols.forEach(col => {
      page.drawLine({ start: { x: hx, y: tableTop }, end: { x: hx, y: tableTop - headerH }, thickness: 0.5, color: rgb(0,0,0) });
      page.drawText(col.label, { x: hx + 3, y: tableTop - headerH + 8, font: bold, size: 8, color: rgb(0,0,0) });
      hx += col.w;
    });
    page.drawLine({ start: { x: hx, y: tableTop }, end: { x: hx, y: tableTop - headerH }, thickness: 0.5, color: rgb(0,0,0) });

    y = tableTop - headerH;
  };

  drawTableHeader();

  // Data rows — a batch can span 100+ logs, far more than one Letter page
  // holds. Start a fresh page (with the header repeated) whenever the next
  // row wouldn't fully fit above the bottom margin, instead of drawing rows
  // off the bottom of the page where they're generated but never visible.
  encounters.forEach(enc => {
    if (y - rowH < margin) {
      page = pdfDoc.addPage([612, 792]);
      y = height - margin;
      drawTableHeader();
    }

    const vals = [
      String(enc.child_id   || ''),
      String(enc.county     || ''),
      String(enc.child_name || ''),
      formatServiceDate(enc.date),
      String(enc.total_hours || ''),
      String(enc.rate_of_pay || ''),
      'Y',
    ];

    page.drawRectangle({ x: margin, y: y - rowH, width: contentWidth, height: rowH, borderColor: rgb(0,0,0), borderWidth: 0.5 });

    let cx = margin;
    vals.forEach((val, i) => {
      page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y - rowH }, thickness: 0.5, color: rgb(0,0,0) });
      page.drawText(val, { x: cx + 3, y: y - rowH + 6, font: regular, size: 9, color: rgb(0,0,0) });
      cx += cols[i].w;
    });
    page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y - rowH }, thickness: 0.5, color: rgb(0,0,0) });

    y -= rowH;
  });

  y -= 20;

  // ── Declaration box ──
  const declLines = [
    'I do solemnly declare and certify that all hours specified above have been previously',
    'approved by the IF-SP and are hereby in compliance with the contractual Agreement between',
    'Progressive Steps and the New Jersey Department of Health and Senior Services.',
    '',
    'Furthermore, I fully Accept and Acknowledge that any hours which may exceed the time',
    'allotted by said contractual agreement may not be presented for payment at the discretion',
    'of Progressive Steps.',
  ];

  const declBoxH = 145;
  if (y - declBoxH < margin) {
    // Same off-page problem as the data rows: a long invoice can leave too
    // little room on the last table page for the declaration box to fit.
    page = pdfDoc.addPage([612, 792]);
    y = height - margin;
  }
  page.drawRectangle({ x: margin, y: y - declBoxH, width: contentWidth, height: declBoxH, borderColor: rgb(0,0,0), borderWidth: 2 });

  const declTitle = "CLAIMANT'S CERTIFICATION AND DECLARATION";
  const declTitleW = bold.widthOfTextAtSize(declTitle, 11);
  page.drawText(declTitle, { x: (width - declTitleW) / 2, y: y - 16, font: bold, size: 11, color: rgb(0,0,0) });

  let declY = y - 32;
  declLines.forEach(line => {
    if (line) page.drawText(line, { x: margin + 6, y: declY, font: regular, size: 9, color: rgb(0,0,0) });
    declY -= 14;
  });

  page.drawText('Therapist Signature: _______________________', { x: margin + 6, y: y - declBoxH + 14, font: bold, size: 10, color: rgb(0,0,0) });
  page.drawText('Date: _______________', { x: margin + contentWidth - 145, y: y - declBoxH + 14, font: bold, size: 10, color: rgb(0,0,0) });

  // ── County hours / total amount summary ──
  // One flat rate applies to the whole invoice (a batch is always scoped to a
  // single practitioner), so the total is just total hours * that rate.
  const declBottomY = y - declBoxH;

  const countyTotals = {};
  encounters.forEach(enc => {
    const county = (enc.county || '').trim() || 'Unspecified';
    const hours = parseFloat(enc.total_hours) || 0;
    countyTotals[county] = (countyTotals[county] || 0) + hours;
  });
  const countyNames = Object.keys(countyTotals).sort();
  const totalHours = countyNames.reduce((sum, c) => sum + countyTotals[c], 0);
  const payRate = parseFloat(encounters[0]?.rate_of_pay) || 0;
  const totalAmount = totalHours * payRate;

  const summaryLineH = 16;
  const summaryNeededH = 20 + Math.max(countyNames.length, 2) * summaryLineH;

  let summaryPage = page;
  let summaryY;
  if (declBottomY - summaryNeededH < margin) {
    // Long invoice — the declaration box already runs close to the page edge,
    // so give the summary its own page instead of overlapping/overflowing.
    summaryPage = pdfDoc.addPage([612, 792]);
    summaryY = summaryPage.getSize().height - margin;
  } else {
    summaryY = declBottomY - 26;
  }

  summaryPage.drawText('HOURS:', { x: margin, y: summaryY, font: bold, size: 10, color: rgb(0,0,0) });
  summaryPage.drawText(`Total Hours: ${totalHours.toFixed(2)}`, { x: margin + 260, y: summaryY, font: bold, size: 10, color: rgb(0,0,0) });

  let rowY = summaryY - summaryLineH;
  countyNames.forEach((county, i) => {
    summaryPage.drawText(`${county}: ${countyTotals[county].toFixed(2)}`, { x: margin, y: rowY, font: regular, size: 10, color: rgb(0,0,0) });
    if (i === 0) {
      summaryPage.drawText(`Total Amount: $${totalAmount.toFixed(2)}`, { x: margin + 260, y: rowY, font: bold, size: 10, color: rgb(0,0,0) });
    }
    rowY -= summaryLineH;
  });
  // Only one county — the "Total Amount" line still needs to be drawn even
  // though the loop above only writes it alongside the first county row.
  if (countyNames.length === 0) {
    summaryPage.drawText(`Total Amount: $${totalAmount.toFixed(2)}`, { x: margin + 260, y: rowY, font: bold, size: 10, color: rgb(0,0,0) });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

module.exports = { generateInvoicePDF };
