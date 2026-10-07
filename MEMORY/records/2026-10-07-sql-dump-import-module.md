# 2026-10-07 — The SQL-dump import (P24-06, ADR-129)

**Owner request (2026-10-07, Indonesian, paraphrased):** "Build a module to import an SQL dump file into Postgres: the
dump is uploaded to the backend, a worker runs it as a background process, and a notification is sent when the import
finishes." **Design:** the coordinator's brief of the same day (never execute uploaded SQL; a safe streaming parser;
stage 1 into a staging schema owned by a dedicated role the application role cannot read; stage 2 designed only;
super-admin upload into the quarantine; ClamAV; SHA-256; delete the file once loaded; DPIA gate), written down as
**ADR-129** (`MEMORY/DECISIONS.md`). **Card:** P24-06 (`TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`) — the extract-and-stage half
of P24-01. **Privacy:** no real upstream value entered the repository or any test; every dump used was generated
(`tests/support/syntheticUpstreamDump.ts`); the owner's `mozivid/` dumps were not opened.

## 1. What was built

| Layer | Files |
|---|---|
| Parser | `backend/src/services/upstreamImport/dumpParser.ts` — byte-level streaming tokenizer + statement machine: `CREATE TABLE` and `INSERT [IGNORE] INTO … VALUES` only; MariaDB escapes, doubled quotes, `_binary`/`_utf8*`/`_latin1`/`N` introducers, `0x…`/`X'…'`, `b'…'`/`0b…`, TRUE/FALSE; every other statement counted (`set`, `lock`, `drop`, `use`, `alter`, `transaction`, `create_other`, `insert_other`, `other`), `DELIMITER` regions discarded whole; per-row rejection with resynchronisation; bounded memory (16 MiB per literal / row, 1,024 columns, 1,000 tables — past it, `#invalid`); names not matching `^[A-Za-z_][A-Za-z0-9_]{0,62}$` never reported |
| Values / policy | `stagingValues.ts` (MariaDB type → staging type; every value checked before it is bound; zero dates → NULL, counted); `tablePolicy.ts` (07 as code: 41 tables staged, `users` without its ten credential / internal columns, `auth_logins` + credential tables + photo logs + `migrations` not extracted, unknown tables not extracted) |
| Staging | `stagingLoader.ts` (advisory lock, role proof, purge of the run's rows, `CREATE TABLE IF NOT EXISTS upstream_import."stg_<t>"`, added columns, `schema_conflict`, multi-row bound INSERT under 30 k parameters); `importPipeline.ts` (64 KiB chunks, gunzip with a decompressed cap, one row buffer flushed per table change / batch / 8 MiB, progress + cancel every 2 s, per-table counts, fixed error codes) |
| Config | `backend/src/config/upstreamImport.ts` — `UPSTREAM_IMPORT_MAX_BYTES`, `…_MAX_UNCOMPRESSED_BYTES`, `…_FAILED_RETENTION_DAYS`, `…_UPLOAD_TIMEOUT_MS`, `UPSTREAM_IMPORT_DB_ROLE`, the staging Sequelize instance (2 connections, `SET ROLE` on acquire). The DPIA gate is ADR-130's `config/upstream.ts#upstreamRealDataAllowed` (shared) |
| Model + migrations | `models/upstreamSqlImport.model.ts` (platform row, no tenant column); `migrations/0114-upstream-sql-imports.ts` (table + ENUM, 5 CHECKs, list / one-active / FK indexes, REVOKE DELETE/TRUNCATE from `callibrator_app`, role `callibrator_import` NOLOGIN…, schema `upstream_import` owned by it and closed to PUBLIC and the app role); `migrations/0116-upstream-sql-import-menu.ts` (menu `upstream-sql-import`, SUPERADMIN write — as 0101/0115) |
| Service / worker | `services/upstreamSqlImport.service.ts` (upload, list, get, cancel, retry, settings, the batch handler `upstream-sql-import`, reconciliation, sweep, notification text); `middlewares/upstreamSqlImportSweepScheduler.middleware.ts` (hourly, monitored, `UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER`), wired in `backend/index.ts`; job `upstream-sql-import-sweep` in `jobMonitor.service.ts` |
| API | `controllers/upstreamSqlImport.controller.ts` (+ `uploadTimeBudget`), six routes on `routes/api/admin.route.ts` (router `rbac(SUPER_ADMIN)` + `superAdminOnly`), operations in `routes/api/admin.openapi.ts` (`UpstreamSqlImportRun`), `validators/upstreamSqlImport.validator.ts` |
| Contracts | `packages/contracts/src/upstreamSqlImport.ts` (data classes, compressions, error codes, row and table reason vocabularies, transform status, request schemas); `states.ts` `UPSTREAM_SQL_IMPORT_STATUSES` |
| Shared registrations | `models/index.ts`, `types/models.ts`, `utils/jsonShape.util.ts` (strict shapes for `tables` / `parseSummary`), `constants/systemActors.ts` (`system:upstream-sql-import`), `constants/roleConstants.ts`, `constants/seededMenuSlugs.ts`, `constants/menuPageAccess.ts`, `utils/seedMenuGroups.util.ts`, `config/migrator.ts`, `openapi.json` |
| Frontend | `app/dashboard/upstream-sql-import/page.tsx` (server: locale cookie, `pickMessages(["sqlImport."])`, the language toggle posting to `setLocale`) + `UpstreamSqlImportClient.tsx`; `api/services/upstreamSqlImport.service.ts`; 79 `sqlImport.*` keys in `i18n/messages/id.ts` / `en.ts`; `lib/statusTone.ts` domain `upstreamSqlImport`; `components/layouts/menuHelpers.tsx` icon `DatabaseZap`; `constants/index.ts` `PROXY_UPLOAD_TIMEOUT_MS`, `UPLOAD_CLIENT_TIMEOUT_MS`, `LONG_UPLOAD_PATHS`; `app/api/v1/[...path]/route.ts` (the long budget for that one POST); regenerated `api/generated/schema.d.ts` |
| Deploy | `deploy/compose/nginx/default.conf` + `vm-http.conf` (exact `location = /api/v1/admin/upstream-sql-imports`: 210m, `proxy_request_buffering off`, 960 s); `deploy/helm/callibrator` (`cron.upstreamSqlImportSweep`, `"disabled"` on API pods); `.github/workflows/ci.yml` (sweep disabled in the boot job); `backend/.env.example`, `deploy/compose/.env.example` |
| Docs | ADR-129; `docs/UPSTREAM/05-DATA-MIGRATION.md` § 2 amended (staging schema, typed tables); `docs/BACKEND/10-MODULE-REFERENCE.md` Module 35 |

## 2. The design in one paragraph

The super admin uploads a dump (multer into the upload quarantine; `.sql`/`.gz`; ≤ 200 MiB). The service sniffs it by
content (gzip magic; a UTF-8, NUL-free head whose first token is a comment or a statement keyword), checks the
uploader's declaration against the DPIA gate (`real` → 403 while `UPSTREAM_REAL_DATA_ALLOWED` is off), refuses a second
active run (409), hashes it, moves it to `uploads/.quarantine/upstream-sql/<run id>.dump`, records the run + its audit
row in one transaction and queues a PLATFORM batch job. The job claims the queued run (`uploaded → scanning`), re-checks
the gate, the file and its SHA-256, scans it (fail-closed), moves to `parsing`, opens the staging connection (role
`callibrator_import`, proved), takes the advisory lock, deletes the run's earlier rows, streams the file through the
parser, the policy and the value checks into `upstream_import.stg_<table>` in one transaction, commits, and moves to
`loaded` with the counts — notifying the uploader (in-app + e-mail, counts and codes only, in their home tenant) in the
same transaction — and deletes the file. Any failure rolls staging back, fails the run with a fixed code (the file kept
7 days for a retry unless infected or missing) and notifies; a cancellation (queued: at once; running: read at the next
2-second progress write) rolls back and deletes the file. Stage 2 (the transform) is designed in ADR-129 § 10 and
reported as `transformStatus: "not_available"`.

## 3. Tests (TypeScript; named)

| Suite | Tests | Proves |
|---|---:|---|
| `backend/src/tests/services/upstreamImport/dumpParser.p2406.test.ts` | 53 | a mysqldump-shaped file read table by table; escapes byte for byte; every literal kind; column lists; row numbering across INSERTs; CREATE TABLE variants (keys, nested defaults, enums, unsigned, `db`.`t`); SET/LOCK/DROP/USE/ALTER/transaction/other counted; CREATE VIEW/OR REPLACE/LIKE refused; INSERT … SELECT/SET refused; DELIMITER regions discarded (an INSERT inside a trigger body is not a row); comments of every kind, not nested; every refusal and rejection reason; limits (columns, tables, value, row, overlong words); 13 truncation shapes, 5 non-truncation shapes; **fuzz: 2,000 random byte strings and 2,000 SQL-shaped token soups never throw and report only identifiers; a 2 MB unterminated string; chunk-size invariance 1 B … 64 KiB; property: 1,000 random rows round-trip through mysqldump's escaping**. Coverage 100 % |
| `…/upstreamImport/stagingValues.p2406.test.ts` | 47 | 29 type mappings; integer ranges, decimals, doubles, real calendar dates, zero dates noted, strict UTF-8 (never U+FFFD), latin1, NUL refused, bit literals, bytea; the policy (users' ten excluded columns, 8 not-extracted names incl. `__proto__`, staging names ≤ 63 bytes); every reason in the contract vocabulary |
| `…/upstreamImport/importPipeline.p2406.test.ts` | 14 | the loader: advisory lock + role proof (4 refusals), bound purge, create / add column / `schema_conflict`, batches under the parameter limit (700 rows × 100 parameters → 3 statements); the pipeline over files: generator-equal counts, `password_hash` and `stg_auth_logins` never in a statement, gzip with compressed byte count, flush on table change / batch / 8 MiB, refused tables keep their reasons, progress interval and cancellation, `TRUNCATED_INPUT`, `DECOMPRESSED_TOO_LARGE`, `CORRUPT_COMPRESSION`, `FILE_MISSING`, a staging error passed on with its SQLSTATE |
| `backend/src/tests/services/upstreamSqlImport.service.p2406.test.ts` | 40 | over the REAL models, hooks, audit and notification services (memoryDb): upload (file moved, SHA-256, audit, job queued; gzip + BOM; 64 KiB head; 5 refusals that delete the file; validation 400; DPIA 403 / allowed; one active 409; unique-index races); the worker (every transition audited, `system:upstream-sql-import`; counts; file deleted; notification in the home tenant with counts; **a value from the dump in no run row, audit row or notification**; 9 failure codes each with its file kept or deleted; the gate re-checked; cancel while scanning and while parsing (rollback); an uploader gone); cancel / retry / list / settings with every 409 explained; reconciliation (job FAILED, vanished, never queued, running left alone, race); the sweep (expired file purged + audited, orphan after an hour, young file kept, a file that cannot be deleted logged); the notification text. Coverage 100 % |
| `backend/src/tests/routes/upstreamSqlImport.route.p2406.test.ts` | 10 | the real chain over HTTP: a tenant administrator 403 on all six routes before multer or the service (nothing written to the quarantine); 401; envelope (`data` + top-level `meta`); query validation 400; multipart through multer into the quarantine under a random name; gzip MIME variants; no file / wrong extension / over `UPSTREAM_IMPORT_MAX_BYTES` → 400 before the service; id 400; a service 409 passed through; `uploadTimeBudget` (30 s replaced, the timeout raised after it; a closed response clears it) |
| `backend/src/tests/middlewares/upstreamSqlImportSweepScheduler.p2406.test.ts` | 5 | hourly default, monitored, quiet when nothing happened, `disabled`/`off`, an invalid expression refused with an alert |
| `backend/src/tests/migrations/0114-upstream-sql-imports.test.ts` | 9 | fresh path (table, 5 CHECKs, indexes, revokes, role, membership, closed schema), idempotent re-run, role names from the environment and refused when not identifiers, 4 refusals (missing table, missing app role, cannot create the role, cannot SET it), `down` refuses while runs or staged rows exist, registered after 0113, no try/catch |
| `backend/src/tests/migrations/0116-upstream-sql-import-menu.test.ts` | 6 | unseeded database left alone; fixed id or random fallback; idempotent grant; down; registered after 0115 |
| `backend/src/tests/utils/jsonShape.p2406.test.ts` | 7 | the two JSONB shapes accept counts and codes (incl. `invalid_utf8`) and refuse a smuggled value, a non-identifier table key, a non-code reason, a negative count, > 1,001 tables, an extra summary key |
| `packages/contracts/test/upstreamSqlImport.p2406.test.ts` | 4 | the declaration, the list query bounds, the UUID, the vocabularies (contract module at 100 %) |
| **Live:** `backend/src/tests/services/upstreamSqlImport.p2406.live.test.ts` | 13 | see § 4 |
| Guard entries | — | `twoTenantRoutes.guard` (3 routes `platform`), `openapiRoutes.p925`, `unscopedModels.d17`, `enumMirrors.d26`, `associationForeignKeys.a148` (3 FKs), `includeRequired.d12` (81 models), `jsonShape.d27` (22 columns, good and bad fixtures), `systemActors.a124`, `rawSqlTenantPredicate.d05` (the staging loader's interpolated `upstream_import."stg_<t>"`, reviewed), `schedulerSwitch.w02` (both `.env.example`, the API-pod ConfigMap), `admin.route` (17 endpoints), `admin.flags.a174` (its auth mock gains `superAdminOnly`) |
| Frontend `app/dashboard/upstream-sql-import/__tests__/UpstreamSqlImportClient.test.tsx` | 12 | restriction; DPIA banner and the declaration required; file / size refusals before sending; multipart with progress (50 %) and the long timeout; a 409 inline; real allowed → a radio; list → detail (counts, per table, transform notice, file gone, duration); a failed run in words + retry; cancel 409 inline and "cancellation requested"; polling + `?run=`; error states; Indonesian; **axe: no violations** (2 checks) |
| Frontend `…/__tests__/page.test.tsx`, `api/services/upstreamSqlImport.service.test.ts`, `lib/statusTone.test.ts`, `app/api/v1/[...path]/route.stream.f16.test.ts` | 2 + 3 + 6 rows + 1 | server half (title, toggle, `aria-current`, `lang`); the contract paths and progress; the tones (`failed` the only alarm); the proxy's long budget for the upload POST only |

## 4. Live evidence (PostgreSQL 18 + ClamAV, synthetic data only)

Containers created for this and removed by name afterwards: `p2406-sqlimport-pg18` (`pgvector/pgvector:pg18`, port
127.0.0.1:55246) and `p2406-sqlimport-clamav` (`clamav/clamav:stable`, 127.0.0.1:53346; the image was pulled for this
check). No prune.

`P2406_PG_LIVE_TEST=1 P2406_CLAMAV=1 … npm test -- src/tests/services/upstreamSqlImport.p2406.live` on a fresh
`p2406_scratch` database — **13 / 13 passed, three consecutive fresh runs** (after a test-only race on the batch job's
COMPLETED mark was fixed by polling):

1. `0114: down / up / up on the migrated database rebuilds the same objects`;
2. `0114 grants`: **as `callibrator_app`**: `SELECT`/`INSERT` on `upstream_import.stg_probe` → `42501 permission denied for
   schema upstream_import`; `CREATE TABLE upstream_import.…` → 42501; `DELETE`/`TRUNCATE upstream_sql_imports` → 42501;
   `SELECT` on the runs allowed; `has_schema_privilege` USAGE/CREATE false; the import role is not superuser / createrole /
   createdb / login / bypassrls. **As `callibrator_import`**: its own table readable; `users`, `upstream_sql_imports`,
   `audit_logs` → 42501;
3. a synthetic dump (12 facilities, 120 devices, 10 tables, a trigger region, an escaped name, a zero date, an impossible
   date) through upload → ClamAV → parse → staging → `loaded`: every per-table count equal to the **generator's**
   expectation; the batch job the PLATFORM tenant's, COMPLETED;
4. staged rows: 6 users, 119 devices (row 3's `2024-02-30` rejected), 12 facilities; `stg_users` has no
   `password_hash`/`reset_hash`/`activate_hash`/`user_image`/`force_pass_reset` column; no `stg_auth_logins`,
   `stg_migrations` or `stg_synthetic_unknown_table`; the escaped name byte-equal; the zero date NULL; `tgl_inventory` typed
   `date`; a note with newline and tab intact; the trigger's INSERT not staged;
5. no synthetic secret (hash marker, login IP, names, e-mail) in the run row, the four audit rows (uploaded / scanning /
   parsing / loaded, PLATFORM tenant, the user then `system:upstream-sql-import`) or the notification (home tenant, the
   uploader, `SYSTEM`, with the SHA-256); the file gone;
6. a gzip dump loads the same counts; the pipeline run twice for one run id leaves 119 rows, not 238;
7. a cancelled parse leaves nothing of its run;
8. a truncated dump fails `TRUNCATED_INPUT`, nothing staged, file kept; retry → attempt 2 → same failure; two failure
   notifications;
9. the DPIA gate: `real` → 403 with `UPSTREAM_REAL_DATA_ALLOWED`, the file deleted, nothing in the dump directory;
10. one active run: a second upload 409; a second active row refused by the partial unique index (`23505`) even past the
    service; a queued run cancelled at once; a second cancel 409;
11. **ClamAV (real clamd):** a clean dump passes the scan and loads; the EICAR file in a run's place fails `INFECTED`
    before parsing and is deleted;
12. the sweep, 8 days on, deletes the failed run's kept file;
13. a reboot (sync + migrator) applies nothing; `verifySchema` reports no problem; 0114 `down` refuses while runs exist.

Throughput (scratch script, not committed): a 58.1 MB synthetic dump of 200,161 staged rows → **10.4 s**, peak RSS
**+94 MB** over the process's baseline (368 → 462 MB; the heap 45 MB after) — memory does not grow with the file.

## 5. Gates (2026-10-07, this tree, other agents working concurrently)

- Backend: `node scripts/ci/eslint-ratchet.js` → **0 errors, 0 warnings, baseline 0**; `npm run typecheck` → 0 errors;
  `npm run ratchet` → 695 `.js`, at the floor; `npm run build:dist` → 655 TypeScript files; `npm run load:check` → OK
  (dist, 645 modules, 107 in boot order) and `-- --src` → OK (tsx); `openapi:check` current, `openapi:lint` no new error
  (15 warnings, baselined); full `npm run test:coverage -- --ci` → see § 5.1.
- Contracts: `upstreamSqlImport.ts` at 100 % (`npm test` in `packages/contracts`).
- Frontend: `npm run typecheck` → 0 errors; `eslint` on every touched file → clean; jest on the new suites 17 / 17 and the
  proxy suites 32 / 32; full jest gate, `next build` and the bundle budget → see § 5.1.

### 5.1 Full-suite numbers

- **Backend `npm run test:coverage -- --ci`** (Node 26, other agents' work in the tree): **919 suites passed, 39 skipped,
  0 failed; 15,857 tests passed, 274 skipped; 100 % statements / branches / functions / lines**, 476 s. (The first full
  run caught two guards this module had not registered — `apiKey.scopeContract.a299` (the new slug in
  `@callibrator/contracts/apiKeyScopes`) and `unboundedFindAll.d24` (three reviewed `findAll`s); the second, one
  `swaggerValidatorAlignment.p608` failure from an `openapi.json` another agent's route change had left stale —
  regenerated; the third run is the one above.)
- **Contracts** `npm test`: 1,190 tests, 100 %.
- **Frontend** `jest --coverage --ci`: **314 suites, 3,439 tests passed**, 94.12 / 85.07 / 89.83 / 94.77 (gate 90/81/86/91);
  `next build` OK (run as `node ../node_modules/next/dist/bin/next build` — the `next` shim is a Bun shim that refused
  here); `node scripts/bundle-budget.mjs` → 10 / 10 within (`/` gzip 149.4 / 150 KB, unchanged); `npm run typecheck`
  0 errors; `eslint .` 0 errors (55 pre-existing warnings, none in this module's files).
- `openapi.json` and `frontend/src/api/generated/schema.d.ts` regenerated against the whole tree after the last route change.

## 6. Decisions and deviations

- **ADR-129** (new). Deviations from the brief, each recorded there: the run table is `upstream_sql_imports` (beside
  ADR-130's `upstream_file_imports`) rather than `import_runs`; the real-data refusal is **403**, as ADR-130 answers the
  same shared gate, not 409; the upload request has its own 15-minute budget end to end (backend, Next proxy, nginx)
  because every other request is held to 30 s / 10 MB; staging columns are typed (05 § 2 said `text`) — **05 § 2
  amended** with a reference to ADR-129.
- The SQL-dump import's menu leaf is its own (`upstream-sql-import`, migration 0116) next to the rsync import's
  (`upstream-import`, 0115): two pages, two slugs, one parent.

## 7. Deferred (stage 2 and after)

- **Stage 2 — the transform** (P24-01 / P24-02, needs the Phase 20 tables): `upstream_import.id_map` and `quarantine`
  (05 § 4), `transformStatus` gaining `transform_requested → transforming → transformed | transform_failed`, reading only
  its run's `stg_*` rows, idempotent by `source_row_hash`, writing through the application or a third narrowly granted
  role. Interface in ADR-129 § 10.
- Dropping or archiving old staging tables (e.g. after a `schema_conflict`) is an operator action until stage 2 owns the
  staging lifecycle; `upstream_import` is archived and dropped at decommission (Phase 31).
- A dedicated LOGIN role for the worker (instead of the owner + `SET ROLE`) is the stronger deployment, documented, not
  required.
- The real-data dry run (P24-05) stays blocked on R-01, R-03, R-17 and the legal review.

## 8. Gotchas

- A Sequelize instance built at **run time** outside `jest.isolateModules` loads its dialect from the main module
  registry; an isolated graph's `transaction()` then fails "Unable to start a transaction without transaction object!"
  (the `instanceof Transaction` check). The live suite loads the application's graph in the main registry.
- The `Write` tool turned a `﻿` escape into a literal BOM (lint: irregular whitespace); written as `\\uFEFF`.
- `invalid_utf8` carries a digit: the JSONB code pattern is `^[a-z][a-z0-9_]{0,39}$`, not `[a-z_]` (caught by the contracts
  test before any run could fail its final UPDATE).
