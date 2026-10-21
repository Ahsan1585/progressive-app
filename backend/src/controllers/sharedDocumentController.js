// Expiring, token-gated secure links for disclosing a child's SEVF (and
// matching invoice) to an outside early intervention agency — replaces the
// old flow of attaching the PDFs to an email. Resend (our email vendor)
// cannot sign a BAA, so the documents themselves must never pass through
// it; the email carries only this link, and the PDFs are served from
// Izaya's own BAA-covered infrastructure (Cloud Run + GCS).
//
// Mirrors the telepractice signature flow (telepracticeSignatureController
// / telepracticeSignatureRoutes): a 32-byte random token, only its sha256
// hash stored, public routes resolve the tenant from the company slug in
// the URL (resolveTenantBySlug), rate-limited.
//
// Public flow:
//   GET /api/shared-documents/:companySlug/:token          -> HTML landing
//       page with the FERPA/IDEA redisclosure notice + download buttons.
//       Opening it is NOT counted as a download (email link scanners
//       prefetch GET links, and the notice must be shown before the file).
//   GET /api/shared-documents/:companySlug/:token/:docType -> the PDF
//       (docType 'sevf' | 'invoice'), Cache-Control: no-store, records
//       first_downloaded_at/download_count, and logs a per-child disclosure
//       audit row (34 CFR 99.32 / 303.406).
const crypto = require('crypto');
const { pool } = require('../config/db');
const { BILLING_INVOICES_BUCKET, downloadFile } = require('../config/storage');
const { logAudit } = require('../utils/auditLog');
const { REDISCLOSURE_NOTICE, escapeHtml } = require('../utils/emailClient');

const SHARED_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const TOKEN_RE = /^[a-f0-9]{64}$/;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const DOC_TYPES = {
  sevf: { column: 'njeis_path', filename: 'SEVF.pdf', label: 'Service Verification Form (SEVF)' },
  invoice: { column: 'invoice_path', filename: 'Invoice.pdf', label: 'Invoice' },
};

// Called from billingController.emailSevfToAgency AFTER the consent gate
// passes. baseUrl is the backend's public origin (the link points straight
// at this API, since the landing page is server-rendered here);
// BACKEND_PUBLIC_URL overrides it when set.
async function createSharedDocumentLink({ batchId, patientId, recipientEmail, createdBy, companySlug, baseUrl }) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SHARED_LINK_TTL_MS);
  const { rows } = await pool.query(
    `INSERT INTO shared_document_links (token_hash, batch_id, patient_id, recipient_email, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, expires_at`,
    [hashToken(rawToken), batchId, patientId ?? null, recipientEmail, createdBy ?? null, expiresAt]
  );
  const origin = String(process.env.BACKEND_PUBLIC_URL || baseUrl || '').replace(/\/+$/, '');
  const url = `${origin}/api/shared-documents/${encodeURIComponent(companySlug)}/${rawToken}`;
  return { linkId: rows[0]?.id, expiresAt: rows[0]?.expires_at || expiresAt, url };
}

async function revokeSharedDocumentLink(linkId) {
  await pool.query('UPDATE shared_document_links SET revoked_at = now() WHERE id = $1', [linkId]);
}

