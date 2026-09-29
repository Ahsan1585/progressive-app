// Two-step self-serve registration for an "independent practitioner" — a
// practitioner with no tenant company registering directly with Izaya as a
// $30/month customer. Mirrors signupController.js's shape exactly (request
// -> email-confirm -> provision) but collects a person's own fields
// (discipline, hourly rate, personal address) instead of a company's, and
// creates exactly one practitioners row with role='independent_practitioner'
// instead of a ceo + empty staff directory.
//
// See the independent-practitioner feature plan for full context on why
// this is a separate controller rather than an accountType branch bolted
// onto signupController.js.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { platformPool } = require('../config/platformDb');
const { getProvisioningPool } = require('../config/provisioningDb');
const { evictTenantPool } = require('../config/tenantPoolRegistry');
const { provisionTenantDatabase } = require('../utils/tenantProvisioning');
const { RESERVED_SLUGS, TRIAL_DAYS } = require('../constants/signup');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { sendIndependentSignupConfirmationEmail } = require('../utils/emailClient');
const { logAudit } = require('../utils/auditLog');
const { DISCIPLINE_CODE_MAP, getDisciplineCode } = require('../utils/disciplineCodes');

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// An independent practitioner never types/picks their own slug (unlike a
// tenant company's user-chosen company code) — it's an internal identifier
// only, so any collision is retried silently rather than surfaced as a
// user-facing conflict. Same character set the platform DB's
// companies_slug_format_check enforces: [a-z0-9-]{3,40}.
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'practitioner';
}

