// IDEA Part C 34 CFR 303.405: records inspection must be provided within 10 days.
const IDENTITY_METHODS = ['known_parent', 'photo_id', 'callback_verified', 'in_person', 'other'];
const RESPONSE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Parse 'YYYY-MM-DD' (or a Date, read in UTC) to a UTC-midnight ms value; null if invalid.
function toDayMs(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const chk = new Date(ms);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return ms;
}

function computeDueDate(requestedAt) {
  const ms = toDayMs(requestedAt);
  if (ms === null) return null;
  return new Date(ms + RESPONSE_DAYS * DAY_MS).toISOString().slice(0, 10);
}

// "Today" is the calendar date in New Jersey, not UTC.
function todayMs(now) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  return toDayMs(s);
}

function daysRemaining(dueAt, now = new Date()) {
  const due = toDayMs(dueAt);
  if (due === null) return null;
  return Math.round((due - todayMs(now)) / DAY_MS);
}

function isOverdue(request, now = new Date()) {
  if (!request || request.status !== 'open') return false;
  const d = daysRemaining(request.due_at, now);
  return d !== null && d < 0;
}

// Returns an error message, or null when valid.
function validateIdentityVerification(method, note) {
  if (!method || !IDENTITY_METHODS.includes(method)) {
    return `identityVerifiedMethod is required and must be one of: ${IDENTITY_METHODS.join(', ')}.`;
  }
  if (method === 'other' && !(note && String(note).trim())) {
    return "identityVerifiedNote is required when identityVerifiedMethod is 'other'.";
  }
  return null;
}

module.exports = { IDENTITY_METHODS, RESPONSE_DAYS, computeDueDate, daysRemaining, isOverdue, validateIdentityVerification };
