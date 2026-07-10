import { useState } from 'react';
import { Smartphone, Share, SquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { detectInstallPlatform } from '@/lib/platformDetect';

const MOBILE_APP_URL = import.meta.env.VITE_MOBILE_APP_URL;

// One-time-per-render platform read — the UA doesn't change during a
// session, so there's no need to re-detect on every render.
const installPlatform = typeof navigator !== 'undefined' ? detectInstallPlatform() : 'other';

/**
 * "Practitioners: install our mobile app" banner for the login page.
 * Renders nothing at all when VITE_MOBILE_APP_URL is unset, so local dev
 * and any preview deploy without a deployed mobile app stay clean.
 *
 * NOTE: `frontend/` is a separate, non-PWA app that only links out to the
 * `mobile/` PWA (a different origin/deployment) — it can never capture a
 * native `beforeinstallprompt` event itself, since that event is dispatched
 * only to the document being evaluated for installability based on *its
 * own* manifest + service worker. Every path below is a link out to
 * `MOBILE_APP_URL`; the real native "Install app" experience happens once
 * the user is actually on `mobile/`'s own origin (see
 * `mobile/src/hooks/useInstallPrompt.ts`).
 */
const InstallAppBanner = () => {
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  if (!MOBILE_APP_URL) return null;

  return (
    <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Smartphone className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">
            Practitioners: install our mobile app
          </p>
          <p className="mt-0.5 text-sm text-neutral-600">
            Log encounters faster in the field, right from your home screen.
          </p>

          <div className="mt-3">
            {installPlatform === 'ios-safari' ? (
              <Button
                type="button"
                onClick={() => setShowIOSInstructions(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
              >
                Add to Home Screen
              </Button>
            ) : installPlatform === 'android' ? (
              <div className="space-y-1">
                <a
                  href={MOBILE_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Open the app &rarr;
                </a>
                <p className="text-xs text-neutral-500">
                  You&apos;ll be prompted to install it once you&apos;re
                  there - look for &quot;Install app&quot; in Chrome.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <a
                  href={MOBILE_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Open the app &rarr;
                </a>
                <p className="text-xs text-neutral-500">
                  Installing to your home screen depends on your browser. For
                  the best experience, open this link on your phone in Chrome
                  (Android) or Safari (iPhone).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Home Screen</DialogTitle>
            <DialogDescription>
              Install the practitioner app on your iPhone or iPad in a few
              taps.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm text-neutral-700">
            <li className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                1
              </span>
              <span className="pt-0.5">
                Open this page in Safari, then tap the Share icon{' '}
                <Share className="inline size-4 align-text-bottom" /> in the
                toolbar.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                2
              </span>
              <span className="pt-0.5">
                Scroll down and tap{' '}
                <span className="font-semibold text-neutral-900">
                  Add to Home Screen
                </span>{' '}
                <SquarePlus className="inline size-4 align-text-bottom" />.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                3
              </span>
              <span className="pt-0.5">
                Tap{' '}
                <span className="font-semibold text-neutral-900">Add</span>{' '}
                to finish. The app icon will appear on your home screen.
              </span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InstallAppBanner;
