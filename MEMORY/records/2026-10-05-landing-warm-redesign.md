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

## Addendum 2026-10-06 — the verification demo's layout at tablet widths (owner bug report)

**The report.** `/`, EN, dark, 773 × 935 (Chrome responsive mode): in `#verifikasi` the paper certificate was squeezed to ~200 px with the phone over it, the number wrapped mid-token on three lines ("CERT-2026100 / 5-CONTOH-00 / 01"), the sample-data tag was cut by the card's edge, the QR was half hidden behind the phone, "Scan again" wrapped, and the composition was lopsided.

**Cause (measured on a production build of the pre-fix tree).**
- The demo grid was `md:grid-cols-[minmax(0,1fr)_auto]`, and the phone was `width: min(100%, 19rem)` inside the `auto` column. A percentage inside a content-sized track is cyclic, so the column took its width from the phone's **content**.
- Idle, that content is short: the phone was 223–258 px wide. After a scan, the verdict's sentence is long: the `auto` column grew to 517 px and the `minmax(0, 1fr)` column, allowed to shrink to 0, left the certificate 160 px at 773. The certificate's content (the QR's fixed 7 rem box, the tag's `nowrap`) then spilled out under the phone, and `break-all` broke the number anywhere.
- The bug was not only at tablet widths. At every width the phone changed size between idle and verified (223 × 458 → 304 × 625, a layout shift), and at 1024 the certificate shrank to 314 px after a scan. "Scan again" is the verified state's label, which is why the owner saw it.

**Fix.**
- `landing.css` (`.lp-demo-wrap`, `.lp-demo`, `.lp-demo-phone`, `.lp-cert-number`). Every width is now a definite length.
  - The certificate is `min(100%, 24rem)` and the phone's figure `min(100%, 17.5rem)`; the phone fills its figure.
  - The two stack, centred, until **the demo itself** is 43 rem wide (a container query, so a 200 % text zoom stacks it too). From there they sit side by side at their minimum readable widths, `minmax(20rem, 24rem) 17.5rem`, centred.
  - From 60 rem the desktop composition is kept as designed: the certificate centred in a `minmax(20rem, 1fr)` column and the phone at 19 rem. The phone now holds the size it always showed after a scan, idle too.
- `QrVerifyDemo.tsx`:
  - `breakAfterHyphens()` puts a `<wbr>` after each hyphen in the certificate number, on the paper and in the verdict, and `break-all` is gone. UAX #14 allows no break between a hyphen and a digit, so without the `<wbr>` the number could only overflow or break mid-token. The text content is unchanged.
  - The button is `whitespace-nowrap`; the minimum card width leaves it room.
- Animation, the live region and reduced-motion behaviour are unchanged; no motion was added. No copy changed. There is no new decision: this is a defect in the P10-17 implementation, inside ADR-118, and doc 20 specifies no grid for the demo, so `docs/` needs no amendment.

**Regression check.** `automate/responsive.browser.js` gains a demo sweep. It runs when the page list includes `/` (it is in `make test-browser`), and `RESPONSIVE_QR_ONLY=1` runs it alone.
- **Coverage:** ID and EN, light and dark, with reduced motion, plus two passes without it (EN light, ID dark). Each pass runs at 360, 390, 480, 600, 640, 700, 768, 773, 820, 900, 960, 1024, 1100, 1280 and 1536 px, in both the idle and the verified state: **90 rows**.
- **It fails on:**
  - the certificate and the phone intersecting;
  - anything in the certificate extending past it, or the certificate or phone past the viewport;
  - `elementFromPoint` at the QR's four corners and centre hitting anything but the QR;
  - a number line, on the paper or in the verdict, that does not end in "-";
  - the button's or the tag's text on more than one line, or overflowing its box;
  - the verdict extending past the phone's screen, or an empty live region;
  - the certificate or the phone changing size between the two states;
  - without reduced motion, a verdict that appears at once.
- **`RESPONSIVE_SELFTEST=1`** plants three defects through the CSSOM, because the nonce CSP refuses an injected `<style>`: the phone moved onto the QR, a squeezed `break-all` number, and a 5 rem button. Every row must report all three.
- **`RESPONSIVE_QR_SHOTS`** writes the before/after crops.

**Evidence** (production `next build` + `next start -p 27391` on the workstation, no backend; Node 26.10.0):

