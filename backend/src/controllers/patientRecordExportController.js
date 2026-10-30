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
//
// Gate (owner rule): with an active parent consent approving a full-record
// release (GET, findCoveringConsent) the response is THAT consent's
// disclosure packet (consentReportController.sendConsentPacket), since the
// consent names a third-party recipient. The complete parent copy built by
// buildFullRecordPdf (with access history, disclosures and consents on file)
// is produced only by the admin override (POST .../override: password, a
// reason, and a TOTP code when the admin has MFA enabled).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { pool } = require('../config/db');
const { decryptPatientRow, decryptAssessmentRow } = require('../utils/fieldEncryption');
const { logAudit } = require('../utils/auditLog');
const { getCompanyName, getCompanySettingsForDocuments } = require('../utils/companyName');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
const {
  formatInvoiceNumber, maskTaxId, formatPractitionerAddressLines, loadComplianceForLines, buildInvoiceLines, buildBrand,
} = require('../utils/invoiceData');
const { buildNjeisPdfForGroup } = require('../utils/njeisFormFiller');
const { formatTime12h } = require('../utils/formatting');
const { REDISCLOSURE_NOTICE } = require('../utils/emailClient');
const { isValidIntId } = require('../utils/consentValidation');
const { pdfSafeText, safeFilenamePart } = require('../utils/pdfText');
const { isMfaLocked, recordMfaFailure, consumeTotpCode } = require('../utils/mfaGuard');

const PAGE = { width: 612, height: 792 }; // Letter
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const ts = () => new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

// Plain-language labels for audit_logs.action — this export is handed to
// parents/guardians under a 34 CFR 303.405 access request, so raw action
// strings and internal row IDs (e.g. "patient_assessments_view" /
// "patient 85") have no place in it. Mirrors frontend/src/components/
// AuditLogViewer.jsx's ACTION_LABELS (kept separately since this runs
// server-side, with no access to frontend code), plus labels for the
// correction-request and record-export actions this feature itself adds.
const ACTION_LABELS = {
  login_success: 'Login',
  login_failed: 'Login failed',
  login_blocked_deactivated: 'Login blocked (deactivated)',
  patient_create: 'Record created',
  patient_update: 'Record updated',
  patient_status_update: 'Status changed',
  patient_delete: 'Record deleted',
  patient_attach: 'Added to practitioner caseload',
  patient_reassign: 'Practitioner reassigned',
  patient_assessments_view: 'Record viewed',
  patients_bulk_view: 'Roster viewed',
  log_create: 'Session logged',
  log_edit: 'Session log edited',
  log_delete: 'Session log deleted',
  log_void: 'Session log voided',
  log_comment_add: 'Comment added to session log',
  correction_request_create: 'Correction request logged',
  correction_request_accepted: 'Correction request accepted',
  correction_request_denied: 'Correction request denied',
  patient_record_export: 'Full record exported',
  sevf_emailed_to_agency: 'SEVF shared with agency (secure link)',
  shared_document_link_created: 'Secure document link created',
  shared_document_downloaded: 'Shared document downloaded by recipient',
  sevf_disclosure_blocked_no_consent: 'Disclosure blocked (no parental consent)',
  records_consent_granted: 'Consent recorded',
  records_consent_revoked: 'Consent revoked',
  consent_paper_recorded: 'Signed paper consent recorded',
  consent_request_created: 'Consent request sent to parent',
  consent_request_resent: 'Consent request re-sent to parent',
  consent_request_cancelled: 'Consent request cancelled',
  consent_signed_electronically: 'Consent signed electronically by parent',
  consent_signing_locked: 'Consent signing link locked (too many attempts)',
  // Preparing a consent-scoped packet is not the same as sending it; staff
  // hand it over themselves (consentReportController).
  consent_report_generated: 'Disclosure packet prepared',
  // In-app "Send records" (recordsReleaseController).
  records_release_sent: 'Records sent to recipient (secure link)',
  records_release_downloaded: 'Records downloaded by recipient',
  records_release_revoked: 'Records link revoked',
  records_consent_revoked_by_parent: 'Consent withdrawn by parent',
  consent_copy_downloaded_by_parent: 'Parent downloaded a copy of the consent',
  consent_scan_uploaded: 'Scan of paper consent attached',
  consent_scan_viewed: 'Scan of paper consent viewed',
  // Admin password-confirmed export with no covering consent (the reason is
  // appended by describeAuditRow).
  record_export_override: 'Full record exported with admin approval',
  record_export_override_failed: 'Admin approval for full record export failed',
};

