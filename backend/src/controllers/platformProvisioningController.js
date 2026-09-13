const jwt = require('jsonwebtoken');
const { platformPool } = require('../config/platformDb');
const { pool: tenantProxyPool } = require('../config/db');
const { getTenantPool, evictTenantPool } = require('../config/tenantPoolRegistry');
const { getProvisioningPool } = require('../config/provisioningDb');
const { runWithTenant } = require('../config/tenantContext');
const { provisionTenantDatabase } = require('../utils/tenantProvisioning');
const { insertInvitedPractitioner } = require('../utils/practitionerRegistration');
const { SLUG_REGEX, RESERVED_SLUGS, TRIAL_DAYS } = require('../constants/signup');
const { logPlatformAudit } = require('../utils/platformAuditLog');
const { tenantPoolForSlug } = require('./platformAdminController');

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

function validateCreateCompanyPayload(body) {
  const slug = String(body.slug || '').toLowerCase().trim();
  if (!SLUG_REGEX.test(slug)) {
    return 'Company code must be 3-40 characters, lowercase letters/numbers/hyphens only.';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'This company code is reserved — please choose another.';
  }
  if (!body.displayName || !String(body.displayName).trim()) {
    return 'Company display name is required.';
  }
  if (!body.email || !String(body.email).trim()) {
    return 'Company contact email is required.';
  }
  if (!body.adminFirstName || !body.adminLastName || !body.adminEmail) {
    return "The customer admin's name and email are required.";
  }
  return null;
}

// Platform-admin-triggered company creation — no self-signup, no BAA
// pre-acceptance. The customer's admin gets a normal activation email and
// must accept the BAA themselves on first login; a hidden Izaya Support
// account is also created so a platform admin can later enter the tenant
// (once the BAA is accepted — see impersonateCompany's hard gate below).
const createCompany = async (req, res) => {
  const validationError = validateCreateCompanyPayload(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const slug = String(req.body.slug).toLowerCase().trim();
  const {
    displayName, legalEntityName, address, phone, email,
    adminFirstName, adminLastName, adminEmail,
  } = req.body;

  const { rows: existingCompany } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [slug]);
  if (existingCompany[0]) return res.status(409).json({ error: 'This company code is already taken.' });

  const tenantDbName = `tenant_${slug.replace(/-/g, '_')}`;

  try {
    const { adminRoleId } = await provisionTenantDatabase({ slug, tenantDbName });

    await runWithTenant(tenantDbName, async () => {
      await tenantProxyPool.query(
        `INSERT INTO company_settings (id, display_name, legal_entity_name, address, phone, billing_email)
         VALUES (1, $1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, legal_entity_name = EXCLUDED.legal_entity_name,
           address = EXCLUDED.address, phone = EXCLUDED.phone, billing_email = EXCLUDED.billing_email`,
        [displayName.trim(), legalEntityName?.trim() || null, address?.trim() || null, phone?.trim() || null, email.trim()]
      );

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';

      // Hidden Izaya Support account — never emailed, never logged into via
      // a password (insertInvitedPractitioner's INVITE_PENDING placeholder
      // can never match a real bcrypt compare). Only reachable via a
      // platform-admin-minted impersonation JWT (impersonateCompany below).
      const supportResult = await insertInvitedPractitioner({
        firstName: 'Izaya', lastName: 'Support', email: `support+${slug}@izayaedge.com`,
        legacyRole: 'ceo', resolvedRoleId: adminRoleId, slug, frontendUrl,
        sendEmail: false, isPlatformSupport: true,
      });
      if (!supportResult.ok) throw new Error(`Failed to create support account: ${supportResult.error}`);

      // The customer's real admin — a normal invite-pending account, real
      // activation email, sets their own password. This is what forces the
      // BAA-acceptance flow: the platform admin never touches this account.
      const adminResult = await insertInvitedPractitioner({
        firstName: adminFirstName.trim(), lastName: adminLastName.trim(), email: adminEmail.trim(),
        legacyRole: 'ceo', resolvedRoleId: adminRoleId, slug, frontendUrl, sendEmail: true,
      });
      if (!adminResult.ok) throw new Error(`Failed to create admin account: ${adminResult.error}`);
    });

    // BAA left unaccepted on purpose — the customer's own admin must accept
    // it themselves (BaaGate) before a platform admin can impersonate in.
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await platformPool.query(
      `INSERT INTO companies (slug, display_name, legal_entity_name, address, phone, email, tenant_db_name, status, trial_ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'trial',$8)`,
      [slug, displayName.trim(), legalEntityName?.trim() || null, address?.trim() || null, phone?.trim() || null, email.trim(), tenantDbName, trialEndsAt]
    );

    await logPlatformAudit({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'company_created',
      targetCompanySlug: slug,
      details: { adminEmail: adminEmail.trim(), displayName: displayName.trim() },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      success: true,
      slug,
      message: "Company created. The customer's admin will receive an activation email and must accept the BAA on first login before Izaya Support can enter.",
    });
  } catch (error) {
    console.error('createCompany provisioning error:', error);
    try {
      await evictTenantPool(tenantDbName);
      await getProvisioningPool().query(`DROP DATABASE IF EXISTS "${tenantDbName}"`);
    } catch (cleanupError) {
      console.error(`Failed to clean up orphaned database ${tenantDbName}:`, cleanupError.message);
    }
    res.status(500).json({ error: 'Failed to create company.' });
  }
};

