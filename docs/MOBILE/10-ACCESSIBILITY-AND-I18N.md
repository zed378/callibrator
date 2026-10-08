# 10 — Accessibility and Languages (TARGET)

> **TARGET — nothing here is built.** Target: **WCAG 2.1 Level AA** on every screen, in both themes
> (`docs/UI-UX/17`), applied to native through the platform accessibility APIs. Languages:
> **Indonesian first, English second**, from the shared `i18n` package
> ([`docs/SHARED/04-I18N.md`](../SHARED/04-I18N.md)).

---

## 1. The Rules of `docs/UI-UX/17`, in Native Terms

| `17` rule | Native implementation |
|---|---|
| Text 4.5:1, large text and UI parts 3:1, both themes | colours come **only** from the shared tokens' React Native theme (`docs/SHARED/02-TOKENS.md` § 9), whose values are the ones the web's contrast test (`a11y.adr090`) pins; no raw colour in the app (`90` § 3) |
| Status is shape + icon + text, never colour alone (ADR-122 § 6) | the native `StatusBadge` renders the tone's shape (solid / tint + border / tint / dashed / tint), its icon from the shared icon map, **and** the label; in a dense list cell the label is the cell's accessible text |
| Control boundaries 3:1 | inputs, checkboxes and switches draw their outline with `border-strong` (= `--input`), never the decorative border |
| Visible focus | the platform focus ring on hardware-keyboard focus, in the primary token colour; never removed (`03` § 7) |
| Every control labelled; errors linked to fields | `accessibilityLabel` from the visible label (or `accessibilityLabelledBy` on Android); field errors in `accessibilityHint` + announced on submit; never placeholder-as-label |
| Icon-only controls named after their object | `accessibilityLabel={t("devices.photos.remove", { name })}` → "Remove the front photo of Infusion Pump B-Braun", not "Remove" |
| Announce what changed | `AccessibilityInfo.announceForAccessibility` for async results (saved locally, synced, needs attention, update ready); Android `accessibilityLiveRegion="polite"` on status areas |
| One `<main>` / one `<h1>` per page | per screen: one header with `accessibilityRole="header"` naming the screen; section titles are headers too; the navigator's title equals it |
| Motion: `prefers-reduced-motion` | `AccessibilityInfo.isReduceMotionEnabled()` → no animated transitions beyond the platform default; no motion carries meaning alone (`docs/UI-UX/16`) |
| Zoom and reflow | Dynamic Type / font scale without a cap on content (`03` § 8); layouts reflow, never clip |
| Keyboard operable | `03` § 7 — Tab order, arrows in grids, Enter/Space, Esc |

## 2. Touch and Gestures

- Targets **≥ 44 × 44 pt** (iOS) and **≥ 48 × 48 dp** (Android); 8 dp between adjacent targets
  (`docs/UI-UX/15`); `hitSlop` only to reach the minimum, never to overlap a neighbour.
- **Every gesture has a visible alternative**: swipe-to-act on a list row is a shortcut for an action
  that also exists as a button (or an accessibility action — `accessibilityActions` with names); no
  drag-only interaction; pull-to-refresh also has a "Refresh" action reachable by screen readers.
- Native gestures follow the platform: iOS swipe-back from the edge, Android system back / predictive
  back; neither is overridden inside the capture stepper — leaving a step is safe because every change
  is already saved locally (`04`).
- The QR scanner never depends on aiming alone: **typed entry** is on the same screen (`05` § 2), and
  the scanner announces "Code found" when it decodes.

## 3. Screen-Specific Requirements

| Screen | Requirement |
|---|---|
| **IPM capture stepper** | each item is one accessibility element group: label, required state, the value, the unit, the limit ("limit 0.5 milliohm maximum") and any out-of-range flag read in that order; the step indicator is a header ("Step 3 of 9, Electrical safety"); "Submit" is announced with its consequence (`03` § 5) |
| **Verify** (auditor, signed out) | held to `17`'s higher standard for the verification page: the verdict is the first thing read; works at the largest text size; no time limit; a failed verification says why in plain words; tested in both themes in bright and dim conditions on the real-device run |
| **Dashboards** | each chart has a text alternative (a table of its values reachable by screen readers); headline figures are text, not images; "unavailable" is said, never "0" |
| **Lists with status** | the cell's accessible text reads "Infusion Pump B-Braun, IP-2024-00871, Active, IPM due, Room 2.14" — status words included |
| **Needs attention / conflicts** | the explanation is read before the actions; destructive actions are named as such ("Discard this capture, 3 photos") |
| **Sign-in, MFA** | `textContentType` / `autoComplete` set for password managers and one-time codes; errors announced; no CAPTCHA |

## 4. Languages

- **Indonesian is the default**, English the second language — the field users are Indonesian
  hospital and provider staff; the public surfaces already default to Indonesian (ADR-098) and the
  field app is Indonesian-first (P19-08 § 3.1). The language follows the device (`expo-localization`)
  when it is Indonesian or English; otherwise Indonesian; the user can choose in Settings (stored in
  MMKV — a preference, not tenant data).
- **One dictionary set, shared with the web** (`docs/SHARED/04-I18N.md`): keys are namespaced by feature
  (`field.*`, `ipm.*`, `devices.*`, `auth.*`, `verify.*`, `mobile.*` for strings only the app has);
  every key exists in **both** `id` and `en` — a missing key fails the shared package's test, not a user.
- **API error messages:** the server's `data.code` maps to a dictionary entry (`field.conflicts.*`,
  `auth.errors.*`); the server's own message is shown only when no code is known — so a conflict reads
  the same in the PWA and the app.
- **Formatting** through the shared formatters over `Intl` (Hermes ships `Intl`): dates in the
  **tenant's time zone** (default `Asia/Jakarta`, UD-7) with the locale's format; decimal comma in
  Indonesian for display; **measured values are entered** with either a comma or a point and parsed by
  the one shared parser (P19-01 § 7) — never reformatted in a way that changes digits; units are never
  translated (`mΩ`, `kPa`).
- **Domain vocabulary stays the users'**: *IPM*, *IPSRS*, *faskes*, *opname* are kept as the users say
  them (`docs/UI-UX/00` § Language); seeded role display names are Indonesian (Admin Faskes, Teknisi,
  IPSRS, Penyelia).
- **Store listings, permission purpose strings, push and local notification texts** exist in both
  languages (config plugin localisations for the purpose strings — `NSCameraUsageDescription` etc. —
  per `InfoPlist.strings`, Android `values-in/strings.xml`).
- Right-to-left is not a requirement (neither language is RTL); layouts still use `start`/`end` rather
  than `left`/`right` so that adding one later is not a rewrite.

## 5. Evidence

Per release (`09` § 6): the component a11y assertions, the Maestro largest-font flow, the Accessibility
Scanner / Accessibility Inspector audits, and a recorded **TalkBack and VoiceOver walk** of sign-in,
scan, capture, verify and sign — named in the release record with what was found and fixed.
