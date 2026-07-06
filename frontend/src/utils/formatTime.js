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
