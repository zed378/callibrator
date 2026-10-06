# P10-17 — Warm, human-centric redesign of the landing, sign-in and request access; light and dark modes (ADR-118 with Amendments 1 and 3)

**Date:** 2026-10-05 · **Card:** P10-17 · **Decision:** ADR-118 in `MEMORY/DECISIONS.md`.
- **Base decision:** the warm palette and the photographs.
- **Amendment 1:** the composition, the inverted section, the auth surface.
- **Amendment 2:** the logo. Written by the logo agent, record `2026-10-05-logo-warm-recolour.md`.
- **Amendment 3:** dark mode, the second-pass imagery, the swipeable explanations.

**Spec amended:** `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` — header note, §3, §4.1, §4.2 (light, inverted and dark tables), §4.3, §4.5, §6.1–§6.6, §6.10, §7.1, §11.1 and §12.

**Brief:** the owner's `.claude/commands/redesign-landing.md`. It was revised three times during the work; the final version is "Human warmth × Luxury × Modern Editorial × Dynamic Interaction", plus §19 "Login & Register". Then came the owner's follow-ups: refresh the photographs, add a light/dark toggle, make the certificate explanations swipe on mobile. An independent QA pass followed (verdict NEEDS WORK; evidence in `scratchpad/qa-p1017/`), and every item it raised was addressed (§9).

**Owner's answers** to the brief's two questions:
- **Palette:** warm light throughout, with dark teal only as "verified".
- **Visuals:** free-licence photographs, self-hosted.

## 1. Audit before the change

**What the git history shows.** The first commit's landing (`a984e7b`) felt warm, for three reasons:
- a light theme;
- people in photographs;
- Motion stagger and a scroll-filled rail.

It was also built on fabricated proof: randomuser faces, "12,000+", invented hospitals and testimonials. P10-00 rightly removed the fabrication, and ADR-098 then made the surface dark and cinematic with no people at all. The warmth left with the fabrication.

**Why the Phase 10 page felt generic:**
1. A near-black and electric-teal palette.
2. No human beings anywhere.
3. One skeleton repeated in every section.
4. Brochure ordering.
5. A uniform capability grid.
6. Almost no motion or interaction.
7. Verification, the strongest fact, shown as a static phone image.

## 2. Per-section evaluation (kept / redesigned / removed)

| Section (before) | Verdict | Now |
|---|---|---|
| Header (5 anchors, "Hubungi kami" primary) | **Redesigned** | Essentials only: workflow, verification, security, the theme toggle, ID/EN, *Masuk*, and the primary CTA **Minta akses** (`/request-access`). Transparent at the top; opaque once scrolled (no height change). "Hubungi kami" lives in the closing section (`#kontak`) |
| Hero (screenshot + motif) | **Redesigned** | A full-bleed photograph of a clinician at a vital-signs monitor, shown first on mobile as a short band. A greeting on the visitor's clock and the kicker "…semuanya sudah siap." The sourced `<h1>` and lead are unchanged. One interactive element: the gauge needle follows the pointer (it settles once on touch) |
| Problem band (3 bullets) | **Redesigned** | The Story: three numbered moments in large serif type. Then a full-bleed human moment (hands at a desk of papers, late). Then the transformation: a before/after slider plus the three "Dengan Device Calibrator" lines |
| Workflow story | **Kept and deepened** | Sticky panel, progress rail, a micro-animation per step. Below 1024 px it is a swipeable scroll-snap strip with zoomed crops. The screenshots were re-captured in light theme |
| — | **Added** | The explorable sample certificate (personalization). All values are invented and labelled. One marker per explanation; the explanations swipe (scroll-snap) in sync with the markers and dashes |
| Verification (static phone) | **Redesigned** | The inverted section (deep charcoal; lifted espresso in dark mode) with the interactive scan demo |
| — | **Added** | Proof, minimal and centred: says plainly that there are no customer stories yet, with three links to what a visitor can check. `customerStories.ts` is an empty, typed slot |
| Compliance & security | **Redesigned** | An editorial split. The disclaimer, unchanged in wording, set as a large serif statement over a full-height photograph; standards and controls as two quiet columns |
| Capabilities grid | **Redesigned** | Run-in editorial type ("…◆…"). `#fitur` kept |
| How we work (3 cards) | **Redesigned** | A full-width photo band (a staff member setting a wall monitor) with the title over it, then a horizontal three-step timeline |
| FAQ | **Kept** | Native `<details>` with a smooth open, in a minimal two-column layout |
| Contact band | **Redesigned** | A minimal closing: kicker, very large serif line, contact buttons |
| First-pass scenario cards, bento, hero screenshot overlay, count-up card, UK-corridor photo, `hero.webp` | **Removed** | Card and grid patterns the brief forbids; a photograph with identifiable faces and a real hospital's uniforms; an unused asset |

