# Art Direction: Practitioner Mobile App (`mobile/`)

Source design (structural): `design/practitioner-mobile-app.md`
Source spec (intent): `specs/practitioner-mobile-app.md`
Reference identity (what we are evolving): `frontend/src/pages/dashboard.jsx`,
`frontend/src/components/LogInterventionModal.jsx`,
`frontend/src/components/SignaturePad.jsx`, `frontend/src/index.css`,
`frontend/src/components/ui/*`.

**Design Read** (design-taste-frontend): _Reading this as a dedicated mobile
field-tool for clinical practitioners, one-handed in a family's living room
under variable light, with a Swiss-clinical language, leaning toward a
refinement of the app's own Geist + slate + trust-blue system rather than a new
look._

> This is a **redesign in "preserve" mode**, not a greenfield. The existing web
> app already has a committed, coherent visual identity (Geist typeface, slate
> neutrals, a single blue-600 accent, emerald/amber/red/violet status
> semantics, ~10px radius, soft shadows, uppercase micro-labels). Identity
> preservation wins. Everything below either **carries a token forward
> verbatim** or **changes one thing on purpose for mobile**, and says which.

---

## 1. Design concept

A **clinical instrument that fits in one hand.** The feeling is a calm,
trustworthy, precise field tool: the practitioner should feel the app is quiet
and certain while they stand in a stranger's living room capturing legal PHI on
a phone. Nothing decorative competes with the two things that matter, reading a
patient's history and capturing an encounter without losing data. The user
walks away feeling _"that was faster and steadier than the website, and I never
worried whether it saved."_

The big idea in one line: **take the web app's Swiss-clinical calm and make it
tactile** — every tap answers, every state is legible, the numbers line up, and
the signature feels like ink.

---

## 2. Chosen style

