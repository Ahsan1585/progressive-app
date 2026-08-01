const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendPasswordResetEmail, sendInviteEmail } = require('../utils/emailClient');
const { logAudit } = require('../utils/auditLog');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { lookupCompanyBySlug } = require('../middleware/tenantMiddleware');
const { platformPool } = require('../config/platformDb');

// Placeholder password_hash for an invited-but-not-yet-activated account —
// never a real bcrypt hash, so it can never match a bcrypt.compare() and
// doubles as the "still pending" check in activateAccount below.
const INVITE_PENDING = 'INVITE_PENDING';
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — longer than a password-reset link, since this is first-time onboarding, not an urgent forgotten-password flow
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Service Type Code legend from the NJEIS-020 form — must match
// frontend/src/pages/dashboard.jsx's serviceTypeMap and mobile/src/constants/njeis.ts
const VALID_SERVICE_TYPE_CODES = [
  'EV', 'AS', 'IFSP', 'AU', 'DI', 'FT', 'HS', 'MS', 'NU', 'NT',
  'OT', 'PT', 'PSY', 'SLP', 'SW', 'VI', 'CC', 'I/T', 'ES', 'TPC'
];

// --- Function 1: Admin Provisions a Practitioner (invite-link based — the
// admin fills in every field except a password; the invitee gets a
// one-time link and picks their own) ---
const provisionPractitioner = async (req, res) => {
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
    if (isPractitionerRegistration && !isOfficeStaff && (!payRate || isNaN(payRate))) {
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
      ? service_types.filter(code => VALID_SERVICE_TYPE_CODES.includes(code))
      : [];

    if (isPractitionerRegistration && !isOfficeStaff && serviceTypes.length === 0) {
      return res.status(400).json({ error: 'At least one service type is required.' });
    }

    if (!req.isAdmin && !req.permissions.has('staff_directory_edit_role') && !isPractitionerRegistration) {
      return res.status(403).json({ error: 'You can only register Practitioner accounts.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows: existingRows } = await pool.query(
      'SELECT id FROM practitioners WHERE email = $1',
      [normalizedEmail]
    );
    if (existingRows[0]) return res.status(400).json({ error: 'This email is already registered.' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();

    // Optional fields are omitted from the INSERT entirely (not passed as NULL)
    // when absent, so the column's DB default applies — matching the original
    // Supabase insert, which only included keys that were truthy.
    const columns = ['first_name', 'last_name', 'email', 'password_hash', 'requires_password_change', 'role', 'reset_token_hash', 'reset_token_expires'];
    const values = [firstName, lastName, normalizedEmail, INVITE_PENDING, true, legacyRole, tokenHash, tokenExpiresAt];
    const addColumn = (column, value) => { columns.push(column); values.push(value); };

    if (address) addColumn('address', address);
    if (phone_number) addColumn('phone_number', phone_number);
    if (payRate) addColumn('pay_rate', parseFloat(payRate));
    if (position_title) addColumn('position_title', position_title);
    if (ssn) addColumn('ssn', ssn);
    if (serviceTypes.length > 0) addColumn('service_types', serviceTypes);
    if (resolvedRoleId) addColumn('role_id', resolvedRoleId);

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: insertedRows } = await pool.query(
      `INSERT INTO practitioners (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING id, first_name, last_name, email, requires_password_change, created_at`,
      values
    );

    const { rows: companyRows } = await pool.query('SELECT display_name FROM company_settings WHERE id = 1');
    const companyName = companyRows[0]?.display_name || 'Izaya EIS';
    const slug = req.practitioner.slug;

    // The app is served under the /eis base path (see frontend/vite.config.js's
    // `base: "/eis/"`), so FRONTEND_URL must include it.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const activateUrl = `${frontendUrl}/${slug}/activate/${rawToken}`;

    try {
      await sendInviteEmail(normalizedEmail, { activateUrl, companyName });
    } catch (emailError) {
      console.error('Failed to send account invite email:', emailError);
    }

    res.status(201).json({ message: 'Invite sent successfully', practitioner: insertedRows[0] });
  } catch (error) {
    console.error('Provisioning error:', error);
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
    res.json({
      displayName: company.display_name,
      status: company.status,
      trialEndsAt: company.trial_ends_at,
      baaAccepted: !!company.baa_accepted_at,
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
      'SELECT id, reset_token_expires FROM practitioners WHERE reset_token_hash = $1 AND password_hash = $2',
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

    res.json({ success: true, message: 'Account activated. You can now log in.' });
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

    // CREATE THE TOKEN REGARDLESS OF PASSWORD STATUS
    // slug/tenantDb come from req.company (set by resolveTenantBySlug,
    // mounted ahead of this handler) — signed into the JWT so every later
    // authenticated request already knows which tenant database to use
    // without a platform-DB lookup on every request (see authMiddleware.js).
    const token = jwt.sign(
      { practitionerId: user.id, email: user.email, role: user.role, slug: req.company.slug, tenantDb: req.company.tenant_db_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logAudit({ req, actorId: user.id, actorEmail: user.email, actorRole: user.role, action: 'login_success', resourceType: 'auth' });

    // SEND BOTH THE TOKEN AND THE FLAG TO THE FRONTEND
    res.json({
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
    });

  } catch (error) {
    console.error('Login error:', error);
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
      'SELECT id, email FROM practitioners WHERE email = $1',
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

        // The app is served under the /eis base path (see frontend/vite.config.js's
        // `base: "/eis/"`), so FRONTEND_URL must include it — e.g.
        // https://izayaedge.com/eis, not just https://izayaedge.com.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

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
              pcu.address AS pending_address, pcu.phone_number AS pending_phone_number, pcu.submitted_at AS pending_submitted_at
       FROM practitioners p
       LEFT JOIN roles r ON r.id = p.role_id
       LEFT JOIN pending_contact_updates pcu ON pcu.practitioner_id = p.id
       ORDER BY p.created_at DESC`
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

    if (!req.isAdmin && !req.permissions.has('staff_directory_edit_role') && target.role !== 'practitioner') {
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
    if (phone_number !== undefined) addSet('phone_number', phone_number.trim());
    // Write-only: getAllStaff never returns ssn, so the edit form always
    // starts blank — only touch the stored value when the admin actually
    // types a new one, an empty submission leaves the existing SSN/EIN alone.
    if (ssn) addSet('ssn', ssn.trim());

    if (payRate !== undefined && payRate !== '') {
      if (isNaN(payRate)) return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
      addSet('pay_rate', parseFloat(payRate));
    }

    if (service_types !== undefined) {
      const serviceTypes = Array.isArray(service_types)
        ? service_types.filter(code => VALID_SERVICE_TYPE_CODES.includes(code))
        : [];
      const isOfficeStaff = position_title === 'Office Staff';
      if (target.role === 'practitioner' && !isOfficeStaff && serviceTypes.length === 0) {
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

const deleteStaffMember = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.practitioner.practitionerId;
    if (String(id) === String(requesterId)) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    // Same last-Admin rail as updateStaffRole — deactivating the only remaining
    // active Admin would leave the agency with no full-access account.
    if (await isLastActiveAdmin(id)) {
      return res.status(400).json({ error: 'This is the only remaining Admin account — assign Admin to someone else first.' });
    }
    await pool.query('UPDATE practitioners SET is_active = false WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 6: Reactivate a Deactivated Staff Member (CEO only) ---
const reactivateStaffMember = async (req, res) => {
  try {
    const { id } = req.params;
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
  res.json({ isAdmin: req.isAdmin, permissions: Array.from(req.permissions), roleName });
}

module.exports = {
  provisionPractitioner,
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
  getMe
};
