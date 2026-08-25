// Small display-formatting helpers shared by anything that needs to show a
// session's date/time/duration in human-readable form — originally a local
// copy inside reportController.js, extracted here so the new parent-facing
// telepractice-signature flow (which needs the same conversions, but for a
// non-technical outside reader who must never see a raw 24h time or bare
// minute count) can reuse it instead of a second copy.

// Converts a 24-hour "HH:MM" string into 12-hour AM/PM format.
const formatTime12h = (timeStr) => {
  if (!timeStr) return '';
  const [hourStr, minuteStr] = String(timeStr).split(':');
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return timeStr;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${(minuteStr || '00').padStart(2, '0')} ${period}`;
};

// Converts a date (Date object, or a 'YYYY-MM-DD'/ISO string) into a long
// form date, e.g. "Tuesday, August 25, 2026" — never a bare MM/DD/YY.
const formatLongDate = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  // service_date is stored as a plain date (no time-of-day/timezone
  // component that matters), so format using UTC fields — reading it back
  // with local-timezone getters could roll it to the adjacent calendar day
  // depending on the server's TZ.
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

// Converts a minute count into a spelled-out duration, e.g. "1 hour",
// "45 minutes", "1 hour 15 minutes" — never a bare, unitless number.
const formatDurationLabel = (totalMinutes) => {
  const minutes = Number(totalMinutes);
  if (!minutes || minutes <= 0 || isNaN(minutes)) return '';
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (remaining > 0) parts.push(`${remaining} minute${remaining === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 minutes';
};

module.exports = { formatTime12h, formatLongDate, formatDurationLabel };
