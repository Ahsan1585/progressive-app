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
  (getDropdownOptionsCache()[category] || []).filter((o) => o.is_active).map((o) => ({ code: o.code, label: o.label }));

const norm = normalizeForMatch;

// Admin-configurable via company_settings.compliance_strictness (Billing
// Batch Review's "Compliance Matching" tab, ceo-editable). Each profile
// controls how forgiving scoredWordMatch (below) and the time-tolerance
// comparisons in billingController.js are — a starting point that the
// feedback/learning layer (compliance_match_overrides) always overrides
// regardless of which level is active.
const STRICTNESS_PROFILES = {
  strict:   { wordOverlapThreshold: 1,    timeToleranceMinutes: 0 },
  moderate: { wordOverlapThreshold: 0.66, timeToleranceMinutes: 2 },
  lenient:  { wordOverlapThreshold: 0.5,  timeToleranceMinutes: 5 },
};
const resolveStrictnessProfile = (level) => STRICTNESS_PROFILES[level] || STRICTNESS_PROFILES.moderate;

// Fallback for when the state's text doesn't literally equal one of our
// labels — e.g. drops a word ("Speech Therapy" for our "Speech Language
// Therapy") or a clerical variation. Scores what fraction of the state
// text's words are found in each option's words, and matches whichever
// option clears `threshold` — at threshold 1 this is exactly "every one of
// the state's words must appear in the option" (the original, stricter
// behavior); lower thresholds tolerate more of the state's words being
// "wrong"/different. If more than one option ties for the highest
// qualifying score, this intentionally returns null rather than guessing,
// so a bad guess never silently mislabels a record — strictness only
// widens what counts as ONE clear match, it never resolves an ambiguity.
function scoredWordMatch(label, options, threshold = 1) {
  const tokens = norm(label).split(' ').filter(Boolean);
  if (tokens.length < 2) return null;
  const scored = options
    .map((o) => {
      const optTokens = new Set(norm(o.label).split(' ').filter(Boolean));
      const matchingCount = tokens.filter((t) => optTokens.has(t)).length;
      return { option: o, score: matchingCount / tokens.length };
    })
    .filter((s) => s.score >= threshold);
  if (scored.length === 0) return null;
  const maxScore = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === maxScore);
  return winners.length === 1 ? winners[0].option : null;
}

// The state's "Service" column doesn't always literally match one of our
// labels (confirmed against a real export: it says "Foreign Language
// Interpreter" where our code is I/T "Interpreter/Translator"). Per the
// user, any state Service label containing "Interpreter" maps to I/T.
const SERVICE_LABEL_OVERRIDES = [
  { test: (label) => /interpreter/i.test(label), code: 'I/T' },
];

function mapServiceLabelToCode(label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions('service_type');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const override = SERVICE_LABEL_OVERRIDES.find((o) => o.test(label));
  if (override) return override.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}

function mapLocationLabelToCode(label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions('location');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}

function mapGroupSizeLabelToCode(label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions('group_size');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}

function mapStatusLabelToCode(label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions('service_status');
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n || o.code === String(label).trim());
  if (exact) return exact.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}

// Generic version of the mapXLabelToCode pattern above, for any custom
// (admin-created) dropdown category — deliberately does NOT carry
// service_type's SERVICE_LABEL_OVERRIDES or service_status's extra
// exact-code-match rule, since those are domain-specific to NJEIS's fixed
// vocabulary and have no equivalent meaning for an arbitrary custom field.
function mapCategoryLabelToCode(category, label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions(category);
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}

// Code->label lookups search ALL rows (active + inactive) so a deactivated/
// retired code used on a historical record still resolves to its label
// instead of falling back to the raw code.
const codeLabel = (category, code) => (getDropdownOptionsCache()[category] || []).find((o) => o.code === code)?.label || code;
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
  mapCategoryLabelToCode,
  serviceCodeLabel,
  locationCodeLabel,
  groupSizeCodeLabel,
  statusCodeLabel,
  codeLabel,
  STRICTNESS_PROFILES,
  resolveStrictnessProfile,
};