// Reasons an admin may give for exporting the full record without a
// covering consent (POST /:id/record-export/override).
const OVERRIDE_REASON_LABELS = {
  parent_request: 'Parent request',
  internal_review: 'Internal review',
  audit: 'Audit',
  legal: 'Legal',
};
const OVERRIDE_RECIPIENT = 'Parent/guardian or agency';
// Only these override reasons put the record in someone else's hands, so only
// they belong in the parent-facing Record of Disclosures. internal_review and
// audit exports stay in the Record Access History (as admin-approved exports).
const OVERRIDE_DISCLOSURE_REASONS = new Set(['parent_request', 'legal']);

// Record of disclosures (34 CFR 99.32 / 303.406): every audit_logs row
// that represents this child's record leaving the system, with recipient,
// purpose, date and which records. Built from the same patient-scoped
// audit rows as the access-history table.
const DISCLOSURE_PURPOSE_FALLBACK = {
  sevf_emailed_to_agency: 'Billing / service verification',
  shared_document_downloaded: 'Recipient downloaded shared document',
  patient_record_export: 'Parent/guardian record access request',
  consent_report_generated: 'Disclosure under parental consent',
  records_release_sent: 'Disclosure under parental consent',
  records_release_downloaded: 'Disclosure under parental consent',
  record_export_override: 'Full record export approved by an administrator',
};

const parseDetails = (details) => {
  if (!details) return {};
  if (typeof details === 'object') return details;
  try { return JSON.parse(details); } catch { return {}; }
};

// Every string drawn with the standard (WinAnsi) fonts goes through
// pdfSafeText (utils/pdfText.js): pdf-lib throws on anything it cannot
// encode, so one 'Łukasz' or emoji would otherwise fail the whole export.

const formatAuditDate = (value) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function buildDisclosureRows(auditRows) {
  return (auditRows || [])
    .filter((r) => Object.prototype.hasOwnProperty.call(DISCLOSURE_PURPOSE_FALLBACK, r.action))
    .filter((r) => r.action !== 'record_export_override' || OVERRIDE_DISCLOSURE_REASONS.has(parseDetails(r.details).reason))
    .map((r) => {
      const d = parseDetails(r.details);
      if (r.action === 'consent_report_generated') {
        // details: { consentId, recordTypes, recipient, purpose } — worded as
        // "prepared", since generating the packet does not send it anywhere.
        const types = Array.isArray(d.recordTypes) ? d.recordTypes.map((t) => RECORD_TYPE_LABELS[t] || t) : [];
        return [
          formatAuditDate(r.created_at),
          pdfSafeText(`Disclosure packet prepared for ${d.recipient || '—'}`),
          pdfSafeText(d.purpose || DISCLOSURE_PURPOSE_FALLBACK.consent_report_generated),
          pdfSafeText(types.length ? types.join(', ') : '—'),
        ];
      }
      if (r.action === 'records_release_sent' || r.action === 'records_release_downloaded') {
        // details: { consentId, releaseId, recipient, recipientEmail?, recordTypes }
        const types = Array.isArray(d.recordTypes) ? d.recordTypes.map((t) => RECORD_TYPE_LABELS[t] || t) : [];
        const who = d.recipient || '—';
        const text = r.action === 'records_release_sent'
          ? `Records sent to ${d.recipientEmail ? `${who} <${d.recipientEmail}>` : who} (secure link)`
          : `Records downloaded by ${who}`;
        return [
          formatAuditDate(r.created_at),
          pdfSafeText(text),
          pdfSafeText(DISCLOSURE_PURPOSE_FALLBACK[r.action]),
          pdfSafeText(types.length ? types.join(', ') : '—'),
        ];
      }
      if (r.action === 'record_export_override') {
        // The admin's reason is the purpose of this disclosure.
        return [
          formatAuditDate(r.created_at),
          pdfSafeText(d.recipientName || OVERRIDE_RECIPIENT),
          pdfSafeText(OVERRIDE_REASON_LABELS[d.reason] || DISCLOSURE_PURPOSE_FALLBACK.record_export_override),
          pdfSafeText(Array.isArray(d.records) && d.records.length ? d.records.join(', ') : 'Full record'),
        ];
      }
      const name = d.recipientName && d.recipientName !== d.recipientEmail ? d.recipientName : null;
      const recipient = name && d.recipientEmail ? `${name} <${d.recipientEmail}>` : (name || d.recipientEmail || '—');
      const purpose = r.action === 'shared_document_downloaded'
        ? DISCLOSURE_PURPOSE_FALLBACK.shared_document_downloaded
        : (d.purpose || DISCLOSURE_PURPOSE_FALLBACK[r.action]);
      const records = Array.isArray(d.records) && d.records.length ? d.records.join(', ') : '—';
      return [formatAuditDate(r.created_at), pdfSafeText(recipient), pdfSafeText(purpose), pdfSafeText(records)];
    });
}