| Check | Result |
|---|---|
| Demo sweep on the **pre-fix** build | **0/90 clean**. Layout shift on every row; at 768–960 overlap, the QR covered by `div.lp-phone`, the tag and QR outside the card, the number broken mid-token ("CERT-202 \| 61005-C \| ONTOH-0 \| 001") |
| Demo sweep on the fixed build | **90/90 clean** |
| `RESPONSIVE_SELFTEST=1 RESPONSIVE_QR_ONLY=1` | **90/90 rows detected the planted defects** |
| Full `responsive.browser.js` (pages + demo) | **45/45 page-mode pairs clean** (incl. `/` at 200 % zoom and 200 % text-only zoom), **90/90 demo rows clean** |
| axe-core, WCAG 2.1 A/AA, `/` (scratch script; axe through `Runtime.evaluate`) | **0 violations in 120/120 runs**: ID/EN × light/dark × the 15 widths × idle/verified, reduced motion |
| `landingIslands.p1017.test.tsx` | 25 tests, 2 new: the number's `<wbr>` after each hyphen (paper and verdict), the layout classes, no `break-all`, the nowrap button; a value without a hyphen stays whole |
| Frontend jest with coverage (`npm run test:coverage -- --ci`) | **305 suites, 3,309 tests passed**, 0 failed; **94.01 / 84.94 / 89.62 / 94.68** against the 90 / 81 / 86 / 91 gate; `QrVerifyDemo.tsx` 100 % on all four |
| `npm run typecheck` (frontend) | 0 errors |
| `npx eslint` on the changed frontend files | 0 errors, 0 warnings (`automate/*.js` sits outside both ESLint configs, as before) |
| `node ../node_modules/next/dist/bin/next build` | exit 0 |
| `node scripts/bundle-budget.mjs` | all 10 routes within the **unchanged** ceilings; `/` brotli 128.5 / 180, **gzip 149.4 / 150** (no change) |

**Screenshots** (verified state, EN, reduced motion; `docs/UI-UX/research/screens/`): `p1017-fix-qr-before-{light,dark}-{768,773,820,1024}.webp` from the pre-fix build and `p1017-fix-qr-after-…` from the fixed one, 16 files. The section is charcoal in both themes by design (ADR-118 Am. 1), so the theme shows in the paper and the page around it.

**Not done:** the live compose stack was not re-run for this change. The demo sweep needs only the frontend and ran against a production build. The VM is untouched.

**Files:** `frontend/src/components/public/landing/QrVerifyDemo.tsx`, `landing.css`, `__tests__/landingIslands.p1017.test.tsx`; `automate/responsive.browser.js`; the `Makefile` (the `test-browser` help text); the 16 screenshots; this addendum, `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`.


## Addendum 2026-10-07 — first paint and LCP of `/` and `/login` (AC-5/AC-6)

**The brief.** Lighthouse 12.8.2 mobile (simulated) missed AC-5/AC-6 (§6.2): `/` Performance 88, LCP 3.6 s; `/login` Performance 89, LCP 3.2 s. The task was to find out why and fix it without changing the design, the content, the CSP/nonce or any bundle ceiling. There is no new decision and no ADR: the changes are inside ADR-118 and doc 20, and nothing in `docs/` specified what was changed.

### Root causes (measured, not inferred)

Evidence: Lighthouse JSON (`network-requests`, `lcp-breakdown-insight`, `render-blocking-insight`, `metrics`); Chrome traces of the main thread, the GPU process and the raster threads; A/B runs through a rewriting proxy; and Lantern's own source in `@paulirish/trace_engine` (`FirstContentfulPaint.getFirstPaintBasedGraph`, `LargestContentfulPaint`).

1. **Simulated LCP is set mostly by the bytes fetched before the observed paint, not by the two small stylesheets.**
   - Lantern's LCP graph keeps every request that finished before the observed LCP (low-priority images excepted), and the CPU tasks of every script evaluated before it.
   - On this host the GPU process spends ~100–200 ms rastering the first frame. The framework chunks (~133 KB transfer) download and evaluate inside that window, so they count as LCP-blocking.
   - Bytes fetched before LCP:
     - `/`: 366 KB (JS 155, fonts 80, document 47, images 46, CSS 30).
     - `/login`: 288 KB (JS 185, fonts 58, CSS 25, document 19).
   - **Floors under simulation** (`--blocked-url-patterns`, 3 runs each):
     - `/login` with all JS blocked: LCP **1.96 s**.
     - `/login` with framework JS only: **2.77 s**.
     - `/` with all JS blocked: **2.64 s**.
   - So **`/login` ≤ 1.8 s is not reachable in simulate mode on this host while the framework JS arrives before the first presented frame**, and `/` ≤ 2.5 s is not reachable even with no JS.
