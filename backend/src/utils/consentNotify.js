// Tells the right people about consent activity ('signed' | 'withdrawn'),
// best-effort: the consent change is already committed, so a failure here is
// logged and swallowed. Emails are neutral (no child, parent or recipient
// names; Resend has no BAA), worded for where each person can actually look.
//
//  - The staff member who requested the consent always hears, worded for their
//    role: office roles use the web dashboard, practitioners only have the
//    mobile app.
//  - A practitioner cannot send records, so when the requester is one, the
//    active office admins (ceo) are told too: they are the ones who act on it.
//  - Independent practitioners are never emailed (out of scope for now).
const { pool } = require('../config/db');
const { sendConsentStaffNoticeEmail } = require('./emailClient');

async function activeAdminEmails() {
  const { rows } = await pool.query("SELECT email FROM practitioners WHERE role = 'ceo' AND is_active = true AND email IS NOT NULL");
  return rows.map((r) => r.email);
}

async function notifyConsentStaff(kind, requestedBy) {
  try {
    const found = await pool.query(
      'SELECT email, role FROM practitioners WHERE id = $1 AND is_active = true',
      [requestedBy]
    );
    const requester = found?.rows?.[0] || null;
    if (requester?.role === 'independent_practitioner') return;

    const targets = new Map(); // email -> audience
    if (requester?.email) targets.set(requester.email, requester.role === 'practitioner' ? 'practitioner' : 'office');
    if (!requester || requester.role === 'practitioner') {
      for (const email of await activeAdminEmails()) {
        if (!targets.has(email)) targets.set(email, 'office');
      }
    }

    for (const [email, audience] of targets) {
      try {
        await sendConsentStaffNoticeEmail(email, { kind, audience });
      } catch (err) {
        console.error(`Failed to send consent ${kind} notice:`, err.message);
      }
    }
  } catch (err) {
    console.error(`Failed to notify staff of consent ${kind}:`, err.message);
  }
}

module.exports = { notifyConsentStaff };
