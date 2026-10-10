# P24-01: the upstream import's transform mechanism (stage 2)

**Date:** 2026-10-10 · **Card:** P24-01 · **ADR:** ADR-129 Amendment 1 · **Status:** DONE (the mechanism). **The transforms themselves are P24-02's.**

## What was built

| | |
|---|---|
| Migration `0133-upstream-import-transform` | A third role, `callibrator_transform` (`UPSTREAM_TRANSFORM_DB_ROLE`), switchable by the migrating role. `upstream_import.id_map`, keyed by (source_table, legacy_id), with `client_facility_id` (AM-28), the hex hash and `source_values`; a CHECK forbids `source_values` for `users`. `upstream_import.quarantine`, keyed by (run, table, staged row, reason), with the reason CHECK built from contracts. Both are created as the import role. Grants: the transform role gets SELECT on staging (default privileges included), SELECT/INSERT/UPDATE on `id_map`, SELECT/INSERT/DELETE on `quarantine`, and nothing in `public`. `callibrator_app` and PUBLIC are revoked. On `upstream_sql_imports`: 7 transform columns, a widened vocabulary CHECK, the transform-after-load and error-when-failed CHECKs, the one-transforming partial unique index, and FK indexes. `down` refuses while decisions exist |
| Contracts | `UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES` (5), `UPSTREAM_SQL_IMPORT_TRANSFORM_ERROR_CODES` (6), `UPSTREAM_IMPORT_QUARANTINE_REASONS` (18; `device_not_found` → `no_device`) |
| `services/upstreamImport/transform/` | `steps.ts`: the 05 § 3.1 registry, 13 steps; each of the 41 staged tables is claimed once; no step is built. `ledger.ts`: the row hash in SQL, `classify` (new / unchanged / changed), `recordMappings` (upsert, bound, 1,000 per batch) and `quarantineRows`. `runner.ts`: one transaction; lock, role check, quarantine purge, steps, and a per-source account. An unaccounted row or an unclaimed staged table gives `TRANSFORM_INCOMPLETE` |
| `services/upstreamSqlTransform.service.ts` | `requestTransform` returns 404, 409 (`TRANSFORM_NOT_AVAILABLE`, `RUN_NOT_LOADED`, `TRANSFORM_IN_PROGRESS`) or 403 (`REAL_DATA_NOT_ALLOWED`) as `CodedError`. Also the `upstream-sql-transform` job, `reconcileInterruptedTransforms` (in the hourly sweep), and an audit row on every transition |
| Route | `POST /admin/upstream-sql-imports/:id/transform`: super admin, validated `:id`, OpenAPI (553 ops), the frontend `schema.d.ts` regenerated. The run view gains `transformErrorCode`, `transformRequestable`, three timestamps and `transformSummary` (a D-27 shape) |
| Config | `config/upstreamImport.ts`: `transformRoleName` and `createTransformDb`; `.env.example` documents the role |

## Decisions (ADR-129 Am. 1)

