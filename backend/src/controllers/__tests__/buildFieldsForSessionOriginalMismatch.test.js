// buildFieldsForSession's acknowledgment/learned-override layer paints a
// genuinely-mismatched field to match:true once a human Allows it or a
// learned rule resolves it, so billing/flagged logic can treat the session
// as resolved. But the Overview dashboard's "Billed, unresolved mismatch"
// drill-down needs to show the TRUE original discrepancy (e.g. a time
// mismatch), not a plain green check that hides what the exception covered.
// originalMismatch preserves that fact without changing `match` itself.
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({})),
}));

const { buildFieldsForSession } = require('../billingController');

const baseSession = {
  id: 42,
  child_id: 'C-1',
  patient_first_name: 'Hazel',
  patient_last_name: 'Hughes',
  practitioner_first_name: 'Hector',
  practitioner_last_name: 'Nguyen',
  service_date: '2026-05-21',
  start_time: '15:50',
  end_time: '16:20',
  total_time: 30,
  type: null,
  location: null,
  group_size_category: null,
  status: null,
  form_data: {},
};

const baseMatch = {
  child_id: 'C-1',
  child_name: 'Hazel Hughes',
  practitioner_name: 'Hector Nguyen',
  service_date: '2026-05-21',
  start_time: '15:35', // mismatched vs session.start_time
  end_time: '16:05', // mismatched vs session.end_time
  service_label: null,
  location_label: null,
  group_size_label: null,
  service_status_label: null,
};

const matchParams = { timeToleranceMinutes: 5, wordOverlapThreshold: 0.5 };
const mappedKeys = new Set(['child_id', 'child_name', 'practitioner_name', 'service_date', 'start_time', 'end_time']);
const customFieldsByLabel = new Map();

describe('buildFieldsForSession — originalMismatch', () => {
  test('an acknowledged (Allowed) field stays match:true but carries originalMismatch:true', () => {
    const ackByKey = new Map([
      ['42:start_time', { our_value: '15:50', state_value: '15:35' }],
    ]);
    const overridesByField = new Map();

    const fields = buildFieldsForSession(baseSession, baseMatch, {
      customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey,
    });

    const startTime = fields.find((f) => f.key === 'start_time');
    expect(startTime.match).toBe(true);
    expect(startTime.acknowledged).toBe(true);
    expect(startTime.originalMismatch).toBe(true);
    expect(startTime.ours).toBe('15:50');
    expect(startTime.state).toBe('15:35');
  });

  test('a field resolved by a learned-match rule also carries originalMismatch:true', () => {
    // "Hazel Hughes" vs "Zelda Winthrop" share no words, so scoredNamesMatch
    // reports a genuine mismatch here — exactly the case a learned override
    // (taught via the "remember" checkbox on a prior Allow) exists to cover.
    const matchWithVariant = { ...baseMatch, child_name: 'Zelda Winthrop' };
    const overridesByField = new Map([
      ['child_name', [{ state_value_normalized: 'zelda winthrop', our_value: 'hazel hughes' }]],
    ]);
    const ackByKey = new Map();

    const fields = buildFieldsForSession(baseSession, matchWithVariant, {
      customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey,
    });

    const childName = fields.find((f) => f.key === 'child_name');
    expect(childName.match).toBe(true);
    expect(childName.learnedMatch).toBe(true);
    expect(childName.originalMismatch).toBe(true);
  });

  test('a genuinely-matching field (no ack, no override) has no originalMismatch flag', () => {
    const ackByKey = new Map();
    const overridesByField = new Map();

    const fields = buildFieldsForSession(baseSession, baseMatch, {
      customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey,
    });

    const childId = fields.find((f) => f.key === 'child_id');
    expect(childId.match).toBe(true);
    expect(childId.originalMismatch).toBeUndefined();
  });

  test('a still-flagged field (no ack, no override) stays match:false with no originalMismatch flag', () => {
    const ackByKey = new Map();
    const overridesByField = new Map();

    const fields = buildFieldsForSession(baseSession, baseMatch, {
      customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey,
    });

    const startTime = fields.find((f) => f.key === 'start_time');
    expect(startTime.match).toBe(false);
    expect(startTime.originalMismatch).toBeUndefined();
  });
});
