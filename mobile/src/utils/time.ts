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

// Today's date as the device's own local calendar day — NOT
// `new Date().toISOString().split("T")[0]`, which converts to UTC first.
// A practitioner on the East Coast in the evening has already rolled into
// UTC's "tomorrow" hours before their own local midnight, so that pattern
// defaults the Service Date field to the wrong day. getFullYear/getMonth/
// getDate all read the device's local time zone directly.
export const localTodayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Coarse relative-time label (e.g. "2 hours ago", "3 days ago") — good
// enough for "how stale is this draft", no need for a precise duration.
// Shared by Home's draft list and PatientDetail's "Resume draft" list, since
// a child can now have up to 2 concurrent drafts that need to be told apart.
export const timeAgo = (isoString: string): string => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
};
