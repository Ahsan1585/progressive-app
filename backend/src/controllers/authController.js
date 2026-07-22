const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/emailClient');

// --- Helper: Enforce Password Strength ---
const isPasswordStrong = (password) => {
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password);
};

// Service Type Code legend from the NJEIS-020 form — must match
// frontend/src/pages/dashboard.jsx's serviceTypeMap and mobile/src/constants/njeis.ts
const VALID_SERVICE_TYPE_CODES = [
  'EV', 'AS', 'IFSP', 'AU', 'DI', 'FT', 'HS', 'MS', 'NU', 'NT',
  'OT', 'PT', 'PSY', 'SLP', 'SW', 'VI', 'CC', 'I/T', 'ES', 'TPC'
];

// --- Function 1: Admin Provisions a Practitioner ---
const provisionPractitioner = async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    tempPassword,
    payRate,
    position_title,
    address,
    phone_number,
    ssn,
    role,
    service_types
  } = req.body;

  const isOfficeStaff = position_title === 'Office Staff';

  try {
    if (role === 'practitioner' && !isOfficeStaff && (!payRate || isNaN(payRate))) {
      return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
    }

    const VALID_ROLES = ['practitioner', 'staff_director', 'billing', 'ceo', 'account_specialist'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'A valid role is required.' });
    }

    const serviceTypes = Array.isArray(service_types)
      ? service_types.filter(code => VALID_SERVICE_TYPE_CODES.includes(code))
      : [];

    if (role === 'practitioner' && !isOfficeStaff && serviceTypes.length === 0) {
      return res.status(400).json({ error: 'At least one service type is required.' });
    }

    if (!isPasswordStrong(tempPassword)) {
      return res.status(400).json({ error: 'Temporary password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.' });
    }

    if (['staff_director', 'account_specialist'].includes(req.practitioner.role) && role !== 'practitioner') {
      return res.status(403).json({ error: 'Office Managers and Account Specialists can only register Practitioner accounts.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows: existingRows } = await pool.query(
      'SELECT id FROM practitioners WHERE email = $1',
      [normalizedEmail]
    );
    if (existingRows[0]) return res.status(400).json({ error: 'This email is already registered.' });

    const salt = await bcrypt.genSalt(10);
    const temporaryHash = await bcrypt.hash(tempPassword, salt);

    // Optional fields are omitted from the INSERT entirely (not passed as NULL)
    // when absent, so the column's DB default applies — matching the original
    // Supabase insert, which only included keys that were truthy.
    const columns = ['first_name', 'last_name', 'email', 'password_hash', 'requires_password_change', 'role'];
    const values = [firstName, lastName, normalizedEmail, temporaryHash, true, role];
    const addColumn = (column, value) => { columns.push(column); values.push(value); };

    if (address) addColumn('address', address);
    if (phone_number) addColumn('phone_number', phone_number);
    if (payRate) addColumn('pay_rate', parseFloat(payRate));
    if (position_title) addColumn('position_title', position_title);
    if (ssn) addColumn('ssn', ssn);
    if (serviceTypes.length > 0) addColumn('service_types', serviceTypes);

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: insertedRows } = await pool.query(
      `INSERT INTO practitioners (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING id, first_name, last_name, email, requires_password_change, created_at`,
      values
    );

    res.status(201).json({ message: 'Practitioner provisioned successfully', practitioner: insertedRows[0] });
  } catch (error) {
    console.error('Provisioning error:', error);
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
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }

    // CREATE THE TOKEN REGARDLESS OF PASSWORD STATUS
    const token = jwt.sign(
      { practitionerId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

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

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
      `SELECT p.id, p.first_name, p.last_name, p.email, p.role, p.position_title, p.service_types,
              p.pay_rate, p.address, p.phone_number, p.created_at, p.is_active, p.profile_picture,
              pcu.address AS pending_address, pcu.phone_number AS pending_phone_number, pcu.submitted_at AS pending_submitted_at
       FROM practitioners p
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
      phone_number
    } = req.body;

    const { rows: targetRows } = await pool.query('SELECT id, role FROM practitioners WHERE id = $1', [id]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'Staff member not found.' });

    if (['staff_director', 'account_specialist'].includes(req.practitioner.role) && target.role !== 'practitioner') {
      return res.status(403).json({ error: 'Office Managers and Account Specialists can only edit Practitioner accounts.' });
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

// --- Function 5: Update Staff Role (CEO only) ---
const updateStaffRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const VALID_ROLES = ['practitioner', 'staff_director', 'billing', 'ceo', 'account_specialist'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    await pool.query('UPDATE practitioners SET role = $1 WHERE id = $2', [role, id]);
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

module.exports = {
  provisionPractitioner,
  loginPractitioner,
  changeTemporaryPassword,
  forgotPassword,
  resetPassword,
  getAllStaff,
  updateStaffProfile,
  updateStaffRole,
  deleteStaffMember,
  reactivateStaffMember,
  reviewContactUpdate
};
