const { pool } = require('../config/db');
const { platformPool } = require('../config/platformDb');
const { runWithTenant, getCurrentTenantDb } = require('../config/tenantContext');
const { getStripeClient, isStripeConfigured, isGooglePayConfigured } = require('../config/stripe');
const { computeCurrentPeriodSummary, getSubscriptionSettings, getPreviousPeriodBounds, markOverdueInvoices } = require('../utils/subscriptionBilling');
const { generateSubscriptionInvoicePdf } = require('../utils/subscriptionInvoicePdf');
const { logAudit } = require('../utils/auditLog');

// What the frontend needs to decide which payment UI to render — never
// exposes the secret key, only whether it's set and the publishable half.
const getConfig = async (req, res) => {
  res.json({
    success: true,
    stripeConfigured: isStripeConfigured(),
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    googlePayReady: isGooglePayConfigured(),
  });
};

const getSummary = async (req, res) => {
  try {
    const summary = await computeCurrentPeriodSummary();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error computing subscription summary:', error);
    res.status(500).json({ error: 'Failed to compute subscription summary' });
  }
};

const getInvoices = async (req, res) => {
  try {
    await markOverdueInvoices();
    const { rows } = await pool.query(
      `SELECT id, period_start, period_end, active_practitioner_count, office_staff_count,
              extra_staff_seats, total_amount, status, paid_at, created_at
       FROM subscription_invoices
       ORDER BY period_start DESC
       LIMIT 24`
    );
    res.json({ success: true, invoices: rows });
  } catch (error) {
    console.error('Error fetching subscription invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

// Printable invoice — generated on demand from the stored row (not
// re-computed live), so it always reflects exactly what was billed even if
// pricing later changes. Available for any status, not just 'paid' — a
// pending invoice still needs a document a ceo can review/print.
const getInvoicePdf = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subscription_invoices WHERE id = $1', [req.params.id]);
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: companyRows } = await pool.query(
      'SELECT display_name, legal_entity_name, address, phone, billing_email FROM company_settings WHERE id = 1'
    );

    const pdfBuffer = await generateSubscriptionInvoicePdf(invoice, companyRows[0]);
    logAudit({ req, action: 'subscription_invoice_pdf_download', resourceType: 'subscription_invoice', resourceId: invoice.id });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Izaya-Invoice-${invoice.period_start}.pdf`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error('Error generating subscription invoice PDF:', error);
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
};

const getPaymentMethod = async (req, res) => {
  try {
    const settings = await getSubscriptionSettings();
    res.json({
      success: true,
      paymentMethod: settings.defaultPaymentMethodId
        ? {
            type: settings.defaultPaymentMethodType,
            brand: settings.defaultPaymentMethodBrand,
            last4: settings.defaultPaymentMethodLast4,
            exp: settings.defaultPaymentMethodExp,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching payment method:', error);
    res.status(500).json({ error: 'Failed to fetch payment method' });
  }
};

// Ensures a Stripe Customer exists for this (singleton) company, creating it
// on first use. Returns the customer id.
async function ensureStripeCustomer(stripe) {
  const { rows } = await pool.query('SELECT stripe_customer_id, display_name, billing_email FROM company_settings WHERE id = 1');
  const row = rows[0] || {};
  if (row.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe.customers.create({
    name: row.display_name || undefined,
    email: row.billing_email || undefined,
    metadata: { app: 'izaya-eis', company_settings_id: '1' },
  });
  await pool.query('UPDATE company_settings SET stripe_customer_id = $1, updated_at = now() WHERE id = 1', [customer.id]);
  // Mirrored into the platform DB too — the Stripe webhook is public and has
  // no JWT/slug, so it has no other way to resolve which tenant a given
  // Stripe customer id belongs to (see stripeWebhook below).
  await platformPool.query('UPDATE companies SET stripe_customer_id = $1, updated_at = now() WHERE tenant_db_name = $2', [customer.id, getCurrentTenantDb()]);
  return customer.id;
}

// Starts card/Google Pay collection: creates (or reuses) the Stripe Customer
// and a SetupIntent, returning the client_secret the frontend needs to
// confirm the payment method with Stripe.js directly (card details never
// touch our backend). 503s cleanly if Stripe isn't configured yet.
const createSetupIntent = async (req, res) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to enable payment collection.' });
  }
  try {
    const customerId = await ensureStripeCustomer(stripe);
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session', // future off-session charges for the monthly invoice
    });
    res.json({ success: true, clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    res.status(500).json({ error: 'Failed to start payment method setup' });
  }
};

// Called after the frontend has confirmed the SetupIntent with Stripe.js —
// attaches the resulting PaymentMethod as the customer's default and saves
// its display details (brand/last4/exp) for the "Payment Method" card.
const confirmPaymentMethod = async (req, res) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured yet.' });
  }
  const { paymentMethodId, type } = req.body;
  if (!paymentMethodId || typeof paymentMethodId !== 'string') {
    return res.status(400).json({ error: 'paymentMethodId is required' });
  }
  try {
    const customerId = await ensureStripeCustomer(stripe);
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Attach is a no-op error if already attached to this customer — that's
    // fine, it just means confirmPaymentMethod is being retried.
    if (paymentMethod.customer !== customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    }
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });

    const card = paymentMethod.card || {};
    await pool.query(
      `UPDATE company_settings SET
         stripe_default_payment_method_id = $1,
         stripe_default_pm_type = $2,
         stripe_default_pm_brand = $3,
         stripe_default_pm_last4 = $4,
         stripe_default_pm_exp = $5,
         subscription_started_at = COALESCE(subscription_started_at, now()),
         updated_at = now()
       WHERE id = 1`,
      [
        paymentMethodId,
        type === 'google_pay' ? 'google_pay' : 'card',
        card.brand || null,
        card.last4 || null,
        card.exp_month && card.exp_year ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}` : null,
      ]
    );

    logAudit({ req, action: 'subscription_payment_method_updated', resourceType: 'subscription', resourceId: '1', details: { brand: card.brand, last4: card.last4 } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error confirming payment method:', error);
    res.status(500).json({ error: 'Failed to save payment method' });
  }
};

