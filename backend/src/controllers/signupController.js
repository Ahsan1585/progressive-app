const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { platformPool } = require('../config/platformDb');
const { getProvisioningPool } = require('../config/provisioningDb');
const { getTenantPool, evictTenantPool } = require('../config/tenantPoolRegistry');
const { applyMigrationsToPool } = require('../config/runMigrations');
const { PREBUILT_ROLE_NAMES } = require('../constants/permissions');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { sendSignupConfirmationEmail } = require('../utils/emailClient');
const { logAudit } = require('../utils/auditLog');

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;
// Must not collide with an existing app route or a future subdomain.
const RESERVED_SLUGS = new Set([
  'api', 'www', 'admin', 'platform', 'signup', 'activate', 'login',
  'logout', 'app', 'assets', 'static', 'mail', 'support', 'help', 'eis',
]);
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TRIAL_DAYS = 15;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function validateSignupPayload(body) {
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
  if (!body.ceoFirstName || !body.ceoLastName || !body.ceoEmail) {
    return "The signing-up admin's name and email are required.";
  }
  if (!isPasswordStrong(body.ceoPassword)) {
    return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';
  }
  if (!body.baaAccepted || !body.baaAcceptedByName || !body.baaAcceptedByEmail) {
    return 'You must accept the Business Associate Agreement to sign up.';
  }
  return null;
}

