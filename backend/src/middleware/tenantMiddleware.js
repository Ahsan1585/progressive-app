const { platformPool } = require('../config/platformDb');
const { runWithTenant } = require('../config/tenantContext');

async function lookupCompanyBySlug(slug) {
  const { rows } = await platformPool.query(
    `SELECT id, slug, display_name, tenant_db_name, status, trial_ends_at
     FROM companies WHERE slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

// Used only on the handful of intentionally-public, slug-carrying routes —
// login, forgot-password, reset-password, signup-confirm, invite-activation.
// Everything else gets its tenant context from the JWT via authMiddleware's
// `protect` instead (see E0.1/E0.2 in the multi-tenant-foundation plan) —
// this middleware is the only place the platform DB is consulted on the
// hot path, and only for these first-contact-with-a-company requests.
function resolveTenantBySlug(req, res, next) {
  const slug = String(req.body?.slug || req.params?.companySlug || '').toLowerCase().trim();
  if (!slug) {
    return res.status(400).json({ error: 'Company code is required' });
  }

  lookupCompanyBySlug(slug)
    .then((company) => {
      if (!company) {
        return res.status(404).json({ error: 'Unknown company code' });
      }
      if (company.status === 'cancelled') {
        return res.status(403).json({ error: 'This company\'s account has been cancelled.' });
      }
      req.company = company;
      runWithTenant(company.tenant_db_name, next);
    })
    .catch(next);
}

module.exports = { resolveTenantBySlug, lookupCompanyBySlug };
