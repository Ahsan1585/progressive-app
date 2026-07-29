// Service type/status/location/group-size vocabularies are admin-configurable
// (see dropdownOptionsCache.js/dropdownOptionsController.js) and stored in the
// `dropdown_options` table. SERVICE_TYPE_OPTIONS etc. below are live getters
// over the in-memory cache (not static arrays), so every consumer — the
// label<->code mapping functions in this file, and the state Excel import in
// complianceMapping.js — reflects whatever the admin currently has
// configured, without a DB round trip per lookup.
const { normalizeForMatch } = require('../utils/textMatch');
const { getDropdownOptionsCache } = require('./dropdownOptionsCache');

// Active-only, {code, label} shape — matches what these arrays looked like
// when they were hardcoded. Used for label<->code matching of *new*
// submissions/imports, where a deactivated option shouldn't be offered.
const activeOptions = (category) =>
  getDropdownOptionsCache()[category].filter((o) => o.is_active).map((o) => ({ code: o.code, label: o.label }));

const norm = normalizeForMatch;

// Fallback for when the state abbreviates a label by dropping a word (e.g.
// exports "Speech Therapy" for our "Speech Language Therapy") rather than
// just formatting it differently. Matches only when the state's words are
// ALL present in exactly one option's words — if they're a subset of more
// than one option (ambiguous) or of none, this intentionally returns null
// rather than guessing, so a bad guess never silently mislabels a record.
function subsetWordMatch(label, options) {
  const tokens = norm(label).split(' ').filter(Boolean);
  if (tokens.length < 2) return null;
  const candidates = options.filter((o) => {
    const optTokens = norm(o.label).split(' ').filter(Boolean);
    return tokens.every((t) => optTokens.includes(t));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

// The state's "Service" column doesn't always literally match one of our
// labels (confirmed against a real export: it says "Foreign Language
// Interpreter" where our code is I/T "Interpreter/Translator"). Per the
// user, any state Service label containing "Interpreter" maps to I/T.
const SERVICE_LABEL_OVERRIDES = [
  { test: (label) => /interpreter/i.test(label), code: 'I/T' },
];

function mapServiceLabelToCode(label) {
  if (!label) return null;
  const options = activeOptions('service_type');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const override = SERVICE_LABEL_OVERRIDES.find((o) => o.test(label));
  if (override) return override.code;
  const subset = subsetWordMatch(label, options);
  return subset ? subset.code : null;
}

function mapLocationLabelToCode(label) {
  if (!label) return null;
  const options = activeOptions('location');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, options);
  return subset ? subset.code : null;
}

function mapGroupSizeLabelToCode(label) {
  if (!label) return null;
  const options = activeOptions('group_size');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, options);
  return subset ? subset.code : null;
}

function mapStatusLabelToCode(label) {
  if (!label) return null;
  const options = activeOptions('service_status');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n || o.code === String(label).trim());
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, options);
  return subset ? subset.code : null;
}

// Code->label lookups search ALL rows (active + inactive) so a deactivated/
// retired code used on a historical record still resolves to its label
// instead of falling back to the raw code.
const codeLabel = (category, code) => getDropdownOptionsCache()[category].find((o) => o.code === code)?.label || code;
const serviceCodeLabel = (code) => codeLabel('service_type', code);
const locationCodeLabel = (code) => codeLabel('location', code);
const groupSizeCodeLabel = (code) => codeLabel('group_size', code);
const statusCodeLabel = (code) => codeLabel('service_status', code);

module.exports = {
  get SERVICE_TYPE_OPTIONS() { return activeOptions('service_type'); },
  get LOCATION_CODE_OPTIONS() { return activeOptions('location'); },
  get GROUP_SIZE_OPTIONS() { return activeOptions('group_size'); },
  get STATUS_CODE_OPTIONS() { return activeOptions('service_status'); },
  mapServiceLabelToCode,
  mapLocationLabelToCode,
  mapGroupSizeLabelToCode,
  mapStatusLabelToCode,
  serviceCodeLabel,
  locationCodeLabel,
  groupSizeCodeLabel,
  statusCodeLabel,
};