// --- Step 1: submit signup form -> email verification, no infra touched yet ---
// Provisioning a real Postgres database is deferred until the confirmation
// link is clicked (see confirmSignup below) — this endpoint is public and
// unauthenticated, so it must not be able to trigger CREATE DATABASE on a
// bare form submission (abuse/resource-exhaustion risk, closed as part of
// the multi-tenant-foundation plan's design-review pass, section E0.4).
const requestSignup = async (req, res) => {
  try {
    const validationError = validateSignupPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const slug = String(req.body.slug).toLowerCase().trim();
    const ceoEmail = String(req.body.ceoEmail).trim().toLowerCase();

    const { rows: existingCompany } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [slug]);
    if (existingCompany[0]) return res.status(409).json({ error: 'This company code is already taken.' });

    const ceoPasswordHash = await bcrypt.hash(req.body.ceoPassword, await bcrypt.genSalt(10));

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();

    await platformPool.query(
      `INSERT INTO pending_signups
         (slug, display_name, legal_entity_name, address, phone, email,
          ceo_first_name, ceo_last_name, ceo_email, ceo_password_hash,
          baa_accepted_at, baa_accepted_by_name, baa_accepted_by_email,
          confirm_token_hash, confirm_token_expires)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11,$12, $13,$14)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name, legal_entity_name = EXCLUDED.legal_entity_name,
         address = EXCLUDED.address, phone = EXCLUDED.phone, email = EXCLUDED.email,
         ceo_first_name = EXCLUDED.ceo_first_name, ceo_last_name = EXCLUDED.ceo_last_name,
         ceo_email = EXCLUDED.ceo_email, ceo_password_hash = EXCLUDED.ceo_password_hash,
         baa_accepted_at = now(), baa_accepted_by_name = EXCLUDED.baa_accepted_by_name, baa_accepted_by_email = EXCLUDED.baa_accepted_by_email,
         confirm_token_hash = EXCLUDED.confirm_token_hash, confirm_token_expires = EXCLUDED.confirm_token_expires`,
      [
        slug, req.body.displayName.trim(), req.body.legalEntityName?.trim() || null,
        req.body.address?.trim() || null, req.body.phone?.trim() || null, req.body.email.trim(),
        req.body.ceoFirstName.trim(), req.body.ceoLastName.trim(), ceoEmail, ceoPasswordHash,
        req.body.baaAcceptedByName.trim(), req.body.baaAcceptedByEmail.trim(),
        tokenHash, tokenExpiresAt,
      ]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const confirmUrl = `${frontendUrl}/signup/confirm/${rawToken}`;
    try {
      await sendSignupConfirmationEmail(req.body.email.trim(), { confirmUrl, companyName: req.body.displayName.trim() });
    } catch (emailError) {
      console.error('Failed to send signup confirmation email:', emailError);
    }

    res.status(202).json({ success: true, message: 'Check your email to confirm your signup and finish setting up your account.' });
  } catch (error) {
    console.error('Signup request error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Step 2: confirmation link clicked -> actually provision the tenant database ---
const confirmSignup = async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).json({ error: 'A confirmation token is required.' });

  let pending;
  try {
    const tokenHash = hashToken(token);
    const { rows } = await platformPool.query('SELECT * FROM pending_signups WHERE confirm_token_hash = $1', [tokenHash]);
    pending = rows[0];
    if (!pending || new Date(pending.confirm_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This confirmation link is invalid or has expired. Please sign up again.' });
    }

    const { rows: existingCompany } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [pending.slug]);
    if (existingCompany[0]) {
      await platformPool.query('DELETE FROM pending_signups WHERE slug = $1', [pending.slug]);
      return res.status(409).json({ error: 'This company code was already claimed. Please sign up again with a different one.' });
    }
  } catch (error) {
    console.error('Signup confirmation lookup error:', error);
    return res.status(500).json({ error: 'Server error' });
  }

  const tenantDbName = `tenant_${pending.slug.replace(/-/g, '_')}`;

  try {
    // CREATE DATABASE cannot run inside a transaction block — a plain,
    // autocommit query via the elevated, CREATEDB-only provisioning
    // connection (see provisioningDb.js; deliberately never the same
    // credential the everyday tenant pools use).
    await getProvisioningPool().query(`CREATE DATABASE "${tenantDbName}"`);

    const tenantPool = getTenantPool(tenantDbName);
    const schemaSql = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
    await tenantPool.query(schemaSql);
    await applyMigrationsToPool(tenantPool, pending.slug);

    await tenantPool.query(
      `INSERT INTO company_settings (id, display_name, legal_entity_name, address, phone, billing_email)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, legal_entity_name = EXCLUDED.legal_entity_name,
         address = EXCLUDED.address, phone = EXCLUDED.phone, billing_email = EXCLUDED.billing_email`,
      [pending.display_name, pending.legal_entity_name, pending.address, pending.phone, pending.email]
    );

    // Seed the Admin role + 4 prebuilt roles for this new tenant. The
    // migrations applied above (applyMigrationsToPool, including
    // add_roles_permissions.sql) already seed these same rows via
    // `WHERE NOT EXISTS` guards, so this must reuse those same guards
    // rather than bare INSERTs — otherwise this would throw a duplicate-key
    // error on every single new signup.
    const { rows: adminRoleRows } = await tenantPool.query(
      `INSERT INTO roles (name, is_system) SELECT 'Admin', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system = true) RETURNING id`
    );
    let adminRoleId = adminRoleRows[0]?.id;
    if (!adminRoleId) {
      const { rows } = await tenantPool.query('SELECT id FROM roles WHERE is_system = true');
      adminRoleId = rows[0].id;
    }
    for (const roleName of PREBUILT_ROLE_NAMES) {
      const { rows: existing } = await tenantPool.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      if (existing[0]) continue;
      const { rows } = await tenantPool.query('INSERT INTO roles (name) VALUES ($1) RETURNING id', [roleName]);
      await tenantPool.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [rows[0].id, 'staff_directory_view']);
    }

    await tenantPool.query(
      `INSERT INTO practitioners (first_name, last_name, email, password_hash, requires_password_change, role, role_id)
       VALUES ($1, $2, $3, $4, false, 'ceo', $5)`,
      [pending.ceo_first_name, pending.ceo_last_name, pending.ceo_email, pending.ceo_password_hash, adminRoleId]
    );

    // Only as the last step, register the tenant in the platform DB — a
    // crash before this point leaves an untracked orphan database rather
    // than a registered-but-broken tenant (see the multi-tenant-foundation
    // plan, section C, step 7).
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await platformPool.query(
      `INSERT INTO companies
         (slug, display_name, legal_entity_name, address, phone, email, tenant_db_name, status, trial_ends_at,
          baa_accepted_at, baa_accepted_by_name, baa_accepted_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'trial',$8,$9,$10,$11)`,
      [
        pending.slug, pending.display_name, pending.legal_entity_name, pending.address, pending.phone, pending.email,
        tenantDbName, trialEndsAt, pending.baa_accepted_at, pending.baa_accepted_by_name, pending.baa_accepted_by_email,
      ]
    );
    await platformPool.query('DELETE FROM pending_signups WHERE slug = $1', [pending.slug]);

    logAudit({
      actorEmail: pending.ceo_email, actorRole: 'ceo', action: 'company_signup_confirmed',
      resourceType: 'company', resourceId: pending.slug, details: { slug: pending.slug, trialEndsAt },
    });

    res.json({ success: true, slug: pending.slug, message: 'Your company is set up. You can now log in.' });
  } catch (error) {
    console.error('Signup provisioning error:', error);
    // Best-effort cleanup — CREATE DATABASE/DROP DATABASE aren't
    // transactional, so this can't be fully guaranteed, but it keeps a
    // failed attempt from leaving a half-provisioned tenant registered
    // nowhere from silently lingering as an unusable, unlisted database.
    try {
      await evictTenantPool(tenantDbName);
      await getProvisioningPool().query(`DROP DATABASE IF EXISTS "${tenantDbName}"`);
    } catch (cleanupError) {
      console.error(`Failed to clean up orphaned database ${tenantDbName}:`, cleanupError.message);
    }
    res.status(500).json({ error: 'Failed to finish setting up your company. Please try signing up again.' });
  }
};

module.exports = { requestSignup, confirmSignup };