// Closes out a billing period into a subscription_invoices row and, if a
// default payment method is on file, attempts an off-session charge for it.
// Shared by the ceo-triggered manual button (generateInvoice) and the
// automatic scheduled run (runScheduledBilling) — same close-out logic
// either way, they just differ in which period and how they're authenticated.
//
// `at` is always derived from periodStart, never passed in independently —
// computeCurrentPeriodSummary computes its own period internally from `at`,
// so periodStart/periodEnd (what gets written to the row) and the summary
// numbers (what gets computed) must come from the exact same date or they
// silently drift apart (e.g. a June period getting July's activity counted
// into it because `at` defaulted to "now").
async function closePeriodInvoice(periodStart, periodEnd) {
  // Noon UTC, not midnight — computeCurrentPeriodSummary resolves the
  // period from this instant's Eastern-time calendar date (see
  // subscriptionBilling.js's easternParts), and midnight UTC is already the
  // previous day on the US East Coast under any DST offset.
  const summary = await computeCurrentPeriodSummary(new Date(`${periodStart}T12:00:00Z`));

  const { rows: existing } = await pool.query(
    'SELECT id, status FROM subscription_invoices WHERE period_start = $1 AND period_end = $2',
    [periodStart, periodEnd]
  );
  if (existing[0] && existing[0].status === 'paid') {
    const err = new Error('This period already has a paid invoice.');
    err.statusCode = 409;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO subscription_invoices
       (period_start, period_end, active_practitioner_count, price_per_practitioner, practitioner_charge,
        office_staff_count, included_staff_seats, extra_staff_seats, extra_staff_seat_price, extra_staff_charge,
        total_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
     ON CONFLICT (period_start, period_end) DO UPDATE SET
       active_practitioner_count = EXCLUDED.active_practitioner_count,
       price_per_practitioner = EXCLUDED.price_per_practitioner,
       practitioner_charge = EXCLUDED.practitioner_charge,
       office_staff_count = EXCLUDED.office_staff_count,
       included_staff_seats = EXCLUDED.included_staff_seats,
       extra_staff_seats = EXCLUDED.extra_staff_seats,
       extra_staff_seat_price = EXCLUDED.extra_staff_seat_price,
       extra_staff_charge = EXCLUDED.extra_staff_charge,
       total_amount = EXCLUDED.total_amount
     RETURNING *`,
    [
      periodStart, periodEnd, summary.activePractitionerCount, summary.pricePerPractitioner, summary.practitionerCharge,
      summary.officeStaffCount, summary.includedStaffSeats, summary.extraStaffSeats, summary.extraStaffSeatPrice, summary.extraStaffCharge,
      summary.totalAmount,
    ]
  );
  let invoice = rows[0];

  const stripe = getStripeClient();
  const settings = await getSubscriptionSettings();
  if (stripe && settings.stripeCustomerId && settings.defaultPaymentMethodId && Number(invoice.total_amount) > 0) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(Number(invoice.total_amount) * 100),
        currency: 'usd',
        customer: settings.stripeCustomerId,
        payment_method: settings.defaultPaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Izaya subscription — ${periodStart} to ${periodEnd}`,
        metadata: { subscription_invoice_id: invoice.id },
      });
      const { rows: updated } = await pool.query(
        `UPDATE subscription_invoices SET status = $1, stripe_payment_intent_id = $2, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END WHERE id = $3 RETURNING *`,
        [paymentIntent.status === 'succeeded' ? 'paid' : 'pending', paymentIntent.id, invoice.id]
      );
      invoice = updated[0];
    } catch (chargeError) {
      console.error('Off-session subscription charge failed:', chargeError.message);
      const { rows: updated } = await pool.query(
        `UPDATE subscription_invoices SET status = 'failed', failure_reason = $1 WHERE id = $2 RETURNING *`,
        [chargeError.message, invoice.id]
      );
      invoice = updated[0];
    }
  }

  return invoice;
}

