# Izaya EIS Marketing Walkthrough Video — Design

## Context

Izaya EIS needs a short walkthrough video prospective customers can watch to understand the platform and the value it delivers, without paying for any third-party video-production service. This is a content-production task, not a code change — the "implementation" is capturing real screens from the live app and assembling them into a designed, narrated video.

An external toolkit (`digitalsamba/claude-code-video-toolkit`) was evaluated and rejected: despite marketing itself as low-cost, it requires paid-capable third-party cloud GPU/storage accounts (Modal/RunPod + Cloudflare R2) and is built for AI-generated stylized content rather than real screen-recorded product footage. Instead, this uses tooling already available in this environment at no additional cost: Playwright (screen capture) feeding into the `hyperframes` skill ecosystem (professional video assembly/design), both installed locally.

## Compliance constraint

All footage is recorded against tenant `izayaedge`, whose data is confirmed by the user to be entirely dummy/fake and safe for public use. **No other tenant's data may ever appear on screen** — this is the one hard boundary on the capture step.

## Audience & goal

Prospective customers evaluating Izaya EIS. The video's job is to make three things visually obvious in under two minutes: logging a session is fast for practitioners, signatures are captured digitally in the moment, and billing/invoicing — normally weeks of manual review — is reduced to minutes through automated compliance matching.

## Narration & format

- Voiceover is recorded by the user against a script this project provides — no TTS, no synthesized voice.
- Output targets both 16:9 (marketing site / YouTube) and 9:16 (vertical social). Shots are composed to work as 16:9 first; the 9:16 cut re-crops the same footage, re-centered per shot, rather than being a separate recording pass.

## Storyboard

| # | Scene | Time | What's shown |
|---|---|---|---|
| 0 | Cold open | ~0:00–0:03 | The app's real launch animation (`mobile/src/components/shell/SplashScreen.tsx`) — blooming leaf/sprout draws in, IZAYA wordmark strokes in, tagline "Early Intervention Simplified." Captured live via Playwright, not recreated. |
| 1 | Hook / practitioner ease | 0:03–0:18 | Mobile app, Log Session screen — how few taps it takes to fill in a session. |
| 2 | Dual signature capture | 0:18–0:33 | Both signature pads on the same screen — practitioner signs, then parent signs, in the moment. |
| 3 | Instant handoff | 0:33–0:43 | Submit → the log already sitting in the office's Pending Bills queue. |
| 4 | Office review & billing periods | 0:43–0:58 | Admin dashboard, Billing & Invoices — the Biweekly 1 / Biweekly 2 / Monthly period picker. |
| 5 | Automation payoff | 0:58–1:23 | Compliance Analysis — click into a log, run the analysis, see auto-matched counts clear instantly and only flagged exceptions surfaced. |
| 6 | Closing stat | 1:23–1:33 | Brand-styled title card: "Weeks of invoice processing. Reduced to minutes." |

Total runtime: roughly 90–95 seconds.

## Script

| Scene | Time | VO |
|---|---|---|
| 1 | 0:03–0:18 | "For early intervention practitioners, every extra minute of paperwork is a minute away from the families who need you. Izaya EIS makes logging a session effortless — right from your phone." |
| 2 | 0:18–0:33 | "Capture both signatures on the spot — practitioner and parent — right there in the visit. No paper, no follow-up, no chasing anyone down later." |
| 3 | 0:33–0:43 | "The moment it's submitted, it's already in the office's queue — ready for review." |
| 4 | 0:43–0:58 | "Billing runs on your schedule — biweekly or monthly — with every session organized and ready to go." |
| 5 | 0:58–1:23 | "One click runs the analysis. Every log is instantly cross-checked against EIMS records — matches are approved automatically, and only the sessions that actually need a second look get flagged for your team." |
| 6 | 1:23–1:33 | "What used to take weeks of manual review now takes minutes. Izaya EIS — less paperwork, more time for families." |

## Technical approach

**Capture (Playwright):**
- Admin dashboard scenes: desktop viewport (1920×1080, 2x device scale factor) against the real app logged into `tenant_izayaedge`.
- Practitioner app scenes: phone-viewport emulation (e.g. iPhone 14 Pro dimensions) in the same browser — no physical device needed.
- Real video recording of each scene (not static screenshots), so typing, signing, and clicking read as genuine motion.
- Shots are framed/cropped to their focal region per scene (e.g. tight on the signature pad while signing, tight on the Compliance Analysis result counts) rather than always capturing the full viewport.

**Design & assembly (`hyperframes` skill ecosystem, already installed, no added cost):**
- `hyperframes` — mandatory entry point; routes the request.
- `product-launch-video` — the workflow: extracts real brand tokens (colors/typography) from the live UI, builds a storyboard, and composes frame-by-frame.
- `hyperframes-creative` — palette/typography/pacing direction so the result doesn't look templated.
- `hyperframes-animation` — transitions, title-card motion, zoom/pan on the screen footage.
- `hyperframes-registry` — reusable designed components (lower-thirds, captions, overlays).
- `hyperframes-cli` — preview/render loop.
- `media-use` — optional background music/SFX bed, resolved through a free HeyGen sign-in the user will complete themselves (not required — the video can ship with narration-only audio if skipped).

Playwright supplies the authentic interaction footage; HyperFrames supplies the marketing-grade design layer around it (brand-matched title cards, captions, transitions) and renders the final 16:9 and 9:16 exports.

## Credentials handling

Login credentials for `tenant_izayaedge` (admin/billing account and practitioner account) were provided by the user for this recording task. They are stored only in the session-local scratchpad (outside the repo, `.gitignore`d by location, never committed) and used solely to drive Playwright during capture.

## Out of scope

- SMS or any non-email/non-in-app delivery channel — not relevant to this video.
- Any tenant other than `izayaedge` appearing on screen.
- Paid third-party rendering/generation services of any kind.

## Verification

- Manual review of rendered output before publishing: confirm no PHI/real-tenant data appears in any frame (only `izayaedge` dummy data), confirm both 16:9 and 9:16 exports play back cleanly, confirm captions/lower-thirds match the locked script.
