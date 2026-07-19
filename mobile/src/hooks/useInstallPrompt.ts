import { useEffect, useState, useCallback } from "react";

/** The (non-standard but universally implemented) Chrome/Edge/Android install-prompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isRunningStandalone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own (non-standard) flag, kept as a belt-and-suspenders check.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

/**
 * Captures the browser's native `beforeinstallprompt` event (Chrome/Edge/
 * Android — the standard PWA install-prompt API) so a custom "Install app"
 * affordance can trigger the real OS install dialog on demand.
 *
 * This only works on the origin that IS the installable PWA, which is why
 * this hook lives in `mobile/` (not `frontend/`, which merely links here —
 * `beforeinstallprompt` is dispatched based on *this document's own*
 * manifest + service worker and never fires for a link to another origin).
 *
 * Safari (iOS and macOS) never fires this event; that path is out of scope
 * here and handled with manual "Add to Home Screen" instructions elsewhere.
 */
// How long to show the indeterminate "installing" state if the browser
// never fires `appinstalled` (some Android/Chrome versions are inconsistent
// about it, or the user backgrounds the tab mid-install) — a safety valve so
// the UI can't get stuck showing "Installing…" forever.
const INSTALL_FALLBACK_TIMEOUT_MS = 20000;

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(isRunningStandalone);
  // True from the moment the user accepts the native install dialog until
  // the OS actually finishes installing (`appinstalled`) — there's no web
  // API for real install progress, so this only drives an indeterminate bar.
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Prevent the browser's default mini-infobar; we show our own CTA.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setIsInstalling(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!isInstalling) return;
    const timer = window.setTimeout(() => setIsInstalling(false), INSTALL_FALLBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isInstalling]);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalling(true);
    } finally {
      // A captured prompt event can only be used once.
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return {
    canPromptInstall: Boolean(deferredPrompt) && !isInstalled,
    // Safari (iOS/iPadOS) never fires beforeinstallprompt, so there's no
    // programmatic install — surface this instead so the UI can show manual
    // "Add to Home Screen" instructions.
    showIOSInstructions: isIOSDevice() && !isInstalled,
    isInstalled,
    isInstalling,
    promptInstall,
  };
}
