const { pool } = require('../config/db');
const { platformPool } = require('../config/platformDb');
const { runWithTenant } = require('../config/tenantContext');
const { getOutstandingInvoices } = require('./subscriptionController');
const { getSubscriptionSettings, computeCurrentPeriodSummary } = require('../utils/subscriptionBilling');
const { logPlatformAudit } = require('../utils/platformAuditLog');

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key]), 0);

// Platform-wide AR rollup — one row per company, built by hopping into each
// tenant's own database (runWithTenant) and reusing the exact same
// getOutstandingInvoices()/getSubscriptionSettings() that a company's own
// admin's billing screen already relies on. Deliberately not a duplicate
// calculation: whatever a tenant sees for itself is exactly what shows up
// here, just aggregated across every tenant in one place.
//
// Includes 'suspended' companies (unlike the billing cron's own loop in
// subscriptionController.js, which only processes 'trial'/'active' — a
// suspended company's still-outstanding balance is the whole point of this
// dashboard, so it must stay visible here even though the cron no longer
// touches it). Only 'cancelled' companies are excluded.
//
// NOTE: getPractitionerActivity/getOfficeStaffCount/the total-practitioner
// count in subscriptionBilling.js (used indirectly via getSubscriptionSettings
// -> computeCurrentPeriodSummary elsewhere, and directly by the per-tenant
// billing screen) do not exclude is_platform_support = true practitioners,
// unlike the roster-listing convention used elsewhere (see
// add_platform_support_flag.sql). A hidden Izaya Support account with
// role='practitioner' that ever logs anything could inflate a company's
// active-practitioner count and therefore its invoice total. Pre-existing
// gap, not introduced or fixed here — flagged so it isn't mistaken for
// verified-correct just because it's now surfaced platform-wide.
const listBillingOverview = async (req, res) => {
  try {
    const { rows: companyRows } = await platformPool.query(
      "SELECT slug, display_name, status FROM companies WHERE status != 'cancelled' ORDER BY display_name ASC"
    );
    // tenant_db_name isn't needed by the caller's response, but IS needed to
    // open the right tenant pool — fetched separately to keep the SELECT
    // above focused on what's actually returned.
    const { rows: dbNameRows } = await platformPool.query(
      "SELECT slug, tenant_db_name FROM companies WHERE status != 'cancelled'"
    );
    const dbNameBySlug = Object.fromEntries(dbNameRows.map((r) => [r.slug, r.tenant_db_name]));

    const companies = [];
    for (const c of companyRows) {
      const tenantDbName = dbNameBySlug[c.slug];
      try {
        const { outstanding, settings } = await runWithTenant(tenantDbName, async () => {
          const invoices = await getOutstandingInvoices();
          const subSettings = await getSubscriptionSettings();
          return { outstanding: invoices, settings: subSettings };
        });

        const overdueInvoices = outstanding.filter((inv) => inv.status === 'overdue');
        companies.push({
          slug: c.slug,
          displayName: c.display_name,
          status: c.status,
          outstandingTotal: Math.round(sum(outstanding, 'total_amount') * 100) / 100,
          outstandingCount: outstanding.length,
          overdueTotal: Math.round(sum(overdueInvoices, 'total_amount') * 100) / 100,
          overdueCount: overdueInvoices.length,
          hasPaymentMethod: !!settings.defaultPaymentMethodId,
          oldestOverdueDate: overdueInvoices.length > 0 ? overdueInvoices[0].period_end : null,
        });
      } catch (tenantError) {
        console.error(`Billing overview failed for tenant "${c.slug}":`, tenantError.message);
        companies.push({ slug: c.slug, displayName: c.display_name, status: c.status, error: 'Failed to load billing data for this company.' });
      }
    }

    const ok = companies.filter((c) => !c.error);
    const totals = {
      outstandingTotal: Math.round(sum(ok, 'outstandingTotal') * 100) / 100,
      overdueTotal: Math.round(sum(ok, 'overdueTotal') * 100) / 100,
      companiesOverdue: ok.filter((c) => c.overdueCount > 0).length,
      companiesNoPaymentMethod: ok.filter((c) => !c.hasPaymentMethod).length,
    };

    res.json({ success: true, companies, totals });
  } catch (error) {
    console.error('listBillingOverview error:', error);
    res.status(500).json({ error: 'Failed to load billing overview.' });
  }
};

