// Target fields Compliance Analysis needs out of the state's Excel export.
// `candidates` are the exact header text(s) we auto-detect against — taken
// from the real NJEIS "Service Log Report" export column headers. When the
// state changes their export's column headers, auto-detection stops
// matching and the Company Information mapping screen flags that field for
// the user to re-point manually (see companyController.uploadComplianceDoc
// / applyComplianceDocMapping).
const { normalizeForMatch } = require('../utils/textMatch');

const TARGET_FIELDS = [
  { key: 'child_id', label: 'Child ID', required: true, candidates: ['Child ID'] },
  { key: 'child_name', label: 'Child Name', required: false, candidates: ['Child Name'] },
  { key: 'practitioner_name', label: 'Practitioner', required: false, candidates: ['Practitioner'] },
  { key: 'service_date', label: 'Service Date', required: true, candidates: ['Service Date'] },
  { key: 'start_time', label: 'Start Time', required: false, candidates: ['Start Time'] },
  { key: 'end_time', label: 'End Time', required: false, candidates: ['End Time'] },
  { key: 'service_label', label: 'Service (Service Type code)', required: false, candidates: ['Service'] },
  { key: 'location_label', label: 'Location', required: false, candidates: ['Location'] },
  { key: 'group_size_label', label: 'Group Size', required: false, candidates: ['Group Size'] },
  { key: 'logged_date', label: 'Logged Date', required: false, candidates: ['Logged Date'] },
  { key: 'ifsp_event_id', label: 'IFSP Event ID', required: false, candidates: ['IFSP Event ID'] },
];

const norm = normalizeForMatch;

// Best-effort auto-match: for each target field, find the first sheet
// header whose normalized text exactly matches one of its candidates.
function suggestMapping(headers) {
  const suggestion = {};
  for (const field of TARGET_FIELDS) {
    const match = headers.find((h) => field.candidates.some((c) => norm(c) === norm(h)));
    suggestion[field.key] = match || null;
  }
  return suggestion;
}

module.exports = { TARGET_FIELDS, suggestMapping, norm };
