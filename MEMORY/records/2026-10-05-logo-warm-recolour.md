# P10-17 — The logo follows the warm palette (ADR-118 Amendment 2)

**Date:** 2026-10-05 · **Card:** P10-17 · **Decision:** ADR-118 Amendment 2 in `MEMORY/DECISIONS.md` · **Owner's request (verbatim):** "warna logo sesuaikan dengan palet warna yang digunakan saat ini". An earlier owner decision said "keep the logo", so only the colours changed.

## What changed

| Area | Files | Change |
|---|---|---|
| Brand SVGs | `frontend/public/brand/mark.svg`, `lockup-light.svg` | body `#001250` → charcoal `#1F1B17`; accent `#00DAB4` → copper `#9A4E22` |
| | `mark-dark.svg` | body `#FEFEFE` → ivory `#F6EFE4`; accent → light copper `#E3A47B` |
| | `lockup-dark.svg` | navy tile → warm charcoal `#241E19`; mark (was all teal) → ivory body + light-copper accent; wordmark → ivory |
| | `app-icon.svg` | tile `#2A2A2A` → `#241E19`; mark (was all white) → ivory body + light-copper accent |
| | `lockup-mono.svg` | unchanged |
| Rasters | `brand/logo-email.png` (480×200), `public/favicon.ico` (16/32/48, PNG entries, as before), `public/apple-touch-icon.png` (180) | regenerated from the new SVGs with the root `sharp` (rendered at 4×, downsampled) |
| Components | `components/brand/BrandIcon.tsx` | accent elements carry `.logo-accent` instead of a fixed `#00DAB4`; an explicit `accent` prop still wins (mono) |
| | `components/auth/BrandMark.tsx`, `components/layouts/Sidebar.tsx` | `text-[#001250] dark:text-white` → `text-logo-ink` (logo only; the dashboard is otherwise untouched) |
| Tokens | `src/app/globals.css` | new `--logo-ink` / `--logo-accent` (light and `.dark`), `text-logo-ink` / `fill-logo-accent` utilities, and `.logo-accent { fill: var(--pub-accent, var(--logo-accent)) }` |
| Emails | `backend/src/templates/{template,otp,account}.html`, `services/email.service.ts` (`sendNotificationEmail`) | navy/teal/slate → cream `#F4ECDF` page, paper `#FFFDF8` card, `#E5D9C7` border, charcoal text, `#4A423A` muted, copper bar/button/links |
| Tests | `backend/src/tests/services/email.templates.test.js` | asserts the warm palette, forbids `#001250`/`#00dab4` and the old slate neutrals, and pins the copper accent bar (new case) |
| | `backend/src/tests/services/email.service.test.js` | footer selector follows the new muted colour (assertion unchanged) |
| | `frontend/src/components/brand/__tests__/BrandIcon.p1017.test.tsx` (new, 19 cases) | BrandIcon's accent comes from the theme; each brand file's fills; mono stays mono; every logo colour ≥ 3:1 on its surface |
| Docs | `MEMORY/DECISIONS.md` (ADR-118 Am. 2), `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §12 (one row), `frontend/public/marketing/ASSETS.md` (one section) | |

**Shape unchanged — checked, not asserted.** Stripping the `class` attributes and comparing every `<svg>/<g>/<rect>/<path>/<polygon>` line against the previous files: identical for all six SVGs. The new `logo-email.png` has exactly the old pixel counts per opaque colour (9 693 body, 2 664 accent).

**Not edited:** `components/public/BrandLockup.tsx` (the redesign agent's) — it already sets `text-pub-text`, and its `BrandIcon` now picks up copper from `--pub-accent` without a change.

## Contrast (WCAG relative luminance, non-text ≥ 3:1)

| Logo colour | Surface | Ratio |
|---|---|---|
| charcoal `#1F1B17` | ivory `#FBF7F0` | 16.02 |
| copper `#9A4E22` | ivory `#FBF7F0` | 5.64 |
| copper `#9A4E22` | cream `#F4ECDF` | 5.14 |
| ivory `#F6EFE4` | inverted charcoal `#241E19` | 14.42 |
| light copper `#E3A47B` | inverted charcoal `#241E19` | 7.74 |
| charcoal / copper | dashboard light card `#ffffff` | 17.11 / 6.02 |
| ivory / light copper | dashboard dark card `#1e293b` | 12.81 / 6.87 |
| copper `#9A4E22` | inverted charcoal `#241E19` | **2.74 — fails**, hence the light copper on dark |
| old teal `#00DAB4` | white | 1.80 (the old logo failed) |

Email text: charcoal on paper 16.83; muted on paper 9.69, on cream 8.40; paper on the copper button 5.92; copper links on paper 5.92.

**16 px legibility:** the favicon's 16 px entry keeps the ruler ticks, the bracket and the copper block distinct, in light and dark tab strips (`p1017-logo-favicon-16-after.webp`).

## Evidence

`docs/UI-UX/research/screens/`:
- `p1017-logo-marks-before.webp` / `-after.png` — mark, lockup and app icon on ivory and on the inverted charcoal, at 96/32/16 px;
- `p1017-logo-favicon-16-before.webp` / `-after.png` — the ICO entries at 1:1, the 16 px entry at 8×, and in light and dark tab strips;
- `p1017-logo-email-before.webp` / `-after.png` — `template.html` rendered through mustache with the real `logo-email.png`, in Chrome.

Rendered with `puppeteer-core` and the local Chrome (as `automate/` does).

## Gates (2026-10-05)

- Backend: `npx eslint src/services/email.service.ts src/tests/services/email.templates.test.js src/tests/services/email.service.test.js` — clean; `npm run typecheck` — exit 0; `npm test -- email` — 7 suites, 79 tests passed (`email.templates`, `email.service`, `emailQueue.service`, `emailQueue.dedup.a26`, `emailQueue.redaction.a186`, `auth.emailVerificationPolicy.a60`, `tenant.statusEmail.a326a327`). The npm exit code is non-zero only because a partial run misses the global 100% coverage thresholds.
- Frontend: `npx eslint` on `BrandIcon.tsx`, `BrandMark.tsx`, `Sidebar.tsx` and the new test — clean; `npm run typecheck` — exit 0; jest 25 suites passed, including `BrandIcon.p1017` (19), `copyTruthfulness.p1011`, `publicTokens.contrast.p1001`, `productName.q43`, `bundleBudget.p1013`, `a11y.adr090`, `brandColor`, `a11y.f12.overlays`, `DashboardLayout.{f07,shell,gates.a160}`, `TopBar` and the login suites.
- `npx next build` — exit 0 (compiled, 84/84 static pages); the built CSS carries `.logo-accent{fill:var(--pub-accent,var(--logo-accent))}`, `.text-logo-ink` and both `--logo-accent` values.

## Caveats

- Cached favicons and cached email images show the old colours until the client's cache expires (same URLs).
- The logo colours live in the SVGs, `public-surface.css` and `globals.css`; the p1017 test pins the files and contrasts, not the equality of the three.
- The logo's origin/designer is still unrecorded (doc 20 §12).
