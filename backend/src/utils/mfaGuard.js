// Per-account TOTP lockout + replay guard, shared by the login MFA path
// (authController) and step-up checks such as the admin record-export
// override (patientRecordExportController), so both enforce the same rules.
const { pool } = require('../config/db');
const { logAudit } = require('./auditLog');
const { verifyTotp } = require('./totp');
const { decryptField } = require('./fieldEncryption');

const MFA_MAX_FAILED_ATTEMPTS = 5;

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

// Verifies a TOTP code and consumes its time step. The conditional UPDATE is
// the real replay guard: two concurrent requests with the same code can't
// both advance the step. Returns true only when the code was valid AND this
// request won the step; a success also clears the failure counter/lock.
async function consumeTotpCode(user, code) {
  const step = verifyTotp(decryptField(user.mfa_secret), code, { lastUsedStep: user.mfa_last_used_step });
  if (step === null) return false;
  const { rows } = await pool.query(
    `UPDATE practitioners SET mfa_last_used_step = $2, mfa_failed_attempts = 0, mfa_locked_until = NULL
     WHERE id = $1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2) RETURNING id`,
    [user.id, step]
  );
  return !!rows[0];
}

module.exports = { MFA_MAX_FAILED_ATTEMPTS, isMfaLocked, recordMfaFailure, consumeTotpCode };
