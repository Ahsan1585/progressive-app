// Discipline choices offered to an independent practitioner at signup.
// Same code space as dropdown_options' seeded 'service_type' category
// (see backend/db/migrations/add_dropdown_options.sql) so a disciplines
// array written here lines up with practitioners.service_types everywhere
// else in the app (session logging, staff directory, EditWorkDetails.tsx).
// Deliberately a CURATED SUBSET of that 20-code list: service_type also
// contains session-event codes that aren't a practitioner's own discipline
// (EV Evaluation, AS Assessment, IFSP Meeting, TPC Transition Planning
// Conference, ES Escort/Security) — those stay available later as a
// per-session service type, just not offered as "what are you" at signup.
const INDEPENDENT_DISCIPLINE_OPTIONS = [
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
  { code: 'I/T', label: 'Interpreter/Translator' },
];

const INDEPENDENT_DISCIPLINE_CODES = new Set(INDEPENDENT_DISCIPLINE_OPTIONS.map((o) => o.code));

module.exports = { INDEPENDENT_DISCIPLINE_OPTIONS, INDEPENDENT_DISCIPLINE_CODES };
