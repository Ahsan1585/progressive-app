// Matches the calculation used by frontend/src/pages/dashboard.jsx and
// LogInterventionModal.jsx exactly, so total-time figures agree with the web app.
export const calculateTotalMinutes = (startTime: string, endTime: string): number => {
  if (!startTime || !endTime) return 0;
  const start = new Date(`1970-01-01T${startTime}`);
  const end = new Date(`1970-01-01T${endTime}`);
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.round(diffMs / 60000);
  return diffMins < 0 ? diffMins + 24 * 60 : diffMins;
};

// Converts a 24-hour "HH:MM" string (from <input type="time">) into 12-hour AM/PM format.
// Mirrors frontend/src/utils/formatTime.js.
export const formatTime12h = (timeStr?: string | null): string => {
  if (!timeStr) return "";
  const [hourStr, minuteStr] = timeStr.split(":");
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return timeStr;
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${(minuteStr || "00").padStart(2, "0")} ${period}`;
};

// Prevents timezone shifting when displaying a date-only string. Mirrors
// frontend/src/pages/dashboard.jsx's formatSafeDate.
export const formatSafeDate = (dateString?: string | null): string => {
  if (!dateString) return "N/A";
  const [year, month, day] = dateString.split("T")[0].split("-");
  return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
};
