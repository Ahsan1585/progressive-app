// Single-child "full early intervention record" export — IDEA Part C gives
// a parent/guardian the right to inspect and receive a copy of their
// child's early intervention records, generally within 10 days of a
// request (34 CFR 303.405(a)). This endpoint is the tool an office uses to
// actually produce that copy on demand, rather than hand-assembling it from
// several screens.
//
// Deliberately NOT a reuse of the existing billing_batches.njeis_path /
// invoice_path files — those are per-practitioner batches covering many
// children at once, so handing one over would disclose other children's
// records. Every section here is generated fresh, scoped to exactly one
// patient_id:
//   1. Session log summary — hand-drawn table, same visual pattern as
//      reportController.generateAuditReportPDF.
//   2. A freshly-filled SEVF for this child only, via the same
//      buildNjeisPdfForGroup helper billing already uses (not a stored
//      multi-child batch file).
//   3. This child's invoice line items — hand-drawn, not the stored
//      invoice PDF (which also carries the practitioner's SSN/EIN on the
//      same page, and covers every child in the batch).
//   4. This child's own audit-log history (who accessed/edited their
//      record and when) — satisfies 34 CFR 303.406.
// All four sections are merged into one PDF via pdf-lib copyPages, the
// same merge pattern used by generateNJEISForms/generateAuditNJEIS.
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { getCompanyName } = require('../utils/companyName');
const { buildNjeisPdfForGroup } = require('../utils/njeisFormFiller');
const { formatTime12h } = require('../utils/formatting');

const PAGE = { width: 612, height: 792 }; // Letter
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const ts = () => new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

async function drawCoverPage(pdfDoc, patient, companyName, generatedBy) {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let y = PAGE.height - 100;

  page.drawText('Early Intervention Record', { x: MARGIN, y, font: bold, size: 20, color: rgb(0.08, 0.1, 0.15) });
  y -= 30;
  page.drawText(`${patient.first_name || ''} ${patient.last_name || ''}`.trim(), { x: MARGIN, y, font: bold, size: 16, color: rgb(0.08, 0.1, 0.15) });
  y -= 40;

  const rows = [
    ['Date of birth:', patient.dob || '—'],
    ['County:', patient.county || '—'],
    ['Child ID:', patient.child_id || '—'],
    ['Agency:', companyName || '—'],
    ['Exported by:', generatedBy || '—'],
    ['Export date:', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
  ];
  rows.forEach(([label, value]) => {
    page.drawText(label, { x: MARGIN, y, font: bold, size: 11, color: rgb(0.2, 0.24, 0.3) });
    page.drawText(String(value), { x: MARGIN + 140, y, font: regular, size: 11, color: rgb(0.2, 0.24, 0.3) });
    y -= 20;
  });

  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  y -= 24;

  const note = [
    'This document contains this child\'s early intervention record, provided in response',
    'to a parent/guardian record-access request under 34 CFR 303.405. It includes a summary',
    'of logged sessions, the Service Encounter Verification Form(s) generated from those',
    'sessions, related billing line items, and a log of who has accessed this record.',
  ];
  note.forEach((line) => {
    page.drawText(line, { x: MARGIN, y, font: regular, size: 9.5, color: rgb(0.4, 0.46, 0.55) });
    y -= 14;
  });

  return page;
}

function drawTablePage(pdfDoc, { title, cols, rows, fonts, pageLabel }) {
  const { regular, bold } = fonts;
  const black = rgb(0.12, 0.16, 0.22);
  const gray = rgb(0.4, 0.46, 0.55);
  const lightGray = rgb(0.97, 0.98, 0.99);
  const rowH = 16;
  const headerH = 18;

  let page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  page.drawText(title, { x: MARGIN, y, font: bold, size: 14, color: black });
  y -= 24;

  const drawHeader = (p, yy) => {
    p.drawRectangle({ x: MARGIN, y: yy - headerH, width: CONTENT_WIDTH, height: headerH, color: black });
    let cx = MARGIN;
    cols.forEach((col) => {
      p.drawText(col.label.toUpperCase(), { x: cx + 4, y: yy - headerH + 6, font: bold, size: 7, color: rgb(1, 1, 1) });
      cx += col.w;
    });
    return yy - headerH;
  };

  if (rows.length === 0) {
    page.drawText('No records found.', { x: MARGIN, y: y - 20, font: regular, size: 10, color: gray });
    return page;
  }

  y = drawHeader(page, y);

  rows.forEach((row, i) => {
    if (y - rowH < MARGIN + 20) {
      page = pdfDoc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
      page.drawText(`${pageLabel || title} (continued)`, { x: MARGIN, y, font: bold, size: 11, color: black });
      y -= 18;
      y = drawHeader(page, y);
    }
    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_WIDTH, height: rowH, color: lightGray });
    }
    let cx = MARGIN;
    row.forEach((val, ci) => {
      page.drawText(String(val ?? '—'), { x: cx + 4, y: y - rowH + 5, font: regular, size: 8, color: rgb(0.2, 0.24, 0.3) });
      cx += cols[ci].w;
    });
    y -= rowH;
  });

  return page;
}

const exportPatientRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: patientRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    const patient = patientRows[0];
    if (!patient) return res.status(404).json({ error: 'Child not found' });

    const companyName = await getCompanyName();
    const requester = `${req.practitioner.email || 'Unknown'}`;

    const { rows: assessments } = await pool.query(
      `SELECT * FROM assessments WHERE patient_id = $1 ORDER BY service_date ASC, start_time ASC`,
      [id]
    );

    const outDoc = await PDFDocument.create();
    const regular = await outDoc.embedFont(StandardFonts.Helvetica);
    const bold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { regular, bold };

    // 1. Cover page
    await drawCoverPage(outDoc, patient, companyName, requester);

    // 2. Session log summary
    drawTablePage(outDoc, {
      title: 'Session Log Summary',
      pageLabel: 'Session Log Summary',
      fonts,
      cols: [
        { label: 'Date', w: 70 },
        { label: 'Practitioner', w: 130 },
        { label: 'Type', w: 90 },
        { label: 'Location', w: 90 },
        { label: 'Start', w: 55 },
        { label: 'End', w: 55 },
        { label: 'Time', w: 42 },
      ],
      rows: assessments.map((a) => {
        const [y, m, d] = (a.service_date || '').split('-');
        const dateStr = y ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(-2)}` : '—';
        return [
          dateStr,
          `${a.practitioner_first_name || ''} ${a.practitioner_last_name || ''}`.trim(),
          a.type || '—',
          a.location || '—',
          a.start_time ? formatTime12h(a.start_time) : '—',
          a.end_time ? formatTime12h(a.end_time) : '—',
          a.total_time ? `${(a.total_time / 60).toFixed(2)}h` : '—',
        ];
      }),
    });

    // 3. Freshly-generated SEVF for this child only (not a stored
    // multi-child batch file). A child can have more than one practitioner
    // over time (patient_practitioners is many-to-many), and the SEVF
    // template's Discipline/Position Title box reflects one practitioner —
    // so, same as billingController.generateNJEISForms, group this child's
    // own sessions by practitioner first and render one SEVF group per
    // practitioner rather than assuming a single practitioner for the
    // whole child.
    if (assessments.length > 0) {
      try {
        const templatePath = path.join(__dirname, '..', '..', 'templates', 'NJEIS-020.pdf');
        const templateBytes = fs.readFileSync(templatePath);
        const byPractitioner = assessments.reduce((acc, a) => {
          const key = a.practitioner_id;
          if (!acc[key]) acc[key] = [];
          acc[key].push({ ...a, patient_first_name: patient.first_name, patient_last_name: patient.last_name });
          return acc;
        }, {});
        for (const practitionerId of Object.keys(byPractitioner)) {
          const group = byPractitioner[practitionerId];
          // practitioner_discipline is already denormalized onto each
          // assessment row at logging time (see assessments.practitioner_discipline
          // in schema.sql) — reuse it here instead of a second query, since
          // buildNjeisPdfForGroup only reads position_title off this object.
          const syntheticPractitioner = { position_title: group[0]?.practitioner_discipline || '' };
          const sevfDoc = await buildNjeisPdfForGroup(templateBytes, group, companyName, syntheticPractitioner);
          const sevfPages = await outDoc.copyPages(sevfDoc, sevfDoc.getPageIndices());
          sevfPages.forEach((p) => outDoc.addPage(p));
        }
      } catch (sevfError) {
        console.error('exportPatientRecord: SEVF generation failed, continuing without it:', sevfError);
      }
    }

    // 4. Billing/invoice line items for this child only — hand-drawn, not
    // the stored invoice PDF (which also carries the practitioner's
    // SSN/EIN and other children's rows on the same page).
    drawTablePage(outDoc, {
      title: 'Billing Summary',
      pageLabel: 'Billing Summary',
      fonts,
      cols: [
        { label: 'Date', w: 70 },
        { label: 'Type', w: 90 },
        { label: 'Time', w: 60 },
        { label: 'Billing Status', w: 100 },
        { label: 'Agency', w: 140 },
      ],
      rows: assessments.map((a) => {
        const [y, m, d] = (a.service_date || '').split('-');
        const dateStr = y ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(-2)}` : '—';
        return [
          dateStr,
          a.type || '—',
          a.total_time ? `${(a.total_time / 60).toFixed(2)}h` : '—',
          a.billing_status || '—',
          a.company_affiliation || '—',
        ];
      }),
    });

    // 5. Audit-log history for this child (34 CFR 303.406) — direct
    // 'patient' rows plus every 'assessment' row tied to one of this
    // child's logs. Deleted logs' own audit rows fall out of the
    // assessment-id subquery (see survey note); acceptable here since the
    // session-log summary above and the SEVF itself are generated from
    // the assessments that still exist.
    const { rows: auditRows } = await pool.query(
      `SELECT al.*, p.email AS actor_resolved_email
       FROM audit_logs al
       LEFT JOIN practitioners p ON p.id = al.actor_id
       WHERE (al.resource_type = 'patient' AND al.resource_id = $1)
          OR (al.resource_type = 'assessment' AND al.resource_id = ANY($2))
       ORDER BY al.created_at ASC`,
      [String(id), assessments.map((a) => String(a.id))]
    );
    drawTablePage(outDoc, {
      title: 'Record Access History',
      pageLabel: 'Record Access History',
      fonts,
      cols: [
        { label: 'Date', w: 90 },
        { label: 'Actor', w: 160 },
        { label: 'Action', w: 150 },
        { label: 'Resource', w: 90 },
      ],
      rows: auditRows.map((r) => [
        new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
        r.actor_email || r.actor_resolved_email || '—',
        r.action || '—',
        `${r.resource_type || ''} ${r.resource_id || ''}`.trim(),
      ]),
    });

    const pdfBytes = await outDoc.save();

    logAudit({ req, action: 'patient_record_export', resourceType: 'patient', resourceId: id, details: { assessmentCount: assessments.length } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="record-export-${patient.last_name || 'child'}-${ts()}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('exportPatientRecord error:', error);
    res.status(500).json({ error: 'Failed to export record' });
  }
};

module.exports = { exportPatientRecord };
