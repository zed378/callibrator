# P20-09 — Phase 20 as an upgrade boot on production-shaped data, columns inspected

**Date:** 2026-10-10 · **Card:** P20-09 (Phase 20, last card) · **ADR:** ADR-124 Amendment 7 · **Status:** DONE

## What was built

| | |
|---|---|
| New live suite | `backend/src/tests/migrations/upgradeBoot.p2009.live.test.ts`, by hand (`P2009_UPGRADE_LIVE_TEST=1`), listed in `scripts/live-suites.ts` `NOT_RUN` with its reason |
| Base | `3e91413`: the image the reference deployment runs since 2026-10-06. Its last migration is 0110, so it is the release right before Phase 20. The suite refuses a base that already has 0111 |
| Volume (scale 1) | 121 tenants, 1,200 users, 240 stores, 100,000 devices, 200,000 calibration records, 100,000 certificates, 50,000 work orders, 1,000,000 IoT readings, 60,000 attachments (a fifth of them vendor files, plus work-order files whose work order is gone), 5,000 NCs and 330,000 audit rows. Set-based synthetic SQL with md5-derived ids and `example.test` addresses. Nothing from `mozivid/` or upstream. Seeding took 106 s |
| Knobs | `P2009_SCALE` (0.01 runs in about 45 s), `P2009_REPORT` (timings as JSON), `P2009_PLANT` (a planted drift, for fail-before), `P2009_KEEP_WORKDIR` |

## What it checks (9 cases)

1. The base built its own schema: 0001 – 0110, and its schema check passed.
2. The seed holds the volume, counted.
3. The current tree's boot schema step upgrades the database with no manual migrate. It applies exactly 0111 – 0131, in order, and the schema check passes.
4. **The boot budget.** The whole step stays under 600 s (`MIGRATION_LOCK_TIMEOUT_MS`), and every migration is timed.
5. A second boot applies nothing, and a fresh install of the same tree passes.
6. **`npm run migrate:verify`** (`src/scripts/verifySchema.ts`, the operator's command) on the upgraded database: exit 0, `[schema-verify] OK: 87 tables, 1273 columns and 124 control objects`.
7. **The columns, read from `information_schema`:** 18 Phase 20 columns, each with its type and nullability. These include `client_facility_id` NOT NULL on the five device-chain tables and nullable on the other five.
8. **The back-fills:**
   - every tenant has exactly one self facility, and every device is in it;
   - no record, certificate, work order, reading or NC disagrees with its device's facility;
   - every facility-kind attachment has a facility and no vendor file has one;
   - orphaned work-order files are kept, in the self facility;
   - no table lost a row.
9. **The upgraded catalogue equals a fresh install's**, compared on both databases in `pg_catalog`:
   - columns, with type, NOT NULL and default;
   - constraints, indexes, and triggers with their enable state;
   - function bodies (md5) and ENUM labels in order;
   - table and column grants to `callibrator_app`.

   0091's `audit_logs_actor_check` run-time timestamp is the one masked value.

## Results (PostgreSQL 18, `pgvector/pgvector:pg18` on 127.0.0.1:55221, removed by name afterwards)

- **Full scale: 9/9 in 264 s.** The schema step took **126.3 s**; a fresh install of the same tree took 7.8 s.
- **Per migration (ms):**
  - Phase 20 back-fills: 0118 7,866 · 0119 16,173 · 0120 11,850 · 0121 2,963 · **0122 76,330** · 0123 3,380.
  - The rest: 0111 122 · 0112 210 · 0113 24 · 0114 43 · 0115 6 · 0116 8 · 0117 603 · 0124 18 · 0125 39 · 0126 326 · 0127 59 · 0128 5,139 · 0129 156 · 0130 13 · 0131 11.
- **Scale 0.01: 9/9 in 45 s,** run twice (before and after the lint fix).
- **Fail-before:** with `P2009_PLANT="ALTER TABLE warehouses ALTER COLUMN floor SET DEFAULT 1"` the result was **8 passed, 1 failed**. The catalogue case failed with `onlyUpgrade: ["warehouses.floor character varying(50) DEFAULT 1"]`, and `migrate:verify` still said OK. The comparison catches what `schemaVerify` does not.

## The decision (ADR-124 Am. 7)

- The upgrade window is 600 s (the schema lock's bound).
- No back-fill is split: 126 s is well inside 600 s.
- The threshold is recorded instead: at about 4.5 times this volume (about 4.5M readings), split 0122 or 0119 first, or raise the lock timeout together with the startup probe.
- The P19-04 spec § 6.2 has an as-measured note.

## Gates (card scope only, by owner rule)

- `npx eslint` on both changed files: clean (one `quotes` error fixed with `--fix`).
- `node scripts/ci/eslint-ratchet.js`: 0 errors, 0 warnings, baseline 0.
- `npm run typecheck`: 0 errors (two TS4111 errors fixed with bracket access).
- `npm run ratchet`: 695 `.js`, at the floor.
- `npm run load:check`: OK.
- `liveSuites.a367.guard`: 4/4.
- Coverage: no `src/` file changed outside the tests.

## Not done / limits

- The 76 µs per reading figure comes from one workstation's Docker. It is not a production measurement.
- The suite is not in CI (`NOT_RUN`), because it takes about 5 minutes and extracts an older revision.
- `make migrate-verify` (the compose target, which reads the boot log) was not run: there is no compose stack, and the owner rule says no deploy. The card's "not the log" is met by the host script and the catalogue reads.

## Files

- `backend/src/tests/migrations/upgradeBoot.p2009.live.test.ts` (new)
- `backend/scripts/live-suites.ts`
- `MEMORY/DECISIONS.md` (ADR-124 Am. 7 and its "Amended by" entry)
- `MEMORY/specs/P19-04-client-facilities.md` (§ 6.2 note)
- this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-20-UPSTREAM-DB-MIGRATION.md`
