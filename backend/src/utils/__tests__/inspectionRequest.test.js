const { computeDueDate, daysRemaining, isOverdue, validateIdentityVerification } = require('../inspectionRequest');

describe('computeDueDate', () => {
  test('adds 10 calendar days', () => expect(computeDueDate('2026-10-01')).toBe('2026-10-11'));
  test('crosses month boundary', () => expect(computeDueDate('2026-10-25')).toBe('2026-11-04'));
  test('crosses year boundary', () => expect(computeDueDate('2026-12-25')).toBe('2027-01-04'));
  test('handles leap February', () => expect(computeDueDate('2028-02-25')).toBe('2028-03-06'));
  test('handles non-leap February', () => expect(computeDueDate('2027-02-25')).toBe('2027-03-07'));
  test('returns null for invalid input', () => {
    expect(computeDueDate('garbage')).toBeNull();
    expect(computeDueDate('2026-02-31')).toBeNull();
  });
});

describe('daysRemaining / isOverdue', () => {
  const today = new Date('2026-10-21T15:00:00Z');
  test('days remaining counts to due date', () => expect(daysRemaining('2026-10-25', today)).toBe(4));
  test('due today is 0 and not overdue', () => {
    expect(daysRemaining('2026-10-21', today)).toBe(0);
    expect(isOverdue({ status: 'open', due_at: '2026-10-21' }, today)).toBe(false);
  });
  test('past due is negative and overdue', () => {
    expect(daysRemaining('2026-10-19', today)).toBe(-2);
    expect(isOverdue({ status: 'open', due_at: '2026-10-19' }, today)).toBe(true);
  });
  test('fulfilled is never overdue', () => expect(isOverdue({ status: 'fulfilled', due_at: '2026-01-01' }, today)).toBe(false));
  test('accepts Date due_at values', () => expect(daysRemaining(new Date('2026-10-25T00:00:00Z'), today)).toBe(4));
});

describe('validateIdentityVerification', () => {
  test('missing method', () => expect(validateIdentityVerification(undefined, '')).toMatch(/identityVerifiedMethod/));
  test('invalid method', () => expect(validateIdentityVerification('nope', '')).toMatch(/identityVerifiedMethod/));
  test('other requires note', () => {
    expect(validateIdentityVerification('other', '  ')).toMatch(/note/i);
    expect(validateIdentityVerification('other', 'checked via school')).toBeNull();
  });
  test('valid', () => expect(validateIdentityVerification('photo_id')).toBeNull());
});
