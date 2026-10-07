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
const { SLUG_REGEX, RESERVED_SLUGS, TRIAL_DAYS } = require('../constants/signup');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { sendIndependentSignupConfirmationEmail } = require('../utils/emailClient');
const { logAudit } = require('../utils/auditLog');
const { INDEPENDENT_DISCIPLINE_CODES } = require('../constants/independentDisciplines');

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// The independent practitioner picks their own login code (same field
// tenant companies call "Company Code"), so they actually know what to type
// at login instead of it being an opaque generated string only discoverable
// by querying the database — the exact gap this replaces. Same format rule
// as tenant signup (SLUG_REGEX/RESERVED_SLUGS, enforced in
// validateIndependentSignupPayload below) so both flows share one mental
// model. A name-derived suggestion is still offered client-side (see
// IndependentSignupWizard.jsx) purely as a starting point to edit, not
// silently substituted server-side.
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'practitioner';
}

function validateIndependentSignupPayload(body) {
  const slug = String(body.slug || '').toLowerCase().trim();
  if (!SLUG_REGEX.test(slug)) {
    return 'Login code must be 3-40 characters, lowercase letters/numbers/hyphens only.';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'This login code is reserved — please choose another.';
  }
  if (!body.firstName || !String(body.firstName).trim()) return 'First name is required.';
  if (!body.lastName || !String(body.lastName).trim()) return 'Last name is required.';
  if (!body.email || !String(body.email).trim()) return 'Email is required.';
  if (!isPasswordStrong(body.password)) {
    return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';
  }
  const disciplines = Array.isArray(body.disciplines) ? body.disciplines : [];
  if (disciplines.length === 0 || !disciplines.every((d) => INDEPENDENT_DISCIPLINE_CODES.has(d))) {
    return 'At least one valid discipline is required.';
  }
  const payRate = Number(body.payRate);
  // Same overflow guard as provisionPractitioner (practitioners.pay_rate is numeric(10,2)).
  if (!body.payRate || Number.isNaN(payRate) || payRate < 0 || payRate >= 100000000) {
    return 'A valid hourly pay rate is required.';
  }
  if (!body.addressLine1 || !String(body.addressLine1).trim()) return 'Street address is required.';
  if (!body.addressCity || !String(body.addressCity).trim()) return 'City is required.';
  if (!body.addressState || !String(body.addressState).trim()) return 'State is required.';
  if (!body.addressZip || !/^\d{5}(-\d{4})?$/.test(String(body.addressZip).trim())) return 'A valid ZIP code is required.';
  if (!body.address || !String(body.address).trim()) return 'Address is required.';
  if (!body.baaAccepted || !body.baaAcceptedByName || !body.baaAcceptedByEmail) {
    return 'You must accept the Business Associate Agreement to sign up.';
  }
  if (body.customDropdownOptions !== undefined && body.customDropdownOptions !== null) {
    if (!Array.isArray(body.customDropdownOptions)) return 'Custom options must be a list.';
    for (const opt of body.customDropdownOptions) {
      if (!opt || !opt.category || !opt.label || !String(opt.label).trim()) {
        return 'Each custom option needs a category and a name.';
      }
      if (!['service_type', 'service_status', 'location', 'group_size'].includes(opt.category)) {
        return 'Invalid custom option category.';
      }
    }
  }
  if (body.removedDefaultOptions !== undefined && body.removedDefaultOptions !== null) {
    if (!Array.isArray(body.removedDefaultOptions)) return 'Removed options must be a list.';
    for (const opt of body.removedDefaultOptions) {
      if (!opt || !opt.category || !opt.label) return 'Each removed option needs a category and a name.';
      if (!['service_type', 'service_status', 'location', 'group_size'].includes(opt.category)) {
        return 'Invalid removed option category.';
      }
    }
  }
  return null;
}

