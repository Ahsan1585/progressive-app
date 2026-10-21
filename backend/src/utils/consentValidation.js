// Shared input validation for a disclosure consent's details, used by both
// the paper path (recordsConsentController.createConsent) and the e-sign
// request path (consentRequestController.createConsentRequest), so the two
// can never disagree on what a valid consent looks like.
const VALID_RECORD_TYPES = ['session_logs', 'sevf_forms', 'invoices', 'full_record_export'];
const DEFAULT_CONSENT_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CONSENT_YEARS = 5;

// Free-text length limits (checked on the trimmed value).
const LIMITS = {
  recipientName: 200,
  recipientEmail: 200,
  purpose: 500,
  proofNote: 1000,
  identityVerifiedNote: 1000,
};

const NJ_TZ = 'America/New_York';
// Today's calendar date in New Jersey, as YYYY-MM-DD.
const njToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: NJ_TZ }).format(now);

// Parses a real YYYY-MM-DD calendar date; returns [y, m, d] or null.
function parseDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return [y, mo, d];
}

// The last instant (23:59:59.999) of a calendar date in New Jersey, so a
// consent "valid through 3/15" stays valid all of 3/15 in NJ rather than
// ending at midnight UTC (the evening of 3/14 in NJ). NJ is UTC-5 (EST) or
// UTC-4 (EDT): try EST first; if that instant has already rolled into the
// next NJ day, DST is in effect and the offset is 4 hours.
function endOfNjDay([y, mo, d], dateStr) {
  const utcEnd = Date.UTC(y, mo - 1, d, 23, 59, 59, 999);
  const est = new Date(utcEnd + 5 * 3600 * 1000);
  return njToday(est) === dateStr ? est : new Date(utcEnd + 4 * 3600 * 1000);
}

function tooLong(field, value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > LIMITS[field] ? `${field} must be ${LIMITS[field]} characters or fewer.` : null;
}

// Returns { error } or { value: { recipientName, recipientEmail, purpose, recordTypes, expiresAt } }.
// expiresAt is always a concrete Date (default: one year from now). A
// date-only value (YYYY-MM-DD) means "valid through the end of that day in
// New Jersey". proofNote / identityVerifiedNote are only length-checked here
// (the paper path validates their meaning elsewhere).
function validateConsentDetails({ recipientName, recipientEmail, purpose, recordTypes, expiresAt, proofNote, identityVerifiedNote } = {}, now = new Date()) {
  if (!recipientName || !String(recipientName).trim()) return { error: 'recipientName is required.' };
  if (!purpose || !String(purpose).trim()) return { error: 'purpose is required.' };
  for (const [field, value] of Object.entries({ recipientName, recipientEmail, purpose, proofNote, identityVerifiedNote })) {
    const err = tooLong(field, value);
    if (err) return { error: err };
  }
  if (!Array.isArray(recordTypes) || recordTypes.length === 0) return { error: 'At least one record type is required.' };
  const invalidTypes = recordTypes.filter((t) => !VALID_RECORD_TYPES.includes(t));
  if (invalidTypes.length > 0) return { error: `Invalid record type(s): ${invalidTypes.join(', ')}` };

  let resolvedExpiresAt;
  if (expiresAt) {
    const raw = String(expiresAt).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parts = parseDateOnly(raw);
      if (!parts) return { error: 'expiresAt is not a valid date.' };
      resolvedExpiresAt = endOfNjDay(parts, raw);
    } else {
      resolvedExpiresAt = new Date(expiresAt);
    }
    if (Number.isNaN(resolvedExpiresAt.getTime())) return { error: 'expiresAt is not a valid date.' };
    if (resolvedExpiresAt <= now) return { error: 'expiresAt must be in the future.' };
    const maxExpiry = new Date(now);
    maxExpiry.setUTCFullYear(maxExpiry.getUTCFullYear() + MAX_CONSENT_YEARS);
    // Allow the whole final calendar day (date-only values end at NJ midnight).
    if (resolvedExpiresAt.getTime() > maxExpiry.getTime() + 24 * 3600 * 1000) {
      return { error: `expiresAt cannot be more than ${MAX_CONSENT_YEARS} years from now.` };
    }
  } else {
    resolvedExpiresAt = new Date(now.getTime() + DEFAULT_CONSENT_MS);
  }

  return {
    value: {
      recipientName: String(recipientName).trim(),
      recipientEmail: recipientEmail && String(recipientEmail).trim() ? String(recipientEmail).trim() : null,
      purpose: String(purpose).trim(),
      recordTypes,
      expiresAt: resolvedExpiresAt,
    },
  };
}

// The date the parent signed a paper consent: a real YYYY-MM-DD calendar
// date, not after today (NJ time). Returns an error message or null.
function validateSignedOn(signedOn, now = new Date()) {
  const raw = typeof signedOn === 'string' ? signedOn.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'signedOn is required (YYYY-MM-DD): the date the parent signed the paper consent.';
  if (!parseDateOnly(raw)) return 'signedOn is not a valid date.';
  if (raw > njToday(now)) return 'signedOn cannot be in the future.';
  return null;
}

// Route-param guards, checked before any query so a malformed id is a clean
// 404 instead of a Postgres cast error (500). patients.id and
// records_consents.id are int4 (serial); records_consent_requests.id is uuid.
const INT4_MAX = 2147483647;
const isValidIntId = (v) => typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= INT4_MAX;
const isValidUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

module.exports = { VALID_RECORD_TYPES, validateConsentDetails, validateSignedOn, isValidIntId, isValidUuid };