// Returns { link } or { status, message } for a rejection.
async function loadLink(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { status: 404, message: 'This link is not valid.' };
  const { rows } = await pool.query(
    `SELECT l.id, l.batch_id, l.patient_id, l.recipient_email, l.expires_at, l.revoked_at,
            b.njeis_path, b.invoice_path,
            pr.first_name AS practitioner_first_name, pr.last_name AS practitioner_last_name
     FROM shared_document_links l
     JOIN billing_batches b ON b.id = l.batch_id
     LEFT JOIN practitioners pr ON pr.id = l.created_by
     WHERE l.token_hash = $1`,
    [hashToken(token)]
  );
  const link = rows[0];
  if (!link) return { status: 404, message: 'This link is not valid.' };
  if (link.revoked_at) return { status: 410, message: 'This link has been revoked. Please contact the practitioner who sent it.' };
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return { status: 410, message: 'This link has expired. Please contact the practitioner who sent it for a new one.' };
  }
  return { link };
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
};

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; background:#F7FAF9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#132A3E; }
  main { max-width:560px; margin:40px auto; padding:32px 24px; background:#fff; border-radius:16px; border-top:5px solid #0E6E67; box-sizing:border-box; }
  h1 { font-family:Georgia,'Times New Roman',serif; font-size:23px; margin:0 0 14px; }
  p { color:#5C6B73; line-height:1.6; font-size:14.5px; }
  .notice { border:1px solid #E2EAE8; border-radius:8px; padding:12px 14px; color:#132A3E; font-size:13px; line-height:1.55; }
  a.btn { display:block; text-align:center; margin:12px 0; padding:14px 20px; background:#0E6E67; color:#fff; text-decoration:none; border-radius:10px; font-weight:600; }
  @media (max-width:600px) { main { margin:16px; } }
</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

function sendRejection(res, status, message, asHtml) {
  res.set(NO_STORE_HEADERS);
  if (asHtml) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(status).send(page('Link unavailable', `<h1>Link unavailable</h1><p>${escapeHtml(message)}</p>`));
  }
  return res.status(status).json({ error: message });
}

// GET /api/shared-documents/:companySlug/:token
const getSharedDocumentLanding = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await loadLink(token);
    if (!result.link) return sendRejection(res, result.status, result.message, true);
    const { link } = result;

    const practitionerName = `${link.practitioner_first_name || ''} ${link.practitioner_last_name || ''}`.trim() || 'A practitioner';
    const expires = new Date(link.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const buttons = Object.entries(DOC_TYPES)
      .filter(([, d]) => !!link[d.column])
      .map(([key, d]) => `<a class="btn" href="${escapeHtml(token)}/${key}" rel="noreferrer">Download ${escapeHtml(d.label)}</a>`)
      .join('');

    res.set(NO_STORE_HEADERS);
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Relative links ("<token>/sevf") only resolve under the token path when
    // the page URL itself has no trailing slash — always the case for the
    // link we generate.
    res.status(200).send(page('Secure documents', `
      <h1>Secure documents</h1>
      <p><b style="color:#132A3E;">${escapeHtml(practitionerName)}</b> has shared the following document(s) with your agency.</p>
      <p class="notice"><b>Confidentiality notice:</b> ${escapeHtml(REDISCLOSURE_NOTICE)}</p>
      ${buttons}
      <p style="font-size:12px;">By downloading, you acknowledge the notice above. This private link expires on ${escapeHtml(expires)}. Downloads are logged.</p>
    `));
  } catch (error) {
    console.error('getSharedDocumentLanding error:', error);
    sendRejection(res, 500, 'Something went wrong. Please try again later.', true);
  }
};

// GET /api/shared-documents/:companySlug/:token/:docType
const downloadSharedDocument = async (req, res) => {
  try {
    const { token, docType } = req.params;
    const doc = DOC_TYPES[docType];
    if (!doc) return sendRejection(res, 404, 'Document not found.', false);

    const result = await loadLink(token);
    if (!result.link) return sendRejection(res, result.status, result.message, false);
    const { link } = result;

    const storagePath = link[doc.column];
    if (!storagePath) return sendRejection(res, 404, 'Document not found.', false);

    const buffer = await downloadFile(BILLING_INVOICES_BUCKET, storagePath);

    await pool.query(
      `UPDATE shared_document_links
       SET download_count = download_count + 1,
           first_downloaded_at = COALESCE(first_downloaded_at, now())
       WHERE id = $1`,
      [link.id]
    );

    // Per-child disclosure log (34 CFR 99.32 / 303.406) — resourceType
    // 'patient' so it shows in that child's Record of Access.
    logAudit({
      req,
      actorEmail: link.recipient_email,
      actorRole: 'external_recipient',
      action: 'shared_document_downloaded',
      resourceType: 'patient',
      resourceId: link.patient_id,
      details: {
        batchId: link.batch_id,
        linkId: link.id,
        document: docType,
        recipientEmail: link.recipient_email,
        records: [doc.label],
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Redisclosure-Notice', REDISCLOSURE_NOTICE);
    res.send(buffer);
  } catch (error) {
    console.error('downloadSharedDocument error:', error);
    sendRejection(res, 500, 'Failed to download document.', false);
  }
};

module.exports = {
  createSharedDocumentLink,
  revokeSharedDocumentLink,
  getSharedDocumentLanding,
  downloadSharedDocument,
  SHARED_LINK_TTL_MS,
  hashToken,
};
