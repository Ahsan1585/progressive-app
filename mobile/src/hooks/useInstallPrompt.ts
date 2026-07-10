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
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(isRunningStandalone);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Prevent the browser's default mini-infobar; we show our own CTA.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      // A captured prompt event can only be used once.
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return {
    canPromptInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
