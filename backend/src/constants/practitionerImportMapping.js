// Column mapping + row-matching for the Staff Directory's bulk practitioner
// import (Excel upload). Mirrors complianceMapping.js's TARGET_FIELDS/
// suggestMapping shape so the "upload -> match columns -> confirm" screen
// (CompanySettings.jsx's compliance-doc UI) can be reused for this second
// Excel-upload feature with the same visual language.
const { normalizeForMatch } = require('../utils/textMatch');
const { activeOptions, mapServiceLabelToCode } = require('./njeis');
const { DISCIPLINE_CODE_MAP } = require('../utils/disciplineCodes');

const TARGET_FIELDS = [
  { key: 'first_name', label: 'First Name', required: true, candidates: ['First Name', 'First'] },
  { key: 'last_name', label: 'Last Name', required: true, candidates: ['Last Name', 'Last'] },
  { key: 'email', label: 'Email', required: true, candidates: ['Email', 'Email Address'] },
  { key: 'pay_rate', label: 'Hourly Pay Rate', required: true, candidates: ['Pay Rate', 'Hourly Rate', 'Hourly Pay Rate'] },
  { key: 'position_title', label: 'Position Title', required: true, candidates: ['Position Title', 'Discipline', 'Discipline / Position Title'] },
  { key: 'service_types', label: 'Service Type(s)', required: true, candidates: ['Service Type', 'Service Types', 'Service Type(s)'] },
  { key: 'address', label: 'Address', required: false, candidates: ['Address', 'Full Address'] },
  { key: 'phone_number', label: 'Phone Number', required: false, candidates: ['Phone Number', 'Phone', 'Phone #'] },
  { key: 'ssn', label: 'SSN / EIN', required: false, candidates: ['SSN', 'EIN', 'SSN / EIN', 'SSN/EIN', 'Tax ID'] },
];

// Best-effort auto-match: for each target field, find the first sheet
// header whose normalized text exactly matches one of its candidates.
function suggestMapping(headers) {
  const suggestion = {};
  for (const field of TARGET_FIELDS) {
    const match = headers.find((h) => field.candidates.some((c) => normalizeForMatch(c) === normalizeForMatch(h)));
    suggestion[field.key] = match || null;
  }
  return suggestion;
}

// Resolves free text (the exact discipline label, or one of its short NJEIS
// codes) to the exact label practitioners.position_title expects — the same
// fixed 8-item list RegisterPractitionerForm.jsx's dropdown offers. Returns
// null if the text doesn't recognizably match any of them.
function resolvePositionTitle(cellText) {
  if (!cellText) return null;
  const n = normalizeForMatch(cellText);
  const byLabel = Object.keys(DISCIPLINE_CODE_MAP).find((label) => normalizeForMatch(label) === n);
  if (byLabel) return byLabel;
  const byCode = Object.entries(DISCIPLINE_CODE_MAP).find(([, code]) => normalizeForMatch(code) === n);
  return byCode ? byCode[0] : null;
}

// A cell can list several service types ("OT, PT" or "Occupational
// Therapy; Physical Therapy") — split, then resolve each token against the
// tenant's own live active service_type list, first by exact code (a bare
// "OT" won't clear mapServiceLabelToCode's 2-word-minimum), then by label
// match. Returns { codes, unmatched } so the caller can report anything it
// couldn't recognize instead of silently dropping it.
function resolveServiceTypes(cellText, threshold = 0.66) {
  if (!cellText) return { codes: [], unmatched: [] };
  const options = activeOptions('service_type');
  const tokens = String(cellText).split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const codes = [];
  const unmatched = [];
  for (const token of tokens) {
    const byCode = options.find((o) => normalizeForMatch(o.code) === normalizeForMatch(token));
    if (byCode) { codes.push(byCode.code); continue; }
    const byLabel = mapServiceLabelToCode(token, threshold);
    if (byLabel) { codes.push(byLabel); continue; }
    unmatched.push(token);
  }
  return { codes: [...new Set(codes)], unmatched };
}

module.exports = { TARGET_FIELDS, suggestMapping, resolvePositionTitle, resolveServiceTypes };
