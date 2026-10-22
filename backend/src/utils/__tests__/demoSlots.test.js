// Demo booking slots: 30-minute slots, Monday to Friday, 9:00 to 17:00 New York
// time, never today or in the past, and correct on both sides of a DST change.
const { generateSlots, isBookableSlot, SLOT_MINUTES } = require('../demoSlots');

// Wednesday 2026-10-21, 15:00 UTC = 11:00 EDT
const NOW = new Date('2026-10-21T15:00:00Z');

const byNyDate = (slots) => {
  const out = {};
  for (const iso of slots) {
    const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    (out[d] = out[d] || []).push(iso);
  }
  return out;
};

test('every weekday has 16 half-hour slots from 9:00 to 16:30 New York time', () => {
  const days = byNyDate(generateSlots({ now: NOW, days: 7 }));
  const thu = days['2026-10-22'];
  expect(thu).toHaveLength(16);
  expect(SLOT_MINUTES).toBe(30);
  const times = thu.map((iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }));
  expect(times[0]).toBe('9:00 AM');
  expect(times[15]).toBe('4:30 PM');
});

test('no weekend slots and no slots today', () => {
  const days = byNyDate(generateSlots({ now: NOW, days: 7 }));
  expect(days['2026-10-21']).toBeUndefined(); // today
  expect(days['2026-10-24']).toBeUndefined(); // Saturday
  expect(days['2026-10-25']).toBeUndefined(); // Sunday
  expect(days['2026-10-26']).toHaveLength(16); // Monday
});

test('9:00 New York is 13:00 UTC before the November DST change and 14:00 UTC after it', () => {
  const slots = generateSlots({ now: NOW, days: 21 });
  expect(slots).toContain('2026-10-30T13:00:00.000Z'); // Fri, EDT
  expect(slots).toContain('2026-11-02T14:00:00.000Z'); // Mon, EST
  expect(slots).not.toContain('2026-11-02T13:00:00.000Z');
});

test('booked slots are left out', () => {
  const booked = ['2026-10-22T13:00:00.000Z', '2026-10-22T13:30:00.000Z'];
  const days = byNyDate(generateSlots({ now: NOW, days: 7, booked }));
  expect(days['2026-10-22']).toHaveLength(14);
  expect(days['2026-10-22']).not.toContain(booked[0]);
});

test('isBookableSlot accepts a generated slot and rejects anything else', () => {
  expect(isBookableSlot('2026-10-22T13:00:00.000Z', { now: NOW })).toBe(true);
  expect(isBookableSlot('2026-10-22T13:15:00.000Z', { now: NOW })).toBe(false); // off the half hour
  expect(isBookableSlot('2026-10-22T21:00:00.000Z', { now: NOW })).toBe(false); // 17:00, after hours
  expect(isBookableSlot('2026-10-24T14:00:00.000Z', { now: NOW })).toBe(false); // Saturday
  expect(isBookableSlot('2026-10-21T18:00:00.000Z', { now: NOW })).toBe(false); // today
  expect(isBookableSlot('not a date', { now: NOW })).toBe(false);
});