## 3. Login and request access (brief §19)

**Shell (`AuthShell.tsx`):**
- An editorial photograph behind a warm veil, one serif line, and a sample certificate whose QR "forms" once on load.
- Below 1024 px it collapses to a 6 px band.
- The theme toggle and ID/EN sit by the back link. The back link does not prefetch `/`, so the landing CSS is not preloaded on auth pages.
- The form column no longer re-centres when the form streams in, which removes a CLS source.

**Sign-in — each state as designed:**
- **Default:** a greeting, the `<h1>`, and "Alat Anda, jadwalnya, dan sertifikatnya ada di sini."
- **Loading:** spinner and text inside a full-width button, with no shift.
- **Validation:** a hint on blur for an empty identifier or password, with `aria-describedby` and `aria-invalid`.
- **Wrong credentials, locked, rate-limited, suspended, network:** the existing non-enumerating dictionary messages, in a `role="alert"` that rises softly.
- **2FA:** one large `one-time-code` field (`inputmode="numeric"`); a pasted "123 456" is taken whole. The recovery-code switch is kept.
- **SSO:** the organisation-code step, restyled.
- **Passkey:** kept. Passwordless sign-in exists (P10-10, ADR-108), so the brief's "only if it exists" condition is met.
- **First sign-in password:** restyled.
- **Success:** a redirect, unchanged.
- **Session expired / continue:** a notice when a `callbackUrl` is present.
- **Reset done / invited:** the existing notices.

**Request access — each state as designed:**
- **Default:** focus-driven two-section progress. Every field stays on the page.
- **Validation:** on blur, which only ever adds an error. Editing a field clears its own error, and the summary lists only what the last submit found — so the form never moves under the pointer (the first P10 run caught that).
- **400, 429 and network:** dictionary sentences.
- **Success:** "Permintaan untuk {organisation} atas nama {name} sudah tercatat. Tim kami akan menghubungi Anda." Then the three next steps; no time, price or SLA.
- **Closed (privacy gate, ADR-113):** a designed state with the next-steps line and the contact channels.
- **Forgot password and invitation:** the new shell, the OTP field style, and 44 px links.

**Logic NOT changed (presentation only).** These files were not touched:
- **Frontend:** `app/login/hooks/useLoginForm.ts`, `api/services/auth.service.ts`, `api/client.ts`, `lib/safeCallback.ts`, `lib/passkey.ts`, `i18n/apiErrors.ts`, `proxy.ts`, `app/api/**`, `app/sso-callback/**`.
- **Backend:** all of it.
- **Messages and payload:** no message wording or enumeration behaviour changed. The submitted payload is identical, proved by `authPresentation.p1017.test.tsx` against the body P10-06 pins.

## 4. Colour, type, motion, dark mode

**Light palette:**
- ivory `#FBF7F0`, cream `#F4ECDF`, paper `#FFFDF8`;
- charcoal `#1F1B17` (16.02:1);
- copper `#9A4E22` (5.64:1);
- gold `#C49A5B`, decorative only;
- verified teal `#0E5A52`.

**Inverted section:**
- `#241E19` with ivory text (14.42:1);
- in dark mode it lifts to `#30261F` with hairlines, so it stays distinct.

**Dark mode** (`--pub-dark-*`):
- espresso `#1A1511`, ivory text 15.86:1, copper `#E3A47B` 8.51:1, verified `#7CCFC0` 9.96:1;
- every text pair ≥ 4.5:1 and every boundary ≥ 3:1 on all four dark surfaces (`publicTokens.contrast.p1001.test.ts`);
- `.lp-paper` (the demo certificate and the phone screen) keeps every light value in both modes, so the QR is always dark on light.

**The theme switch:**
- It is the app's one mechanism: `localStorage` `hdc-theme-preference` plus `.dark` on `<html>`, set before paint by the nonce'd init script, which now also writes `data-theme-choice`.
- When nothing is stored, the system preference applies.
- The toggle is in the header, the mobile menu and the auth shell. `/verify` follows the theme without a toggle (AC-7 budget).

**Type:** Instrument Serif (display; the Italic is a separate face that is not preloaded) and Plus Jakarta Sans (not preloaded). No JetBrains Mono on `/`.

**Motion:**
- CSS-first; the islands use no library.
- The LCP image is never masked or faded, and the `<h1>` only rises.
- Everything sits inside `no-preference`. The a11y suite's reduced-motion check passed on `/` and `/login`.

## 5. Assets

**Unsplash License photos.** Each was checked `premium: false` and `plus: false`; source, author and subject are in `frontend/public/marketing/ASSETS.md` and doc 20 §12.
- `clinician-monitor.webp` — hero.
- `technician-bench.webp` — auth panel.
- `paper-stacks.webp` — before/after.
- `late-paperwork.webp` — the human moment.
- `records-review.webp` — compliance.
- `device-check.webp` — how we work.

