const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendPasswordResetEmail, sendInviteEmail } = require('../utils/emailClient');
const { logAudit } = require('../utils/auditLog');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { lookupCompanyBySlug } = require('../middleware/tenantMiddleware');
const { platformPool } = require('../config/platformDb');
const { encryptField, decryptField } = require('../utils/fieldEncryption');
const { generateSecret, verifyTotp, buildOtpauthUri, generateRecoveryCodes, hashRecoveryCode } = require('../utils/totp');
// Placeholder password_hash for an invited-but-not-yet-activated account —
// never a real bcrypt hash, so it can never match a bcrypt.compare() and
// doubles as the "still pending" check in activateAccount below. Shared
// with the Staff Directory's bulk practitioner import
// (practitionerImportController.js), which goes through the exact same
// invite-pending row shape via insertInvitedPractitioner.
const {
  insertInvitedPractitioner, getValidServiceTypeCodes,
  INVITE_PENDING, INVITE_TOKEN_TTL_MS, hashToken, buildActivateUrl,
} = require('../utils/practitionerRegistration');

// --- Function 1: Admin Provisions a Practitioner (invite-link based — the
// admin fills in every field except a password; the invitee gets a
// one-time link and picks their own) ---
const provisionPractitioner = async (req, res) => {
  // An independent practitioner's tenant database is single-seat by design
  // (see docs on the independent-practitioner feature) — the entire
  // self-certified/no-office-review billing model assumes exactly one
  // practitioner row ever exists there. Defense-in-depth: the mobile app
  // never surfaces a "register staff" UI for this role, but block it here
  // too in case the endpoint is ever called directly.
  if (req.practitioner?.role === 'independent_practitioner') {
    return res.status(403).json({ error: 'Independent practitioner accounts are single-seat and cannot register additional staff.' });
  }

  const {
    firstName,
    lastName,
    email,
    payRate,
    position_title,
    address,
    phone_number,
    ssn,
    role,
    roleId,
    service_types
  } = req.body;

  const isOfficeStaff = position_title === 'Office Staff';
  // `role: 'practitioner'` is how the existing invite form marks a
  // practitioner registration; anything else is an office-staff account,
  // whose actual permission tier now comes from `roleId` (a row in the
  // tenant's `roles` table) rather than a hardcoded role string.
  const isPractitionerRegistration = role === 'practitioner';

  try {
    // practitioners.pay_rate is numeric(10,2) — anything at or beyond 10^8
    // overflows that column and would otherwise surface as a raw Postgres
    // error instead of a normal validation message.
    if (isPractitionerRegistration && !isOfficeStaff && (!payRate || isNaN(payRate) || payRate < 0 || payRate >= 100000000)) {
      return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
    }

    let legacyRole;
    let resolvedRoleId = null;
    if (isPractitionerRegistration) {
      legacyRole = 'practitioner';
    } else {
      const { rows: roleRows } = await pool.query('SELECT id, is_system FROM roles WHERE id = $1', [roleId]);
      if (!roleRows[0]) {
        return res.status(400).json({ error: 'A valid role is required.' });
      }
      // Only an existing Admin can create another Admin — otherwise anyone
      // holding staff_directory_edit_role could invite themselves a second,
      // full-access account and escalate that way.
      if (roleRows[0].is_system && !req.isAdmin) {
        return res.status(403).json({ error: 'Only an existing Admin can grant Admin access.' });
      }
      legacyRole = roleRows[0].is_system ? 'ceo' : 'staff';
      resolvedRoleId = roleRows[0].id;
    }

    const serviceTypes = Array.isArray(service_types)
      ? service_types.filter(code => getValidServiceTypeCodes().includes(code))
      : [];

    if (isPractitionerRegistration && !isOfficeStaff && serviceTypes.length === 0) {
      return res.status(400).json({ error: 'At least one service type is required.' });
    }

    if (!req.isAdmin && !req.permissions.has('staff_directory_edit_role') && !isPractitionerRegistration) {
      return res.status(403).json({ error: 'You can only register Practitioner accounts.' });
    }

    // The app is served under the /eis base path (see frontend/vite.config.js's
    // `base: "/eis/"`), so FRONTEND_URL must include it.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';

    // sendEmail: false — the account is created invite-pending, but the
    // admin now explicitly sends the invite afterward (the frontend's
    // "Send Invite Now" button on the success screen), rather than it going
    // out automatically the instant the form is submitted.
    const result = await insertInvitedPractitioner({
      firstName, lastName, email, address, phoneNumber: phone_number, payRate,
      positionTitle: position_title, ssn, serviceTypes, legacyRole, resolvedRoleId,
      slug: req.practitioner.slug, frontendUrl, sendEmail: false,
    });
    if (!result.ok) return res.status(result.statusCode).json({ error: result.error });

    res.status(201).json({ message: 'Account created', practitioner: result.practitioner });
  } catch (error) {
    console.error('Provisioning error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 1b: Resend an activation link for an account still awaiting
// first-time activation (password_hash === INVITE_PENDING) — covers the
// case where the original 7-day link expired before the invitee used it.
// Reuses the exact same token-generation/email path as provisionPractitioner,
// just against an existing row instead of a freshly inserted one. ---
const resendInvite = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT id, first_name, last_name, email, password_hash, role FROM practitioners WHERE id = $1',
      [id]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Staff member not found.' });
    if (target.password_hash !== INVITE_PENDING) {
      return res.status(400).json({ error: 'This account has already been activated.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();

    const { rows: companyRows } = await pool.query('SELECT display_name FROM company_settings WHERE id = 1');
    const companyName = companyRows[0]?.display_name || 'Izaya EIS';
    const slug = req.practitioner.slug;
    const activateUrl = buildActivateUrl(target.role, slug, rawToken);

    // Send first, then persist — so invite_email_id / invite_delivery_status
    // reflect this send (and a fresh send clears any prior 'bounced' state
    // so the roster badge resets while we wait for the new delivery event).
    const messageId = await sendInviteEmail(target.email, { activateUrl, companyName });

    await pool.query(
      "UPDATE practitioners SET reset_token_hash = $1, reset_token_expires = $2, invite_sent_at = now(), invite_email_id = $4, invite_delivery_status = 'sent', invite_delivery_detail = NULL WHERE id = $3",
      [tokenHash, tokenExpiresAt, id, messageId]
    );

    res.json({ success: true, message: 'Activation link resent.' });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Public, read-only, no-PHI lookup used only so an activation/login/reset
// page can greet the user with "...for Progressive Steps NJ" before they've
// entered any credentials — reads straight from the platform registry, not
// a tenant database, so no tenant context is needed here at all.
const getCompanyDisplayName = async (req, res) => {
  const slug = String(req.params.companySlug || '').toLowerCase().trim();
  const company = await lookupCompanyBySlug(slug);
  if (!company) return res.status(404).json({ error: 'Unknown company code' });
  res.json({ displayName: company.display_name });
};

// Lets any authenticated user's dashboard show a trial-countdown/upgrade
// banner without needing ceo-only subscription-route access — reads the
// current status fresh from the platform registry (not the JWT, which can
// be up to 24h stale), same source of truth authMiddleware's trial gate uses.
const getCompanyStatus = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      'SELECT display_name, status, trial_ends_at, baa_accepted_at FROM companies WHERE slug = $1',
      [req.practitioner.slug]
    );
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // A suspended company's blocking screen (TrialGate.jsx) shows WHY, not
    // just that it's suspended — the reason a platform admin typed when
    // suspending (platformBillingController.js's suspendCompany) is the
    // most recent 'company_suspended' audit row for this slug. Best-effort:
    // if the lookup fails or no reason was ever recorded (e.g. a company
    // suspended by hand before this endpoint existed), the screen still
    // renders with its original generic copy — never blocks on this.
    let suspensionReason = null;
    if (company.status === 'suspended') {
      try {
        const { rows: auditRows } = await platformPool.query(
          `SELECT details FROM platform_audit_logs
           WHERE target_company_slug = $1 AND action = 'company_suspended'
           ORDER BY created_at DESC LIMIT 1`,
          [req.practitioner.slug]
        );
        suspensionReason = auditRows[0]?.details?.reason || null;
      } catch (auditError) {
        console.error('Error fetching suspension reason:', auditError.message);
      }
    }

    res.json({
      displayName: company.display_name,
      status: company.status,
      trialEndsAt: company.trial_ends_at,
      baaAccepted: !!company.baa_accepted_at,
      suspensionReason,
    });
  } catch (error) {
    console.error('Error fetching company status:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Clears the BAA gate for this company — ceo only (mirrors who checks the
// "authority to accept this agreement" box during signup). Deliberately
// takes name/email rather than trusting req.practitioner's own identity,
// since the person accepting on the company's behalf may not be the same
// person currently logged in, and this needs an auditable record of who
// actually accepted, same as the signup-time acceptance.
const acceptBaa = async (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required to accept the agreement.' });
  }
  try {
    const { rows } = await platformPool.query(
      `UPDATE companies SET baa_accepted_at = now(), baa_accepted_by_name = $1, baa_accepted_by_email = $2, updated_at = now()
       WHERE slug = $3
       RETURNING slug`,
      [name.trim(), email.trim(), req.practitioner.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Company not found' });
    logAudit({ req, action: 'baa_accepted', resourceType: 'company', resourceId: req.practitioner.slug, details: { name: name.trim(), email: email.trim() } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error accepting BAA:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 1b: Invitee activates their account via the one-time link,
// choosing their own password. Structurally identical to resetPassword,
// with one extra check: the account must still be in the pending state
// (password_hash === INVITE_PENDING) — an already-activated account's link
// can't be reused to hijack the password. Tenant is resolved from the URL's
// company slug via resolveTenantBySlug (same as login/signup), so the
// invitee never has to know or type a company code themselves. ---
const activateAccount = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'An activation token and new password are required.' });
  }
  if (!isPasswordStrong(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.' });
  }

  try {
    const tokenHash = hashToken(token);
    const { rows } = await pool.query(
      'SELECT id, email, reset_token_expires FROM practitioners WHERE reset_token_hash = $1 AND password_hash = $2',
      [tokenHash, INVITE_PENDING]
    );
    const user = rows[0];

    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This activation link is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE practitioners
       SET password_hash = $1, requires_password_change = false, reset_token_hash = NULL, reset_token_expires = NULL
       WHERE id = $2`,
      [newPasswordHash, user.id]
    );

    // email returned so the frontend can land the user on a confirmation
    // screen with their login form already filled in (company + email),
    // rather than sending them off to re-enter details they just supplied.
    res.json({ success: true, message: 'Account activated. You can now log in.', email: user.email });
  } catch (error) {
    console.error('Activate account error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 2: Practitioner Logs In ---
// Dummy bcrypt hash used to equalize timing when the email does not exist (prevents user enumeration via response time)
const DUMMY_HASH = '$2b$10$kfbIqw/2Dj.rlDic572uhuWxN01VGzbkxLbzZFws5lTYPCa6/Cp7S';

const loginPractitioner = async (req, res) => {
  const { email, password } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM practitioners WHERE email = $1',
      [String(email || '').trim().toLowerCase()]
    );
    const user = rows[0];

    // Always run a bcrypt compare (against a dummy hash if no user) so timing does not reveal account existence
    const isMatch = await bcrypt.compare(password || '', user ? user.password_hash : DUMMY_HASH);

    if (!user || !isMatch) {
      logAudit({ req, actorEmail: String(email || '').trim().toLowerCase(), action: 'login_failed', resourceType: 'auth' });
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'login_blocked_deactivated', resourceType: 'auth' });
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }

    const companyClaims = { slug: req.company.slug, tenantDb: req.company.tenant_db_name, accountType: req.company.account_type };

    // Password is correct, but a session is only issued after the second
    // factor — the mfaToken can't be used anywhere except the /mfa/* routes.
    if (user.mfa_enabled) {
      return res.json({ mfaRequired: true, mfaToken: signMfaToken(user, companyClaims, 'verify') });
    }
    if (await companyRequiresMfa()) {
      return res.json({ mfaEnrollmentRequired: true, mfaToken: signMfaToken(user, companyClaims, 'enroll') });
    }

    res.json(await issueSession(req, user, companyClaims));

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Shared by password-only login and the MFA completion paths, so a session
// minted after MFA is byte-for-byte the same shape as a plain login's.
// slug/tenantDb are signed into the JWT so every later authenticated request
// already knows which tenant database to use without a platform-DB lookup
// (see authMiddleware.js); accountType ('tenant' | 'independent') lets
// subscriptionController.js pick the billing path the same way.
async function issueSession(req, user, { slug, tenantDb, accountType }) {
  const token = jwt.sign(
    { practitionerId: user.id, email: user.email, role: user.role, slug, tenantDb, accountType },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Starts the server-side idle clock (authMiddleware.js). Non-fatal: the
  // token's own iat also counts as activity there.
  try {
    await pool.query('UPDATE practitioners SET last_activity_at = now() WHERE id = $1', [user.id]);
  } catch (err) {
    console.error('last_activity_at update at login failed:', err.message);
  }

  logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'login_success', resourceType: 'auth' });

  return {
    success: true,
    message: 'Login successful',
    token,
    practitioner: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role
    },
    requirePasswordChange: user.requires_password_change
  };
}

// --- MFA (TOTP) ---
const MFA_ISSUER = 'Izaya EIS';
const MFA_TOKEN_TTL = '10m';
const MFA_MAX_FAILED_ATTEMPTS = 5;
const INVALID_CODE_MESSAGE = 'Invalid verification code.';

// stage 'verify' = enrolled user proving the second factor; stage 'enroll'
// = company requires MFA and this user must enroll before getting a session.
// The two are kept distinct so a password-only attacker holding a 'verify'
// token can never use setup/enable to swap in their own authenticator.
function signMfaToken(user, { slug, tenantDb, accountType }, stage) {
  return jwt.sign(
    { purpose: 'mfa', stage, practitionerId: user.id, email: user.email, role: user.role, slug, tenantDb, accountType },
    process.env.JWT_SECRET,
    { expiresIn: MFA_TOKEN_TTL }
  );
}

async function companyRequiresMfa() {
  const { rows } = await pool.query('SELECT mfa_required FROM company_settings WHERE id = 1');
  return rows[0]?.mfa_required === true;
}

async function loadPractitionerForMfa(id) {
  const { rows } = await pool.query('SELECT * FROM practitioners WHERE id = $1', [id]);
  return rows[0] || null;
}

function isMfaLocked(user) {
  return !!user.mfa_locked_until && new Date(user.mfa_locked_until) > new Date();
}

// Per-account lockout on top of the per-IP limiter (authRoutes.js): after
// MFA_MAX_FAILED_ATTEMPTS consecutive misses the account is locked for 15
// minutes, and every further miss re-arms the lock until a success resets
// the counter. At ~20 guesses/hour against 3 valid codes in 10^6, a blind
// brute force takes on the order of years.
async function recordMfaFailure(req, user, context) {
  try {
    await pool.query(
      `UPDATE practitioners SET
         mfa_failed_attempts = mfa_failed_attempts + 1,
         mfa_locked_until = CASE WHEN mfa_failed_attempts + 1 >= $2 THEN now() + interval '15 minutes' ELSE mfa_locked_until END
       WHERE id = $1`,
      [user.id, MFA_MAX_FAILED_ATTEMPTS]
    );
  } catch (err) {
    console.error('MFA failure counter update failed:', err.message);
  }
  logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'mfa_verify_failed', resourceType: 'auth', details: { context } });
}

const lockedResponse = (res) => res.status(429).json({ error: 'Too many failed verification attempts. Please wait 15 minutes and try again.' });

function companyClaimsFrom(challenge) {
  return { slug: challenge.slug, tenantDb: challenge.tenantDb, accountType: challenge.accountType };
}

// POST /api/auth/mfa/verify — req.mfaChallenge set by requireMfaChallenge('verify').
const verifyMfa = async (req, res) => {
  const { code, recoveryCode } = req.body || {};
  if (!code && !recoveryCode) {
    return res.status(400).json({ error: 'A verification code or recovery code is required.' });
  }
  try {
    const user = await loadPractitionerForMfa(req.mfaChallenge.practitionerId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    if (!user.mfa_enabled || !user.mfa_secret) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled for this account.' });
    }
    if (isMfaLocked(user)) return lockedResponse(res);

    if (code) {
      const step = verifyTotp(decryptField(user.mfa_secret), code, { lastUsedStep: user.mfa_last_used_step });
      // The conditional UPDATE is the real replay guard: two concurrent
      // requests with the same code can't both advance the step.
      const { rows } = step === null ? { rows: [] } : await pool.query(
        `UPDATE practitioners SET mfa_last_used_step = $2, mfa_failed_attempts = 0, mfa_locked_until = NULL
         WHERE id = $1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2) RETURNING id`,
        [user.id, step]
      );
      if (!rows[0]) {
        await recordMfaFailure(req, user, 'login');
        return res.status(400).json({ error: INVALID_CODE_MESSAGE });
      }
    } else {
      const { rows } = await pool.query(
        `UPDATE practitioners SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2), mfa_failed_attempts = 0, mfa_locked_until = NULL
         WHERE id = $1 AND $2 = ANY(mfa_recovery_hashes)
         RETURNING cardinality(mfa_recovery_hashes) AS remaining`,
        [user.id, hashRecoveryCode(recoveryCode)]
      );
      if (!rows[0]) {
        await recordMfaFailure(req, user, 'login_recovery_code');
        return res.status(400).json({ error: 'Invalid recovery code.' });
      }
      logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'mfa_recovery_code_used', resourceType: 'auth', details: { remaining: rows[0].remaining } });
    }

    res.json(await issueSession(req, user, companyClaimsFrom(req.mfaChallenge)));
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const INCORRECT_PASSWORD_MESSAGE = 'Password is incorrect.';

// setup/enable called with a plain SESSION token must re-prove the account
// password (same bcrypt check login uses), so a stolen/unattended session
// alone can't enroll an attacker's authenticator. The enroll-stage mfaToken
// path is exempt: it was minted seconds ago by a successful password login.
// Callers MUST check isMfaLocked first, and a miss counts toward the same
// per-account MFA failure limiter, so this can't be used to brute-force the
// password around the login limiter. Returns true, or writes the 400.
async function requireSessionPassword(req, res, user, context) {
  if (req.mfaChallenge) return true;
  const ok = await bcrypt.compare(String(req.body?.password || ''), user.password_hash);
  if (ok) return true;
  await recordMfaFailure(req, user, context);
  res.status(400).json({ error: INCORRECT_PASSWORD_MESSAGE });
  return false;
}

// POST /api/auth/mfa/setup — real session (body: { password }) or an
// 'enroll' mfaToken (no password). On an account that already has MFA on,
// this starts an authenticator REPLACEMENT and requires a real session with
// { password, code } or { password, recoveryCode }; the current factor is
// consumed atomically while the new pending secret is stored. MFA stays on
// with the old secret until /mfa/enable confirms the new one.
const setupMfa = async (req, res) => {
  if (req.practitioner?.impersonation) {
    return res.status(403).json({ error: 'Two-factor settings cannot be changed during a support session.' });
  }
  const { password, code, recoveryCode } = req.body || {};
  try {
    const user = await loadPractitionerForMfa(req.practitioner.practitionerId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }

    if (user.mfa_enabled) {
      // An enroll-stage token can never replace an enabled authenticator,
      // and a bare session with no re-auth gets the original 409.
      if (req.mfaChallenge || (!password && !code && !recoveryCode)) {
        return res.status(409).json({ error: 'Two-factor authentication is already enabled. Turn it off first to set up a new authenticator.' });
      }
      if (isMfaLocked(user)) return lockedResponse(res);
      if (!code && !recoveryCode) {
        return res.status(400).json({ error: 'Your current verification code or a recovery code is required to replace your authenticator.' });
      }
      if (!(await requireSessionPassword(req, res, user, 'replace_password'))) return;

      const secret = generateSecret();
      const encrypted = encryptField(secret);
      if (code) {
        const step = verifyTotp(decryptField(user.mfa_secret), code, { lastUsedStep: user.mfa_last_used_step });
        const { rows } = step === null ? { rows: [] } : await pool.query(
          `UPDATE practitioners SET mfa_last_used_step = $2, mfa_failed_attempts = 0, mfa_locked_until = NULL, mfa_pending_secret = $3
           WHERE id = $1 AND mfa_enabled = true AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2) RETURNING id`,
          [user.id, step, encrypted]
        );
        if (!rows[0]) {
          await recordMfaFailure(req, user, 'replace');
          return res.status(400).json({ error: INVALID_CODE_MESSAGE });
        }
      } else {
        const { rows } = await pool.query(
          `UPDATE practitioners SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2), mfa_failed_attempts = 0, mfa_locked_until = NULL, mfa_pending_secret = $3
           WHERE id = $1 AND mfa_enabled = true AND $2 = ANY(mfa_recovery_hashes)
           RETURNING cardinality(mfa_recovery_hashes) AS remaining`,
          [user.id, hashRecoveryCode(recoveryCode), encrypted]
        );
        if (!rows[0]) {
          await recordMfaFailure(req, user, 'replace_recovery_code');
          return res.status(400).json({ error: 'Invalid recovery code.' });
        }
        logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'mfa_recovery_code_used', resourceType: 'auth', details: { remaining: rows[0].remaining } });
      }
      return res.json({ secret, otpauthUri: buildOtpauthUri({ secret, accountName: user.email, issuer: MFA_ISSUER }) });
    }

    if (!req.mfaChallenge) {
      if (isMfaLocked(user)) return lockedResponse(res);
      if (!(await requireSessionPassword(req, res, user, 'setup_password'))) return;
    }
    const secret = generateSecret();
    await pool.query('UPDATE practitioners SET mfa_pending_secret = $2 WHERE id = $1', [user.id, encryptField(secret)]);
    res.json({ secret, otpauthUri: buildOtpauthUri({ secret, accountName: user.email, issuer: MFA_ISSUER }) });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/mfa/enable — real session (body: { code, password }) or an
// 'enroll' mfaToken (body: { code }). Also completes an authenticator
// replacement started by setupMfa on an already-enabled account: swaps in
// the new secret, rotates fresh recovery codes, and resets the counters.
const enableMfa = async (req, res) => {
  if (req.practitioner?.impersonation) {
    return res.status(403).json({ error: 'Two-factor settings cannot be changed during a support session.' });
  }
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'A verification code is required.' });
  try {
    const user = await loadPractitionerForMfa(req.practitioner.practitionerId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    const isReplacement = !!user.mfa_enabled;
    if (isReplacement && (req.mfaChallenge || !user.mfa_pending_secret)) {
      return res.status(409).json({ error: 'Two-factor authentication is already enabled.' });
    }
    if (!user.mfa_pending_secret) {
      return res.status(400).json({ error: 'Start two-factor setup first.' });
    }
    if (isMfaLocked(user)) return lockedResponse(res);
    if (!(await requireSessionPassword(req, res, user, 'enable_password'))) return;

    const step = verifyTotp(decryptField(user.mfa_pending_secret), code);
    if (step === null) {
      await recordMfaFailure(req, user, 'enable');
      return res.status(400).json({ error: INVALID_CODE_MESSAGE });
    }

    const recoveryCodes = generateRecoveryCodes();
    // Guarded on the exact pending secret just verified (and the enabled
    // state it was verified under), so a concurrent setup can't swap in a
    // different secret between the check and the write.
    const { rows } = await pool.query(
      `UPDATE practitioners SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled = true,
         mfa_recovery_hashes = $2, mfa_last_used_step = $3, mfa_failed_attempts = 0, mfa_locked_until = NULL
       WHERE id = $1 AND mfa_enabled = $4 AND mfa_pending_secret = $5 RETURNING id`,
      [user.id, recoveryCodes.map(hashRecoveryCode), step, isReplacement, user.mfa_pending_secret]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'Two-factor setup changed while enabling. Please start again.' });
    }
    logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: isReplacement ? 'mfa_authenticator_replaced' : 'mfa_enabled', resourceType: 'auth' });

    const payload = { recoveryCodes };
    if (req.mfaChallenge) {
      Object.assign(payload, await issueSession(req, user, companyClaimsFrom(req.mfaChallenge)));
    }
    res.json(payload);
  } catch (error) {
    console.error('MFA enable error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/mfa/disable — real session only; requires password + code.
const disableMfa = async (req, res) => {
  if (req.practitioner?.impersonation) {
    return res.status(403).json({ error: 'Two-factor settings cannot be changed during a support session.' });
  }
  const { password, code } = req.body || {};
  try {
    const user = await loadPractitionerForMfa(req.practitioner.practitionerId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    if (!user.mfa_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
    }
    if (await companyRequiresMfa()) {
      return res.status(403).json({ error: 'Your organization requires two-factor authentication, so it cannot be turned off.' });
    }
    if (isMfaLocked(user)) return lockedResponse(res);

    const passwordOk = await bcrypt.compare(String(password || ''), user.password_hash);
    const step = verifyTotp(decryptField(user.mfa_secret), code, { lastUsedStep: user.mfa_last_used_step });
    if (!passwordOk || step === null) {
      await recordMfaFailure(req, user, 'disable');
      return res.status(400).json({ error: 'Incorrect password or verification code.' });
    }

    await pool.query(
      `UPDATE practitioners SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL,
         mfa_recovery_hashes = NULL, mfa_last_used_step = NULL, mfa_failed_attempts = 0, mfa_locked_until = NULL
       WHERE id = $1`,
      [user.id]
    );
    logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'mfa_disabled', resourceType: 'auth' });
    res.json({ success: true });
  } catch (error) {
    console.error('MFA disable error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 3: Practitioner Changes Temporary Password ---
const changeTemporaryPassword = async (req, res) => {
  try {
    // We grab the ID securely from the token via the protect middleware
    const practitionerId = req.practitioner.practitionerId;
    const { newPassword } = req.body;

    if (!isPasswordStrong(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.' });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update the database AND remove the required change flag
    await pool.query(
      'UPDATE practitioners SET password_hash = $1, requires_password_change = false WHERE id = $2',
      [newPasswordHash, practitionerId]
    );

    res.json({ success: true, message: 'Password updated successfully. Welcome to the portal!' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 3b: Request a Password Reset Link ---
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  // Always respond generically, whether or not the email exists, to prevent user enumeration.
  const genericResponse = { success: true, message: 'If an account exists with that email, a password reset link has been sent.' };

  if (!email) return res.json(genericResponse);

  try {
    const { rows } = await pool.query(
      'SELECT id, email, role FROM practitioners WHERE email = $1',
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

      try {
        await pool.query(
          'UPDATE practitioners SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
          [tokenHash, expiresAt, user.id]
        );

        // A practitioner's day-to-day app is the mobile PWA
        // (app.izayaedge.com/EIS), not the office web dashboard
        // (izayaedge.com/eis) ceo/staff accounts use — send them to their
        // own app's reset screen instead. Both apps are served under the
        // /eis or /EIS base path (see frontend/vite.config.js and
        // mobile/vite.config.ts), so *_URL must include it.
        // An independent practitioner's only UI is also the mobile app —
        // they never see the office web dashboard (no company/staff to
        // administer there beyond their own single-seat account).
        const baseUrl = ['practitioner', 'independent_practitioner'].includes(user.role)
          ? (process.env.MOBILE_APP_URL || 'http://localhost:5174/EIS')
          : (process.env.FRONTEND_URL || 'http://localhost:5173/eis');
        const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (emailError) {
          console.error('Failed to send password reset email:', emailError);
        }
      } catch (tokenUpdateError) {
        console.error('Failed to store reset token:', tokenUpdateError);
      }
    }

    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.json(genericResponse);
  }
};

// --- Function 3c: Complete a Password Reset ---
const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'A reset token and new password are required.' });
  }
  if (!isPasswordStrong(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.' });
  }

  try {
    const tokenHash = hashResetToken(token);
    const { rows } = await pool.query(
      'SELECT id, reset_token_expires FROM practitioners WHERE reset_token_hash = $1',
      [tokenHash]
    );
    const user = rows[0];

    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE practitioners
       SET password_hash = $1, requires_password_change = false, reset_token_hash = NULL, reset_token_expires = NULL
       WHERE id = $2`,
      [newPasswordHash, user.id]
    );

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 4: Get All Staff (CEO + Staff Director) ---
const getAllStaff = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.role, p.role_id, r.name AS role_name,
              p.position_title, p.service_types,
              p.pay_rate, p.address, p.phone_number, p.created_at, p.is_active, p.profile_picture,
              COALESCE(p.mfa_enabled, false) AS mfa_enabled,
              (p.password_hash = $1) AS is_pending_activation, p.invite_sent_at, p.invite_delivery_status, p.invite_delivery_detail,
              pcu.address AS pending_address, pcu.phone_number AS pending_phone_number, pcu.submitted_at AS pending_submitted_at
       FROM practitioners p
       LEFT JOIN roles r ON r.id = p.role_id
       LEFT JOIN pending_contact_updates pcu ON pcu.practitioner_id = p.id
       WHERE p.is_platform_support = false
       ORDER BY p.created_at DESC`,
      [INVITE_PENDING]
    );
    res.json({ staff: rows });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 4c: Accept or reject a practitioner's self-submitted contact info change ---
const reviewContactUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'reject'
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
    }

    const { rows: pendingRows } = await pool.query(
      'SELECT address, phone_number FROM pending_contact_updates WHERE practitioner_id = $1',
      [id]
    );
    const pending = pendingRows[0];
    if (!pending) return res.status(404).json({ error: 'No pending contact change for this practitioner' });

    if (action === 'accept') {
      await pool.query(
        'UPDATE practitioners SET address = $1, phone_number = $2 WHERE id = $3',
        [pending.address, pending.phone_number, id]
      );
    }
    await pool.query('DELETE FROM pending_contact_updates WHERE practitioner_id = $1', [id]);

    res.json({ success: true, applied: action === 'accept' });
  } catch (error) {
    console.error('Review contact update error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 4b: Update a Staff Member's Profile (CEO + Staff Director + Account Specialist) ---
// Staff Directors and Account Specialists are restricted to editing Practitioner-role
// accounts only, mirroring the same restriction already enforced on provisionPractitioner.
const updateStaffProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      email,
      position_title,
      service_types,
      payRate,
      address,
      phone_number,
      ssn
    } = req.body;

    const { rows: targetRows } = await pool.query('SELECT id, role FROM practitioners WHERE id = $1', [id]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'Staff member not found.' });

    // An independent practitioner editing their OWN row (route-level gate
    // is requireStaffEditOrSelf, see authRoutes.js) has no staff_directory_edit
    // permission — their own role is 'independent_practitioner', not
    // 'practitioner', so the generic self-service-practitioner check below
    // would otherwise wrongly 403 them out of editing themselves.
    const isSelfEdit = String(id) === String(req.practitioner.practitionerId);
    if (!isSelfEdit && !req.isAdmin && !req.permissions.has('staff_directory_edit_role') && target.role !== 'practitioner') {
      return res.status(403).json({ error: 'You can only edit Practitioner accounts.' });
    }

    const setClauses = [];
    const params = [];
    const addSet = (column, value) => {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    };

    if (firstName !== undefined) addSet('first_name', firstName.trim());
    if (lastName !== undefined) addSet('last_name', lastName.trim());
    if (position_title !== undefined) addSet('position_title', position_title);
    if (address !== undefined) addSet('address', address.trim());
    if (phone_number !== undefined) {
      const trimmedPhone = phone_number.trim();
      if (trimmedPhone.length > 20) return res.status(400).json({ error: 'Phone number is too long (max 20 characters).' });
      addSet('phone_number', trimmedPhone);
    }
    // Write-only: getAllStaff never returns ssn, so the edit form always
    // starts blank — only touch the stored value when the admin actually
    // types a new one, an empty submission leaves the existing SSN/EIN alone.
    if (ssn) {
      const trimmedSsn = ssn.trim();
      if (trimmedSsn.length > 11) return res.status(400).json({ error: 'SSN / EIN is too long (max 11 characters).' });
      addSet('ssn', encryptField(trimmedSsn));
    }

    if (payRate !== undefined && payRate !== '') {
      const parsedPayRate = parseFloat(payRate);
      if (isNaN(payRate) || parsedPayRate < 0 || parsedPayRate >= 100000000) return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
      addSet('pay_rate', parsedPayRate);
    }

    if (service_types !== undefined) {
      const serviceTypes = Array.isArray(service_types)
        ? service_types.filter(code => getValidServiceTypeCodes().includes(code))
        : [];
      const isOfficeStaff = position_title === 'Office Staff';
      if (['practitioner', 'independent_practitioner'].includes(target.role) && !isOfficeStaff && serviceTypes.length === 0) {
        return res.status(400).json({ error: 'At least one service type is required.' });
      }
      addSet('service_types', serviceTypes);
    }

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      const { rows: existingRows } = await pool.query(
        'SELECT id FROM practitioners WHERE email = $1 AND id != $2',
        [normalizedEmail, id]
      );
      if (existingRows[0]) return res.status(400).json({ error: 'This email is already registered.' });
      addSet('email', normalizedEmail);
    }

    params.push(id);
    const { rows: updatedRows } = await pool.query(
      `UPDATE practitioners SET ${setClauses.join(', ')} WHERE id = $${params.length}
       RETURNING id, first_name, last_name, email, role, position_title, service_types,
                 pay_rate, address, phone_number, created_at, is_active`,
      params
    );

    // assessments.practitioner_first_name/last_name is a denormalized
    // snapshot taken at log time (so a later deactivation/role change
    // doesn't rewrite history) — but a name *correction* here (e.g. a typo)
    // should propagate, otherwise every existing log keeps the wrong name
    // forever and Compliance Analysis can never match it against EIMS
    // records filed under the corrected spelling.
    if (firstName !== undefined || lastName !== undefined) {
      const updated = updatedRows[0];
      await pool.query(
        `UPDATE assessments SET practitioner_first_name = $1, practitioner_last_name = $2 WHERE practitioner_id = $3`,
        [updated.first_name, updated.last_name, id]
      );

      // Independent-practitioner-only: company_settings.display_name is
      // their own personal name (set once at signup — see
      // signupController.js/platformProvisioningController.js), not a real
      // company name, since this role's single practitioners row IS their
      // whole "company" (see PATCH /api/practitioner/business-entity's own
      // comment for the same display_name/legal_entity_name split). Without
      // this, a name change here would correct Home's big "Welcome back"
      // line (AuthContext's own cached practitioner object, patched
      // client-side) while the small company-branding label above it keeps
      // showing the name as of signup forever, since nothing else ever
      // writes display_name again. Never applies to a tenant company's own
      // practitioner — their display_name is their employer's name, must
      // never be overwritten by an individual staff member's own edit.
      if (updated.role === 'independent_practitioner') {
        const fullName = `${updated.first_name} ${updated.last_name}`.trim();
        await pool.query(
          `INSERT INTO company_settings (id, display_name, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
          [fullName]
        );
      }
    }

    res.json({ success: true, staff: updatedRows[0] });
  } catch (error) {
    console.error('Update staff profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// The fixed Admin role (roles.is_system = true) is a tenant's only source of
// full access, so it must never be possible to leave an agency with zero active
// Admins — by role change or by deactivation, and regardless of who initiates
// it. Returns true only when `practitionerId` is an ACTIVE Admin and is the last
// one; an already-inactive target isn't counted, so changing it is always safe.
const isLastActiveAdmin = async (practitionerId) => {
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM practitioners
              WHERE role_id = r.id AND is_active = true) AS admin_count
       FROM practitioners p
       JOIN roles r ON r.id = p.role_id
      WHERE p.id = $1 AND p.is_active = true AND r.is_system = true`,
    [practitionerId]
  );
  return rows[0] ? Number(rows[0].admin_count) <= 1 : false;
};

// --- Function 5: Update Staff Role (staff_directory_edit_role) ---
const updateStaffRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { roleId } = req.body;
    const { rows: roleRows } = await pool.query('SELECT id, is_system FROM roles WHERE id = $1', [roleId]);
    if (!roleRows[0]) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    // Only an existing Admin can hand out Admin. Without this, anyone holding
    // staff_directory_edit_role could promote themselves (or anyone else) to the
    // fixed full-access system role — a straight privilege escalation.
    if (roleRows[0].is_system && !req.isAdmin) {
      return res.status(403).json({ error: 'Only an existing Admin can grant Admin access.' });
    }

    // Last-Admin/self-demotion guard: an Admin must not be able to strip their
    // own Admin access (mirrors the self-deletion guard in deleteStaffMember,
    // and protects against a tenant ending up with zero full-access accounts).
    if (String(id) === String(req.practitioner.practitionerId) && req.isAdmin && !roleRows[0].is_system) {
      return res.status(400).json({ error: 'You cannot remove your own Admin access.' });
    }

    // Count-based last-Admin rail: blocks moving the only remaining active Admin
    // off the system role no matter who asks (e.g. a non-Admin holding
    // staff_directory_edit_role demoting someone else's Admin account).
    if (!roleRows[0].is_system && await isLastActiveAdmin(id)) {
      return res.status(400).json({ error: 'This is the only remaining Admin account — assign Admin to someone else first.' });
    }

    const legacyRole = roleRows[0].is_system ? 'ceo' : 'staff';
    await pool.query('UPDATE practitioners SET role = $1, role_id = $2 WHERE id = $3', [legacyRole, roleId, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Deactivating a practitioner only needs practitioner_manage; deactivating
// an office-staff/Admin account still needs the broader
// staff_directory_edit_role — checked here (not at the route) since it
// depends on which the target actually is.
function canManageTarget(req, targetRole) {
  if (req.isAdmin) return true;
  if (targetRole === 'practitioner') {
    return req.permissions.has('practitioner_manage') || req.permissions.has('staff_directory_edit_role');
  }
  return req.permissions.has('staff_directory_edit_role');
}

const deleteStaffMember = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.practitioner.practitionerId;
    if (String(id) === String(requesterId)) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const { rows: targetRows } = await pool.query('SELECT role FROM practitioners WHERE id = $1', [id]);
    if (!targetRows[0]) return res.status(404).json({ error: 'Account not found.' });
    if (!canManageTarget(req, targetRows[0].role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    // Same last-Admin rail as updateStaffRole — deactivating the only remaining
    // active Admin would leave the agency with no full-access account.
    if (await isLastActiveAdmin(id)) {
      return res.status(400).json({ error: 'This is the only remaining Admin account — assign Admin to someone else first.' });
    }
    await pool.query('UPDATE practitioners SET is_active = false WHERE id = $1', [id]);
    // A deactivated practitioner can no longer log in or act on anything
    // (protect's is_active recheck — see the FERPA §303.404 revocation
    // fix), so leaving their caseload silently pointing at them hides
    // real orphaned work instead of surfacing it. Clear it the same way
    // an office reassignment does (deactivated_reason = 'reassigned'),
    // so those children immediately show as Unassigned and are ready to
    // be picked up by someone else. Reactivating later does NOT restore
    // the old caseload automatically — by then those children may
    // already have been reassigned elsewhere.
    await pool.query(
      "UPDATE patient_practitioners SET status = 'inactive', deactivated_reason = 'reassigned' WHERE practitioner_id = $1 AND status = 'active'",
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/staff/:id/mfa-reset (ceo only, see authRoutes.js) — the
// recovery path for a staff member who lost their authenticator AND their
// recovery codes. Clears every MFA column so their next login goes through
// the normal flow (forced re-enrollment if the company requires MFA). Ends
// nothing else: no deactivation, no password change, no session revocation.
// Tenant-scoped automatically (pool runs inside the caller's tenant).
const resetStaffMfa = async (req, res) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.practitioner.practitionerId)) {
      return res.status(400).json({ error: 'You cannot reset your own two-factor authentication. Turn it off from your own settings instead.' });
    }
    if (!/^\d+$/.test(String(id))) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const { rows } = await pool.query(
      `UPDATE practitioners SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL,
         mfa_recovery_hashes = NULL, mfa_last_used_step = NULL, mfa_failed_attempts = 0, mfa_locked_until = NULL
       WHERE id = $1 AND is_platform_support = false
       RETURNING id`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    logAudit({ req, action: 'mfa_reset_by_admin', resourceType: 'practitioner', resourceId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Reset staff MFA error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 6: Reactivate a Deactivated Staff Member (CEO only) ---
const reactivateStaffMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: targetRows } = await pool.query('SELECT role FROM practitioners WHERE id = $1', [id]);
    if (!targetRows[0]) return res.status(404).json({ error: 'Account not found.' });
    if (!canManageTarget(req, targetRows[0].role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    await pool.query('UPDATE practitioners SET is_active = true WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Reactivate staff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 7: Return the caller's own admin/permission set (used by the
// frontend to decide what to render without duplicating role logic there) ---
async function getMe(req, res) {
  let roleName;
  if (req.practitioner.role === 'ceo') {
    roleName = 'Admin';
  } else if (req.practitioner.role === 'independent_practitioner') {
    roleName = 'Independent Practitioner';
  } else if (req.practitioner.role === 'practitioner') {
    roleName = 'Practitioner';
  } else {
    const { rows } = await pool.query(
      `SELECT r.name FROM roles r JOIN practitioners p ON p.role_id = r.id WHERE p.id = $1`,
      [req.practitioner.practitionerId]
    );
    // Fall back to the neutral 'Staff' label, never 'Admin' — a staff account
    // with a NULL/unmatched role_id has no permissions, so labelling it Admin
    // would be actively misleading.
    roleName = rows[0]?.name || 'Staff';
  }
  // isPlatformSupport and isImpersonating both ride on the decoded JWT
  // already (set at token-mint time in platformProvisioningController.js's
  // impersonateCompany) — no extra query needed. Used by the frontend to
  // show the "Viewing X as Izaya Support" banner and to gate Bulk Register
  // to the support account only (see RegisterPractitionerForm.jsx).
  const isPlatformSupport = !!req.practitioner.isPlatformSupport;
  const isImpersonating = !!req.practitioner.impersonation;
  // Display-only, so a failed lookup degrades to "off" rather than breaking
  // /me (which the whole admin shell depends on).
  let mfaEnabled = false;
  let companyMfaRequired = false;
  try {
    const { rows: mfaRows } = await pool.query(
      `SELECT p.mfa_enabled, (SELECT mfa_required FROM company_settings WHERE id = 1) AS company_mfa_required
       FROM practitioners p WHERE p.id = $1`,
      [req.practitioner.practitionerId]
    );
    mfaEnabled = mfaRows[0]?.mfa_enabled === true;
    companyMfaRequired = mfaRows[0]?.company_mfa_required === true;
  } catch (err) {
    console.error('getMe MFA lookup failed:', err.message);
  }
  res.json({
    mfaEnabled,
    companyMfaRequired,
    isAdmin: req.isAdmin,
    permissions: Array.from(req.permissions),
    roleName,
    isPlatformSupport,
    isImpersonating,
    impersonatedBy: isImpersonating ? req.practitioner.impersonation.platformAdminEmail : null,
  });
}

module.exports = {
  provisionPractitioner,
  resendInvite,
  activateAccount,
  getCompanyDisplayName,
  getCompanyStatus,
  acceptBaa,
  loginPractitioner,
  changeTemporaryPassword,
  forgotPassword,
  resetPassword,
  getAllStaff,
  updateStaffProfile,
  updateStaffRole,
  deleteStaffMember,
  reactivateStaffMember,
  reviewContactUpdate,
  getMe,
  verifyMfa,
  setupMfa,
  enableMfa,
  disableMfa,
  resetStaffMfa
};
