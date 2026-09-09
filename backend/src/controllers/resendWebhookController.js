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
const STATUS_BY_EVENT = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

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
             SET invite_delivery_status = $1
           WHERE invite_email_id = $2
             AND ($1 <> 'delivered' OR invite_delivery_status NOT IN ('bounced', 'complained'))`,
          [status, emailId]
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
