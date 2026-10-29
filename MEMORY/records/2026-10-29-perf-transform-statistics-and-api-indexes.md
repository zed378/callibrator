# Performance: the transform 608 s → 129 s (planner statistics), device search on a trigram index, compliance counted in SQL

**Date:** 2026-10-29 · **Card:** P24-05 follow-up; owner request "optimalisasi query, indexing dan lainnya" · **Status:** DONE · **Decision:** [ADR-129 Am. 13](../DECISIONS.md)

## How it was measured

Everything below was measured on the real 2026-10-06 dump (local only, owner rule UD-18). It ran on a throwaway PostgreSQL 18 (`pgvector/pgvector:pg18` with `pg_stat_statements`) through [`backend/scripts/upstream-dry-run.ts`](../../backend/scripts/upstream-dry-run.ts). Only counts, durations and plans were kept. The database, containers and logs were removed afterwards.

- **Transform:** one dry run profiled with `--cpu-prof`, plus `pg_stat_statements`.
- **API:** a local benchmark called the hot read services as a tenant user, five times each, on the transformed data: 23,722 devices and 25,855 calibration records in one tenant. A median is reported. This workstation's timing noise is about ±50 % (the same plan ranged 29–62 ms), so only large differences count.

## 1. The transform: CPU, then planner statistics

| Fix | Where | Effect |
|---|---|---|
| Cache the `Intl.DateTimeFormat` per zone | `packages/contracts` `zonedDay` (inspectionValues.ts), `zonedParts` (deviceValues.ts) | 177 s of transform CPU was spent building formatters. 100k calls: 25,978 ms → 1,839 ms (14.1×). `zonedParts` also runs per listed device on the API |
| `ANALYZE` after every step, in the transaction | `transform/runner.ts` `refreshStatistics` | the IPM snapshot read (120 s), photo rows (63 s) and rooms (30 s) were planned on empty-table statistics |
| `MAINTAIN` on what the transform writes | migration **0147** (ADR-129 Am. 13) | lets the transform role run that ANALYZE; the bookkeeping is granted as its owner, the import role |
| `ANALYZE` of the staged tables after stage 1 commits | `stagingLoader.ts` `analyzeStaged`, `upstreamSqlImport.service.ts` | stage 2 starts with real statistics; a failure is logged, never fails the import |

Same dump, before (summary of 2026-10-29 morning) → after:

| Step | Before (ms) | After (ms) |
|---|---|---|
| warehouses | 30,191 | 803 |
| calibration_devices | 7,504 | 9,366 |
| attachments (no photos) | 66,928 | 3,456 |
| inspection_sessions | 245,937 | 16,867 |
| inspection_results | 242,607 | 85,287 |
| **transform total** | **607,864** | **128,655** |
| reconciliation / data quality | 29,132 / 9,450 | 7,330 / 3,237 |

Outcomes are identical: per-step source counts are equal, and there are 0 reconciliation failures before and after. The data-quality report differs only in the run's fresh UUIDs.

## 2. API reads at real volume

The benchmark (median ms) showed every hot read already fast. The device list is batched (`deviceFacts`, `labNames`) with no N+1, and the paging walks `calibration_devices_tenant_id_name`. Two targets:

**Device search (`find=`).** A leading-wildcard `ILIKE` over name, serial and manufacturer read every live device of the tenant, for the page and again for the count. That cost about 38 ms per statement and grows with the register. Migration **0148** adds one GIN, `calibration_devices_tenant_id_text_trgm (tenant_id, name gin_trgm_ops, serial_number gin_trgm_ops, manufacturer gin_trgm_ops)`, using pg_trgm and btree_gin. It is built CONCURRENTLY and lives only in the migration.

- A rare term (a serial typed in the field) becomes a BitmapOr of three scans of the index, each with the tenant in its Index Cond. The statement takes 0.18 ms (count 0.12 ms), and the whole service call goes from **40 ms to 6 ms**.
- A common term ("infus", 7.5 % of the register) keeps the `(tenant_id, name)` walk with or without the index, so it is unchanged within noise.
- A term under three characters has no trigram and is also unchanged.
- The index is 3.4 MB for 23,722 rows.
- Three separate single-column trigram indexes were tried first. They were dropped for the one tenant-led index, which keeps a term from walking other tenants' matches (0110's lesson).

**Compliance report.** `reporting.getCompliance` fetched every record's `is_compliant` into Node to count it: 25,855 rows per call. It now groups in SQL (`GROUP BY is_compliant`, at most three rows). On the real data its summary equals a direct `count(*) FILTER` exactly (25,855 total, all unknown).

Not changed, because measured fast: dashboard (36–52 ms), records list (7–13), one device (13–23), overdue (6–8), IPM due and count (12–14), IPM sessions (8–13), report summary (9–15).

## Evidence

- **Unit:**
  - `src/tests/migrations/0147-upstream-transform-maintain.test.ts`: 6 tests. It also checks every step's `writes` against the grant list.
  - `0148-device-text-search-trgm.test.ts`: 4.
  - `indexDefinitionSync.u06b`: 0148's definition parses in Sequelize's showIndex.
  - `transform.p2401` (the ANALYZE order and transaction), `importPipeline.p2406` (`analyzeStaged`, refuses a name it would quote), `upstreamSqlImport.service.p2406` (after the commit; a failed ANALYZE keeps the run `loaded`), `reporting.service*`.
  - Changed files at 100 %: 0147, 0148, runner.ts, stagingLoader.ts, upstreamSqlImport.service.ts, reporting.service.ts. Contracts 73 suites, 1,429 tests at 100 %.
- **Live, PostgreSQL 18:**
  - `p2401` 9/9, with the new "0147: MAINTAIN on every table the transform writes" run as the transform role. It runs before the suite's 0133 down/up, which recreates the bookkeeping.
  - `p2402a` … `g` and `p2403`, `p2409a`, `p6`: all passing.
  - New suite **`t0148`** 3/3, run three times. It checks the index is VALID with its definition, that it serves each ILIKE, and that `find=` answers by name, serial and manufacturer, any case, for the caller's tenant only.
  - Not run: `p2406` (needs ClamAV) and the upgrade-boot suites.
- Lint is clean on every changed file. The backend typecheck has errors only in `src/tests/middlewares/*`, from the concurrent JS→TS conversion, none in these files.

## Found on the way

- A live check of a grant must run before anything in the suite recreates the table: 0133's down/up drops later grants on `id_map`/`quarantine`.
- Asserting which plan the planner picks is fragile: it flipped between runs on synthetic data, depending on ANALYZE's sample. `t0148` asserts that the index *serves* the predicate. The planner's choice is measured on the real data, above.