// GET /api/independent-signup/slug-available?slug=... — lets the wizard's
// name-derived suggestion (slugSuggestion() in IndependentSignupWizard.jsx)
// check itself against the real registry and auto-disambiguate (jamie-rivera,
// jamie-rivera-2, ...) before the practitioner ever sees a collision, instead
// of only finding out at submit time. Never the sole enforcement — the hard
// check still lives in requestIndependentSignup/confirmIndependentSignup
// below (platformPool is the single source of truth; this is a convenience
// read only, so a race between this check and submit is harmless, submit
// still returns 409 if someone else won the slug in between).
const checkSlugAvailable = async (req, res) => {
  const slug = String(req.query.slug || '').toLowerCase().trim();
  if (!SLUG_REGEX.test(slug) || RESERVED_SLUGS.has(slug)) {
    return res.json({ available: false });
  }
  try {
    const { rows } = await platformPool.query(
      'SELECT 1 FROM companies WHERE slug = $1 UNION SELECT 1 FROM pending_signups WHERE slug = $1',
      [slug]
    );
    res.json({ available: !rows[0] });
  } catch (error) {
    console.error('Slug availability check error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Step 1: submit signup form -> email verification, no infra touched yet ---
// Same abuse/resource-exhaustion reasoning as signupController.js's
// requestSignup: this endpoint is public/unauthenticated, so provisioning a
// real database is deferred until the confirmation link is clicked.
const requestIndependentSignup = async (req, res) => {
  try {
    const validationError = validateIndependentSignupPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const slug = String(req.body.slug).toLowerCase().trim();
    const { rows: existingSlug } = await platformPool.query('SELECT 1 FROM companies WHERE slug = $1', [slug]);
    if (existingSlug[0]) return res.status(409).json({ error: 'This login code is already taken.' });

    const email = String(req.body.email).trim().toLowerCase();
    const { rows: existingByEmail } = await platformPool.query(
      'SELECT 1 FROM pending_signups WHERE ceo_email = $1 UNION SELECT 1 FROM companies WHERE email = $1',
      [email]
    );
    if (existingByEmail[0]) return res.status(409).json({ error: 'An account with this email already exists or is pending confirmation.' });

    const fullName = `${req.body.firstName.trim()} ${req.body.lastName.trim()}`;
    const passwordHash = await bcrypt.hash(req.body.password, await bcrypt.genSalt(10));

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();

    // pending_signups' schema is shared with the tenant-company flow — a
    // practitioner's own name fills ceo_first_name/ceo_last_name/ceo_email
    // (they're both "the account owner"), and display_name mirrors their
    // full name since there's no separate company name to show anywhere
    // (company_settings.display_name, invoices, etc. all read this).
    const customDropdownOptions = Array.isArray(req.body.customDropdownOptions) && req.body.customDropdownOptions.length > 0
      ? JSON.stringify(req.body.customDropdownOptions)
      : null;
    const removedDefaultOptions = Array.isArray(req.body.removedDefaultOptions) && req.body.removedDefaultOptions.length > 0
      ? JSON.stringify(req.body.removedDefaultOptions)
      : null;

    await platformPool.query(
      `INSERT INTO pending_signups
         (slug, display_name, email, ceo_first_name, ceo_last_name, ceo_email, ceo_password_hash,
          baa_accepted_at, baa_accepted_by_name, baa_accepted_by_email,
          confirm_token_hash, confirm_token_expires, account_type, disciplines, pay_rate, address, custom_dropdown_options,
          address_line1, address_city, address_state, address_zip, removed_default_options)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8,$9, $10,$11, 'independent', $12,$13,$14,$15, $16,$17,$18,$19, $20)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name, email = EXCLUDED.email,
         ceo_first_name = EXCLUDED.ceo_first_name, ceo_last_name = EXCLUDED.ceo_last_name,
         ceo_email = EXCLUDED.ceo_email, ceo_password_hash = EXCLUDED.ceo_password_hash,
         baa_accepted_at = now(), baa_accepted_by_name = EXCLUDED.baa_accepted_by_name, baa_accepted_by_email = EXCLUDED.baa_accepted_by_email,
         confirm_token_hash = EXCLUDED.confirm_token_hash, confirm_token_expires = EXCLUDED.confirm_token_expires,
         account_type = EXCLUDED.account_type, disciplines = EXCLUDED.disciplines, pay_rate = EXCLUDED.pay_rate,
         address = EXCLUDED.address, custom_dropdown_options = EXCLUDED.custom_dropdown_options,
         address_line1 = EXCLUDED.address_line1, address_city = EXCLUDED.address_city,
         address_state = EXCLUDED.address_state, address_zip = EXCLUDED.address_zip,
         removed_default_options = EXCLUDED.removed_default_options`,
      [
        slug, fullName, email, req.body.firstName.trim(), req.body.lastName.trim(), email, passwordHash,
        req.body.baaAcceptedByName.trim(), req.body.baaAcceptedByEmail.trim(),
        tokenHash, tokenExpiresAt,
        req.body.disciplines, Number(req.body.payRate), req.body.address.trim(), customDropdownOptions,
        req.body.addressLine1 ? String(req.body.addressLine1).trim() : null,
        req.body.addressCity ? String(req.body.addressCity).trim() : null,
        String(req.body.addressState).trim(), String(req.body.addressZip).trim(),
        removedDefaultOptions,
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

    const disciplines = Array.isArray(pending.disciplines) && pending.disciplines.length > 0
      ? pending.disciplines
      : (pending.discipline ? [pending.discipline] : []);
    const positionTitle = disciplines.join(', ');
    await tenantPool.query(
      `INSERT INTO practitioners
         (first_name, last_name, email, password_hash, requires_password_change, role, role_id,
          position_title, pay_rate, address, service_types, address_line1, address_city, address_state, address_zip)
       VALUES ($1, $2, $3, $4, false, 'independent_practitioner', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        pending.ceo_first_name, pending.ceo_last_name, pending.ceo_email, pending.ceo_password_hash, adminRoleId,
        positionTitle, pending.pay_rate, pending.address, disciplines,
        pending.address_line1, pending.address_city, pending.address_state, pending.address_zip,
      ]
    );

    // Any dropdown options the practitioner chose to add during signup
    // (see ManageDropdownOptions-in-wizard step), inserted into the
    // brand-new tenant right after provisioning — same
    // INSERT ... ON CONFLICT DO UPDATE shape as dropdownOptionsController's
    // createDropdownOption, just run directly against tenantPool since no
    // authenticated request context exists yet at this point in the flow.
    const customOptions = Array.isArray(pending.custom_dropdown_options) ? pending.custom_dropdown_options : [];
    for (const opt of customOptions) {
      const code = String(opt.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || `custom-${Date.now()}`;
      await tenantPool.query(
        `INSERT INTO dropdown_options (category, code, label, sort_order)
         VALUES ($1, $2, $3, 100)
         ON CONFLICT (category, code) DO NOTHING`,
        [opt.category, code, String(opt.label).trim()]
      );
    }

    // Default seeded options the practitioner un-checked during signup
    // (e.g. "we don't do Escort/Security") — matched by (category, label)
    // since the wizard only knows the human label, not the seeded code.
    // Soft-deactivated the same way deactivateDropdownOption does (never a
    // real DELETE — is_seeded rows especially can't be hard-deleted, see
    // dropdownOptionsController.js), so it's reversible later from Company
    // Information -> Dropdown Options if they change their mind.
    const removedDefaults = Array.isArray(pending.removed_default_options) ? pending.removed_default_options : [];
    for (const opt of removedDefaults) {
      await tenantPool.query(
        `UPDATE dropdown_options SET is_active = false, updated_at = now() WHERE category = $1 AND label = $2`,
        [opt.category, opt.label]
      );
    }

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

module.exports = { requestIndependentSignup, confirmIndependentSignup, checkSlugAvailable };
