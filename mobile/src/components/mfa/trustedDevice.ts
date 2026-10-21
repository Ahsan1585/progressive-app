// Trusted-device ("Remember this device") tokens, kept in localStorage as one
// map keyed by `${slug}:${email}` (lowercased) so two people sharing a phone
// never overwrite each other. Storage can be blocked, so every access is
// wrapped and a failure just means "no token".
const KEY = "trustedDevices";
const CURRENT_KEY = "trustedDeviceCurrent";

interface Entry {
  token: string;
  expiresAt: string | null;
  deviceId?: string | null;
}
type DeviceMap = Record<string, Entry>;

const mapKey = (slug: string, email: string) => `${(slug || "").trim()}:${(email || "").trim()}`.toLowerCase();

function readMap(): DeviceMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DeviceMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: DeviceMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage blocked */
  }
}

export function getDeviceToken(slug: string, email: string): string | null {
  const map = readMap();
  const k = mapKey(slug, email);
  const entry = map[k];
  if (!entry || typeof entry.token !== "string" || !entry.token) return null;
  const exp = entry.expiresAt ? Date.parse(entry.expiresAt) : NaN;
  if (Number.isFinite(exp) && exp <= Date.now()) {
    delete map[k];
    writeMap(map);
    return null;
  }
  return entry.token;
}

export function setDeviceToken(slug: string, email: string, token: string, expiresAt?: string | null, deviceId?: string | null) {
  if (!token) return;
  const map = readMap();
  map[mapKey(slug, email)] = { token, expiresAt: expiresAt || null, deviceId: deviceId ? String(deviceId) : null };
  writeMap(map);
}

export function clearDeviceToken(slug: string, email: string) {
  const map = readMap();
  const k = mapKey(slug, email);
  if (k in map) {
    delete map[k];
    writeMap(map);
  }
}

// Remember who last signed in on this device so Security settings can find
// (and clear) this device's own entry after a removal.
export function setCurrentUser(slug: string, email: string) {
  try {
    localStorage.setItem(CURRENT_KEY, mapKey(slug, email));
  } catch {
    /* ignore */
  }
}

// Server id of the trusted-device row this browser holds (current user), or null.
export function getCurrentDeviceId(): string | null {
  try {
    const k = localStorage.getItem(CURRENT_KEY);
    const entry = k ? readMap()[k] : null;
    return entry && entry.deviceId ? String(entry.deviceId) : null;
  } catch {
    return null;
  }
}

export function clearCurrentUserDevice() {
  try {
    const k = localStorage.getItem(CURRENT_KEY);
    if (!k) return;
    const map = readMap();
    if (k in map) {
      delete map[k];
      writeMap(map);
    }
  } catch {
    /* ignore */
  }
}
