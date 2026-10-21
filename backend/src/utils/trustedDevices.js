// "Remember this device" for TOTP MFA. A trusted device is a random bearer
// token the client keeps; only its SHA-256 lives in mfa_trusted_devices
// (migration add_mfa_trusted_devices.sql). Presenting it at password login
// skips the second-factor step for THAT practitioner only — every lookup is
// scoped by practitioner_id, so a token can never unlock another account.
const crypto = require('crypto');
const { pool } = require('../config/db');

const MAX_ACTIVE_DEVICES = 10;
const MAX_TOKEN_LENGTH = 200;
const MAX_LABEL_LENGTH = 60;

const hashDeviceToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function trustedDeviceDays() {
  const days = parseInt(process.env.TRUSTED_DEVICE_DAYS, 10);
  return Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
}

// Tiny, deliberately coarse UA parse — the label is only so a user can tell
// their devices apart in the list ("Chrome on Windows"), never a security input.
function deviceLabelFromUserAgent(ua) {
  const s = String(ua || '').slice(0, 1000);
  let browser = null;
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\/|Chromium\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';

  let os = null;
  if (/iPhone/.test(s)) os = 'iPhone';
  else if (/iPad/.test(s)) os = 'iPad';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) os = 'Mac';
  else if (/Linux/.test(s)) os = 'Linux';

  let label;
  if (browser && os) label = `${browser} on ${os}`;
  else if (browser) label = browser;
  else if (os) label = `${os} device`;
  else label = 'Unknown device';
  return label.slice(0, MAX_LABEL_LENGTH);
}

// Mints and stores a new trusted device, then revokes the oldest active ones
// beyond MAX_ACTIVE_DEVICES. Returns the RAW token — the only time it exists
// server-side; callers hand it to the client and never log or persist it.
async function mintTrustedDevice(practitionerId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + trustedDeviceDays() * 86400000);
  const label = deviceLabelFromUserAgent(userAgent);
  const { rows } = await pool.query(
    `INSERT INTO mfa_trusted_devices (practitioner_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id, label`,
    [practitionerId, hashDeviceToken(token), label, expiresAt.toISOString()]
  );
  await pool.query(
    `UPDATE mfa_trusted_devices SET revoked_at = now()
     WHERE id IN (
       SELECT id FROM mfa_trusted_devices
       WHERE practitioner_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC OFFSET $2
     )`,
    [practitionerId, MAX_ACTIVE_DEVICES]
  );
  return { token, id: rows[0]?.id, label: rows[0]?.label ?? label, expiresAt: expiresAt.toISOString() };
}

// Returns { id, label } if `token` is an active trusted device of THIS
// practitioner (and stamps last_used_at), else null. Malformed input never
// reaches the DB.
async function consumeTrustedDevice(practitionerId, token) {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
  const { rows } = await pool.query(
    `UPDATE mfa_trusted_devices SET last_used_at = now()
     WHERE practitioner_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
     RETURNING id, label`,
    [practitionerId, hashDeviceToken(token)]
  );
  return rows[0] || null;
}

// Called on every credential/factor change (password change/reset, MFA
// disable, authenticator replacement, admin MFA reset, deactivation).
// tolerateMissingTable: a tenant DB that hasn't run the migration yet has no
// devices, so undefined_table (42P01) counts as 0 revoked; any other error throws.
async function revokeAllTrustedDevices(practitionerId, { tolerateMissingTable = false } = {}) {
  try {
    const result = await pool.query(
      `UPDATE mfa_trusted_devices SET revoked_at = now()
       WHERE practitioner_id = $1 AND revoked_at IS NULL`,
      [practitionerId]
    );
    return result?.rowCount || 0;
  } catch (err) {
    if (tolerateMissingTable && err?.code === '42P01') return 0;
    throw err;
  }
}

module.exports = {
  MAX_ACTIVE_DEVICES,
  hashDeviceToken,
  trustedDeviceDays,
  deviceLabelFromUserAgent,
  mintTrustedDevice,
  consumeTrustedDevice,
  revokeAllTrustedDevices,
};