2. **`/` laid out the whole page before its first paint.** The first `Layout` covered ~810 boxes and took 200–400 ms unthrottled (×4 under simulation). On a script-free copy:
   - `content-visibility:auto` on the sections after the hero halved it (280 → 143 ms; FCP 358 → 221 ms).
   - The rest was fonts. The `body` sets Inter's character variants (`font-feature-settings: "cv02","cv03","cv04","cv11"`, globals.css) for the dashboard, and the public surface inherited them. A non-default feature list shapes every text run on the slower path: −30 % of layout without it (143 → 104 ms).
3. **`/login` shipped its whole API layer up front:** axios, the auth service and the auth store (~32 KB gzip), before anyone typed.
4. **The "two late stylesheets" were a small item.** Through the proxy, each of these moved simulated LCP by less than an unpaired run's noise (±150 ms):
   - merging the font CSS and `landing.css` into the global sheet;
   - inlining the grain;
   - `content-visibility`;
   - the font-feature reset.

   `experimental.inlineCss` was rejected: it is global, and it puts the 132 KB global sheet into every HTML response twice (once in `<style>`, once in the RSC payload).
5. **Measurement traps found on the way (environment, not code):**
   - A standalone build on **Windows** cannot load sharp: the output trace copies `sharp-win32-x64.node` but not `libvips-42.dll` / `libvips-cpp-*.dll`. Next then serves the 45.6 KB original instead of a 13 KB AVIF. The production image (Linux) is fine: `kalibrasi.zedth.my.id` returns `image/avif` 12.9 KB at `w=750`. The local snapshots measured below have the DLLs copied in.
   - The shared `frontend/.next` was rebuilt by another agent under a running server once, which produced console errors and a11y/BP < 100. Every number below comes from standalone snapshots kept outside the repository.
   - The host is shared, with host CPU load measured at 4–40 % during these runs. Single-variant medians swung by ±300 ms, so before/after is reported only from **interleaved** runs (base, after, base, after…).

### Changes

