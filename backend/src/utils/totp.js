const crypto = require('crypto');

// RFC 6238 TOTP (HMAC-SHA1, 30s step), implemented on node:crypto so the
// MFA feature needs no third-party OTP dependency. SHA1/6 digits/30s is what
// every mainstream authenticator app assumes when the otpauth URI omits or
// ignores the algorithm parameters.

const STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function toKey(secret) {
  return Buffer.isBuffer(secret) ? secret : base32Decode(secret);
}

function hotp(key, counter, digits) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function currentTime() {
  return Math.floor(Date.now() / 1000);
}

function generateTotp(secret, { time = currentTime(), digits = DEFAULT_DIGITS } = {}) {
  return hotp(toKey(secret), Math.floor(time / STEP_SECONDS), digits);
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Returns the matched time step (so the caller can persist it and refuse a
// replay of the same code), or null. Every candidate in the window is
// computed and compared even after a match, so timing doesn't reveal which
// step matched.
function verifyTotp(secret, code, { time = currentTime(), window = 1, lastUsedStep = null } = {}) {
  if (!secret || code === null || code === undefined) return null;
  const normalized = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;

  let key;
  try {
    key = toKey(secret);
  } catch {
    return null;
  }
  const currentStep = Math.floor(time / STEP_SECONDS);
  let matched = null;
  for (let i = -window; i <= window; i += 1) {
    const step = currentStep + i;
    if (safeEqual(hotp(key, step, DEFAULT_DIGITS), normalized) && matched === null) {
      matched = step;
    }
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && lastUsedStep !== undefined && matched <= Number(lastUsedStep)) return null;
  return matched;
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function buildOtpauthUri({ secret, accountName, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DEFAULT_DIGITS}&period=${STEP_SECONDS}`;
}

// Recovery codes carry ~50 bits of entropy each and are only ever checked
// behind the MFA rate limiter + per-user lockout, so a fast unsalted SHA-256
// is adequate (bcrypt would cost ~10 compares per attempt for no real gain).
const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function generateRecoveryCodes(count = 10) {
  const codes = new Set();
  while (codes.size < count) {
    const bytes = crypto.randomBytes(10);
    let s = '';
    for (const b of bytes) s += RECOVERY_ALPHABET[b & 31];
    codes.add(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return Array.from(codes);
}

function normalizeRecoveryCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTotp,
  verifyTotp,
  buildOtpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  safeEqual,
};
