// Pure, dependency-free platform detection for the "install the mobile app"
// banner. Kept separate from any component so the logic can be reasoned
// about (and unit tested later) without rendering anything.
//
// `frontend/` is not itself the installable PWA — it only links out to
// `mobile/` (a separate origin/deployment), so `beforeinstallprompt` can
// never fire here (that event is dispatched only to the document whose own
// manifest + service worker are being evaluated for installability). This
// detection exists purely to tailor the *copy* of the "open the app" link:
// iOS Safari gets manual "Add to Home Screen" instructions (the only path
// possible there), Android/Chrome gets a note that it'll be prompted to
// install once it's actually on the `mobile/` PWA's own origin, and
// everything else gets a generic fallback.

/**
 * True for iPhone/iPad/iPod, including iPadOS 13+ which disguises itself as
 * "MacIntel" in `navigator.platform` but is touch-capable (a real Mac never
 * reports `maxTouchPoints > 1`).
 */
export function isIOSDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const isClassicIOSUA = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus = platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1;
  return isClassicIOSUA || isIPadOS13Plus;
}

/**
 * True only for real Safari — excludes Chrome/Firefox/Edge/other in-app
 * browsers on iOS that also include "Safari" in their UA string, since none
 * of those can install a PWA to the home screen even on iOS.
 */
export function isSafariBrowser(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || "";
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPR|Chrome|Android|FBAN|FBAV|Instagram/i.test(ua);
  const mentionsSafari = /Safari/i.test(ua);
  return mentionsSafari && !isOtherBrowser;
}

/**
 * True for Android devices (any browser) — used only to tailor the
 * "open the app" note, since Android/Chrome will get its own native install
 * prompt once it's actually on the `mobile/` PWA's origin.
 */
export function isAndroidDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  return /Android/.test(nav.userAgent || "");
}

/**
 * @returns {"ios-safari" | "ios-other" | "android" | "other"}
 * - "ios-safari": show the manual "Add to Home Screen" instructions panel.
 * - "ios-other": iOS but a browser that cannot install PWAs at all (Chrome/
 *   Firefox/Instagram in-app browser, etc.) — fall back to "open the app".
 * - "android": Android/Chrome (or another Android browser) — "open the app"
 *   link with a note that they'll be prompted to install once they land on
 *   the mobile app's own origin.
 * - "other": desktop/anything else — generic "open the app" fallback.
 */
export function detectInstallPlatform(nav = globalThis.navigator) {
  if (isIOSDevice(nav)) {
    return isSafariBrowser(nav) ? "ios-safari" : "ios-other";
  }
  if (isAndroidDevice(nav)) {
    return "android";
  }
  return "other";
}