// Single-company drill-down — same invoice history + live current-period
// estimate a company's own admin sees in SubscriptionBilling.jsx, just
// fetched cross-tenant by slug instead of from within that tenant's own
// session.
const getCompanyBillingDetail = async (req, res) => {
  const { slug } = req.params;
  try {
    const { rows } = await platformPool.query('SELECT tenant_db_name, display_name FROM companies WHERE slug = $1', [slug]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const { invoices, summary } = await runWithTenant(company.tenant_db_name, async () => {
      const { rows: invoiceRows } = await pool.query(
        `SELECT id, period_start, period_end, active_practitioner_count, office_staff_count,
                extra_staff_seats, total_amount, status, paid_at, created_at
         FROM subscription_invoices
         ORDER BY period_start DESC
         LIMIT 24`
      );
      const currentSummary = await computeCurrentPeriodSummary();
      return { invoices: invoiceRows, summary: currentSummary };
    });

    res.json({ success: true, slug, displayName: company.display_name, invoices, summary });
  } catch (error) {
    console.error('getCompanyBillingDetail error:', error);
    res.status(500).json({ error: 'Failed to load billing detail for this company.' });
  }
};

// Not restricted to companies with an outstanding balance — a platform
// admin may need to suspend for other reasons (policy, etc.), so this is a
// general-purpose suspend gated only on the company's current status, not
// on its AR. The required `reason` is what keeps a one-click mistake from
// happening and gives the audit trail a real "why" to look back on later.
const suspendCompany = async (req, res) => {
  const { slug } = req.params;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required to suspend a company.' });

  try {
    const { rows } = await platformPool.query('SELECT status FROM companies WHERE slug = $1', [slug]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    if (company.status === 'suspended') return res.status(400).json({ error: 'This company is already suspended.' });
    if (company.status === 'cancelled') return res.status(400).json({ error: 'This company is cancelled — suspend does not apply.' });

    await platformPool.query("UPDATE companies SET status = 'suspended', updated_at = now() WHERE slug = $1", [slug]);
    await logPlatformAudit({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'company_suspended',
      targetCompanySlug: slug,
      details: { reason },
      ipAddress: clientIp(req),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('suspendCompany error:', error);
    res.status(500).json({ error: 'Failed to suspend company.' });
  }
};

// Undoes a suspension only — not a general status-setter. Deliberately does
// NOT touch subscription_invoices: restoring access and clearing a debt are
// different actions. The company still owes whatever it owed; its own
// admin (or a platform admin via impersonation, since impersonation already
// bypasses the suspended/trial-expired gate) resolves that afterward
// through the existing Pay Bill flow.
const reactivateCompany = async (req, res) => {
  const { slug } = req.params;
  try {
    const { rows } = await platformPool.query('SELECT status FROM companies WHERE slug = $1', [slug]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    if (company.status !== 'suspended') return res.status(400).json({ error: 'This company is not currently suspended.' });

    await platformPool.query("UPDATE companies SET status = 'active', updated_at = now() WHERE slug = $1", [slug]);
    await logPlatformAudit({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'company_reactivated',
      targetCompanySlug: slug,
      ipAddress: clientIp(req),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('reactivateCompany error:', error);
    res.status(500).json({ error: 'Failed to reactivate company.' });
  }
};

module.exports = { listBillingOverview, getCompanyBillingDetail, suspendCompany, reactivateCompany };
