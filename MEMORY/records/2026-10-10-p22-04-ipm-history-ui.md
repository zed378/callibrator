# P22-04: the IPM history page — the list, one visit, corrections, the void, a draft's header; the `ipm` menu entry on

**Date:** 2026-10-10 · **Task:** P22-04 (Phase 22; F-54 … F-57) · **Specs:** [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 7, § 8, § 10 (as built by P21-03 / P21-04, ADR-126 Am. 4, Am. 5); ADR-124 Am. 5 § 2 (menu activation) · **Base:** `d0fea5c` + the P21-07 and P22-02 batches

> Synthetic data only. `mozivid/` not touched. `FACILITY_BINDING_ENABLED` untouched (OFF). No API change (`openapi.json` current).

## Built

| Area | What |
|---|---|
| Page | `dashboard/ipm`: `page.tsx` (server; `ipm.` + the catalogue's section / outcome names, the language toggle, `?deviceId=` passed on only when it is one uuid) → `IpmClient` island (ID/EN, own `lang`) |
| List | `GET /ipm/sessions` on the **generated client** (`api/services/ipmHistory.service.ts`); rows from `data`, paging from the top-level `meta`. Filters: device name / QR (`q`), status (default = submitted + voided + my drafts), recommendation, performed from / until (the local day's bounds), facility (provider staff only), "current records only" (`effective=true`). Columns: performed (+ "captured offline"), visit `007`, device + QR (the submit's snapshot; a draft says so), facility (unbound only), room · floor, performer (or "Redacted"), recommendation badge, record state badge (current / superseded / draft / voided / discarded). Loading, empty and failed are three states |
| One visit | `SessionDialog`: the header (device, QR, S/N, performed, visit + upstream number, performer, facility, room, outcomes, recommendation, report number, checklist version, notes), the results **by section** (label, ad-hoc mark, outcome or "computed", cleanliness, warning and disagreement flags, setting · measured value + unit · reference · text), the **lineage** (a correction opens the version it corrects and back), the void's / discard's date and reason |
| Correct (F-56) | an EFFECTIVE visit, `ipm` writer, not the platform operator: reason 3 – 2000 checked BEFORE the POST → `POST …/corrections` → the correction draft read back in the same dialog. The original stays readable (superseded only on submit) |
| Void | the same visit, `ipm` writer and **unbound** (the route also requires the tenant administrator role — ADR-102: no role names client-side; another role reads the server's 403 as written). Final; the lead says what it does and does not undo (P19-02 § 8.4) |
| Draft | the caller's draft (a correction, or a capture left open): the header — performed at (`datetime-local`), recommendation, inspection / maintenance outcomes, notes — **PATCHed with the revision read and only the changed fields** (a cleared one as `null`); **Submit is disabled while the header is unsaved**; the submit's `notices` and `sideEffects.notices` shown; discard with an optional reason. The checklist's results are edited in the IPM capture (P22-03) |
| Refusals | every 409 (`IPM_CORRECTION_OPEN`, `IPM_SUPERSEDED`, `IPM_VOIDED`, `IPM_REVISION_CONFLICT`, missing required items …) and 403 is the server's explanation, the typed reason kept |
| Device link (F-57) | the device register's row gains **"IPM history of {name}"** (`ipm` read) → `/dashboard/ipm?deviceId=<id>`, which narrows the list and names the device (`GET /calibration-devices/:id` when the caller reads devices; otherwise "the selected device"). There is no device detail page to hold a tab; the narrowed history is that tab |
| Badges | `statusTone`: `ipmSession` (current, superseded = info, draft / voided / discarded = draft) and `ipmRecommendation` (fit = current, the other three = attention; alarm stays reserved) |
| Menu | `seedMenuGroups.util.ts`: `ipm` `is_active: true`; **migration 0131** `0131-ipm-menu-active` — 0130's shape: one idempotent `UPDATE … WHERE slug = $2 AND is_active IS DISTINCT FROM $1`, `down` sets false; `client-facilities` untouched. A bound user's sidebar gains `/dashboard/ipm`, whose load route `GET /ipm/sessions` is marked (N-2) |

## Evidence — tests named

- **Frontend, new:** `app/(app)/dashboard/ipm/__tests__/IpmClient.test.tsx` (19: loading / restricted; the reader's row and axe; every filter into the query + paging; empty ≠ failed + retry; the bound view; `?deviceId=` named and neutral; Indonesian; the visit's header and results (axe); lineage both ways; a visit that cannot be read; voided / discarded / redacted; correct with the reason checked first and the draft read back + list reload; a 409 correction kept; void with a 403 then success; bound = no void, operator = neither; a draft's header diff + submit gated + notices; date / cleared fields + a 409 revision conflict; discard with and without a reason); `__tests__/history.test.ts` (7); `__tests__/page.test.tsx` (3); `api/services/ipmHistory.service.test.ts` (4).
- **Frontend, re-based:** `components/ui/a11y.adr090.test.tsx` (the device row's IPM history link, named after the device); `dashboard/devices/__tests__/page.test.tsx` (`accessFor` rows gain `ipm`); `lib/statusTone.test.ts` (+5 rows).
- **Backend, new:** `tests/migrations/0131-ipm-menu-active.test.ts` (4: up/down by slug, idempotent statement, the seed's three flags, registered after 0130, no try/catch). **Re-based:** `0130-ipm-templates-menu-active.test.ts` (the seed now has `ipm` on), `menuEffectiveAccess.adr102` (every equipment holder sees `/dashboard/ipm`; the super admin's sidebar has it), `menuEffectiveAccess.bound` (`/dashboard/ipm` in every bound sidebar; its load route mapped and marked), `effectivePermission.ud4b`.
- **Live, PostgreSQL 18:** `npm run test:live -- --only=uifix,p2006` — 2 of 2 (every migration, 0131 included, then the seed), container `p2204-pg18` at 127.0.0.1:55219, removed by name. 0131's statement by hand on the same server: `UPDATE 1`, `UPDATE 0` (idempotent), `down` `UPDATE 1`, `client-facilities` untouched.

## Gates (2026-10-10, Node 26, Windows)

| Gate | Result |
|---|---|
| `node scripts/ci/eslint-ratchet.js` | 0 error(s), 0 warning(s); baseline 0 |
| backend `typecheck` / `ratchet` / `load:check` (both) / `openapi:check` / `openapi:lint` | 0 / 695 at the floor / OK / current / no new error |
| backend `npm run test:coverage -- --ci` | **1,018 suites passed, 52 skipped, 0 failed; 17,334 tests passed; 100 / 100 / 100 / 100** |
| frontend `typecheck`; `npx eslint` on every changed file | 0 errors; 0 errors, 0 warnings |
| frontend `npx jest --ci --coverage` | **340 suites, 3,692 tests passed**; 94.4 / 86.02 / 90.41 / 95.04 (gate 90/81/86/91). First run: `copyTruthfulness.p1011` flagged "2,000" in two new strings (a figure outside the allow-list) — reworded to "at least 3 characters" (the field's `maxLength` keeps 2000) |
| `node ../node_modules/next/dist/bin/next build` | OK (`ƒ /dashboard/ipm`) |
| `node scripts/bundle-budget.mjs` | 10/10 within, exit 0 (`/` still 149.7 / 150 KB gzip — unchanged, not this page) |

## Not done / open

- The **results of a draft** are edited in the IPM capture (P22-03); this page edits a draft's header only.
- The **report document** and its signatures (`GET …/report-document`, `POST …/signatures`) are P23-02's page; the history shows the report number only.
- Technician activity (F-73, `performedBy`) is P22-07's filter; the list's service already passes any query.
- No live browser, accessibility (light + dark) or responsive run against a server.
- The menu tree is cached: a running deployment shows `ipm` after the TTL or a flush of `<prefix>menu*` / `<prefix>permissions:*`.
