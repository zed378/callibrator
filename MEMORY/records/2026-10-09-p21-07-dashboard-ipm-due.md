# P21-07: the dashboard's condition and IPM figures for bound users, "due" by month, the QR quick search; `ipm-templates` turned on

**Date:** 2026-10-09 · **Task:** P21-07 (Phase 21; F-70 … F-73) · **Decision:** ADR-126 Amendment 6 · **Specs:** [`P18-03`](../specs/P18-03-facility-scope-permissions.md) § 8.2 (A-10, N-8, N-9; OQ-8); [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 11, § 15; [`P19-04`](../specs/P19-04-client-facilities.md) § 9.2 (AM-18, G-20); `docs/UPSTREAM/02-FEATURES.md` F-70 … F-73 · **Base commit:** `26739fa` · **Resumed:** a previous backend agent was halted mid-card; its uncommitted tree was finished, not restarted (no half-written code found; three suites it had not re-based were failing — § What surprised me)

> **Privacy:** synthetic rows only. `mozivid/` was not touched. `FACILITY_BINDING_ENABLED` stays OFF.

## Built

| Area | What |
|---|---|
| Dashboard | `GET /dashboard/metrics` adds `devices.byCondition { good, not_good, broken, unset }` (one grouped hooked count; null / unknown → `unset`; upstream "fit" = `good`, D-03) and `ipm { sessionsLast30Days, due }` — `due` = `{ scheduled, due, neverInspected }` from `ipmDue.service#countDue`, a tenant view only (`null` in the global view) |
| `countDue` | one `sql()` read with `listDue`'s predicates and month arithmetic: the tenant bound on `calibration_devices` and `inspection_sessions` (`$1`), the interval `$2`, the zone `$3`, `facilityClause("d.client_facility_id", 4)` for a bound caller (G-14) |
| A-10 marked | `FACILITY_ACCESSIBLE_ROUTES["api/dashboard.route.ts"]["GET /metrics"]` (read) — OQ-8 met: the cache key is per facility (`:all` / `:f:<id>`, G-20) and the two-facility proofs are green. G-P2's `/dashboard` pending entry is cleared (`menuEffectiveAccess.bound`) |
| "Due" by month | `GET /ipm/due?month=YYYY-MM` (contracts `ipmDueQuery.month`, `IPM_DUE_MONTH_PATTERN`): the reference month bound as `$8` (`<month>-01`), each row's `ipmDue` from `ipmDueReference` (the 15th, 12:00 UTC); range current month … +24 (`IPM_DUE_MONTH_HORIZON`) in the tenant zone, else **400 `IPM_DUE_MONTH_OUT_OF_RANGE`** (top-level `code`), nothing read. The facility clause moved from `$8` to `$9` |
| QR search (F-72) | the device search matches `qr_code = upper($1)` beside the full-text match, ranked `1`; rows carry `qrCode` |
| Technician activity (F-73) | no new route: `GET /ipm/sessions?performedBy=&from=&to=&q=` (P21-03), proved in its facility-scoped form (C-12) |
| Proposal queue | operator queue rows add `tenantName` (display name only; one batched `Tenant` read per page; `null` when gone) — P22-01's request |
| Menu | `seedMenuGroups.util.ts`: `ipm-templates` `is_active: true`; **migration 0130** `0130-ipm-templates-menu-active` — one idempotent `UPDATE … WHERE slug = $2 AND is_active IS DISTINCT FROM $1`, `down` sets false; `ipm`, `client-facilities` untouched |
| OpenAPI | `dashboard`, `ipmReports`, `search` docs and `InspectionTemplateProposalQueueRow`; `openapi.json` and `frontend/src/api/generated/schema.d.ts` current |

## What surprised me

1. **The halted tree was complete but three existing suites were never re-based** and failed the first coverage run: `services/unboundedFindAll.d24` (two new unbounded `findAll`s — the grouped condition count and the queue page's tenant names — now REVIEWED as GROUPED and IDS), `services/queryShape.p804` (its model double had no `InspectionSession`; the fan-out now runs 22 pooled queries + `countDue` = 23 calls), `services/effectivePermission.ud4b` (asserted `ipm-templates` seeded inactive).
2. **A bound user's dashboard reads 0 for the provider-internal figures** (stock, warehouses, transfers, opnames — their models deny a bound caller). Correct, but the cards should be hidden for a bound user (P22-07; ADR-126 Am. 6 implications).
3. **A past `month` cannot be answered honestly**: "due" is computed from the last effective visit now, so a past reference month would count visits made after it. It is a 400, not a history.

## Evidence — tests named

- **New, unit / memoryDb:** `services/dashboard.p2107.test.ts` (3: `byCondition` keys, null and unknown as `unset`, tenant-scoped; `ipm` visits of 30 days and `countDue(tenant)`; global view `due: null`); `services/ipmDue.p2107.test.ts` (`month` bound as `$8`, rows computed for that month, past / beyond-horizon → 400 `IPM_DUE_MONTH_OUT_OF_RANGE` with nothing read; `countDue` binds the tenant on both tables and a bound caller's facility at `$4`); `services/search.qr.p2107.test.ts` (3: exact upper-cased QR match ranked first, the ILIKE fallback searches `qr_code`, other types unchanged); `routes/dashboard.twoFacility.test.ts` (6, **A-10**: bound F1 / F2 get their own facility, provider-internal 0, never another facility's cached value, unbound staff all, another tenant its own); `routes/technicianActivity.twoFacility.test.ts` (6, **C-12**); `migrations/0130-ipm-templates-menu-active.test.ts` (4: up/down, idempotent, the other two slugs untouched, seed agrees, registered after 0129, no try/catch); `routes/ipmTemplateProposals.twoTenant.test.ts` (+1 case and assertions: `tenantName`, null when the tenant is gone, no read on an empty page).
- **Contracts:** `test/ipmDueMonth.p2107.test.ts` (the pattern, the range in the zone at a month boundary, `computeIpmDue` with the reference).
- **Live, PostgreSQL 18** (`pgvector/pgvector:pg18`, container `p2107-pg18` at 127.0.0.1:55217, removed by name after): `npm run test:live -- --only=p2107,p2104,p2006,uifix` — **4 of 4 suites passed** (p2107 70 s, p2104 78 s, p2006 86 s, uifix 90 s). `services/dashboard.twoFacility.p2107.live.test.ts` (7, as `callibrator_app`): the REAL `getDashboardMetrics` under unbound / F1 / F2 contexts, every count of F1 + F2 ≤ unbound; `month` moves the reference in SQL as `computeIpmDue` does; the QR typed in lower case found, rank 1. `p2006` and `uifix` run every migration, 0130 included, then the seed. 0130's statement was also run on PG 18 by hand: `UPDATE 1`, then `UPDATE 0` (idempotent), `down` `UPDATE 1`, `ipm` untouched.
- **Re-based (behaviour changed on purpose):** `services/dashboard.service.test.js`, `services/dashboard.pins.p918.test.ts` (the `InspectionSession` double, `countDue` mocked), `services/ipmDue.p2104.test.ts` (bind lists gain `$8`, the facility at `$9`), `services/menuEffectiveAccess.adr102.test.ts` and `menuEffectiveAccess.bound.test.ts` (`ipm-templates` in the sidebar; its load route `GET /templates/published`; `/dashboard` pending cleared), `services/unboundedFindAll.d24.test.js`, `services/queryShape.p804.test.ts`, `services/effectivePermission.ud4b.test.ts` (§ What surprised me 1).

## Gates (2026-10-09, Node 26, Windows workstation; the frontend agent's Phase 22 files mid-edit in the same tree)

| Gate | Result |
|---|---|
| `node scripts/ci/eslint-ratchet.js` | 0 error(s), 0 warning(s); baseline 0 (after `--fix` of 7 errors in the halted tree: a type-only import, an unnecessary assertion, five quote styles) |
| `npm run typecheck` (backend) | 0 errors |
| `npm run ratchet` | 695 `.js`, at the floor |
| `npm run load:check` / `-- --src` | OK (dist via node; src via tsx) — 729 modules, 116 in boot order |
| `npm run openapi:check` / `openapi:lint` | current / no new error (15 warnings, baselined) |
| `frontend: npm run api:types:check` | current |
| contracts `npm test -- --ci` / `typecheck` | 65 suites, 1,398 tests passed, 100 / 100 / 100 / 100 / 0 errors |
| `npm run test:coverage -- --ci` | FIRST RUN: 3 failed (§ What surprised me 1), coverage 100 %. SECOND RUN (2026-10-10, resumed by the next agent after the halt, the tree unchanged for P21-07 code): **1,017 suites passed, 52 skipped, 0 failed; 17,330 tests passed, 435 skipped; 100 / 100 / 100 / 100**, 240 s |
| `test:live --only=p2107,p2104,p2006,uifix` | 4 of 4 passed (2026-10-09) |
| re-run 2026-10-10 | `test:live --only=p2107,uifix` 2 of 2 and `--only=p2107,p2104` 2 of 2 (p2107 7 tests, p2104 9), throwaway `pgvector/pgvector:pg18` container `p2107b-pg18` at 127.0.0.1:55218, removed by name. Every gate above re-run on 2026-10-10 with the same results (lint 0/0; typecheck 0; ratchet 695; load:check 729 / 116 both modes; openapi current, no new error; contracts 65 suites, 1,398 tests, 100 %; `api:types:check` current) |

## Not done / open

- **`openapi:breaking`** not run locally (no `oasdiff` binary; CI runs it). The changes are additive (new optional query `month`, new response keys) — expected clean.
- **P22-07** (frontend) is unblocked: hide the provider-internal cards for a bound user; `condition=unset` is not a device-list filter.
- The menu tree is cached: a running deployment shows `ipm-templates` after the TTL or a flush of `<prefix>menu*` / `<prefix>permissions:*` (as 0124).