// Consents on file (34 CFR 99.30 / 303.414): every consent ever recorded
// for this child, with how it was given and whether it is still in force.
const RECORD_TYPE_LABELS = {
  session_logs: 'Session logs',
  sevf_forms: 'SEVF forms',
  invoices: 'Invoices',
  full_record_export: 'Full record',
};
const SOURCE_LABELS = { paper: 'Paper', electronic: 'Electronic' };
const NJ_TZ = 'America/New_York';

// A pg `date` (signed_on) arrives as a local-midnight Date or 'YYYY-MM-DD'.
function formatDateOnly(value) {
  if (!value) return '—';
  if (value instanceof Date) return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : '—';
}
// A timestamptz, shown as its New Jersey calendar date.
function formatTimestampDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { timeZone: NJ_TZ, month: 'numeric', day: 'numeric', year: 'numeric' });
}
const clip = (text, max) => {
  const s = pdfSafeText(text ?? '—');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function buildConsentRows(consents, now = new Date()) {
  return (consents || []).map((c) => {
    let status = 'Active';
    if (c.revoked_at) status = 'Revoked';
    else if (c.expires_at && new Date(c.expires_at) <= now) status = 'Expired';
    const records = (c.record_types || []).map((t) => RECORD_TYPE_LABELS[t] || t).join(', ') || '—';
    return [
      clip(c.recipient_name || '—', 24),
      clip(c.purpose || '—', 22),
      clip(records, 24),
      SOURCE_LABELS[c.source] || 'Manual (legacy)',
      c.signed_on ? formatDateOnly(c.signed_on) : formatTimestampDate(c.granted_at),
      formatTimestampDate(c.expires_at),
      status,
    ];
  });
}

// Greedy word-wrap for pdf-lib (which has no built-in text wrapping).
function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

const describeAction = (action) => ACTION_LABELS[action] || (action || '—').replace(/_/g, ' ');

// Access-history label for one audit row; the admin-approved export also
// says why it was approved.
function describeAuditRow(row) {
  const label = describeAction(row.action);
  if (row.action === 'record_export_override') {
    const reason = OVERRIDE_REASON_LABELS[parseDetails(row.details).reason];
    return reason ? `${label} (${reason})` : label;
  }
  if (row.action === 'record_export_override_failed') {
    const d = parseDetails(row.details);
    if (d.rateLimited) return `${label} (too many attempts)`;
    if (d.factor === 'verification_code') return `${label} (incorrect verification code)`;
    return `${label} (incorrect password)`;
  }
  return label;
}

// A reader-facing label for what the row touched — never the raw
// resource_type/resource_id pair (e.g. "patient 85" means nothing to a
// parent). Every row in this table is already scoped to this one child, so
// the distinction that matters is just "this child's record" vs. "one of
// their session logs".
const describeResource = (resourceType) => (resourceType === 'assessment' ? 'Session log' : "Child's record");

async function drawCoverPage(pdfDoc, patient, companyName, generatedBy, statements = []) {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let y = PAGE.height - 100;

  page.drawText('Early Intervention Record', { x: MARGIN, y, font: bold, size: 20, color: rgb(0.08, 0.1, 0.15) });
  y -= 30;
  page.drawText(pdfSafeText(`${patient.first_name || ''} ${patient.last_name || ''}`.trim()), { x: MARGIN, y, font: bold, size: 16, color: rgb(0.08, 0.1, 0.15) });
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
    page.drawText(pdfSafeText(String(value)), { x: MARGIN + 140, y, font: regular, size: 11, color: rgb(0.2, 0.24, 0.3) });
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

  // Redisclosure notice (34 CFR 99.33 / 303.414) — must accompany every
  // disclosure of this record.
  y -= 16;
  y = drawRedisclosureNotice(page, y, { regular, bold });

  // Statement(s) of Disagreement (34 CFR 303.412-413 / FERPA 34 CFR
  // 99.21) — must accompany every disclosure of the disputed part of the
  // record, same as the redisclosure notice above.
  drawStatementsOfDisagreement(page, y, { regular, bold }, statements);

  return page;
}

// The boxed CONFIDENTIALITY NOTICE (REDISCLOSURE_NOTICE), drawn with its top
// edge near `y`. Shared by the full export's cover and the consent-scoped
// disclosure packet's cover (consentReportController). Returns the y below it.
function drawRedisclosureNotice(page, y, { regular, bold }) {
  const noticeLines = wrapText(REDISCLOSURE_NOTICE, regular, 9.5, CONTENT_WIDTH - 20);
  const boxH = 22 + noticeLines.length * 13 + 8;
  page.drawRectangle({
    x: MARGIN, y: y - boxH + 10, width: CONTENT_WIDTH, height: boxH,
    borderColor: rgb(0.55, 0.6, 0.66), borderWidth: 0.75, color: rgb(0.98, 0.98, 0.99),
  });
  page.drawText('CONFIDENTIALITY NOTICE', { x: MARGIN + 10, y: y - 4, font: bold, size: 9, color: rgb(0.08, 0.1, 0.15) });
  let yy = y - 20;
  noticeLines.forEach((line) => {
    page.drawText(line, { x: MARGIN + 10, y: yy, font: regular, size: 9.5, color: rgb(0.08, 0.1, 0.15) });
    yy -= 13;
  });
  return yy;
}

// Parent/guardian Statements of Disagreement (34 CFR 303.412-413 / FERPA
// 34 CFR 99.21) that must accompany every disclosure of the disputed part
// of a record. Drawn right after the redisclosure notice so both
// confidentiality notices sit together. `statements` is already scoped to
// one patient_id and already filtered to non-null rows by the caller
// (fetchStatementsOfDisagreement below). A no-op when there are none, so
// callers can always call it without an extra guard. Returns the y below
// whatever it drew (unchanged when there was nothing to draw).
function drawStatementsOfDisagreement(page, y, { regular, bold }, statements) {
  if (!statements?.length) return y;
  statements.forEach((statement) => {
    const lines = wrapText(statement.statement_of_disagreement, regular, 9.5, CONTENT_WIDTH - 20);
    const boxH = 22 + lines.length * 13 + 8;
    y -= 16;
    page.drawRectangle({
      x: MARGIN, y: y - boxH + 10, width: CONTENT_WIDTH, height: boxH,
      borderColor: rgb(0.7, 0.45, 0.2), borderWidth: 0.75, color: rgb(0.995, 0.97, 0.94),
    });
    page.drawText('STATEMENT OF DISAGREEMENT (parent/guardian)', { x: MARGIN + 10, y: y - 4, font: bold, size: 9, color: rgb(0.08, 0.1, 0.15) });
    let yy = y - 20;
    lines.forEach((line) => {
      page.drawText(pdfSafeText(line), { x: MARGIN + 10, y: yy, font: regular, size: 9.5, color: rgb(0.08, 0.1, 0.15) });
      yy -= 13;
    });
    y = yy;
  });
  return y;
}

// Fetches every recorded Statement of Disagreement for one child, oldest
// first (so multiple statements read in the order they were made). Shared
// by the full export and the consent-scoped disclosure packet.
async function fetchStatementsOfDisagreement(patientId) {
  const { rows } = await pool.query(
    `SELECT statement_of_disagreement, statement_recorded_at
     FROM correction_requests
     WHERE patient_id = $1 AND statement_of_disagreement IS NOT NULL
     ORDER BY statement_recorded_at ASC`,
    [patientId]
  );
  return rows;
}

// Multi-child redaction (34 CFR 303.408): an on-demand, read-only copy of
// one child's billing invoice in the real invoice format (generateInvoicePDF
// with singleChildMode: true), for the real-world case of handing a parent
// something during a records inspection, without exposing the other
// children a practitioner billed in the same period the way the normal
// multi-child agency invoice would. Deliberately separate from
// billingController.generateFinancialInvoice: that function stores the PDF
// and advances billing_status as part of the real billing workflow; this
// one only reads already-billed sessions (invoiced/completed — never
// pending/njeis_review, which aren't final yet) and returns a fresh PDF
// with nothing stored and no state change, so it's safe to call as often as
// an inspection requires.
const BILLED_STATUSES = ['invoiced', 'completed', 'self_certified'];

async function generateSingleChildInvoice(req, res) {
  try {
    const { id } = req.params;

    const { rows: patientRows } = await pool.query(
      'SELECT id, first_name, last_name FROM patients WHERE id = $1',
      [id]
    );
    if (!patientRows[0]) return res.status(404).json({ error: 'Child not found' });
    const patient = decryptPatientRow(patientRows[0]);

    const { rows: rawAssessments } = await pool.query(
      `SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       LEFT JOIN patients pt ON pt.id = a.patient_id
       WHERE a.patient_id = $1 AND a.billing_status = ANY($2::text[])
       ORDER BY a.service_date ASC`,
      [id, BILLED_STATUSES]
    );
    const assessments = rawAssessments.map((a) => ({ ...decryptAssessmentRow(a), patients: decryptPatientRow(a.patients) }));
    if (!assessments.length) {
      return res.status(400).json({ error: 'This child has no invoiced sessions yet.' });
    }

    // One practitioner's worth of lines per invoice, matching the real
    // invoice's own FROM block — a child seen by more than one
    // practitioner gets one PDF per practitioner, same as normal billing
    // (each practitioner invoices the agency separately).
    const byPractitioner = new Map();
    assessments.forEach((a) => {
      const key = a.practitioner_id;
      if (!byPractitioner.has(key)) byPractitioner.set(key, []);
      byPractitioner.get(key).push(a);
    });
    const [practitionerId, practitionerAssessments] = [...byPractitioner.entries()][0];
    if (byPractitioner.size > 1) {
      return res.status(400).json({ error: 'This child was billed by more than one practitioner — single-child invoice generation currently supports one practitioner at a time.' });
    }

    const practitioner = practitionerAssessments[0].practitioners;
    const companySettings = await getCompanySettingsForDocuments();
    // Loaded lazily to avoid a require cycle (billingController requires
    // this file's exports too, via patientRoutes wiring).
    const { computeSessionCompliance } = require('./billingController');
    const complianceById = await loadComplianceForLines(
      practitionerAssessments.map((a) => a.id),
      computeSessionCompliance
    );
    const lines = buildInvoiceLines(practitionerAssessments, practitioner, { mode: 'agency', complianceById });

    const serviceDates = practitionerAssessments.map((a) => a.service_date).filter(Boolean).sort();
    const pdfBuffer = await generateInvoicePDF({
      mode: 'agency',
      singleChildMode: true,
      invoice: {
        number: formatInvoiceNumber(crypto.randomUUID()),
        issuedAt: new Date(),
        periodStart: serviceDates[0],
        periodEnd: serviceDates[serviceDates.length - 1],
      },
      brand: buildBrand(companySettings),
      from: {
        title: 'FROM',
        name: `${practitioner.first_name || ''} ${practitioner.last_name || ''}`.trim(),
        lines: [
          ...formatPractitionerAddressLines(practitioner),
          practitioner.phone_number || '',
          practitioner.email || '',
        ].filter(Boolean),
      },
      billTo: {
        title: 'BILL TO',
        name: companySettings?.legal_entity_name || companySettings?.display_name || '',
        lines: [companySettings?.address, companySettings?.phone, companySettings?.billing_email].filter(Boolean),
      },
      details: {
        discipline: (practitioner.service_types || [])[0] || '',
        taxIdMasked: maskTaxId(practitioner.ssn),
        processedBy: `${req.practitioner.email || ''}`,
      },
      certificationParty: companySettings?.legal_entity_name || companySettings?.display_name || '',
      lines,
      warnings: [],
    });

    logAudit({ req, action: 'single_child_invoice_generated', resourceType: 'patient', resourceId: id, details: { sessionCount: practitionerAssessments.length, practitionerId } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${safeFilenamePart(patient.first_name)}-${safeFilenamePart(patient.last_name)}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('generateSingleChildInvoice error:', error);
    res.status(500).json({ error: 'Failed to generate single-child invoice' });
  }
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

  page.drawText(pdfSafeText(title), { x: MARGIN, y, font: bold, size: 14, color: black });
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
      page.drawText(pdfSafeText(String(val ?? '—')), { x: cx + 4, y: y - rowH + 5, font: regular, size: 8, color: rgb(0.2, 0.24, 0.3) });
      cx += cols[ci].w;
    });
    y -= rowH;
  });

  return page;
}

