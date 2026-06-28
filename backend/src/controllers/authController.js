const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/db');

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
    if (!payRate || isNaN(payRate)) {
      return res.status(400).json({ error: 'A valid hourly pay rate is required.' });
    }

    const VALID_ROLES = ['practitioner', 'staff_director', 'billing', 'ceo'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'A valid role is required.' });
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

    // 3. Insert using the exact column names from your database schema
    const { data: newPractitioner, error: insertError } = await supabase
      .from('practitioners')
      .insert([
        {
          first_name: firstName,
          last_name: lastName,
          email,
          password_hash: temporaryHash,
          requires_password_change: true,
          pay_rate: parseFloat(payRate),
          position_title: position_title,
          address: address,
          phone_number: phone_number,
          ssn: ssn,
          role: role
        }
      ])
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
const loginPractitioner = async (req, res) => {
  const { email, password } = req.body;
  
  console.log("\n--- NEW LOGIN ATTEMPT ---");
  console.log("1. Email requested:", email);
  
  try {
    const { data: user, error } = await supabase
      .from('practitioners')
      .select('*')
      .eq('email', email)
      .single();

    console.log("2. Supabase Error:", error);
    console.log("3. User Found in DB:", user ? "YES" : "NO");

    if (error || !user) {
      console.log("❌ FAILED: Database rejected the email or Row Level Security blocked it.");
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log("4. Password Hash Match:", isMatch ? "YES" : "NO");

    if (!isMatch) {
      console.log("❌ FAILED: Passwords do not match.");
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // CREATE THE TOKEN REGARDLESS OF PASSWORD STATUS
    const token = jwt.sign(
      { practitionerId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log("✅ SUCCESS: User authenticated. Sending token and redirect instructions.");
    
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

// --- Function 4: Get All Staff (CEO + Staff Director) ---
const getAllStaff = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('practitioners')
      .select('id, first_name, last_name, email, role, position_title, created_at')
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
    const { error } = await supabase.from('practitioners').delete().eq('id', id);
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
  getAllStaff,
  updateStaffRole,
  deleteStaffMember
};