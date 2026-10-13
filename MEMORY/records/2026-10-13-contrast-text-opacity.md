# Contrast: text is never faded with opacity — `/dashboard/access-requests` fixed, the frontend swept, a guard, and the operator's queue in the axe suite

**Date:** 2026-10-13 · **Task:** line B of the 2026-10-13 batch, card 1 ("Contrast") · **Base:** `36bda3b` · **Follows:** `e076d1a` (the IPM capture's step count, 4.43:1) and its finding in [`2026-10-13-p22-browser-coverage.md`](./2026-10-13-p22-browser-coverage.md) ("the same `opacity-80` count pattern on `/dashboard/access-requests`; not changed here")

> No backend file changed. `mozivid/` not touched.

## The pattern

A part of a label made "quieter" with `opacity-N` (or a translucent text colour `text-x/N`) blends the text toward whatever is behind it. On a coloured fill (a selected tab, a primary button) the result is a colour no token names and no one measured: `opacity-80` on the primary fill measured 4.43:1 on the IPM capture. The fix in every case is a token at full strength: weight (`font-normal`) for a secondary part, `hover:bg-primary-hover` for a hover on a fill, an underline for a hover on a text link.

## The sweep (every `opacity-N` and `text-x/N` under `frontend/src/app` and `frontend/src/components`)

| Where | Was | Now |
|---|---|---|
| `app/(app)/dashboard/access-requests/page.tsx` — the status tab's count, on the primary fill when selected | `opacity-80` | `font-normal` (full-strength `primary-foreground` / `foreground`) |
| `app/(app)/dashboard/ipm/IpmClient.tsx` — "Start a new IPM" link on `bg-primary` | `hover:opacity-90` (the whole control, text included, faded on hover) | `hover:bg-primary-hover` (the token `Button` uses) |
| `app/(app)/dashboard/profile/components/AvatarUpload.tsx` — "Remove" | `text-destructive/80` | `text-destructive` |
| `app/(app)/dashboard/mfa/page.tsx` — "use a recovery code" text button | `hover:text-primary/80` | `hover:underline` |
| `app/(app)/dashboard/roles/components/RolesTable.tsx` — "Delete" | `hover:text-destructive/80` | `hover:underline` |

**Not text, left as they are** (each named in the guard's reviewed list with its reason): the empty-state and stat icons (`<Inbox className="… opacity-40">` and the like — graphics, not text, under WCAG 1.4.11 only when they carry meaning, and these are decorative next to their text); spinner circles (SVG); `grid-background.tsx` and `AuroraBackground.tsx` layers; `stat-card.tsx`'s 2 px gradient bar; the ping ring on `not-found.tsx`; the QR under an `aria-hidden` viewfinder on the landing demo; `MultiSelect`'s disabled state (WCAG 1.4.3 exempts an inactive control); the kanban card while it is dragged (a transient ghost).

## The guard

`frontend/src/tests/guards/textOpacity.contrast.guard.test.ts` scans every non-test `.ts`/`.tsx` under `app/**` and `components/**`:

- **opacity**: `opacity-N` (0 < N < 100), bare or behind a state variant, on an element that can hold text — a lowercase HTML element other than an SVG one, or `Link` / `Button` / `Badge`. `disabled:` is exempt.
- **alpha**: a translucent text colour `text-<token>/N` (bare or behind a state variant; `placeholder:` and `disabled:` exempt). The colour guard's `faded` rule (P11-01) covered only the `*-foreground` tokens.

A finding passes only if the guard's `EXEMPT` list names it (file, literal, reason; 11 entries). A second case fails on a **stale** exemption, and fixtures prove each form fires (7) and each allowed shape passes (8). Reliability: it reads the tag that opens before the class, so a class on an icon component is never flagged, and a hit inside a comment is flagged (the access-requests comment was reworded for it). It cannot see whether a lowercase element holds text; the 11 reviewed entries are those that do not.

## The axe suite: the operator's queue

`automate/a11y.browser.js` signed in only a tenant administrator, so `/dashboard/access-requests` (super admin only, P10-07) was never measured. Added:

- **`operatorSweep`**: the operator signs in **through the form**, in light and dark, and `/dashboard/access-requests` is swept by axe once the **selected status tab shows its count** (the check fails if the count never appears — otherwise the pattern would not be measured).
- **The form sign-in answers a TOTP step** when the account has MFA (the operator does): the code comes from the E2E harness's MFA state file (the same file and step bookkeeping as `backend/src/tests/e2e/setup.js`; `E2E_SUPERADMIN_TOTP_SECRET` / `E2E_MFA_STATE_FILE` honoured). Re-implemented in the suite because the harness does not export it (the harness is line A's file).

## Gates (2026-10-13)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on the 6 changed frontend files | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests` (the 5 page/component files) | 8 suites, 83 tests passed |
| `npx jest --ci src/tests/guards` (with the new guard) | 7 suites, 115 tests passed (the new guard: 18) |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | exit 0; every route within |
| `node --check automate/a11y.browser.js` | OK |
| **`automate/a11y.browser.js`** on a disposable stack, twice back to back | **110/110** (1,186 s) · **110/110** (1,028 s) — the 108 of the P22 record plus `axe [light]` and `axe [dark] /dashboard/access-requests (operator)`, 0 findings each |
| **Negative proof** (a throwaway script in the session's scratchpad, not committed): the same operator sign-in, `/dashboard/access-requests`, light theme, axe `color-contrast` | as built: **0** violations; with `opacity-80` put back on the selected tab's count: **1 violation, 4.43:1** — the IPM capture's number exactly. In the dark theme the faded count still passes (the dark primary fill carries ~8.8:1), which is why the light sweep is the one that catches it |

**Stack:** `deploy/compose` (`docker-compose.yml` + `.build.yml` + `.e2e.yml`), project `lineb-stack`, `BUILD_TAG=lineb`, `BUILD_CONTEXT` = a clean worktree of `36bda3b` plus this card's diff (line A's tree left out of the build), production mode, 127.0.0.1:27510 (API) / 27511 (frontend) / 27512 (Mailpit), seeded with `GET /api/v1/migration/seeding`. Torn down by name with `down -v --rmi local`; the worktree removed.
