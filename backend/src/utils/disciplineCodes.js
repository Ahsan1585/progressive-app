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

module.exports = { DISCIPLINE_CODE_MAP, getDisciplineCode };