// ---- Reusable single-child section builders -------------------------------
// Used by the full export below AND by consentReportController's
// consent-scoped disclosure packet. Each takes only rows the caller has
// already scoped to one patient_id. Free text goes through pdfSafeText (a
// no-op for anything the WinAnsi font could already draw).

// assessments.service_date is a 'YYYY-MM-DD' string -> 'M/D/YY'.
const shortServiceDate = (serviceDate) => {
  const [y, m, d] = (serviceDate || '').split('-');
  return y ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(-2)}` : '—';
};
const hoursLabel = (totalTime) => (totalTime ? `${(totalTime / 60).toFixed(2)}h` : '—');

// Session log summary — hand-drawn table, same visual pattern as
// reportController.generateAuditReportPDF.
function drawSessionLogSection(outDoc, assessments, fonts) {
  return drawTablePage(outDoc, {
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
    rows: assessments.map((a) => [
      shortServiceDate(a.service_date),
      pdfSafeText(`${a.practitioner_first_name || ''} ${a.practitioner_last_name || ''}`.trim()),
      pdfSafeText(a.type || '—'),
      pdfSafeText(a.location || '—'),
      a.start_time ? formatTime12h(a.start_time) : '—',
      a.end_time ? formatTime12h(a.end_time) : '—',
      hoursLabel(a.total_time),
    ]),
  });
}

// Freshly-generated SEVF for this child only (not a stored multi-child
// batch file). A child can have more than one practitioner over time
// (patient_practitioners is many-to-many), and the SEVF template's
// Discipline/Position Title box reflects one practitioner — so, same as
// billingController.generateNJEISForms, group this child's own sessions by
// practitioner first and render one SEVF group per practitioner rather than
// assuming a single practitioner for the whole child. Throws on failure
// (the full export catches and continues); returns the pages appended.
async function appendSevfSection(outDoc, assessments, patient, companyName) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'NJEIS-020.pdf');
  const templateBytes = fs.readFileSync(templatePath);
  const byPractitioner = assessments.reduce((acc, a) => {
    const key = a.practitioner_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...a, patient_first_name: patient.first_name, patient_last_name: patient.last_name });
    return acc;
  }, {});
  let added = 0;
  for (const practitionerId of Object.keys(byPractitioner)) {
    const group = byPractitioner[practitionerId];
    // practitioner_discipline is already denormalized onto each
    // assessment row at logging time (see assessments.practitioner_discipline
    // in schema.sql) — reuse it here instead of a second query, since
    // buildNjeisPdfForGroup only reads position_title off this object.
    const syntheticPractitioner = { position_title: group[0]?.practitioner_discipline || '' };
    const sevfDoc = await buildNjeisPdfForGroup(templateBytes, group, companyName, syntheticPractitioner);
    const sevfPages = await outDoc.copyPages(sevfDoc, sevfDoc.getPageIndices());
    sevfPages.forEach((pg) => outDoc.addPage(pg));
    added += sevfPages.length;
  }
  return added;
}

// Billing/invoice line items for this child only — hand-drawn, not the
// stored invoice PDF (which also carries the practitioner's SSN/EIN and
// other children's rows on the same page).
function drawBillingSection(outDoc, assessments, fonts) {
  return drawTablePage(outDoc, {
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
    rows: assessments.map((a) => [
      shortServiceDate(a.service_date),
      pdfSafeText(a.type || '—'),
      hoursLabel(a.total_time),
      pdfSafeText(a.billing_status || '—'),
      pdfSafeText(a.company_affiliation || '—'),
    ]),
  });
}

const FULL_RECORD_SECTIONS = ['Session log summary', 'SEVF', 'Billing summary', 'Record access history', 'Consents on file'];

// Builds the full single-child record PDF. Shared by the consent-covered GET
// and the admin override POST so both produce the identical document.
async function buildFullRecordPdf(patient, requester) {
  const id = patient.id;
  const companyName = await getCompanyName();

  const { rows: rawAssessments } = await pool.query(
    `SELECT * FROM assessments WHERE patient_id = $1 ORDER BY service_date ASC, start_time ASC`,
    [id]
  );
  const assessments = rawAssessments.map(decryptAssessmentRow);
  const statements = await fetchStatementsOfDisagreement(id);

  const outDoc = await PDFDocument.create();
  const regular = await outDoc.embedFont(StandardFonts.Helvetica);
  const bold = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  // 1. Cover page
  await drawCoverPage(outDoc, patient, companyName, requester, statements);

  // 2. Session log summary
  drawSessionLogSection(outDoc, assessments, fonts);

  // 3. Freshly-generated SEVF for this child only (see appendSevfSection).
  if (assessments.length > 0) {
    try {
      await appendSevfSection(outDoc, assessments, patient, companyName);
    } catch (sevfError) {
      console.error('buildFullRecordPdf: SEVF generation failed, continuing without it:', sevfError);
    }
  }

  // 4. Billing/invoice line items for this child only (see drawBillingSection).
  drawBillingSection(outDoc, assessments, fonts);

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
      formatAuditDate(r.created_at),
      r.actor_email || r.actor_resolved_email || '—',
      describeAuditRow(r),
      describeResource(r.resource_type),
    ]),
  });

  // 6. Record of disclosures (34 CFR 99.32 / 303.406) — each time this
  // child's record left the system: recipient, purpose, date, records.
  drawTablePage(outDoc, {
    title: 'Record of Disclosures',
    pageLabel: 'Record of Disclosures',
    fonts,
    cols: [
      { label: 'Date', w: 95 },
      { label: 'Recipient', w: 170 },
      { label: 'Purpose', w: 160 },
      { label: 'Records', w: 107 },
    ],
    rows: buildDisclosureRows(auditRows),
  });

  // 7. Consents on file (34 CFR 99.30 / 303.414), next to the disclosures
  // they authorize: paper and electronic, active, revoked or expired.
  const { rows: consentRows } = await pool.query(
    `SELECT recipient_name, recipient_email, purpose, record_types, source, signed_on, granted_at, expires_at, revoked_at
     FROM records_consents WHERE patient_id = $1 ORDER BY granted_at DESC`,
    [String(id)]
  );
  drawTablePage(outDoc, {
    title: 'Consents on File',
    pageLabel: 'Consents on File',
    fonts,
    cols: [
      { label: 'Recipient', w: 110 },
      { label: 'Purpose', w: 100 },
      { label: 'Records', w: 110 },
      { label: 'Source', w: 60 },
      { label: 'Signed', w: 52 },
      { label: 'Expires', w: 52 },
      { label: 'Status', w: 48 },
    ],
    rows: buildConsentRows(consentRows),
  });

  const pdfBytes = await outDoc.save();
  return { pdfBytes, assessmentCount: assessments.length };
}

// Header-safe filename (Node throws ERR_INVALID_CHAR on e.g. a curly
// apostrophe). Called BEFORE the audit row is written, so a header failure
// can never leave a disclosure entry for a file that was never sent.
function setRecordPdfHeaders(res, patient) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="record-export-${safeFilenamePart(patient.last_name)}-${ts()}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
}

const CHILD_NOT_FOUND = { error: 'Child not found' };

// An active parent consent approving a full-record release FOR THIS CHILD.
async function findCoveringConsent(patientId) {
  const { rows } = await pool.query(
    `SELECT * FROM records_consents
     WHERE patient_id = $1 AND revoked_at IS NULL AND expires_at > now()
       AND 'full_record_export' = ANY(record_types)
     ORDER BY granted_at DESC LIMIT 1`,
    [String(patientId)]
  );
  return rows[0] || null;
}

// Whether the signed-in practitioner must add a TOTP code to the override.
async function overrideNeedsMfaCode(req) {
  const { rows } = await pool.query('SELECT mfa_enabled FROM practitioners WHERE id = $1', [req.practitioner.practitionerId]);
  return rows[0]?.mfa_enabled === true;
}

// GET /api/patients/:id/record-export — only with a covering parent consent.
// A consent names a third-party recipient, so what it releases is that
// consent's disclosure packet (consentReportController: only the approved
// sections, audited as consent_report_generated to the real recipient), NOT
// the parent's complete copy with its access history and other consents.
// The admin override POST is the only way to the complete parent copy.
const exportPatientRecord = async (req, res) => {
  const { id } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(CHILD_NOT_FOUND);
  try {
    const { rows: patientRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    const patient = decryptPatientRow(patientRows[0]);
    if (!patient) return res.status(404).json(CHILD_NOT_FOUND);

    const consent = await findCoveringConsent(id);
    if (!consent) {
      const canOverride = req.isAdmin === true;
      return res.status(403).json({
        code: 'CONSENT_REQUIRED',
        error: 'No active parent consent covers a full record export for this child.',
        canOverride,
        requiresMfaCode: canOverride ? await overrideNeedsMfaCode(req) : false,
      });
    }

    // Lazy require: consentReportController requires this module at load.
    const { sendConsentPacket } = require('./consentReportController');
    await sendConsentPacket(req, res, { patient, consent });
  } catch (error) {
    console.error('exportPatientRecord error:', error);
    res.status(500).json({ error: 'Failed to export record' });
  }
};

// ---- Admin override: brute-force limiter ----------------------------------
// At most OVERRIDE_MAX_FAILURES attempts per OVERRIDE_WINDOW_MS per signed-in
// user (sliding window), so an unattended admin session cannot be used to
// guess the password or the verification code. Keyed by tenant DB +
// practitioner id (practitioner ids are per-tenant). In-memory and per
// process, like the express-rate-limit default store the auth routes use.
//
// Race-safe: an attempt is RESERVED (check-and-increment in one synchronous
// step) before anything is awaited, so N parallel requests each consume a
// slot and at most OVERRIDE_MAX_FAILURES ever reach bcrypt. A correct
// password (+ code) releases the user's slots. A request rejected with 429
// also counts (re-arming the window), and each key keeps at most
// OVERRIDE_MAX_FAILURES timestamps, so memory stays bounded.
const OVERRIDE_MAX_FAILURES = 5;
const OVERRIDE_WINDOW_MS = 15 * 60 * 1000;
const OVERRIDE_MAX_KEYS = 10000;
const overrideAttempts = new Map(); // key -> [attempt timestamps], newest last

const overrideKey = (req) => `${req.practitioner?.tenantDb || ''}:${req.practitioner?.practitionerId}`;
function recentAttempts(key, now) {
  const list = (overrideAttempts.get(key) || []).filter((t) => now - t < OVERRIDE_WINDOW_MS);
  if (list.length) overrideAttempts.set(key, list); else overrideAttempts.delete(key);
  return list;
}
// Synchronous: records the attempt and returns whether it may proceed.
function reserveOverrideAttempt(key, now) {
  if (overrideAttempts.size > OVERRIDE_MAX_KEYS) {
    for (const k of [...overrideAttempts.keys()]) recentAttempts(k, now);
  }
  const list = recentAttempts(key, now);
  if (list.length < OVERRIDE_MAX_FAILURES) {
    overrideAttempts.set(key, [...list, now]);
    return true;
  }
  // Already locked: this rejected attempt counts too and re-arms the full
  // window from now (like the account MFA lockout), still MAX entries.
  overrideAttempts.set(key, new Array(OVERRIDE_MAX_FAILURES).fill(now));
  return false;
}
const releaseOverrideAttempts = (key) => overrideAttempts.delete(key);
const resetOverrideFailures = () => overrideAttempts.clear();

// Never matches any password; compared against when the practitioner row or
// hash is missing so the response time does not differ.
const DUMMY_HASH = '$2b$10$kfbIqw/2Dj.rlDic572uhuWxN01VGzbkxLbzZFws5lTYPCa6/Cp7S';
const INCORRECT_CODE = { error: 'Verification code is incorrect.' };

// POST /api/patients/:id/record-export/override
//   body: { password, reason, code? }  code = 6-digit TOTP, required when the
//   admin has MFA enabled (the GET 403 says so via requiresMfaCode).
const overrideExportPatientRecord = async (req, res) => {
  if (req.isAdmin !== true) {
    return res.status(403).json({ error: 'Only an administrator can export the full record without a parent consent.' });
  }
  if (req.practitioner?.impersonation) {
    return res.status(403).json({ error: 'A support session cannot approve a full record export.' });
  }
  const { id } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(CHILD_NOT_FOUND);
  const { password, reason, code } = req.body || {};
  if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(OVERRIDE_REASON_LABELS, reason)) {
    return res.status(400).json({ error: 'Choose a reason for this export.' });
  }

  const auditFailure = (extra = {}) => logAudit({
    req, action: 'record_export_override_failed', resourceType: 'patient', resourceId: id, details: { reason, ...extra },
  });

  // Reserved before the first await (see the limiter comment above).
  const key = overrideKey(req);
  if (!reserveOverrideAttempt(key, Date.now())) {
    auditFailure({ rateLimited: true });
    return res.status(429).json({ error: 'Too many incorrect passwords. Try again later.' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT password_hash, mfa_enabled, mfa_secret, mfa_last_used_step, mfa_locked_until FROM practitioners WHERE id = $1',
      [req.practitioner.practitionerId]
    );
    const user = userRows[0]
      ? { ...userRows[0], id: req.practitioner.practitionerId, email: req.practitioner.email, role: req.practitioner.role }
      : null;
    const mfaRequired = user?.mfa_enabled === true;
    // The same per-account lockout the login MFA path enforces.
    if (mfaRequired && isMfaLocked(user)) {
      auditFailure({ rateLimited: true });
      return res.status(429).json({ error: 'Too many failed verification attempts. Please wait 15 minutes and try again.' });
    }

    const hash = user?.password_hash;
    const usable = typeof hash === 'string' && hash.length > 0;
    let ok = false;
    try {
      ok = await bcrypt.compare(typeof password === 'string' ? password : '', usable ? hash : DUMMY_HASH);
    } catch {
      ok = false;
    }
    if (!ok || !usable) {
      auditFailure();
      return res.status(400).json({ error: 'Password is incorrect.' });
    }

    if (mfaRequired) {
      const supplied = code !== undefined && code !== null && String(code).trim() !== '';
      // verifyTotp + the atomic replay-guarded step UPDATE, as login uses.
      if (!supplied || !(await consumeTotpCode(user, code))) {
        // A supplied-but-wrong code also counts toward the account MFA lockout.
        if (supplied) await recordMfaFailure(req, user, 'record_export_override');
        auditFailure({ factor: 'verification_code' });
        return res.status(400).json(INCORRECT_CODE);
      }
    }
    releaseOverrideAttempts(key);

    const { rows: patientRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    const patient = decryptPatientRow(patientRows[0]);
    if (!patient) return res.status(404).json(CHILD_NOT_FOUND);

    const requester = `${req.practitioner.email || 'Unknown'}`;
    const { pdfBytes, assessmentCount } = await buildFullRecordPdf(patient, requester);
    setRecordPdfHeaders(res, patient);

    logAudit({
      req, action: 'record_export_override', resourceType: 'patient', resourceId: id,
      details: {
        reason,
        assessmentCount,
        recipientName: OVERRIDE_RECIPIENT,
        records: FULL_RECORD_SECTIONS,
        generatedBy: requester,
      },
    });

    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('overrideExportPatientRecord error:', error);
    res.status(500).json({ error: 'Failed to export record' });
  }
};

module.exports = {
  exportPatientRecord,
  overrideExportPatientRecord,
  resetOverrideFailures,
  buildFullRecordPdf,
  describeAuditRow,
  OVERRIDE_REASON_LABELS,
  drawCoverPage,
  buildDisclosureRows,
  buildConsentRows,
  pdfSafeText,
  // Shared with consentReportController (the consent-scoped disclosure packet).
  drawRedisclosureNotice,
  drawStatementsOfDisagreement,
  fetchStatementsOfDisagreement,
  generateSingleChildInvoice,
  drawTablePage,
  drawSessionLogSection,
  appendSevfSection,
  drawBillingSection,
  wrapText,
  formatDateOnly,
  formatTimestampDate,
  RECORD_TYPE_LABELS,
  NJ_TZ,
  PAGE,
  MARGIN,
  CONTENT_WIDTH,
};
