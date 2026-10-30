// Agency-wide register of every records consent on file: who may receive what,
// whether it is still in force, whether records have gone out, and how it
// ended. For the records office (admin or patient_record_rights); the
// per-child view lives in the child's Consents panel.
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { decryptField } = require('../utils/fieldEncryption');

const EXPIRING_DAYS = 30;

function deriveStatus(row, now = Date.now()) {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at) {
    const exp = new Date(row.expires_at).getTime();
    if (exp <= now) return 'expired';
    if (exp <= now + EXPIRING_DAYS * 24 * 60 * 60 * 1000) return 'expiring';
  }
  return 'active';
}

// GET /api/consent-register
const listConsentRegister = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.patient_id, p.first_name, p.last_name, p.child_id,
              c.recipient_name, c.recipient_email, c.purpose, c.record_types, c.source,
              c.signed_on, c.granted_at, c.expires_at, c.revoked_at, c.revoked_via, c.paper_scan_path,
              COALESCE(rel.live, 0) AS live_releases,
              COALESCE(rel.total, 0) AS total_releases,
              rel.last_sent_at,
              COALESCE(rel.downloads, 0) AS total_downloads
       FROM records_consents c
       JOIN patients p ON p.id = c.patient_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE r.revoked_at IS NULL AND r.email_status = 'sent') AS live,
                count(*) FILTER (WHERE r.email_status = 'sent') AS total,
                max(r.created_at) FILTER (WHERE r.email_status = 'sent') AS last_sent_at,
                COALESCE(sum(r.download_count), 0) AS downloads
         FROM records_releases r WHERE r.consent_id = c.id
       ) rel ON true
       ORDER BY c.granted_at DESC
       LIMIT 2000`
    );
    const consents = rows.map((r) => {
      const status = deriveStatus(r);
      return {
        id: r.id,
        patientId: r.patient_id,
        patientName: `${decryptField(r.first_name) || ''} ${decryptField(r.last_name) || ''}`.trim(),
        childId: r.child_id,
        recipientName: r.recipient_name,
        recipientEmail: r.recipient_email,
        purpose: r.purpose,
        recordTypes: r.record_types,
        source: r.source,
        signedOn: r.signed_on || r.granted_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        revokedBy: r.revoked_at ? (r.revoked_via || null) : null,
        status,
        // In force, with nothing live sent yet.
        awaitingSend: (status === 'active' || status === 'expiring') && Number(r.live_releases) === 0,
        sentCount: Number(r.total_releases),
        lastSentAt: r.last_sent_at,
        downloads: Number(r.total_downloads),
        hasScan: !!r.paper_scan_path,
      };
    });
    logAudit({ req, action: 'consent_register_view', resourceType: 'consent', details: { count: consents.length } });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, consents });
  } catch (error) {
    console.error('listConsentRegister error:', error);
    res.status(500).json({ success: false, error: 'Failed to load the consent register.' });
  }
};

module.exports = { listConsentRegister, deriveStatus };
