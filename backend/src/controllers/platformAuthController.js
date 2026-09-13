const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { platformPool } = require('../config/platformDb');
const { isPasswordStrong } = require('../utils/passwordValidation');
const { logPlatformAudit } = require('../utils/platformAuditLog');

// Same timing-safety trick as authController.js's loginPractitioner — always
// run a bcrypt.compare, even when no matching account exists, so a bad
// email and a bad password take the same amount of time to reject.
const DUMMY_HASH = '$2b$10$kfbIqw/2Dj.rlDic572uhuWxN01VGzbkxLbzZFws5lTYPCa6/Cp7S';

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

// One-time bootstrap: creates the FIRST platform_admins row. Self-disabling
// — once any row exists, this endpoint permanently 403s, regardless of the
// key supplied. PLATFORM_ADMIN_KEY (the old permanent shared-secret gate)
// is repurposed as a break-glass bootstrap credential only.
const bootstrapFirstAdmin = async (req, res) => {
  try {
    const { rows: countRows } = await platformPool.query('SELECT COUNT(*)::int AS c FROM platform_admins');
    if (countRows[0].c > 0) {
      return res.status(403).json({ error: 'Bootstrap already completed. Use the login screen or ask an existing platform admin to create your account.' });
    }

    const expectedKey = process.env.PLATFORM_ADMIN_KEY;
    if (!expectedKey || req.headers['x-platform-admin-key'] !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name are required.' });
    }
    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await platformPool.query(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, $3) RETURNING id, email, name`,
      [String(email).trim().toLowerCase(), passwordHash, name.trim()]
    );

    await logPlatformAudit({ platformAdminId: rows[0].id, action: 'platform_admin_bootstrapped', ipAddress: clientIp(req) });
    res.status(201).json({ success: true, admin: rows[0] });
  } catch (error) {
    console.error('bootstrapFirstAdmin error:', error);
    res.status(500).json({ error: 'Failed to bootstrap platform admin.' });
  }
};

const loginPlatformAdmin = async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    const { rows } = await platformPool.query(
      'SELECT id, email, name, password_hash, is_active FROM platform_admins WHERE email = $1',
      [normalizedEmail]
    );
    const admin = rows[0];

    const isMatch = await bcrypt.compare(password || '', admin ? admin.password_hash : DUMMY_HASH);
    if (!admin || !isMatch || !admin.is_active) {
      await logPlatformAudit({
        action: 'platform_admin_login_failed',
        details: { email: normalizedEmail },
        ipAddress: clientIp(req),
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { platformAdminId: admin.id, email: admin.email, type: 'platform_admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    await logPlatformAudit({ platformAdminId: admin.id, action: 'platform_admin_login', ipAddress: clientIp(req) });
    res.json({ success: true, token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (error) {
    console.error('loginPlatformAdmin error:', error);
    res.status(500).json({ error: 'Failed to log in.' });
  }
};

module.exports = { bootstrapFirstAdmin, loginPlatformAdmin };