async function generateUniqueSlug(fullName) {
  const base = `ip-${slugify(fullName)}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = crypto.randomBytes(3).toString('hex'); // 6 hex chars
    const candidate = `${base}-${suffix}`.slice(0, 40);
    if (RESERVED_SLUGS.has(candidate)) continue;
    const { rows } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [candidate]);
    if (!rows[0]) return candidate;
  }
  throw new Error('Could not generate a unique slug after 10 attempts.');
}

function validateIndependentSignupPayload(body) {
  if (!body.firstName || !String(body.firstName).trim()) return 'First name is required.';
  if (!body.lastName || !String(body.lastName).trim()) return 'Last name is required.';
  if (!body.email || !String(body.email).trim()) return 'Email is required.';
  if (!isPasswordStrong(body.password)) {
    return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';
  }
  if (!body.discipline || !DISCIPLINE_CODE_MAP[body.discipline]) {
    return 'A valid discipline is required.';
  }
  const payRate = Number(body.payRate);
  // Same overflow guard as provisionPractitioner (practitioners.pay_rate is numeric(10,2)).
  if (!body.payRate || Number.isNaN(payRate) || payRate < 0 || payRate >= 100000000) {
    return 'A valid hourly pay rate is required.';
  }
  if (!body.address || !String(body.address).trim()) return 'Address is required.';
  if (!body.baaAccepted || !body.baaAcceptedByName || !body.baaAcceptedByEmail) {
    return 'You must accept the Business Associate Agreement to sign up.';
  }
  return null;
}

// --- Step 1: submit signup form -> email verification, no infra touched yet ---
// Same abuse/resource-exhaustion reasoning as signupController.js's
// requestSignup: this endpoint is public/unauthenticated, so provisioning a
// real database is deferred until the confirmation link is clicked.
const requestIndependentSignup = async (req, res) => {
  try {
    const validationError = validateIndependentSignupPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const email = String(req.body.email).trim().toLowerCase();
    const { rows: existingByEmail } = await platformPool.query(
      'SELECT 1 FROM pending_signups WHERE ceo_email = $1 UNION SELECT 1 FROM companies WHERE email = $1',
      [email]
    );
    if (existingByEmail[0]) return res.status(409).json({ error: 'An account with this email already exists or is pending confirmation.' });

    const fullName = `${req.body.firstName.trim()} ${req.body.lastName.trim()}`;
    const slug = await generateUniqueSlug(fullName);
    const passwordHash = await bcrypt.hash(req.body.password, await bcrypt.genSalt(10));

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();

    // pending_signups' schema is shared with the tenant-company flow — a
    // practitioner's own name fills ceo_first_name/ceo_last_name/ceo_email
    // (they're both "the account owner"), and display_name mirrors their
    // full name since there's no separate company name to show anywhere
    // (company_settings.display_name, invoices, etc. all read this).
    await platformPool.query(
      `INSERT INTO pending_signups
         (slug, display_name, email, ceo_first_name, ceo_last_name, ceo_email, ceo_password_hash,
          baa_accepted_at, baa_accepted_by_name, baa_accepted_by_email,
          confirm_token_hash, confirm_token_expires, account_type, discipline, pay_rate, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8,$9, $10,$11, 'independent', $12,$13,$14)`,
      [
        slug, fullName, email, req.body.firstName.trim(), req.body.lastName.trim(), email, passwordHash,
        req.body.baaAcceptedByName.trim(), req.body.baaAcceptedByEmail.trim(),
        tokenHash, tokenExpiresAt,
        req.body.discipline, Number(req.body.payRate), req.body.address.trim(),
      ]
    );

    // The confirm link is a one-time, pre-login action — opens fine in a
    // browser even though this role's day-to-day use is mobile-only (same
    // reasoning as signupController.js's tenant confirm flow, which also
    // lands on the web app: nothing about "confirm and provision my
    // database" needs the installed mobile app specifically).
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const confirmUrl = `${frontendUrl}/signup/independent/confirm/${rawToken}`;
    try {
      await sendIndependentSignupConfirmationEmail(email, { confirmUrl, practitionerName: fullName });
    } catch (emailError) {
      console.error('Failed to send independent-signup confirmation email:', emailError);
    }

    res.status(202).json({ success: true, message: 'Check your email to confirm your signup and finish setting up your account.' });
  } catch (error) {
    console.error('Independent signup request error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Step 2: confirmation link clicked -> provision a single-seat tenant database ---
const confirmIndependentSignup = async (req, res) => {
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
    if (pending.account_type !== 'independent') {
      return res.status(400).json({ error: 'This confirmation link is not for an independent practitioner signup.' });
    }

    const { rows: existingCompany } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [pending.slug]);
    if (existingCompany[0]) {
      await platformPool.query('DELETE FROM pending_signups WHERE slug = $1', [pending.slug]);
      return res.status(409).json({ error: 'This account was already confirmed. Please log in, or sign up again if needed.' });
    }
  } catch (error) {
    console.error('Independent signup confirmation lookup error:', error);
    return res.status(500).json({ error: 'Server error' });
  }

  const tenantDbName = `tenant_${pending.slug.replace(/-/g, '_')}`;

  try {
    const { tenantPool, adminRoleId } = await provisionTenantDatabase({ slug: pending.slug, tenantDbName });

    // display_name = the practitioner's own name — there's no separate
    // company to show. Stripe card collection is deliberately deferred to
    // first Billing-tab visit rather than collected here, matching the
    // existing "trial needs no card" tenant pattern (see
    // subscriptionController.js for where that SetupIntent flow lives).
    await tenantPool.query(
      `INSERT INTO company_settings (id, display_name, billing_email)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, billing_email = EXCLUDED.billing_email`,
      [pending.display_name, pending.email]
    );

    const disciplineCode = getDisciplineCode(pending.discipline);
    await tenantPool.query(
      `INSERT INTO practitioners
         (first_name, last_name, email, password_hash, requires_password_change, role, role_id,
          position_title, pay_rate, address, service_types)
       VALUES ($1, $2, $3, $4, false, 'independent_practitioner', $5, $6, $7, $8, $9)`,
      [
        pending.ceo_first_name, pending.ceo_last_name, pending.ceo_email, pending.ceo_password_hash, adminRoleId,
        pending.discipline, pending.pay_rate, pending.address, [disciplineCode],
      ]
    );

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await platformPool.query(
      `INSERT INTO companies
         (slug, display_name, email, tenant_db_name, status, trial_ends_at,
          baa_accepted_at, baa_accepted_by_name, baa_accepted_by_email, account_type)
       VALUES ($1,$2,$3,$4,'trial',$5,$6,$7,$8,'independent')`,
      [
        pending.slug, pending.display_name, pending.email,
        tenantDbName, trialEndsAt, pending.baa_accepted_at, pending.baa_accepted_by_name, pending.baa_accepted_by_email,
      ]
    );
    await platformPool.query('DELETE FROM pending_signups WHERE slug = $1', [pending.slug]);

    logAudit({
      actorEmail: pending.ceo_email, actorRole: 'independent_practitioner', action: 'independent_practitioner_signup_confirmed',
      resourceType: 'company', resourceId: pending.slug, details: { slug: pending.slug, trialEndsAt },
    });

    res.json({ success: true, slug: pending.slug, message: 'Your account is set up. You can now log in.' });
  } catch (error) {
    console.error('Independent signup provisioning error:', error);
    try {
      await evictTenantPool(tenantDbName);
      await getProvisioningPool().query(`DROP DATABASE IF EXISTS "${tenantDbName}"`);
    } catch (cleanupError) {
      console.error(`Failed to clean up orphaned database ${tenantDbName}:`, cleanupError.message);
    }
    res.status(500).json({ error: 'Failed to finish setting up your account. Please try signing up again.' });
  }
};

module.exports = { requestIndependentSignup, confirmIndependentSignup };