- Third role with no public grants. P24-02 grants each target table in its own migration.
- The ETL runs in the application; it is not a CLI.
- `legacy_id` is text.
- The hash is computed in PostgreSQL with NULLs stripped.
- The quarantine vocabulary is fixed by a CHECK.
- There is no transform notification yet.

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2401` 17/17
  - `services/upstreamSqlTransform.service.p2401` 12/12
  - `routes/upstreamSqlTransform.route.p2401` 9/9 (tenant admin gets 403, codes at the top level)
  - `migrations/0133-upstream-import-transform.p2401` 16/16
  - contracts `upstreamSqlImport.p2401` 3/3
- **Changed files at 100%** (stmts, branches, funcs, lines): the transform service, `ledger`/`runner`/`steps`, `upstreamSqlImport.service`, the controller, `admin.route`, `admin.openapi` and `jsonShape.util`. `config/`, `models/` and `migrations/` are outside coverage. `--findRelatedTests` over every changed file gave 587 suites and 11,846 tests passed. Contracts: 66 suites, 1,401 tests at 100%.
- **Existing tests adapted** (assertion counts that the new route, column and keys require):
  - `admin.route.test.js`: 20 → 21 routes
  - `jsonShape.d27`: 31 → 32 columns, plus good and bad fixtures
  - `associationForeignKeys.a148`: 2 FKs reviewed
  - `twoTenantRoutes.guard`: the `:id/transform` platform entry
  - `upstreamSqlImport.service.p2406`: the handler found by type; the sweep's `interruptedTransforms`
  - contracts `upstreamSqlImport.p2406`: the transform statuses now widened
  - `upstreamSqlImport.p2406.live`: 0133 down/up around 0114's down/up
- **Live, PostgreSQL 18** (`pgvector/pgvector:pg18` on 127.0.0.1:55221, container `p2009-pg18`, removed by name):
  - `migrations/upstreamImportGrants.p2401.live` (new, in `test:live` as `p2401`): **8/8**. It checks G-29 as `callibrator_app`, every grant as `callibrator_transform`, the table CHECKs, and the runner on the transform connection: counts, unchanged on the same values, changed on new values, the quarantine replaced per run, `TRANSFORM_INCOMPLETE` rolling back `id_map`, an unclaimed table refused, and the owner's connection getting `TRANSFORM_ROLE_INVALID`.
  - Migration sequence: `p2004` 15/15, `p2002` 21/21, `uifix` 3/3, `p2406` 12/12 (+1 skipped by its own ClamAV switch).
  - `upgradeBoot.p2009.live` at scale 0.01: 9/9. The upgrade from 3e91413 now applies 0133, and the upgraded catalogue equals a fresh install's.
- **Gates:**
  - `npx eslint` on every changed file: clean
  - `eslint-ratchet`: 0/0
  - `typecheck`: 0 errors in the backend, the frontend and contracts
  - `ratchet`: 695 (at the floor)
  - `load:check`: OK in both modes
  - `openapi:check`: current
  - `openapi:lint`: no new error
  - `api:types:check`: OK

## Left for later

- **P24-02:** the 13 steps' `run` and legacy keys, the target-table grants, and the transform completion notification.
- The frontend page does not show the transform state or its button yet.

## Files

- `backend/src/migrations/0133-upstream-import-transform.ts` (new)
- `backend/src/config/migrator.ts` (the single 0133 line)
- `backend/src/config/upstreamImport.ts`
- `backend/src/models/upstreamSqlImport.model.ts`
- `backend/src/utils/jsonShape.util.ts`
- `backend/src/constants/systemActors.ts`
- `backend/src/services/upstreamImport/transform/{steps,ledger,runner}.ts` (new)
- `backend/src/services/upstreamSqlTransform.service.ts` (new)
- `backend/src/services/upstreamSqlImport.service.ts`
- `backend/src/controllers/upstreamSqlImport.controller.ts`
- `backend/src/routes/api/admin.route.ts`
- `backend/src/routes/api/admin.openapi.ts`
- `backend/openapi.json`
- `backend/scripts/live-suites.ts`
- `backend/.env.example`
- `packages/contracts/src/upstreamSqlImport.ts`
- `frontend/src/api/generated/schema.d.ts`
- tests: `backend/src/tests/{migrations/0133-upstream-import-transform.p2401.test.ts, migrations/upstreamImportGrants.p2401.live.test.ts, services/upstreamImport/transform.p2401.test.ts, services/upstreamSqlTransform.service.p2401.test.ts, routes/upstreamSqlTransform.route.p2401.test.ts}` (new); `packages/contracts/test/upstreamSqlImport.p2401.test.ts` (new); adapted: `backend/src/tests/{services/upstreamSqlImport.service.p2406.test.ts, services/upstreamSqlImport.p2406.live.test.ts, guards/twoTenantRoutes.guard.test.ts, utils/jsonShape.d27.test.js, models/associationForeignKeys.a148.test.js, routes/admin.route.test.js}`, `packages/contracts/test/upstreamSqlImport.p2406.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 1), `docs/UPSTREAM/05-DATA-MIGRATION.md` (§ 3.5, § 4 notes), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