// Mints a short-lived tenant-shaped JWT for the tenant's hidden Izaya
// Support account, letting a platform admin land in that company's
// admin-dashboard without ever touching the customer's own admin identity.
//
// Hard BAA gate: this is the legal/compliance boundary discussed in the
// design — a BAA authorizes Izaya to touch PHI on the covered entity's
// behalf only once it's actually in force, so impersonation is refused
// outright until the customer's own admin has accepted it. Not bypassed
// for any reason.
const impersonateCompany = async (req, res) => {
  const { slug } = req.params;
  try {
    const { rows } = await platformPool.query(
      'SELECT status, trial_ends_at, baa_accepted_at, tenant_db_name, display_name FROM companies WHERE slug = $1',
      [slug]
    );
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    if (!company.baa_accepted_at) {
      return res.status(403).json({
        error: "This company has not accepted the BAA yet. The customer's admin must accept it before Izaya Support can enter.",
        code: 'BAA_NOT_ACCEPTED',
      });
    }

    const tenantPool = getTenantPool(company.tenant_db_name);
    const { rows: supportRows } = await tenantPool.query(
      'SELECT id, email FROM practitioners WHERE is_platform_support = true LIMIT 2'
    );
    if (supportRows.length === 0) {
      return res.status(409).json({
        error: 'This company has no Izaya Support account yet. Run the backfill first.',
        code: 'NO_SUPPORT_ACCOUNT',
      });
    }
    if (supportRows.length > 1) {
      console.warn(`Tenant ${slug} has ${supportRows.length} is_platform_support rows — using the first.`);
    }
    const support = supportRows[0];

    const startedAt = new Date().toISOString();
    const token = jwt.sign(
      {
        practitionerId: support.id,
        email: support.email,
        role: 'ceo',
        slug,
        tenantDb: company.tenant_db_name,
        isPlatformSupport: true,
        impersonation: {
          platformAdminId: req.platformAdmin.platformAdminId,
          platformAdminEmail: req.platformAdmin.email,
          startedAt,
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: '3h' }
    );

    await logPlatformAudit({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'impersonation_started',
      targetCompanySlug: slug,
      details: { targetPractitionerId: support.id },
      ipAddress: clientIp(req),
    });

    res.json({ success: true, token, slug, companyDisplayName: company.display_name });
  } catch (error) {
    console.error('impersonateCompany error:', error);
    res.status(500).json({ error: 'Failed to start impersonation session.' });
  }
};

// Idempotent backfill for any tenant that predates this feature (e.g. the
// existing production tenant, provisioned before is_platform_support
// existed) — or any tenant that somehow ended up without one. Safe to call
// repeatedly: a no-op once a support account already exists.
const ensureSupportAccount = async (req, res) => {
  const { slug } = req.params;
  try {
    const tenantPool = await tenantPoolForSlug(slug);
    if (!tenantPool) return res.status(404).json({ error: 'Company not found.' });

    const { rows: existing } = await tenantPool.query(
      'SELECT id FROM practitioners WHERE is_platform_support = true LIMIT 1'
    );
    if (existing[0]) {
      return res.json({ success: true, created: false, message: 'This company already has an Izaya Support account.' });
    }

    const { rows: companyRows } = await platformPool.query('SELECT tenant_db_name FROM companies WHERE slug = $1', [slug]);
    const tenantDbName = companyRows[0].tenant_db_name;

    const { rows: adminRoleRows } = await tenantPool.query('SELECT id FROM roles WHERE is_system = true LIMIT 1');
    const adminRoleId = adminRoleRows[0]?.id || null;

    const result = await runWithTenant(tenantDbName, () => {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
      return insertInvitedPractitioner({
        firstName: 'Izaya', lastName: 'Support', email: `support+${slug}@izayaedge.com`,
        legacyRole: 'ceo', resolvedRoleId: adminRoleId, slug, frontendUrl,
        sendEmail: false, isPlatformSupport: true,
      });
    });
    if (!result.ok) return res.status(500).json({ error: `Failed to create support account: ${result.error}` });

    await logPlatformAudit({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'support_account_backfilled',
      targetCompanySlug: slug,
      ipAddress: clientIp(req),
    });

    res.json({ success: true, created: true });
  } catch (error) {
    console.error('ensureSupportAccount error:', error);
    res.status(500).json({ error: 'Failed to backfill support account.' });
  }
};

module.exports = { createCompany, impersonateCompany, ensureSupportAccount };