- `src/components/public/landing/landing.css`:
  - The rule: `[data-surface="public"] #konten > .lp-section ~ .lp-section { content-visibility: auto; contain-intrinsic-size: auto 900px; }`. The hero is not affected. Sections stay in the accessibility tree and find-in-page; `auto` keeps a rendered section's real height.
  - **Clipping check (paint containment):** nothing draws outside its section — at 360/390/768/1024/1280/1536 px, with and without reduced motion. It is a geometric check: box rects plus each element's real `box-shadow` extent, plus a 5 px focus-ring allowance on focusables, vertically, and horizontally for sections narrower than the viewport.
  - **Pixel check:** a viewport-by-viewport comparison with the rule on and off, light/dark × 390/768/1280. It found only sub-pixel snapping (paint containment rounds each section's paint offset), with no visible change; the crops are identical by eye.
  - A full-page screenshot blanks skipped sections. That is a capture artifact: the screenshot does not make them relevant.
- `src/app/public-surface.css`:
  - `font-feature-settings: normal` on `[data-surface="public"]`. The five public woff2 faces have no `cv02/cv03/cv04/cv11` (the GSUB/GPOS feature lists were read after Brotli decompression), so the glyphs are identical.
  - The grain texture (`public/textures/grain-warm.svg`) is inlined as a data URI (`img-src` allows `data:`), which removes one request per public page.
- `src/components/public/landing/DemoQr.tsx`: one rectangle per horizontal run of dark modules instead of one per module. The pixels are the same and the path is about half the length. Each QR's path appears twice per page (HTML and RSC payload), and `/` has three QRs.
- `/login`'s API layer is loaded on demand:
  - `src/app/login/hooks/authRuntime.ts` (new) re-exports the auth service, the auth store, `describeApiError` and `destinationAfterSignIn`.
  - `useLoginForm.ts` reaches all of them through `import()` at the point of use.
  - It prefetches at the visitor's first key press, tap or click **inside `<main>`**, and not on focus, because the identifier field autofocuses at hydration. It also does not prefetch from the theme toggle or the language form, which sit outside `<main>`, so that work never lands on their interaction.
  - `destinationAfterSignIn` moved to `src/app/login/hooks/destination.ts`. **`src/app/sso-callback/page.tsx`: one import line changed** to point there. The file already carried another agent's uncommitted edits, which were left untouched.
- **Tests:**
  - `src/components/public/__tests__/publicPerf.p1017.test.ts` (9): the inlined grain equals the file byte for byte; `font-feature-settings: normal`; each woff2 is decompressed and holds no cv02/03/04/11 (with `kern` present as a check that the decode found the feature list); the `content-visibility` rule exists and never touches the hero.
  - `src/app/login/hooks/useLoginForm.lazyAuth.p1017.test.tsx` (5): not loaded at render; not loaded by input outside `<main>`; loaded once at the first key press in the panel, after which the listeners go; a submit awaits the same import and reaches the API; listeners are removed on unmount. The load counter sits outside `jest.fn`, so `clearAllMocks` cannot hide an import-time load.
  - `landingIslands.p1017.test.tsx`: the QR test now decodes the path back to cells and compares them with the encoder's matrix, cell by cell.

### Before / after

**Lighthouse 12.8.2, mobile, simulated:**
- Production standalone builds of the pre-change tree ("before") and the final tree ("after"), on `127.0.0.1`.
- Five interleaved rounds per page, median, 2026-10-07 17:30–17:38. Host CPU load was measured at 14 % at the start and 7 % midway.

| Page | | Performance | LCP | FCP | TBT | Speed Index | CLS | A11y / BP / SEO |
|---|---|---|---|---|---|---|---|---|
| `/` | before | 88 | 3.61 s | 1.82 s | 52 ms | 3.34 s | 0 | 100 / 100 / 100 |
| `/` | **after** | **89** | **3.42 s** | 1.98 s | 69 ms | 3.14 s | 0 | 100 / 100 / 100 |
| `/login` | before | 93 | 3.11 s | 1.53 s | 110 ms | 1.53 s | 0.015 | 100 / 100 / 100 |
| `/login` | **after** | **92** | **2.95 s** | 1.52 s | 157 ms | 1.52 s | 0.015 | 100 / 100 / 100 |

Paired LCP difference (after − before, same round), both pages pooled:
- 2026-10-07 17:30 run: **−151 ms median, 10 of 10 pairs lower**.
- Two earlier interleaved rounds on intermediate trees agree, though both ran on a busier host (load 4–40 %):
  - At 15:29: `/login` 84 → 90, LCP 3.43 → 3.03 s; `/` 80 → 85, LCP 3.74 → 3.57 s; median −311 ms, 8 of 10 pairs lower.
  - Earlier: median −166 ms, 10 of 10 pairs lower.
- `/login`'s TBT was higher after in two of the three rounds (110 → 157 ms in the final one). The cause is not established. The Performance score of `/login` is unchanged within noise.

**Real browser, throttling applied (not simulated):**
- Setup: scratch script `rum.cjs`: puppeteer-core with the repository's Chrome; a Moto G Power viewport; `Emulation.setCPUThrottlingRate 4`; network 150 ms latency, 1.6 Mbps down, 750 kbps up.
- Metrics: LCP, CLS and FCP from PerformanceObservers. INP comes from the Event Timing API over two taps of the visible header toggle on each page, plus a tap and typing in the identifier field on `/login`.
- 7 runs per build, median. Before and after alternated as separate 7-run blocks.

| Page | | LCP | FCP | CLS | INP |
|---|---|---|---|---|---|
| `/` | before | 2.58 s (other blocks: 3.07, 2.48) | 2.58 s | 0.001 | 168 ms |
| `/` | **after** | **1.87 s** (other blocks: 2.33, 1.94) | **0.88 s** | 0.001 | 152 ms |
| `/login` | before | 0.96 s (other blocks: 1.26, 1.08) | 0.85 s | 0.015 | 192–208 ms |
| `/login` | **after** | **0.95–1.06 s** (other blocks: 1.14, 0.99) | 0.94 s | 0.015 | 224–232 ms |

- `/login`'s worst interaction is the **theme toggle** (`click` on its `<svg>`) in both builds.
  - The prefetch cannot fire from it: the toggle sits outside `<main>`, and it is tapped before the field.
  - Its code is unchanged.
  - The after blocks ran second while host load rose (7 → 31 %).
  - So `/login` INP sits at the 200 ms line on both builds. It is not attributed to this change, and it is not fixed: it is a whole-document restyle under 4× CPU.
- `/login` CLS 0.015 is the `<Suspense>` fallback `<h1>` swapping for the panel's `<h1>`, the same in both builds; it is within AC-6's 0.05.

**Bundle budget** (`scripts/bundle-budget.mjs`, no ceiling raised):
- `/login`: **154.2 → 130.9 KB brotli** (178.3 → 152.4 KB gzip).
- Every other route is unchanged; `/` stays at 128.5 KB brotli, 149.4 / 150 KB gzip.

### AC-5 / AC-6 status

- **Not met under Lighthouse simulation on this host:**
  - `/`: Performance 89 against a target of ≥ 90. Its LCP of 3.42 s is above the 2.5 s target, and its JS-free bound is 2.64 s.
  - `/login`: Performance 92 against a target of ≥ 95. Its LCP of 2.95 s is above the 1.8 s target, and its framework floor is 2.77 s.
- **Met under applied throttling in a real browser:**
  - `/` LCP 1.87 s against 2.5 s.
  - `/login` LCP ≈ 1.0 s against 1.8 s.
  - CLS ≤ 0.015 against 0.05.
- **INP:** `/` 152 ms. `/login` sits at about 200–230 ms because of the theme toggle.
- The WebPageTest run AC-6 names has not been made, and no run was made on a dedicated host or the VM.

### What remains, and the next levers

1. **`/request-access`, `/forgot-password` and `/invitation`** import the same API layer statically (147.8 / 148 KB brotli). Applying the `/login` pattern to them is the next step. They were out of scope here.
2. **A public-only global stylesheet.** The root layout's `globals.css` is 132 KB raw (22 KB gzip): Tailwind for the whole dashboard, render-blocking on every public page. Giving the public routes their own root layout (route groups), and with it their own sheet, needs an ADR. It is proposed, not done.
3. **Fonts before LCP.** Plus Jakarta 400/500/600 (37 KB) plus the italic (22.6 KB) load before `/`'s observed LCP. A variable-weight body face, or fewer weights, would be a design decision.
4. **The framework floor** (~133 KB of root main chunks) is the Next/React runtime. The simulate-mode result depends on the host's paint pipeline: on a host where the first frame presents before the chunks evaluate, Lantern drops them from LCP. Measuring on the VM or a dedicated host is the remaining honest test.
5. The theme toggle's INP on `/login`.

*2026-10-08:* items 1 and 2 are done — P10-19 (the three forms load their API layer on demand) and P10-18 (ADR-131: the public pages' own root layout and sheet). Results, including why simulated LCP did not move: [`2026-10-08-p10-18-19-public-layout.md`](./2026-10-08-p10-18-19-public-layout.md).

### Gates (final tree)

| Gate | Result |
|---|---|
| `npm run typecheck` (frontend) | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| Frontend jest with coverage (`npm run test:coverage -- --ci`) | **314 suites, 3,440 tests passed**, 0 failed; **94.12 / 85.06 / 89.83 / 94.77** against 90 / 81 / 86 / 91. `authRuntime.ts` and `DemoQr.tsx` are 100 %; `destination.ts` is 100 % of lines; `useLoginForm.ts` is 86.95 % of lines, with the uncovered lines being pre-existing error branches |
| `node ../node_modules/next/dist/bin/next build` | exit 0 |
| `node scripts/bundle-budget.mjs` | all 10 routes within the **unchanged** ceilings; `/login` 130.9 / 155 KB brotli |
| `automate/responsive.browser.js` (production build, `FRONTEND_URL=http://localhost:27425`) | **45/45 page-mode pairs clean, 90/90 QR demo rows clean** |
| `automate/a11y.browser.js` on the disposable stack `p1017perf` (production mode, built from this tree, ports 27270–27272) | **80/80 checks passed.** axe light and dark: `/` 0 findings; `/login` 0 WCAG findings, plus 1 best-practice `region` warning (the auth shell's back link and language form sit outside a landmark — that markup is unchanged by this work). Reflow at 200 % and reduced motion pass |
| `automate/p10.browser.mts` on `p1017perf` | **12/12 checks passed** (`sso` is skipped by name, as in every earlier run: it needs `P10_MOCK_IDP_HOST`). Identifier-first sign-in, both passkeys, the one-time password, forgot/reset and verify all pass. CSP: 17 documents, 0 violations, 0 third-party requests |

**Stack:**
- Removed by name: `docker compose -p p1017perf … down -v`, then `docker image rm callibrator/backend:local callibrator/frontend:local`. Nothing was pruned.
- The secrets file was deleted. The local servers were stopped by PID.

**Files (this addendum):**
- `frontend/src/components/public/landing/landing.css`, `DemoQr.tsx`, `__tests__/landingIslands.p1017.test.tsx`;
- `frontend/src/app/public-surface.css`;
- `frontend/src/app/login/hooks/useLoginForm.ts`, `authRuntime.ts` (new), `destination.ts` (new), `useLoginForm.lazyAuth.p1017.test.tsx` (new);
- `frontend/src/components/public/__tests__/publicPerf.p1017.test.ts` (new);
- `frontend/src/app/sso-callback/page.tsx` (one import line);
- this addendum, `docs/TESTING/05-PERFORMANCE-TESTING.md` (Frontend), `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` (the AC-5/AC-6 status under §13), `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`.

**Not touched:** `next.config.ts`, `app/layout.tsx`, `bundle-budget.json`, `package.json`, the lockfile and the backend.
