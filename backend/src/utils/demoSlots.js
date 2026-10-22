// Demo-call booking slots: 30 minutes long, Monday to Friday, starting from
// 9:00 to 16:30 New York time (so the last call ends at 17:00). Today and
// anything in the past are never offered, so a prospect can't book a call
// that starts in ten minutes. Times are computed in America/New_York with
// the built-in Intl API, so the UTC instant is right on both sides of a DST
// change without a timezone library.
const TZ = 'America/New_York';
const SLOT_MINUTES = 30;
const FIRST_HOUR = 9;
const LAST_START_MINUTES = 16 * 60 + 30;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
});

// Wall-clock fields of an instant in New York.
function nyParts(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: p.weekday,
  };
}

// The UTC instant for a New York wall-clock time.
function nyToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms) => {
    const p = nyParts(new Date(ms));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms); // second pass settles the hour around a DST change
  return new Date(ms);
}

const dayKey = (p) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

// -> ISO strings (UTC) of every free slot from tomorrow through `days` days ahead.
function generateSlots({ now = new Date(), days = 21, booked = [] } = {}) {
  const taken = new Set(booked.map((b) => new Date(b).toISOString()));
  const today = nyParts(now);
  const out = [];
  for (let i = 1; i <= days; i += 1) {
    // Noon UTC on calendar day today+i, read back in New York, gives that date safely.
    const noon = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 16, 0));
    const d = nyParts(noon);
    if (d.weekday === 'Sat' || d.weekday === 'Sun') continue;
    for (let m = FIRST_HOUR * 60; m <= LAST_START_MINUTES; m += SLOT_MINUTES) {
      const iso = nyToUtc(d.year, d.month, d.day, Math.floor(m / 60), m % 60).toISOString();
      if (!taken.has(iso)) out.push(iso);
    }
  }
  return out;
}

// True only for an exact slot start that generateSlots would offer (ignoring bookings).
function isBookableSlot(value, { now = new Date(), days = 21 } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const p = nyParts(date);
  const today = nyParts(now);
  if (dayKey(p) <= dayKey(today)) return false;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const minutes = p.hour * 60 + p.minute;
  if (minutes < FIRST_HOUR * 60 || minutes > LAST_START_MINUTES || minutes % SLOT_MINUTES !== 0) return false;
  if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return false;
  return date.getTime() - now.getTime() <= (days + 1) * 24 * 60 * 60 * 1000;
}

module.exports = { generateSlots, isBookableSlot, nyParts, SLOT_MINUTES, TZ };
