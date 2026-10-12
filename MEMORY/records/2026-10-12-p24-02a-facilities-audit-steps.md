# P24-02a: the upstream transform's provider tenant, its facilities step and its audit step

**Date:** 2026-10-12 · **Card:** P24-02a (the first part of P24-02) · **ADR:** ADR-129 Amendment 3 · **Status:** DONE (these two steps). Steps 2 … 12 are P24-02b onwards. The transform stays **not available** (409 `TRANSFORM_NOT_AVAILABLE`) until every step is built.

## Why P24-02 is split

P24-02 is 13 steps over 41 staged tables, each with its own decisions and its own target-table grants. It is built in parts, one card each:

- **a:** the provider tenant, facilities (step 1) and audit rows (step 13);
- **b onwards:** users, the catalogue, vendors and rooms, devices, calibrations, sessions and results.

## What was built

| | |
|---|---|
| Contract (`@callibrator/contracts/upstreamSqlImport`) | `requestUpstreamSqlTransformSchema` `{ providerTenantId }`, plus `transformUpstreamSqlImportSchema` (`:id` + body). Error code `PROVIDER_TENANT_INVALID`. Quarantine reason `facility_without_devices` |
| Migration `0134-upstream-transform-facilities` | `upstream_sql_imports.transform_tenant_id` (no FK, not `tenant_id`) and the CHECK `upstream_sql_imports_transform_tenant`. The quarantine reason CHECK is rebuilt from contracts, as the import role. Grants to `callibrator_transform`: SELECT, INSERT and UPDATE on `client_facilities`; INSERT on `audit_logs`. `down` refuses while a run is past `not_available` or the new reason is in use |
| Request | `POST /admin/upstream-sql-imports/:id/transform` now takes a body, validated with `validate(schema, { from: ["params", "body"] })`. Unknown or platform tenant → 404 `PROVIDER_TENANT_NOT_FOUND`. Inactive tenant → 409 `PROVIDER_TENANT_NOT_ACTIVE`. The tenant is stored on the run and in the request's audit `changes`. The view gains `transformTenantId`; OpenAPI and `schema.d.ts` are regenerated |
| Worker | It passes the run's tenant and `UPSTREAM_SOURCE_TIMEZONE` (`config/upstreamImport.ts#sourceTimeZone`, default `Asia/Jakarta`; an invalid zone is refused) to the runner. A run without a tenant fails `PROVIDER_TENANT_INVALID` before the runner starts |
| `transform/clientFacilities.ts` (step 1) | The provider check, then `mst_faskes` → `client_facilities`. Names are normalised. Duplicates merge into the lowest legacy id with a device. Empty names and device-less groups are quarantined. An operator-made facility of the same name is adopted. Codes run `F-0001…`. Changed rows update; unchanged rows are skipped |
| `transform/auditRows.ts` (step 13) | One audit row per target written in this transaction (`id_map.updated_at = now()`). CREATE or UPDATE, actor `system:upstream-transform`, the row's tenant and facility. `changes` holds no legacy id |
| `transform/failure.ts` | `TransformFailure`, moved out of the runner (which re-exports it) so a step can throw it without an import cycle |
| `transform/ledger.ts` | `stagedTableExists`, moved from the runner and exported |
| Runner / `StepContext` | Gain `tenantId` and `sourceZone`, both bound and never interpolated |
| Guards | D-05 passes without new entries, because every statement binds `tenant_id = $n`. G-14 (`constants/facilityAccess.ts`) gains three reviewed system entries |

## Decisions (ADR-129 Am. 3)

