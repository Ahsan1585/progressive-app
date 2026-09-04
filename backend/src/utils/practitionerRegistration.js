const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendInviteEmail } = require('./emailClient');
const { activeOptions } = require('../constants/njeis');

// Shared by authController.js's single-registration form and the Staff
// Directory's bulk (Excel-upload) practitioner import — one place for the
// invite-pending row shape (no admin-set password; the invitee gets a
// one-time activation link) so both paths stay in sync.

const INVITE_PENDING = 'INVITE_PENDING';
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Legacy fallback only — the real, current list is the tenant's own
// configurable service_type dropdown options (see getValidServiceTypeCodes
// below). Kept here so an empty/unloaded cache never blocks registration
// outright, matching the NJEIS-020 Service Type Code legend used elsewhere
// (frontend/src/pages/dashboard.jsx's serviceTypeMap, mobile/src/constants/njeis.ts).
const FALLBACK_SERVICE_TYPE_CODES = [
  'EV', 'AS', 'IFSP', 'AU', 'DI', 'FT', 'HS', 'MS', 'NU', 'NT',
  'OT', 'PT', 'PSY', 'SLP', 'SW', 'VI', 'CC', 'I/T', 'ES', 'TPC',
];

// Was a hardcoded array (see FALLBACK_SERVICE_TYPE_CODES) that silently
// rejected any service_type code a tenant had added themselves via Company
// Information -> Dropdown Options — a custom code could never be assigned
// to a practitioner. Now reads the tenant's live active codes instead,
// falling back to the seed list only if the cache has nothing (e.g. not
// yet warmed).
function getValidServiceTypeCodes() {
  const live = activeOptions('service_type').map((o) => o.code);
  return live.length > 0 ? live : FALLBACK_SERVICE_TYPE_CODES;
}

// Inserts one invite-pending practitioner/staff row and emails the
// activation link. Returns { ok: true, practitioner } on success, or
// { ok: false, statusCode, error } on a recoverable failure (duplicate
// email) — never throws for that case, so a bulk-import loop can skip a row
// and keep going. Does NOT validate business rules (required fields, valid
// service types) — callers do that first, since what's required differs
// between the single admin form (which also handles office-staff accounts)
// and bulk practitioner import (practitioner-only).
async function insertInvitedPractitioner({
  firstName, lastName, email, address, phoneNumber, payRate, positionTitle,
  ssn, serviceTypes, legacyRole, resolvedRoleId, slug, frontendUrl,
}) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const { rows: existingRows } = await pool.query('SELECT id FROM practitioners WHERE email = $1', [normalizedEmail]);
  if (existingRows[0]) return { ok: false, statusCode: 400, error: 'This email is already registered.' };

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const tokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();

  // Optional fields are omitted from the INSERT entirely (not passed as
  // NULL) when absent, so the column's DB default applies.
  const columns = ['first_name', 'last_name', 'email', 'password_hash', 'requires_password_change', 'role', 'reset_token_hash', 'reset_token_expires'];
  const values = [firstName, lastName, normalizedEmail, INVITE_PENDING, true, legacyRole, tokenHash, tokenExpiresAt];
  const addColumn = (column, value) => { columns.push(column); values.push(value); };

  if (address) addColumn('address', address);
  if (phoneNumber) addColumn('phone_number', phoneNumber);
  if (payRate) addColumn('pay_rate', parseFloat(payRate));
  if (positionTitle) addColumn('position_title', positionTitle);
  if (ssn) addColumn('ssn', ssn);
  if (serviceTypes && serviceTypes.length > 0) addColumn('service_types', serviceTypes);
  if (resolvedRoleId) addColumn('role_id', resolvedRoleId);

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: insertedRows } = await pool.query(
    `INSERT INTO practitioners (${columns.join(', ')})
     VALUES (${placeholders})
     RETURNING id, first_name, last_name, email, requires_password_change, created_at`,
    values
  );
  const practitioner = insertedRows[0];

  const { rows: companyRows } = await pool.query('SELECT display_name FROM company_settings WHERE id = 1');
  const companyName = companyRows[0]?.display_name || 'Izaya EIS';
  const activateUrl = `${frontendUrl}/${slug}/activate/${rawToken}`;

  try {
    await sendInviteEmail(normalizedEmail, { activateUrl, companyName });
  } catch (emailError) {
    console.error('Failed to send account invite email:', emailError);
  }

  return { ok: true, practitioner };
}

module.exports = { insertInvitedPractitioner, getValidServiceTypeCodes, INVITE_PENDING, INVITE_TOKEN_TTL_MS, hashToken };
