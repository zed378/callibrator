# Calibration dates and exports get their menu entries (UAT gap C-3)

**Date:** 2026-10-13 · **Card:** line A, the UAT C-3 card · **ADR:** ADR-102 Amendment 1 · **Status:** DONE.

## The gap

`/dashboard/calibration-dates` (P22-05) and `/dashboard/exports` (P22-07) had no sidebar entry. Both pages read only through the `calibration` gate:

- calibration-dates: `calibrationRecords.route` `GET /`; the entry tab needs `calibration` write;
- exports: the register (`calibrationDevices.route` `GET /`) and the calibration records.

Line B's tenant-settings screen is a panel on `/dashboard/tenants`, so it needs no entry (coordinator, 2026-10-13).

## What was built

| | |
|---|---|
| Migration `0142-calibration-dates-exports-menu` | Idempotent, 0124's shape. Unseeded → nothing. It creates `calibration-dates` ("Calibration Dates", Gauge, sort 8, `…309`) and `exports` ("Exports", Table2, sort 9, `…310`) under Equipment, **active**, then grants `read` to every role holding a row on `calibration` or `equipment` (an existing pair is skipped). `down` removes both groups with their role and user grants |
| Seed | `seedMenuGroups.util.ts`: ids, menu data, and the fallback role lists (SUPERADMIN, HEALTHCARE ADMIN, CALIBRATOR ADMIN). `ROLE_MENU_ASSIGNMENTS`: `read` on both for all eleven roles (each holds `equipment`). `MENU_SLUGS` += `CALIBRATION_DATES`, `EXPORTS`; `SEEDED_MENU_SLUGS` += both |
| Gates | `MENU_PAGE_GATES`: both `menu("calibration")`, with their sources. Bound ceiling `SHARED_CEILING`: both at `read` |
| Contracts | `API_KEY_SCOPE_RESOURCES` += both (A-311: the contract names every `MENU_SLUGS` value). `openapi.json` / `schema.d.ts` regenerated: the description count changes from 53 to 55 slugs |
| Tests updated | `menuEffectiveAccess.adr102` (`EQUIPMENT` gains both) and `menuEffectiveAccess.bound` (`BASE` gains both, with their load routes). These are the hand-written expected sidebars |

## Tests (named)

- **Unit:** `migrations/0142-calibration-dates-exports-menu` (new, 6 tests). It covers unseeded, create, existing, taken id and no parent, and down. The seed's slugs, assignments, gates and ceiling are read from their own modules, and the test checks the registration. Coverage: `0142` and `seedMenuGroups.util.ts` at 100 / 100 / 100 / 100.
- **`--findRelatedTests` over the changed files:** 668 suites, 12,433 tests. The one failure was `swaggerValidatorAlignment.p608` (openapi.json not current after the scope addition): regenerated, then 5/5. `menuEffectiveAccess.adr102`, `menuEffectiveAccess.bound`, `apiKey.scopeContract.a299` and `0142`: 45 passed.
- **Guards + `utils/rawSql*` + `unboundedFindAll` + every `src/tests/migrations` unit test:** 1,568 passed.
- **Contracts:** 1,414 passed. **Frontend:** `api-keys` tests 20/20 (the scope dialog lists the contract).
- **Live PostgreSQL 18** (127.0.0.1:56270):
  - `menuEntries.c3` (new): **4/4**. The seed's groups are active under Equipment with the fixed ids, and both get `read` for the same roles. "up" on a database seeded before 0142 restores exactly the seed's rows plus an operator role's `read` (that role holds `calibration` only). A second up changes nothing. Read back as `callibrator_app`. Down removes, up restores.
  - `p2006` 5/5, `p2004` 15/15, `p2002` 21/21, `uifix` 3/3.
- **Gates:**
  - Backend and frontend typecheck: 0 errors.
  - `npm run ratchet`: 695, at the floor.
  - `load:check`: OK in both modes.
  - ESLint ratchet: 0, baseline 0.
  - `openapi:check`, `openapi:lint` and `api:types:check`: current, no new error.

## Files

- `backend/src/migrations/0142-calibration-dates-exports-menu.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/utils/seedMenuGroups.util.ts`, `backend/src/constants/roleConstants.ts`, `backend/src/constants/seededMenuSlugs.ts`, `backend/src/constants/menuPageAccess.ts`, `backend/src/constants/facilityAccess.ts`
- `packages/contracts/src/apiKeyScopes.ts`, `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`
- tests:
  - new: `backend/src/tests/migrations/0142-calibration-dates-exports-menu.test.ts`, `backend/src/tests/migrations/menuEntries.c3.live.test.ts`
  - changed: `backend/src/tests/services/menuEffectiveAccess.adr102.test.ts`, `backend/src/tests/services/menuEffectiveAccess.bound.test.ts`, `backend/scripts/live-suites.ts`
- `MEMORY/DECISIONS.md` (ADR-102 Am. 1), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