- The provider tenant is named by the super admin and created by the onboarding. The transform never creates one.
- Facilities without devices are quarantined (UD-11) with a new reason.
- Import audit rows carry no legacy id. This deviates from 04 § 7, for 07 § 3.
- Adoption is by name, and name collisions fail loudly.

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2402a` (new): the registry, the zone, the provider check, codes, the plan in each branch, the step's statements and binds, the audit statement, and `stagedTableExists`.
  - `migrations/0134-upstream-transform-facilities.p2402a` (new): 12/12.
  - Adapted: `transform.p2401` (the provider scope in every call), `upstreamSqlTransform.service.p2401` (now 14/14, with two new P24-02a cases: the tenant refusals and the worker's missing tenant), `constants/systemActors.a124` (the new actor).
  - The transform files are at 100 / 100 / 100 / 100: `auditRows`, `clientFacilities`, `failure`, `ledger`, `runner`, `steps` (38/38 with p2401).
- **Live, PostgreSQL 18** (`pgvector/pgvector:pg18`, container `p2402a-pg18` on 127.0.0.1:56231; 55231 sits in this workstation's reserved WinNAT range; removed by name):
  - `upstreamTransform.p2402a` (new, `--only=p2402a`): **7/7**, proved as the transform role. It covers:
    - 0134 down/up/up;
    - the grants (no DELETE on facilities; `audit_logs` INSERT only);
    - a tenant with no self facility refused;
    - the first transform: merged, adopted, coded, quarantined, Jakarta time, three CREATE audit rows without a legacy id;
    - a same-values re-run that writes nothing;
    - a rename: UPDATE with the code kept, one UPDATE audit row;
    - a second provider refused;
    - a failed transform rolling back its facilities **and** audit rows.
  - Also: `p2401` 8/8 (its "nothing in public" list no longer names `client_facilities`), `p2004` 15/15, `p2002` 21/21, `uifix` 3/3, `p2406` 13/13 with ClamAV (`bk-clamd`, 127.0.0.1:13314; its 0114 down/up now wraps 0134 too).
- **`--findRelatedTests`** over every changed file: 641 suites, 12,083 tests. 2 suites failed on that first pass, and both are now fixed and green:
  - `routes/upstreamSqlTransform.route.p2401` now sends the body: 15/15 with `systemActors.a124`, including a new 400 case and the two new codes.
  - `constants/systemActors.a124` gained the new actor.
- **Coverage:** every changed `src` file at 100 / 100 / 100 / 100. `config/`, `models/` and `migrations/` are outside coverage.
- **Contracts:** 67 suites, 1,404 tests, 100%. This includes the new `upstreamSqlImport.p2402a` and the adapted `upstreamSqlImport.p2401` (19 reasons, 7 codes).
- **Guards:** `src/tests/guards`, `utils/rawSql*` and `services/unboundedFindAll`: 44 suites, 335 tests passed. G-14 was red before its three entries were added.
- **Gates:**
  - `npx eslint` on every changed file: clean
  - `eslint-ratchet`: 0 / 0, baseline 0
  - `typecheck`: 0 errors in the backend and contracts
  - `ratchet`: 695, at the floor
  - `load:check`: OK for dist via node (739 modules) and src via tsx (743)
  - `openapi:generate` (553 operations) and `openapi:check`: current
  - `openapi:lint`: no new error
  - `api:types` and `api:types:check`: OK

## Left for later

- **P24-02b onwards:** steps 2 … 12, their grants, and the transform completion notification.
- **P24-03:** facility logos (`img_logo`) belong to the file pipeline.
- **Frontend:** the page has no transform button. When it gets one, it must send `providerTenantId`.

## Files

- `packages/contracts/src/upstreamSqlImport.ts`
- `backend/src/migrations/0134-upstream-transform-facilities.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/config/upstreamImport.ts`, `backend/.env.example`
- `backend/src/constants/systemActors.ts`, `backend/src/constants/facilityAccess.ts`
- `backend/src/models/upstreamSqlImport.model.ts`
- `backend/src/services/upstreamImport/transform/{clientFacilities,auditRows,failure}.ts` (new), `{steps,runner,ledger}.ts`
- `backend/src/services/upstreamSqlTransform.service.ts`, `backend/src/services/upstreamSqlImport.service.ts`
- `backend/src/controllers/upstreamSqlImport.controller.ts`, `backend/src/validators/upstreamSqlImport.validator.ts`
- `backend/src/routes/api/admin.route.ts`, `backend/src/routes/api/admin.openapi.ts`, `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`
- `backend/scripts/live-suites.ts`
- tests:
  - new: `backend/src/tests/services/upstreamImport/transform.p2402a.test.ts`, `backend/src/tests/migrations/0134-upstream-transform-facilities.p2402a.test.ts`, `backend/src/tests/migrations/upstreamTransform.p2402a.live.test.ts`
  - adapted: `backend/src/tests/services/upstreamImport/transform.p2401.test.ts`, `backend/src/tests/services/upstreamSqlTransform.service.p2401.test.ts`, `backend/src/tests/migrations/upstreamImportGrants.p2401.live.test.ts`, `backend/src/tests/services/upstreamSqlImport.p2406.live.test.ts`, `backend/src/tests/constants/systemActors.a124.test.js`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 3), `docs/UPSTREAM/05-DATA-MIGRATION.md` (§ 3.1 note), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
