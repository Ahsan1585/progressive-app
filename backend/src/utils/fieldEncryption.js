const crypto = require('crypto');

// Application-level (field-level) encryption for a small number of
// especially sensitive columns — currently just practitioners.ssn — on top
// of whatever at-rest encryption the underlying infrastructure (Google
// Cloud SQL) already provides by default. This is defense-in-depth: it
// means a database-level compromise (a leaked backup, a misconfigured
// read replica, a compromised DB credential) doesn't hand over SSNs in
// plaintext even though the disk itself is already encrypted.
//
// AES-256-GCM: authenticated encryption — a tampered ciphertext fails to
// decrypt rather than silently decrypting to garbage, which matters for a
// field like an SSN where silent corruption could otherwise go unnoticed
// until it's printed on an invoice.
//
// Key management: FIELD_ENCRYPTION_KEY must be a 32-byte key, base64-
// encoded, set as a Cloud Run secret (same pattern as JWT_SECRET/
// DB_PASSWORD — see backend/src/config's existing secretKeyRef usage).
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Losing this key means every already-encrypted SSN becomes permanently
// unrecoverable — back it up the same way JWT_SECRET/DB_PASSWORD are
// backed up, not just left as a single Cloud Run secret with no copy.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is the GCM-recommended size, not 16.

function getKey() {
  const keyB64 = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set — cannot encrypt/decrypt SSN fields.');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(`FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  }
  return key;
}

// Stored format: "v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>" — the
// "v1:" prefix leaves room for a future key-rotation/algorithm scheme
// without breaking old rows, and lets decryptField fail cleanly on a value
// that was never encrypted by this scheme (e.g. a pre-migration plaintext
// SSN that slipped through) rather than throwing an opaque crypto error.
const FORMAT_PREFIX = 'v1:';

function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// Returns the decrypted plaintext, or the original input unchanged if it
// doesn't look like a value this function encrypted (missing prefix) —
// this is what lets a not-yet-migrated plaintext SSN keep working during
// and immediately after the backfill migration, rather than crashing every
// invoice generation until every row is confirmed re-encrypted.
function decryptField(storedValue) {
  if (storedValue === null || storedValue === undefined || storedValue === '') return storedValue;
  if (!String(storedValue).startsWith(FORMAT_PREFIX)) return storedValue;

  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = String(storedValue).slice(FORMAT_PREFIX.length).split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted field value — expected v1:<iv>:<authTag>:<ciphertext>.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptField, decryptField };
