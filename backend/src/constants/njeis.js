// Mirrors mobile/src/constants/njeis.ts and frontend/src/components/LogInterventionModal.jsx's
// ALL_SERVICE_TYPES exactly — same 20 NJEIS service-type codes, 5 status
// codes, 8 location codes. Used server-side to map the state's plain-text
// Excel export back to the codes our app stores on assessments.
const { normalizeForMatch } = require('../utils/textMatch');

const SERVICE_TYPE_OPTIONS = [
  { code: 'EV', label: 'Evaluation' },
  { code: 'AS', label: 'Assessment' },
  { code: 'IFSP', label: 'IFSP Meeting' },
  { code: 'AU', label: 'Audiology' },
  { code: 'DI', label: 'Developmental Intervention' },
  { code: 'FT', label: 'Family Training' },
  { code: 'HS', label: 'Health Service' },
  { code: 'MS', label: 'Medical Service' },
  { code: 'NU', label: 'Nursing' },
  { code: 'NT', label: 'Nutrition' },
  { code: 'OT', label: 'Occupational Therapy' },
  { code: 'PT', label: 'Physical Therapy' },
  { code: 'PSY', label: 'Psychological' },
  { code: 'SLP', label: 'Speech Language Therapy' },
  { code: 'SW', label: 'Social Work' },
  { code: 'VI', label: 'Vision' },
  { code: 'CC', label: 'Childcare/Respite' },
  { code: 'I/T', label: 'Interpreter/Translator' },
  { code: 'ES', label: 'Escort/Security' },
  { code: 'TPC', label: 'Transition Planning Conference' },
];

const LOCATION_CODE_OPTIONS = [
  { code: '1', label: 'Home' },
  { code: '2', label: 'Residential Facility' },
  { code: '3', label: 'Service Provider Clinic/Office' },
  { code: '4', label: 'Hospital (Inpatient)' },
  { code: '5', label: 'EC Program - Children with Disabilities' },
  { code: '6', label: 'EC Program - Inclusive Community' },
  { code: '7', label: 'DCP&P Office' },
  { code: '8', label: 'Phone/Video Conferencing' },
];

const GROUP_SIZE_OPTIONS = [
  { code: 'individual', label: 'Direct Child Service - Individual' },
  { code: 'consultation', label: 'Consultation/Facilitation with Others' },
];

// Mirrors mobile/src/constants/njeis.ts's STATUS_CODE_OPTIONS (codes only,
// without the "(1)"-style suffix mobile appends for its own dropdown).
const STATUS_CODE_OPTIONS = [
  { code: '1', label: 'Direct Child Service' },
  { code: '2', label: 'Practitioner Cancelled (inc weather related)' },
  { code: '3', label: 'Family Cancelled (inc weather related)' },
  { code: '4', label: 'Make Up Direct Child Service' },
  { code: '5', label: 'Family Missed (within 3 hours)' },
  { code: 'IFSP', label: 'Team Mtg – IFSP' },
  { code: 'TPC', label: 'Transition Planning Conference' },
  { code: 'IT', label: 'Bilingual Interpretation' },
];

// The state's "Service" column doesn't always literally match one of our 20
// labels (confirmed against a real export: it says "Foreign Language
// Interpreter" where our code is I/T "Interpreter/Translator"). Per the
// user, any state Service label containing "Interpreter" maps to I/T.
const SERVICE_LABEL_OVERRIDES = [
  { test: (label) => /interpreter/i.test(label), code: 'I/T' },
];

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

function mapServiceLabelToCode(label) {
  if (!label) return null;
  const n = norm(label);
  const exact = SERVICE_TYPE_OPTIONS.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const override = SERVICE_LABEL_OVERRIDES.find((o) => o.test(label));
  if (override) return override.code;
  const subset = subsetWordMatch(label, SERVICE_TYPE_OPTIONS);
  return subset ? subset.code : null;
}

function mapLocationLabelToCode(label) {
  if (!label) return null;
  const n = norm(label);
  const exact = LOCATION_CODE_OPTIONS.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, LOCATION_CODE_OPTIONS);
  return subset ? subset.code : null;
}

function mapGroupSizeLabelToCode(label) {
  if (!label) return null;
  const n = norm(label);
  const exact = GROUP_SIZE_OPTIONS.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, GROUP_SIZE_OPTIONS);
  return subset ? subset.code : null;
}

function mapStatusLabelToCode(label) {
  if (!label) return null;
  const n = norm(label);
  const exact = STATUS_CODE_OPTIONS.find((o) => norm(o.label) === n || o.code === String(label).trim());
  if (exact) return exact.code;
  const subset = subsetWordMatch(label, STATUS_CODE_OPTIONS);
  return subset ? subset.code : null;
}

const serviceCodeLabel = (code) => SERVICE_TYPE_OPTIONS.find((o) => o.code === code)?.label || code;
const locationCodeLabel = (code) => LOCATION_CODE_OPTIONS.find((o) => o.code === code)?.label || code;
const groupSizeCodeLabel = (code) => GROUP_SIZE_OPTIONS.find((o) => o.code === code)?.label || code;
const statusCodeLabel = (code) => STATUS_CODE_OPTIONS.find((o) => o.code === code)?.label || code;

module.exports = {
  SERVICE_TYPE_OPTIONS,
  LOCATION_CODE_OPTIONS,
  GROUP_SIZE_OPTIONS,
  STATUS_CODE_OPTIONS,
  mapServiceLabelToCode,
  mapLocationLabelToCode,
  mapGroupSizeLabelToCode,
  mapStatusLabelToCode,
  serviceCodeLabel,
  locationCodeLabel,
  groupSizeCodeLabel,
  statusCodeLabel,
};
