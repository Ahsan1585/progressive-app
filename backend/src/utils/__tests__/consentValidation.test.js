const { validateConsentDetails } = require('../consentValidation');

const njToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const njDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const base = (o = {}) => ({ recipientName: 'ABC Billing', recipientEmail: 'billing@abc.org', purpose: 'Billing', recordTypes: ['sevf_forms'], ...o });
const DAY = 24 * 60 * 60 * 1000;

describe('validateConsentDetails expiresAt (date-only = end of that NJ day)', () => {
  test("choosing today's date is accepted, and stays valid through the end of today in New Jersey", () => {
    const today = njToday();
    const r = validateConsentDetails(base({ expiresAt: today }));
    expect(r.error).toBeUndefined();
    const exp = r.value.expiresAt;
    expect(exp).toBeInstanceOf(Date);
    expect(exp.getTime()).toBeGreaterThan(Date.now());
    // Still the chosen date in NJ, and one second later it is the next NJ day.
    expect(njDate(exp)).toBe(today);
    expect(njDate(new Date(exp.getTime() + 1000))).not.toBe(today);
  });

  test('a date-only value is the end of that day, not midnight UTC (which is the previous evening in NJ)', () => {
    const r = validateConsentDetails(base({ expiresAt: '2027-03-15' }));
    expect(njDate(r.value.expiresAt)).toBe('2027-03-15');
    expect(r.value.expiresAt.getTime()).toBeGreaterThan(Date.parse('2027-03-15T23:00:00Z'));
  });

  test('handles both EST and EDT dates', () => {
    for (const d of ['2027-01-15', '2027-07-15']) {
      const exp = validateConsentDetails(base({ expiresAt: d })).value.expiresAt;
      expect(njDate(exp)).toBe(d);
      expect(njDate(new Date(exp.getTime() + 1000))).not.toBe(d);
    }
  });

  test('a past date is rejected', () => {
    expect(validateConsentDetails(base({ expiresAt: '2020-01-01' })).error).toMatch(/future/);
    const yesterday = njDate(new Date(Date.now() - DAY));
    expect(validateConsentDetails(base({ expiresAt: yesterday })).error).toMatch(/future/);
  });

  test('an impossible calendar date is rejected', () => {
    expect(validateConsentDetails(base({ expiresAt: '2027-02-30' })).error).toMatch(/valid date/);
  });

  test('full ISO timestamps keep working unchanged', () => {
    const iso = new Date(Date.now() + 30 * DAY).toISOString();
    expect(validateConsentDetails(base({ expiresAt: iso })).value.expiresAt.toISOString()).toBe(iso);
    expect(validateConsentDetails(base({ expiresAt: '2020-01-01T00:00:00.000Z' })).error).toMatch(/future/);
  });

  test('expiry more than 5 years ahead is rejected; exactly within 5 years is accepted', () => {
    const tooFar = new Date(Date.now() + (5 * 366 + 2) * DAY).toISOString();
    expect(validateConsentDetails(base({ expiresAt: tooFar })).error).toMatch(/5 years/);
    const ok = new Date(Date.now() + 4 * 365 * DAY).toISOString();
    expect(validateConsentDetails(base({ expiresAt: ok })).error).toBeUndefined();
  });
});

describe('validateConsentDetails recipientEmail (required on every new consent)', () => {
  test.each([
    ['missing', undefined],
    ['null', null],
    ['blank', '   '],
    ['no @', 'billing.abc.org'],
    ['no domain dot', 'billing@abc'],
    ['has spaces', 'bill ing@abc.org'],
    ['two addresses', 'a@abc.org, b@abc.org'],
  ])('rejects a %s recipient email so the parent approves a specific inbox', (_label, value) => {
    const r = validateConsentDetails(base({ recipientEmail: value }));
    expect(r.value).toBeUndefined();
    expect(r.error).toMatch(/recipientEmail/);
  });

  test('accepts a valid address and returns it trimmed', () => {
    const r = validateConsentDetails(base({ recipientEmail: '  Billing@ABC.org ' }));
    expect(r.error).toBeUndefined();
    expect(r.value.recipientEmail).toBe('Billing@ABC.org');
  });
});

describe('validateConsentDetails length limits', () => {
  test.each([
    ['recipientName', { recipientName: 'x'.repeat(201) }, /recipientName.*200/],
    ['recipientEmail', { recipientEmail: `${'x'.repeat(195)}@a.org` }, /recipientEmail.*200/],
    ['purpose', { purpose: 'x'.repeat(501) }, /purpose.*500/],
    ['proofNote', { proofNote: 'x'.repeat(1001) }, /proofNote.*1000/],
    ['identityVerifiedNote', { identityVerifiedNote: 'x'.repeat(1001) }, /identityVerifiedNote.*1000/],
  ])('rejects an over-long %s with a clear message', (_l, o, re) => {
    expect(validateConsentDetails(base(o)).error).toMatch(re);
  });

  test('accepts values exactly at the limits', () => {
    const r = validateConsentDetails(base({
      recipientName: 'x'.repeat(200), recipientEmail: `${'x'.repeat(194)}@a.org`, purpose: 'x'.repeat(500),
      proofNote: 'x'.repeat(1000), identityVerifiedNote: 'x'.repeat(1000),
    }));
    expect(r.error).toBeUndefined();
  });

  test('limits apply to the trimmed value', () => {
    expect(validateConsentDetails(base({ recipientName: `  ${'x'.repeat(200)}  ` })).error).toBeUndefined();
  });
});
