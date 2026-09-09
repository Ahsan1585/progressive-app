const { Webhook } = require('svix');
const { platformPool } = require('../config/platformDb');
const { runWithTenant } = require('../config/tenantContext');
const { pool } = require('../config/db');

// Resend delivery webhook. Resend signs its webhooks with the Svix
// "Standard Webhooks" scheme, so this route is mounted with express.raw()
// BEFORE the app-wide express.json() parser (see index.js — same as the
// Stripe webhook) and the raw body is verified here.
//
// The event carries an email address and a Resend message id but NO tenant
// context. We stored that message id on the practitioner row at send time
// (practitioners.invite_email_id), so routing is: loop every non-cancelled
// company, run an indexed UPDATE ... WHERE invite_email_id = $1 in that
// tenant's DB, stop at the first that touches a row. With one dominant
// tenant this is a handful of cheap queries per event.

// Resend event type -> the invite_delivery_status we record.
// email.suppressed fires when Resend blocks a send outright because the
// address is on its suppression list (it hard-bounced or complained on a
// PRIOR send) — the email never leaves Resend, so no bounce event follows.
// We surface it the same as a bounce: the invite did not reach anyone.
const STATUS_BY_EVENT = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'bounced',
};

// One plain message for any invite delivery failure — the admin's action is
// the same regardless of cause (check the address, re-send). Resend's own
// diagnostic is appended for support, but we don't try to interpret it.
function describeFailure(event) {
  const raw = (
    event?.data?.bounce?.message ||
    event?.data?.suppressed?.message ||
    ''
  ).trim();
  const base = "The activation email couldn't be delivered — check the email address for typos (via Edit), then re-send the invite.";
  return raw ? `${base}\n\nProvider detail: ${raw}` : base;
}

const resendWebhook = async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Not configured — acknowledge so Resend doesn't retry forever, but do
    // nothing. (Same posture as the Stripe webhook when unconfigured.)
    return res.status(200).json({ received: true, note: 'Webhook not configured' });
  }

  // req.body is a Buffer here (express.raw). svix's verify() throws on a bad
  // signature and otherwise returns nothing — it does NOT hand back the
  // parsed payload, so we JSON.parse the raw string ourselves after it passes.
  const rawBody = req.body.toString('utf8');
  try {
    const wh = new Webhook(secret);
    wh.verify(rawBody, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    });
  } catch (err) {
    console.error('Resend webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).send('Webhook Error: invalid JSON body');
  }

  const status = STATUS_BY_EVENT[event?.type];
  const emailId = event?.data?.email_id;
  if (!status || !emailId) {
    return res.json({ received: true });
  }

  // Log the classification-relevant fields for any failure, so a
  // misclassified reason can be diagnosed from the raw Resend payload.
  if (status !== 'delivered') {
    console.log('Resend failure event:', JSON.stringify({
      type: event.type,
      email_id: emailId,
      bounce: event?.data?.bounce || null,
      suppressed: event?.data?.suppressed || null,
    }));
  }

  // A specific explanation for a failure; null for a plain delivery (which
  // also clears any stale detail from a previous failed send of this id).
  const detail = status === 'delivered' ? null : describeFailure(event);

  try {
    const { rows: companies } = await platformPool.query(
      "SELECT tenant_db_name FROM companies WHERE status != 'cancelled'"
    );

    let matched = false;
    for (const { tenant_db_name } of companies) {
      const updated = await runWithTenant(tenant_db_name, () =>
        pool.query(
          // Don't let a late 'delivered' event overwrite a 'bounced'/
          // 'complained' one that arrived first, and only touch the row if
          // this id is still the current invite (a newer resend supersedes).
          `UPDATE practitioners
             SET invite_delivery_status = $1, invite_delivery_detail = $3
           WHERE invite_email_id = $2
             AND ($1 <> 'delivered' OR invite_delivery_status NOT IN ('bounced', 'complained'))`,
          [status, emailId, detail]
        )
      );
      if (updated.rowCount > 0) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      console.warn(`Resend webhook: no practitioner found for email_id ${emailId} (${event.type})`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Resend webhook handling error:', error);
    // 500 so Resend retries — a transient DB hiccup shouldn't drop a bounce.
    res.status(500).json({ error: 'Webhook handling failed' });
  }
};

module.exports = { resendWebhook };
