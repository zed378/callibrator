# P22-08: the public device page `/d/[token]` and the staff public-link panel

**Date:** 2026-10-13 · **Task:** P22-08 (Phase 22) · **Spec:** [`MEMORY/specs/P19-07-public-device-page.md`](../specs/P19-07-public-device-page.md) § 10 · **Decisions:** ADR-138, Am. 1 – 2, **Am. 3** ([DECISIONS](../DECISIONS.md)) · **Unblocks:** P27-03 · **Status:** DONE in code; the live browser run is LINE C's (through the coordinator)

## What was built

- **`frontend/src/app/(public)/d/[token]/page.tsx` and `DeviceContent.tsx`.**
  - A server shell, with the body inside a Suspense boundary.
  - `lib/publicDevice.server.ts` reads `GET /api/v1/public/devices/:token`: `no-store`, typed from `paths`, with the client's address and scheme forwarded (A-16, A-310). It returns one of four outcomes.
  - The page is readable without JavaScript; its only island is the language form.
  - One `<main>`, and one `<h1>` (the device's name, or the outcome's title). ID by default, EN with the switch.
  - The status is shown as a word with an icon, in `pub-*` tokens. Retired and overdue devices get a note.
  - The IPM report link appears only when the backend sends one (`rel="noreferrer"`).
  - Every outcome answers 200 (Am. 3 § 1).
- **`next.config.ts` and `robots.ts`.** `/d/:path*` sends `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; the metadata also says `noindex` and `no-referrer`; robots disallows `/d/`.
- **`bundle-budget.json`.** `/d/[token]` is held to the `/verify/*` figure (120 KB brotli, 141 KB gzip, 13 KB css).
- **The staff panel.**
  - A "Public link" row action in `/dashboard/devices` (`DeviceTable`, `DevicesClient#accessFor`): unbound staff with `calibration` write, never the platform operator.
  - `components/PublicLinkDialog.tsx` has three load states (it retries) and issue / replace / revoke. Replace and revoke ask first and say what happens to the printed sticker.
  - The sticker: the QR is made in the browser (`qrcode`, loaded on demand), with the link, Print (a print stylesheet in `globals.css` keyed on a body class) and a PNG Download. Nothing is stored.
  - The panel states the tenant setting's effect, and says what the report link discloses.
- **`api/services/publicDevice.service.ts`** on the generated client.
- **i18n.** 27 `publicDevice.*` keys and 28 `devices.publicLink.*` / `devices.action.publicLink` keys, in ID and EN.
- **nginx.** In both `deploy/compose/nginx` files, a `map` and the `redacted` log format write the token on `/d/` and `/api/v1/public/devices/` as `~redacted`. `nginx -t` passed, and the format was checked live on `vm-http.conf` (`GET /d/~redacted?lang=en`, `GET /api/v1/public/devices/~redacted`, `/blog` unchanged).
- **Docs.** `docs/FRONTEND/01-ROUTING.md` gains `/d/[token]` in its three tables (ADR-138 Am. 3). The spec's § 10 status line and its G-9 nginx line are amended.

## Tests (named)

| Suite | Result |
|---|---|
| `app/(public)/d/[token]/__tests__/page.test.tsx` (shell, every outcome, fields, notes, the report link, ID/EN, axe) | 10/10 |
| `lib/__tests__/publicDevice.server.test.ts` (path encoding, no-store, forwarded headers, 4 outcomes) | 7/7 |
| `api/services/publicDevice.service.test.ts` | 2/2 |
| `app/(app)/dashboard/devices/__tests__/publicLink.p2208.test.tsx` (row action by audience, the panel's flows, refusal, failed load, ID, axe) | 11/11 |
| `app/(app)/dashboard/devices/__tests__/page.test.tsx` (`accessFor` gains `publicLink`; no assertion weakened) | 24/24 |

## Gates

| Gate | Result |
|---|---|
| `npx eslint` on every changed frontend file | 0 problems |
| `npm run typecheck` (frontend) | 0 errors |
| `npx jest --ci --findRelatedTests` (11 changed files, the dictionaries and the generated schema included) | 62 suites, 590/590 |
| `npx jest --ci src/tests/guards src/tests` | 287 tests. The colour guard failed once, on a `bg-white` in the panel; the class was removed, and it is 46/46 now |
| `node ../node_modules/next/dist/bin/next build` | exit 0 |
| `node scripts/bundle-budget.mjs` | all routes within budget; `/d/[token]` brotli 114.8 / 120 KB, gzip 134.1 / 141 KB, css 12.0 / 13 KB |
| New files' coverage | `DeviceContent.tsx`, `page.tsx`, `publicDevice.server.ts`, `publicDevice.service.ts` 100 %; `PublicLinkDialog.tsx` 100 % lines and functions, branches covered by the added issuer-less case. The frontend gate is 90/81/86/91 |

## Open

- The live browser run of `/d/<token>` signed out and of the panel belongs to LINE C's automate suite, through the coordinator.
- P27-03: the final sticker layout and the re-stickering policy. Today's sticker is the interim in-browser one (Am. 3 § 3).
- A monitoring check must read the API, not the page's status (Am. 3 § 1).