// Manual "Close & Bill Last Period" button (ceo). Accepts an explicit
// period override (used e.g. for backfilling), otherwise closes the just-
// completed calendar month.
const generateInvoice = async (req, res) => {
  try {
    const { periodStart: reqStart, periodEnd: reqEnd } = req.body || {};
    const { periodStart, periodEnd } = reqStart && reqEnd ? { periodStart: reqStart, periodEnd: reqEnd } : getPreviousPeriodBounds();

    const invoice = await closePeriodInvoice(periodStart, periodEnd);
    logAudit({ req, action: 'subscription_invoice_generated', resourceType: 'subscription_invoice', resourceId: invoice.id, details: { periodStart, periodEnd, totalAmount: invoice.total_amount, status: invoice.status, trigger: 'manual' } });
    res.json({ success: true, invoice });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error generating subscription invoice:', error);
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
};

// Manual "Pay Bill" button (ceo) — retries the off-session charge for a
// pending/failed invoice using whatever payment method is currently on file.
// Reuses the same charge-and-record logic as closePeriodInvoice's automatic
// attempt, just re-entered on demand instead of only at period-close time.
const payInvoice = async (req, res) => {
  try {
    await markOverdueInvoices();
    const { rows } = await pool.query('SELECT * FROM subscription_invoices WHERE id = $1', [req.params.id]);
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(400).json({ error: 'This invoice is already paid.' });

    const stripe = getStripeClient();
    const settings = await getSubscriptionSettings();
    if (!stripe || !settings.stripeCustomerId || !settings.defaultPaymentMethodId) {
      return res.status(400).json({ error: 'No payment method is on file yet — add one before paying this bill.' });
    }

    let updatedInvoice = invoice;
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(Number(invoice.total_amount) * 100),
        currency: 'usd',
        customer: settings.stripeCustomerId,
        payment_method: settings.defaultPaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Izaya subscription — ${invoice.period_start} to ${invoice.period_end}`,
        metadata: { subscription_invoice_id: invoice.id },
      });
      const { rows: updated } = await pool.query(
        `UPDATE subscription_invoices SET status = $1, stripe_payment_intent_id = $2, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END WHERE id = $3 RETURNING *`,
        [paymentIntent.status === 'succeeded' ? 'paid' : 'pending', paymentIntent.id, invoice.id]
      );
      updatedInvoice = updated[0];
    } catch (chargeError) {
      console.error('Manual subscription charge failed:', chargeError.message);
      const { rows: updated } = await pool.query(
        `UPDATE subscription_invoices SET status = 'failed', failure_reason = $1 WHERE id = $2 RETURNING *`,
        [chargeError.message, invoice.id]
      );
      updatedInvoice = updated[0];
    }

    logAudit({ req, action: 'subscription_invoice_paid_manually', resourceType: 'subscription_invoice', resourceId: invoice.id, details: { status: updatedInvoice.status } });

    if (updatedInvoice.status !== 'paid') {
      return res.status(402).json({ error: updatedInvoice.failure_reason || 'Payment did not succeed.', invoice: updatedInvoice });
    }
    res.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error('Error paying subscription invoice:', error);
    res.status(500).json({ error: 'Failed to pay invoice' });
  }
};

// Automatic monthly run — hit by Cloud Scheduler on the 1st of each month
// to close out the previous calendar month (invoiceDueDate then gives a
// genuine ~2-week grace period to the 15th, rather than landing generation
// and due-date on the same day). Not JWT-protected (Cloud
// Scheduler has no user session); instead gated on a shared secret header
// so this can't be triggered by an arbitrary request. Fails closed: if
// CRON_SECRET isn't configured, every request is rejected rather than the
// check being silently skipped.
//
// Multi-tenant: there's no single implicit tenant anymore, so this loops
// over every non-cancelled company in the platform registry and closes
// each one's period independently — one tenant's failure doesn't stop the
// others from being billed.
const runScheduledBilling = async (req, res) => {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || req.headers['x-cron-secret'] !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { rows: companies } = await platformPool.query("SELECT slug, tenant_db_name FROM companies WHERE status IN ('trial', 'active')");
    const results = [];
    for (const { slug, tenant_db_name } of companies) {
      try {
        const invoice = await runWithTenant(tenant_db_name, async () => {
          const { periodStart, periodEnd } = getPreviousPeriodBounds();
          const inv = await closePeriodInvoice(periodStart, periodEnd);
          logAudit({ actorEmail: 'scheduler@izayaedge.com', actorRole: 'system', action: 'subscription_invoice_generated', resourceType: 'subscription_invoice', resourceId: inv.id, details: { periodStart, periodEnd, totalAmount: inv.total_amount, status: inv.status, trigger: 'scheduled' } });
          return inv;
        });
        results.push({ slug, status: invoice.status });
      } catch (tenantError) {
        console.error(`Scheduled billing failed for tenant "${slug}":`, tenantError.message);
        results.push({ slug, error: tenantError.message });
      }
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error running scheduled subscription billing:', error);
    res.status(500).json({ error: 'Failed to run scheduled billing' });
  }
};

// Optional explicit Cloud Scheduler target for the 16th of each month —
// the overdue sweep also runs lazily on every getInvoices/payInvoice call,
// so this endpoint isn't required for correctness, but wiring a scheduled
// job here makes the pending -> overdue transition happen right on the
// 16th even if nobody opens the billing screen that day. Same shared-secret
// auth pattern as runScheduledBilling; loops over every tenant for the same
// reason as above.
const runOverdueSweep = async (req, res) => {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || req.headers['x-cron-secret'] !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { rows: companies } = await platformPool.query("SELECT slug, tenant_db_name FROM companies WHERE status IN ('trial', 'active')");
    let overdueCount = 0;
    for (const { slug, tenant_db_name } of companies) {
      try {
        overdueCount += await runWithTenant(tenant_db_name, () => markOverdueInvoices());
      } catch (tenantError) {
        console.error(`Overdue sweep failed for tenant "${slug}":`, tenantError.message);
      }
    }
    res.json({ success: true, overdueCount });
  } catch (error) {
    console.error('Error running overdue invoice sweep:', error);
    res.status(500).json({ error: 'Failed to run overdue sweep' });
  }
};

// Stripe webhook — mounted with express.raw() BEFORE the global express.json()
// parser (see index.js), since signature verification needs the exact raw
// body bytes. No-ops (200, does nothing) if STRIPE_WEBHOOK_SECRET isn't set,
// rather than erroring, so an unconfigured deployment doesn't 500 on stray traffic.
//
// Multi-tenant: this endpoint is public and carries no JWT/slug, so it must
// resolve which tenant a given Stripe customer id belongs to before
// touching `pool` at all — done via the platform DB's companies.stripe_customer_id
// mirror (kept in sync by ensureStripeCustomer above), then the rest of the
// handling runs inside runWithTenant(...) for that one tenant.
const stripeWebhook = async (req, res) => {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return res.status(200).json({ received: true, note: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const relevantTypes = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_method.updated', 'payment_method.attached'];
  if (!relevantTypes.includes(event.type)) {
    return res.json({ received: true });
  }

  const stripeCustomerId = event.data.object.customer;
  if (!stripeCustomerId) {
    return res.json({ received: true });
  }

  try {
    const { rows } = await platformPool.query('SELECT tenant_db_name FROM companies WHERE stripe_customer_id = $1', [stripeCustomerId]);
    const tenantDbName = rows[0]?.tenant_db_name;
    if (!tenantDbName) {
      console.error(`Stripe webhook: no tenant found for customer ${stripeCustomerId}`);
      return res.json({ received: true });
    }

    await runWithTenant(tenantDbName, async () => {
      if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';
        await pool.query(
          `UPDATE subscription_invoices SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END,
             failure_reason = CASE WHEN $1 = 'failed' THEN $2 ELSE failure_reason END
           WHERE stripe_payment_intent_id = $3`,
          [status, intent.last_payment_error?.message || null, intent.id]
        );
      } else {
        const pm = event.data.object;
        const card = pm.card || {};
        await pool.query(
          `UPDATE company_settings SET stripe_default_pm_brand = $1, stripe_default_pm_last4 = $2, stripe_default_pm_exp = $3, updated_at = now()
           WHERE id = 1 AND stripe_default_payment_method_id = $4`,
          [card.brand || null, card.last4 || null, card.exp_month && card.exp_year ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}` : null, pm.id]
        );
      }
    });

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling Stripe webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

module.exports = {
  getConfig,
  getSummary,
  getInvoices,
  getInvoicePdf,
  getPaymentMethod,
  createSetupIntent,
  confirmPaymentMethod,
  generateInvoice,
  payInvoice,
  runScheduledBilling,
  runOverdueSweep,
  stripeWebhook,
};
