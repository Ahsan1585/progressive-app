// Today's date as the device's own local calendar day — NOT
// `new Date().toISOString().split("T")[0]`, which converts to UTC first. A
// practitioner in the evening on the East Coast has already rolled into
// UTC's "tomorrow" hours before their own local midnight, so that pattern
// defaults the Service Date field to the wrong day. getFullYear/getMonth/
// getDate all read the device's local time zone directly.
export const localTodayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Converts a 24-hour "HH:MM" string (from <input type="time">) into 12-hour AM/PM format.
export const formatTime12h = (timeStr) => {
  if (!timeStr) return '';
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return timeStr;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${(minuteStr || '00').padStart(2, '0')} ${period}`;
};