**Removed:**
- `hallway-conversation.webp`;
- `product/hero.webp`;
- the `WNlFy0_apVQ` trial photo (never shipped).

**Product screenshots:**
- Re-captured in light theme from the demo tenant on the `p1017warm` stack.
- The stack ran in development mode for `seed-demo`, then went back to production.
- The browser suite's own test rows were removed from the page before capture. The demo certificate's `valid_until` was moved forward in that throwaway database.

**Still needed from the owner:** commissioned photographs of a real, consenting Indonesian hospital team, with model releases (`ASSETS.md`).

## 6. Evidence on the final tree

| Gate | Result |
|---|---|
| Frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| Full jest with coverage (`npm run test:coverage -- --ci`) | 297 suites, 3,144 tests. One failure, `useBoard.realtime.test.ts` (A-53 realtime reconnect, another lane's area), passed 3/3 alone; a load flake. Coverage **93.94 / 84.78 / 89.63 / 94.6** against the 90 / 81 / 86 / 91 gate |
| `npx next build` | exit 0 |
| `node scripts/bundle-budget.mjs` | All 10 routes within the **unchanged** ceilings: `/` 127.9 / 180 brotli (gzip 148.7 / 150), `/login` 153.9 / 155, `/request-access` 147.5 / 148, `/verify/*` 118.4 / 120 |
| P10-17 tests | `landingIslands.p1017.test.tsx` (23), `authPresentation.p1017.test.tsx` (6), `PublicThemeToggle.p1017.test.tsx` (4), `landing.p1003` (10, including the explorer rendered as `page.tsx` calls it, in ID and EN), `copyTruthfulness.p1011`, `publicTokens.contrast.p1001` (19: light, inverted, inverted-in-dark, dark), `publicContent` (new nav), and all `/login`, `/request-access`, `/forgot-password` and `/invitation` suites |
| Browser, production `next start` (`scratchpad/shots.cjs`, `dark.cjs`, `swipe.cjs`) | See §6.1 |
| Lighthouse 12.8.2, mobile, simulated, 3 runs, local workstation | See §6.2 |
| Live, stack `p1017warm` | See §8 |

### 6.1 Browser checks on production `next start`

- **axe, WCAG 2.1 A/AA:** 0 violations on `/` (ID and EN, 360/768/1280/1536, with and without reduced motion) and on `/login`, `/request-access`, `/forgot-password`, `/invitation` and `/blog` (4 widths plus reduced motion).
- **axe in dark mode:** 0, both as an explicit choice and as the system preference, at 360 and 1280 on the same pages. A light choice also holds over a dark system.
- **Layout:** no sideways scroll. One `<main>` and one `<h1>`. CSP violations 0. CLS ≤ 0.008.
- **Toggle:** a 44 × 44 px box that does not move. The choice persists across reload, using the shared key.
- **Explorer swipe at 375 px (touch drag):** the active marker, the dash and the live region all follow, with no page overflow.
- **Header:** opaque when scrolled.
- **Text-only zoom 200 %:** the hero `<h1>` breaks a long word instead of overflowing (`overflow-wrap`).

### 6.2 Lighthouse medians (3 runs each)

| Page | Performance | LCP | Other categories | LCP element |
|---|---|---|---|---|
| `/` | 88 | 3.6 s | A11y, Best Practices and SEO 100; CLS 0 | the hero photograph |
| `/login` | 89 | 3.2 s | A11y, Best Practices and SEO 100 | the `<h1>` |

**AC-5/AC-6 are not met** (`/` needs LCP ≤ 2.5 s; `/login` needs Performance ≥ 95 and LCP ≤ 1.8 s).
- **Observed LCP** is 0.33–1.5 s.
- **The simulated gap** comes from two places:
  - Two late page-level stylesheets (the public font faces and the landing CSS, ~6 KB) block render. Lighthouse estimates 300–440 ms for them.
  - The framework's JavaScript costs main-thread time under simulation. This is the limit ADR-098 Amendment 2 already records.
- **Improved by this card:** the mask on the LCP image is removed, only the display face is preloaded, and the auth back link does not prefetch.
- **Next lever:** moving the landing CSS into the global sheet. It is not done because it adds about 5 KB to every auth page.

## 7. Files

**Frontend, new:**
- `src/components/public/landing/`:
  - `landing.css`, `HeroPointer.tsx`, `TimeGreeting.tsx`, `BeforeAfter.tsx`, `CertificateExplorer.tsx`;
  - `QrVerifyDemo.tsx`, `DemoQr.tsx`, `photos.ts`, `customerStories.ts`;
  - `__tests__/landingIslands.p1017.test.tsx`.
- `src/components/public/PublicThemeToggle.tsx` and `__tests__/PublicThemeToggle.p1017.test.tsx`.
- `src/app/request-access/__tests__/authPresentation.p1017.test.tsx`.
- `public/marketing/ASSETS.md`.
- `public/marketing/people/*.webp` (6).
- `public/textures/grain-warm.svg`.
- `src/app/fonts/instrument-serif-latin-400-italic.woff2`.

**Frontend, changed:**
- **Landing:** `src/app/page.tsx`, `landing/WorkflowStory.tsx`, `landing/productShots.ts`, `public/marketing/product/step-*.webp` (re-captured).
- **Public components:** `AuthShell.tsx`, `PrecisionScale.tsx`, `PublicHeader.tsx`, `PublicFooter.tsx`, `PublicSurface.tsx`, `BrandLockup.tsx`, `MobileMenu.tsx`, `LanguageForm.tsx`.
- **Root layout:** `src/app/layout.tsx` — the theme init script line only; the icons metadata is untouched.
- **Styles, fonts, icons:** `src/app/public-surface.css`, `src/app/fonts/public.ts`, `src/components/icons/static.tsx`, `scripts/gen-static-icons.mjs`.
- **Auth:** `src/app/login/page.tsx`; `src/app/login/components/` (`LoginPanel.tsx`, `IdentifierForm.tsx`, `PasswordLoginForm.tsx`, `MfaLoginForm.tsx`); `src/app/request-access/page.tsx`; `src/app/request-access/components/RequestAccessForm.tsx`; `src/app/forgot-password/components/ForgotPasswordForm.tsx`.
- **Dictionaries:** `src/i18n/messages/id.ts`, `en.ts`.
- **Tests:** `src/tests/public/copyRules.ts`, `publicTokens.contrast.p1001.test.ts`; `src/app/blog/__tests__/publicContent.test.tsx`; `src/app/__tests__/landing.p1003.test.tsx`; `src/app/request-access/__tests__/privacyGate.q42.test.tsx`.
- **Assets:** `public/marketing/CREDITS.md`.

**Docs:**
- `docs/UI-UX/20-LANDING-AUTH-REVAMP.md`;
- `MEMORY/DECISIONS.md` (ADR-118: Amendments 1 and 3 moved under ADR-118);
- this record, `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`;
- `TASKS/PROGRESS.md`, `TASKS/PHASE-10-LANDING-AUTH-REVAMP.md`.

**Not touched:**
- `package.json`, the lockfile, `bundle-budget.json` (net unchanged), the backend;
- the logo agent's files: `public/brand/*`, `favicon.ico`, `apple-touch-icon.png`, `BrandIcon.tsx`, `BrandMark.tsx`, `Sidebar.tsx`, the layout icons metadata.

## 8. Final runs (live, stack `p1017warm`, production mode)

**The stack:**
- Built from the working tree.
- Ports 27260–27262, env from `scripts/ci/e2e-env.sh`, `PRIVACY_NOTICE_URL` set.
- Removed by name after the runs (`down -v`); nothing was pruned.

**Earlier runs:**
- **Run 1** (17:05, the tree before the fixes): P10 4/12. Request access never submitted: blur validation shrank the error summary between the harness's mousedown and its click, so the click missed the radio. Everything after it cascaded. **Fixed:** blur only adds, and the summary is submit-time.
- **Run 2** (17:46): P10 **12/12**, responsive **45/45**.
- **Run 3** (18:01): P10 **12/12**, a11y **80/80**, responsive **45/45**.
- **Run 4** (18:37, after the QA fixes and the screenshot capture): P10 11/12.
  - The *verify* check hit a 409. My `seed-demo` (used for the screenshots) had created an active "[DEMO] Certificate Approval" workflow in the default tenant, so certificates had to go through it. This was a data state, not code; the workflow was deactivated in the throwaway database.
  - a11y **80/80**.
  - Responsive 43/45: the 200 % text-only zoom of `/` overflowed through the hero sign-in link (`nowrap`), fixed.
- **Run 5** (18:58): P10 **12/12**, a11y **80/80**. Responsive 43/45: the `<h1>`'s long word at 200 % text-only zoom, fixed with `overflow-wrap`.

**Run 6** (final tree): see the lines appended below.

- **Run 6 (19:18–19:34, the final tree; frontend image rebuilt from it):**
  - **P10 browser 12/12.** `sso` is skipped by name, as in every earlier run: it needs `P10_MOCK_IDP_HOST`.
  - **a11y 80/80**, in both themes, covering axe, dialogs, reflow at 200 %, reduced motion and brand.
  - **responsive 45/45.**
  - Afterwards the stack was removed by name with `docker compose -p p1017warm … down -v`.
