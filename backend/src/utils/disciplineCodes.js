// Maps the full discipline names from RegisterPractitionerForm.jsx's "Discipline / Position
// Title" dropdown to the short codes from the NJEIS-020 Service Type Code legend, so the
// Discipline/Position Title box on the printed form fits (it's sized for a 2-4 letter code).
const DISCIPLINE_CODE_MAP = {
  'Developmental Interventionist': 'DI',
  'Speech Language Pathologist': 'SLP',
  'Occupational Therapist': 'OT',
  'Physical Therapist': 'PT',
  'Social Worker': 'SW',
  'Special Educator': 'HS',
  'Family Therapist': 'FT',
};

const getDisciplineCode = (positionTitle) => {
  if (!positionTitle) return '';
  return DISCIPLINE_CODE_MAP[positionTitle] || positionTitle;
};

// Normalizes either a full discipline name OR a short code to the same code
// space, for comparing our stored practitioner_discipline (a full name)
// against a state export's discipline column (which might use either form).
const mapDisciplineToCode = (value) => {
  if (!value) return null;
  const n = String(value).trim().toLowerCase();
  const byLabel = Object.entries(DISCIPLINE_CODE_MAP).find(([label]) => label.toLowerCase() === n);
  if (byLabel) return byLabel[1];
  const byCode = Object.values(DISCIPLINE_CODE_MAP).find((code) => code.toLowerCase() === n);
  return byCode || null;
};

module.exports = { DISCIPLINE_CODE_MAP, getDisciplineCode, mapDisciplineToCode };
