const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/emailClient');

// --- Helper: Enforce Password Strength ---
const isPasswordStrong = (password) => {
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password);
};

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
    role
  } = req.body;

  try {
    if (role === 'practitioner' && (!payRate || isNaN(payRate))) {
      return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
    }

    const VALID_ROLES = ['practitioner', 'staff_director', 'billing', 'ceo'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'A valid role is required.' });
    }

    if (!isPasswordStrong(tempPassword)) {
      return res.status(400).json({ error: 'Temporary password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.' });
    }

    if (req.practitioner.role === 'staff_director' && role !== 'practitioner') {
      return res.status(403).json({ error: 'Staff Directors can only register Practitioner accounts.' });
    }

    const { data: existingUser } = await supabase
      .from('practitioners')
      .select('id')
      .eq('email', email)
      .maybeSingle(); 

    if (existingUser) return res.status(400).json({ error: 'This email is already registered.' });

    const salt = await bcrypt.genSalt(10);
    const temporaryHash = await bcrypt.hash(tempPassword, salt);

    const insertData = {
      first_name: firstName,
      last_name: lastName,
      email,
      password_hash: temporaryHash,
      requires_password_change: true,
      role,
      ...(address      && { address }),
      ...(phone_number && { phone_number }),
      ...(payRate      && { pay_rate: parseFloat(payRate) }),
      ...(position_title && { position_title }),
      ...(ssn          && { ssn }),
    };

    const { data: newPractitioner, error: insertError } = await supabase
      .from('practitioners')
      .insert([insertData])
      .select('id, first_name, last_name, email, requires_password_change, created_at')
      .single();

    if (insertError) throw insertError;

    res.status(201).json({ message: 'Practitioner provisioned successfully', practitioner: newPractitioner });
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
    const { data: user } = await supabase
      .from('practitioners')
      .select('*')
      .eq('email', email)
      .single();

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
    const { error: updateError } = await supabase
      .from('practitioners')
      .update({ 
        password_hash: newPasswordHash, 
        requires_password_change: false 
      })
      .eq('id', practitionerId);

    if (updateError) throw updateError;

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
    const { data: user } = await supabase
      .from('practitioners')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

      const { error: tokenUpdateError } = await supabase
        .from('practitioners')
        .update({ reset_token_hash: tokenHash, reset_token_expires: expiresAt })
        .eq('id', user.id);

      if (tokenUpdateError) {
        console.error('Failed to store reset token:', tokenUpdateError);
      } else {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (emailError) {
          console.error('Failed to send password reset email:', emailError);
        }
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
    const { data: user } = await supabase
      .from('practitioners')
      .select('id, reset_token_expires')
      .eq('reset_token_hash', tokenHash)
      .maybeSingle();

    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    const { error: updateError } = await supabase
      .from('practitioners')
      .update({
        password_hash: newPasswordHash,
        requires_password_change: false,
        reset_token_hash: null,
        reset_token_expires: null,
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 4: Get All Staff (CEO + Staff Director) ---
const getAllStaff = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('practitioners')
      .select('id, first_name, last_name, email, role, position_title, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ staff: data });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// --- Function 5: Update Staff Role (CEO only) ---
const updateStaffRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const VALID_ROLES = ['practitioner', 'staff_director', 'billing', 'ceo'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const { error } = await supabase.from('practitioners').update({ role }).eq('id', id);
    if (error) throw error;
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
    const { error } = await supabase.from('practitioners').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete staff error:', error);
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
  updateStaffRole,
  deleteStaffMember
};