// Expiry reminders for records consents. Staff get a neutral email (no child,
// parent or recipient names; Resend has no BAA) 30 and 7 days before a consent
// lapses, so they can request a renewed signature in time. Safe to run any
// number of times: each stage is recorded on the consent, and a consent is
// only marked once its email actually went out.
//
// Agency consents only: consents granted by an independent practitioner are
// out of scope for now. Must run inside a tenant context (see
// sweepAllTenantsConsentExpiry in index.js).
const { pool } = require('../config/db');
const { sendConsentStaffNoticeEmail } = require('./emailClient');

const BASE_SELECT = `
  SELECT c.id, pr.email
  FROM records_consents c
  LEFT JOIN practitioners pr ON pr.id = c.granted_by AND pr.is_active = true
  WHERE c.revoked_at IS NULL
    AND c.expires_at > now()
    AND (pr.id IS NULL OR pr.role <> 'independent_practitioner')`;

const STAGES = [
  {
    // Inside the final week: also counts as the 30-day reminder so a consent
    // first seen this late does not trigger two emails.
    select: `${BASE_SELECT}
    AND c.expires_at <= now() + interval '7 days'
    AND c.reminded_7_at IS NULL`,
    mark: 'UPDATE records_consents SET reminded_7_at = now(), reminded_30_at = COALESCE(reminded_30_at, now()) WHERE id = ANY($1::int[])',
  },
  {
    select: `${BASE_SELECT}
    AND c.expires_at > now() + interval '7 days'
    AND c.expires_at <= now() + interval '30 days'
    AND c.reminded_30_at IS NULL`,
    mark: 'UPDATE records_consents SET reminded_30_at = now() WHERE id = ANY($1::int[])',
  },
];

async function activeAdminEmails() {
  const { rows } = await pool.query("SELECT email FROM practitioners WHERE role = 'ceo' AND is_active = true AND email IS NOT NULL");
  return rows.map((r) => r.email);
}

async function sweepConsentExpiry() {
  let notified = 0;
  for (const stage of STAGES) {
    const { rows } = await pool.query(stage.select);
    if (!rows.length) continue;

    // email -> consent ids; a consent with no usable granting-staff email goes
    // to the active admins instead.
    const byEmail = new Map();
    let admins = null;
    for (const row of rows) {
      let targets = row.email ? [row.email] : null;
      if (!targets) {
        if (admins === null) admins = await activeAdminEmails();
        targets = admins;
      }
      for (const email of targets) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email).push(row.id);
      }
    }

    const sentIds = new Set();
    const failedIds = new Set();
    for (const [email, ids] of byEmail) {
      try {
        await sendConsentStaffNoticeEmail(email, { kind: 'expiring' });
        ids.forEach((id) => sentIds.add(id));
      } catch (err) {
        console.error('Consent expiry reminder failed:', err.message);
        ids.forEach((id) => failedIds.add(id));
      }
    }
    // A consent is done once at least one of its recipients got the email;
    // one with no successful send is retried on the next sweep.
    const doneIds = [...sentIds];
    if (doneIds.length) {
      await pool.query(stage.mark, [doneIds]);
      notified += doneIds.length;
    }
  }
  return { notified };
}

module.exports = { sweepConsentExpiry };