**Primary style: `Swiss Modernism 2.0`** (ui-ux-pro-max style #50).
Rational, grid-driven, mathematical 8px spacing, high contrast, a single
vibrant accent, no gradient decoration, excellent in both light and dark, WCAG
AAA-capable, rated High for mobile. This is not a new direction — it is the
_named, disciplined version of what the current app already reaches for_
(slate + one blue accent + Geist + uppercase micro-labels + no ornament). It
lets me refine rather than reinvent.

**Layered with `Micro-interactions`** (style #16) — the tactile feedback layer
the desktop-first build lacks (50–160ms press/state feedback, gesture dismissal,
skeleton loads, success/error states). This is where the mobile app _earns_ its
existence over the responsive site.

**Governed by `Accessible & Ethical`** (style #8) — mandated by the domain:
PHI, a public-service audience, and the design plan's hard a11y requirements
(≥44px targets, never color-only state, 4.5:1 text, visible focus, reduced
motion, persistent labels).

**Deliberately rejected:**
- `Healthcare App` catalog palette (calm cyan `#0891B2` + health green). It is
  the obvious first-order reflex for "healthcare app" and it would **throw away
  the app's own blue-600 identity**. Rejected on identity-preservation grounds.
- `Neumorphism` / `Soft UI Evolution` / `Wellness Calm` — low-contrast, soft,
  spa-like. Wrong for legally-binding clinical data read quickly in bright
  daylight. Fails the "never color/contrast-only" requirement.
- `Glassmorphism` / `Liquid Glass` on the tab bar or sheets — accessibility
  hostile, and a banned default. The tab bar is a solid surface with a hairline.

---

## 3. Color palette

Named palette: **"Clinical Trust Blue"** — an evolution of ui-ux-pro-max's
`SaaS (General)` trust-blue anchor (`#2563EB`, which _is_ the app's existing
Tailwind `blue-600`), kept as the single locked accent, over the app's existing
slate neutral ramp, with the existing four-channel status semantics from
`components/ui/badge.tsx` preserved intact.

**Accent is locked to blue.** One accent, used identically on every screen
(Color Consistency Lock). Violet appears _only_ as the pre-existing `override`
status semantic, never as decoration.

### Light mode (default — clinical clarity, best in daylight)

| Token | Hex | Role | Contrast note |
| --- | --- | --- | --- |
| `--bg` | `#F8FAFC` | app background (slate-50) | — |
| `--surface` | `#FFFFFF` | cards, sheets, tab bar | — |
| `--surface-sunken` | `#F1F5F9` | inset fields, skeletons (slate-100) | — |
| `--border` | `#E2E8F0` | hairlines, card borders (slate-200) | 1.2:1 vs surface (decorative, ok) |
| `--border-strong` | `#CBD5E1` | pressed/active field border (slate-300) | — |
| `--ink` | `#0F172A` | primary text (slate-900) | 16.8:1 on surface ✓ AAA |
| `--ink-body` | `#334155` | body / secondary (slate-700) | 10.4:1 ✓ AAA |
| `--ink-muted` | `#64748B` | captions, meta (slate-500) | 4.8:1 ✓ AA |
| `--ink-faint` | `#94A3B8` | **placeholders / disabled only** (slate-400) | 2.9:1 ✗ — never body text |
| `--primary` | `#2563EB` | accent, primary buttons (blue-600) | 4.6:1 vs white ✓ AA; white-on-primary 4.6:1 ✓ |
| `--primary-hover` | `#1D4ED8` | pressed primary (blue-700) | 6.3:1 ✓ |
| `--primary-tint` | `#EFF6FF` | selected rows, info wash (blue-50) | — |
| `--primary-tint-2` | `#DBEAFE` | active chip fill (blue-100) | — |
| `--ring` | `#2563EB` @ 45% | focus ring | 3px, always visible |
| `--success` | `#047857` / bg `#ECFDF5` / border `#A7F3D0` | "Accepted"/active (emerald-700 on emerald-50) | 6.5:1 ✓ AA |
| `--warning` | `#B45309` / bg `#FFFBEB` / border `#FDE68A` | "Returned" (amber-700 on amber-50) | 5.9:1 ✓ AA |
| `--danger` | `#B91C1C` / bg `#FEF2F2` / border `#FECACA` | "Declined"/destructive (red-700 on red-50) | 6.8:1 ✓ AA |
| `--info` | `#1D4ED8` / bg `#EFF6FF` / border `#BFDBFE` | "In Review" (blue-700 on blue-50) | 6.3:1 ✓ AA |
| `--override` | `#6D28D9` / bg `#F5F3FF` / border `#DDD6FE` | admin override (violet-700 on violet-50) | 6.6:1 ✓ AA |
| `--signature-ink` | `#0A0A0A` | signature stroke (carried forward exactly) | — |

> Note: the badge component's status _text_ colors are bumped one step darker
> (e.g. amber-700 not amber-600) so every status label clears 4.5:1 on its own
> tint — the current web badges use `-700` text on `-100` fills and pass; this
> keeps that intact on the `-50` fills used for larger surfaces.

### Dark mode (defined companion — evening visits, dim rooms)

The web app ships `.dark` tokens that are effectively unused. For mobile they
become real. Same hierarchy, same locked blue accent, status hues preserved.

| Token | Hex | Role |
| --- | --- | --- |
| `--bg` | `#0B1120` | near-black slate (not pure black — preserves depth) |
| `--surface` | `#111827` | cards, tab bar |
| `--surface-sunken` | `#1E293B` | inset fields, skeletons |
| `--border` | `#243044` | hairlines (≈ white 8%) |
| `--ink` | `#F1F5F9` | primary text — 15:1 ✓ |
| `--ink-body` | `#CBD5E1` | body — 9.4:1 ✓ |
| `--ink-muted` | `#94A3B8` | captions — 4.9:1 ✓ AA |
| `--primary` | `#3B82F6` | accent (blue-500 — brightened for dark, brand stays recognizable) |
| `--primary-fg` | `#0B1120` | text on primary |
| `--signature-ink` | `#0A0A0A` on a `#FFFFFF` canvas | signature canvas stays a white "paper" in both modes — a signature is a legal artifact, not a themed surface |

Status tints in dark: fill = hue @ ~18% over surface, text = hue-300, border =
hue @ 30%. Never rely on the hue alone (paired text label + icon always).

---

## 4. Typography

Named pairing: **"Minimal Swiss" (single-family discipline) executed in
Geist** — ui-ux-pro-max pairing #5 is Inter+Inter; I keep its _one-family,
weight-driven_ Swiss logic but use **Geist Variable**, the app's already-committed
typeface (superior tabular numerals, more modern grotesque, and design-taste
explicitly prefers Geist over Inter). A **Geist Mono** companion is added for the
data this app is saturated with: times, Child IDs, NJEIS codes, minutes, hours,
stat counts.

- **Display font:** Geist Variable — headings, all UI text.
- **Body font:** Geist Variable — same family, weight/size carry the hierarchy.
- **Data/mono font:** Geist Mono, `font-variant-numeric: tabular-nums` — every
  number that sits in a column, ticks, or must align.

Contrast axis is weight + size + the sans/mono split, never two similar sans
(design-taste rule honored).

### Type scale (mobile-first, base 16px per the app's existing mobile rule)

| Role | Font / weight | Size / leading | Tracking | Use |
| --- | --- | --- | --- | --- |
| Display | Geist 700 | 30 / 36px | -0.02em | Patient name on Detail, big stat values |
| Screen title | Geist 600 | 20 / 26px | -0.01em | Screen headers (Roster, Log Intervention) |
| Section | Geist 600 | 17 / 24px | 0 | "Recent Interventions", card headings |
| Body | Geist 400 | 16 / 24px | 0 | Default text, field values (≥16px mobile min) |
| Body-strong | Geist 600 | 16 / 24px | 0 | Row titles, patient names in lists |
| Label | Geist 500 | 13 / 18px | 0 | **Persistent visible form labels** (sentence case, above field) |
| Micro-label | Geist 600 | 11 / 14px | 0.06em UPPERCASE | Metadata eyebrows (Child ID / DOB / County) — a **carried-forward signature**, but rationed to card metadata, not stacked above every section |
| Caption | Geist 400 | 12 / 16px | 0 | Timestamps, helper text (`--ink-muted`) |
| Data | Geist Mono 500 | 13–16 / tabular | 0 | Times, Child ID, total minutes, hours, stat counts |

Body line length is naturally capped by the single-column phone width (well
under 65–75ch). `text-wrap: balance` on screen titles and empty-state headings.

---

## 5. Layout & composition

**App shell (the core change from the responsive site).**
- **Bottom tab bar**, 4 destinations (Home / Roster / Inbox / Profile), solid
  `--surface` with a 1px `--border` top hairline and `env(safe-area-inset-bottom)`
  padding. Tab item = icon (Tabler/Lucide, 24px, `stroke-width:2`) + 11px label,
  each a ≥56×48px target. Active tab: `--primary` icon+label + a 2px top
  indicator; inactive: `--ink-muted`. Inbox tab carries the count badge (a
  `--danger` pill, top-right of the icon, tabular-nums).
- **Full-screen pushed views** (Add Patient, Patient Detail, Log Intervention,
  Resubmit) are their own routes with a top app bar: back chevron (≥44px),
  centered/leading title, optional trailing action. They **push** in from the
  right, not appear as centered desktop dialogs.
- **Bottom sheet** for Acknowledge Decline (single light action) — rounded top
  corners `--radius-sheet` (16px), grabber handle, swipe-to-dismiss.
- The pre-auth stack (Login / Forced Change / Forgot / Reset / Unsupported Role)
  renders **with no tab bar**, single centered column, generous vertical rhythm.

**Grid & spacing.** 8px base unit (Swiss discipline), 4px half-step allowed.
Screen gutter 16px. Card padding 16px (mobile) vs the web's 20–28px — tighter,
mobile-appropriate. Vertical rhythm between blocks 12/16/24px. One column
throughout (also satisfies the plan's text-scaling / no-horizontal-scroll a11y
requirement).

**Shape lock** (Shape Consistency Lock, carried forward from existing radii):
- Cards / sheets: **16–18px** (existing `rounded-2xl` ≈ 18px). Sheet tops 16px.
- Controls (buttons, inputs, pickers): **10px** (existing `--radius` / `rounded-lg`).
- Pills / tabs / status badges / chips: **full radius** (existing).
- Hard ceiling: nothing rounded past 18px, even on full-screen sheets (avoids
  the over-rounded tell).

**Focal hierarchy per key screen:**
- **Home:** greeting → 3 stat tiles (Geist Mono values, equal grid) → the
  "needs your attention" prompt (only when Inbox has items; `--warning`/`--danger`
  full-border card, never a left-stripe).
- **Roster:** sticky search field on top → Add action as a header icon button →
  list rows (Body-strong name + Mono Child ID). Selected/active row uses
  `--primary` fill (carried forward from the web sidebar's selected state).
- **Patient Detail:** patient header card → **sticky "Log Intervention" primary
  bar** always reachable without scroll → history list, most-recent-first, each
  row: date (Mono) + service type + status micro-copy + text-labeled billing
  Status Badge + total hours (Mono, right-aligned).
- **Log Intervention:** sticky top **section-chip bar** (Details / Codes /
  Signatures) → single continuous scroll → **sticky bottom submit bar** with a
  live "N still missing" readout (Mono count). Touch-sized pickers, not dense
  `<select>`.

---

## 6. Motion & micro-interactions

Kowalski framework applied: animate by **frequency of use**, ease-out for
entrances, custom curves, everything under 300ms for UI, reduced-motion
alternatives mandatory.

**Tokens:**
```
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);   /* entrances, feedback */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* sheets / pushed views */
--dur-press: 120ms;  --dur-pop: 180ms;  --dur-sheet: 320ms;  --dur-push: 280ms;
```

- **Press feedback (everywhere tappable):** `transform: scale(0.97)` on
  `:active`, `--dur-press` `--ease-out`. Buttons, rows, tab items, chips,
  signature controls. This is the single biggest tactile upgrade over the site.
- **Tab switches:** **no animation** — the tab bar is used hundreds of times;
  content swaps instantly (Kowalski: never animate high-frequency nav). Only the
  active-indicator slides (layout animation, `--dur-pop`, `--ease-in-out`).
- **Pushed views (Add Patient, Detail, Log Intervention):** **Direction-aware
  transition** — slide in from right on push, out to right on back,
  `--dur-push` `--ease-drawer`.
- **Bottom sheet (Acknowledge Decline):** **Slide in** from bottom
  (`translateY(100%)` → `0`), `--dur-sheet` `--ease-drawer`; **Swipe to dismiss**
  with momentum (velocity > ~0.11 dismisses) and boundary damping. Origin is the
  bottom edge so swipe direction matches entrance (Spatial consistency).
- **Modals/dialogs (Confirm discard, Log out, Idle warning):** **Scale in** from
  `scale(0.95)` + opacity (never `scale(0)`), centered origin (modals stay
  centered), `--dur-pop` `--ease-out`.
- **Stat tiles (Home):** **Skeleton shimmer** while loading (structurally
  distinct from a real "0"), then a subtle **Number ticker** count-up on first
  paint of the session only (rare event → delight is allowed), Geist Mono
  tabular so digits don't jitter.
- **Toasts (encounter saved, resubmitted, acknowledged):** **Slide in** from top
  or bottom edge, auto-dismiss, `--ease-out`; enter/exit share a direction.
- **Section-chip bar (Log Intervention):** active chip uses the **clip-path
  color transition** technique (duplicate label layer, animate the clip) for a
  seamless fill/text swap; tapping a chip smooth-scrolls to its section.
- **Submit-readiness:** as the last missing field completes, the bottom bar's
  "N missing" does a small **Text morph / number ticker**, and the Submit button
  crosses from disabled to enabled via a **blur-masked crossfade**
  (`filter: blur(2px)` bridge) so the state change reads as one motion.
- **Signature capture:** on stroke-end, the canvas plays a **Pop in** check +
  a 1px `--success` ring settling in, confirming "captured" (fixes the web's
  silent capture). Redo control appears alongside.

**Reduced motion:** every transform-based motion above collapses to an
instant/opacity-only change under `prefers-reduced-motion: reduce`. Skeletons,
color, and the capture-confirm check remain (they aid comprehension). Hover
effects gated behind `@media (hover: hover) and (pointer: fine)` so touch taps
don't trigger phantom hovers.

---

## 7. Signature details (the crafted touches)

1. **Ink on ruled paper.** The signature canvas keeps the exact
   `#0A0A0A` stroke but grows from the web's cramped 120px to **~200px tall,
   full-width**, with `touch-action: none` (no scroll-while-signing), a faint
   1px baseline guide, and a white "paper" surface in _both_ light and dark
   modes — a signature is a legal artifact, not a themed component. Ends with the
   explicit **captured** state (check + success ring), never silent.
2. **Tabular data rail.** Every number in the app — times, Child IDs, total
   minutes, hours, stat counts, the Inbox badge, the "N missing" readout — is
   Geist Mono with `tabular-nums`, so columns align, tickers don't shift, and
   clinical data reads like an instrument panel. This is the detail that makes it
   feel _measured_ rather than _typed_.
3. **One tinted elevation system, three levels.** Shadows are blue-tinted (hue of
   `--primary`, not pure black), soft, ≤8px blur, and never paired with a 1px
   border on the same element (no ghost-card): `--elev-rest` (cards),
   `--elev-raised` (sticky bars, tab bar, active row), `--elev-overlay` (sheets,
   dialogs). Depth communicates layer, not decoration.
4. **The semantic pulse dot, rationed.** The web header's emerald
   `animate-pulse` "live" dot is carried forward but earns its place as the
   _session-active_ indicator only (design-taste bans decorative dots; this one
   is real state). One per shell, in the top app bar.
5. **Status Badge as text + icon, always.** Carried forward verbatim from the
   badge component and the design plan's hard rule: `Returned` (warning +
   corner-flag icon), `Declined` (danger + slash icon), `In Review` (info +
   clock), `Accepted` (success + check), `Pending`/`neutral` (slate + dot).
   Never hue-only, so the different _actions_ (resubmit vs acknowledge) are never
   guessed from color.

---

## 8. Anti-slop guardrails (do NOT drift back to these)

- **Do not reinvent the palette to cyan/teal "because healthcare."** Blue-600
  `#2563EB` is the locked accent. One accent, every screen.
- **No AI-purple / gradients / gradient text.** Violet is reserved strictly for
  the existing `override` status semantic. No glow, no mesh, no `background-clip:
  text`.
- **No glassmorphism** on the tab bar, sheets, or cards. Solid `--surface` +
  hairline. (Accessibility + banned default.)
- **No ghost-card** (1px border + ≥16px drop shadow on the same element). Pick
  one: hairline border _or_ a ≤8px tinted shadow.
- **No side-stripe borders** on the "needs attention" / rejection / declined
  cards. Use full tinted borders (as the current web app does) — do not drift to
  a colored `border-left`.
- **Radius ceiling 18px.** Cards/sheets ≤18px, controls 10px, pills full. No
  24/28/32px over-rounding on full-screen surfaces.
- **Placeholder gray (`--ink-faint`, slate-400) is never body or label text.**
  Labels are persistent, visible, sentence-case, above the field (never
  placeholder-as-label).
- **No dense desktop `<select>` dropdowns** for the NJEIS vocabularies — touch
  pickers/sheets sized for a thumb.
- **Do not animate tab switches or any keyboard-driven action**, and do not
  animate anything from `scale(0)`.
- **No em-dash** anywhere in UI copy (use a hyphen or restructure).
- **No decorative status dots**, version labels, scroll cues, or eyebrow labels
  stacked above every section. The uppercase micro-label survives only as card
  metadata, rationed.
- **Never convey state by color alone** — every status, validation, and
  saved-vs-drawn signature cue is paired with text and/or an icon.

---

## Summary for the caller

- **Slug:** `practitioner-mobile-app`
- **File:** `design/practitioner-mobile-app-art-direction.md`
- **Style:** Swiss Modernism 2.0 (primary) + Micro-interactions + Accessible &
  Ethical
- **Palette:** "Clinical Trust Blue" (SaaS trust-blue `#2563EB` anchor over the
  app's slate ramp + preserved emerald/amber/red/violet status semantics; light
  default, dark companion)
- **Type:** "Minimal Swiss" single-family discipline in **Geist Variable + Geist
  Mono** (tabular numerals for all clinical data)

Concept: evolve the web app's Swiss-clinical calm into a one-handed field
instrument — same Geist + slate + locked blue-600 identity, but made tactile
with mobile ergonomics (bottom-tab shell, full-screen pushed views, a fingertip
signature canvas) and Kowalski-grade press/state/capture polish the desktop
build never had.
