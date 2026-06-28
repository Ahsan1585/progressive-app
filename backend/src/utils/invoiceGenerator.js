const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const generateInvoicePDF = async (practitioner, encounters) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size

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
  const tableTop = y;

  // Header background
  page.drawRectangle({ x: margin, y: tableTop - headerH, width: contentWidth, height: headerH, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0,0,0), borderWidth: 0.5 });

  let cx = margin;
  cols.forEach(col => {
    page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableTop - headerH }, thickness: 0.5, color: rgb(0,0,0) });
    page.drawText(col.label, { x: cx + 3, y: tableTop - headerH + 8, font: bold, size: 8, color: rgb(0,0,0) });
    cx += col.w;
  });
  page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableTop - headerH }, thickness: 0.5, color: rgb(0,0,0) });

  y = tableTop - headerH;

  // Data rows
  encounters.forEach(enc => {
    const vals = [
      String(enc.child_id   || ''),
      String(enc.county     || ''),
      String(enc.child_name || ''),
      String(enc.date       || ''),
      String(enc.total_hours || ''),
      String(enc.rate_of_pay || ''),
      'Y',
    ];

    page.drawRectangle({ x: margin, y: y - rowH, width: contentWidth, height: rowH, borderColor: rgb(0,0,0), borderWidth: 0.5 });

    cx = margin;
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

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

module.exports = { generateInvoicePDF };
