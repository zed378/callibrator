# 2026-10-05 — U-06: tenant-scoped list performance, re-measured; the ceiling is the Node event loop, not PostgreSQL

**ADR:** [ADR-119](../DECISIONS.md) · **Task:** `TASKS/BACKLOG.md` U-06 · **Builds on:** ADR-086 §3 (P8-07), ADR-096 (P8-04) · **Migration:** `0109` · **Tree:** `dded70c` (runtime identical to `1100658`: the commit between them touches tests and CI only) plus this change.

## Summary

- **The P8-07 figures in U-06 were stale.** They were taken on 2026-09-28, before ADR-096 (audit window and count cap, 0093 indexes, a bounded dashboard). Re-measured with the same k6 script and seed on the current tree, the four tenant-scoped lists had a p95 of **156–438 ms at 10 concurrent users in 8 of 9 baseline runs**. The ninth run was 591–688 ms, and it ran while another lane's CI used 300–400% of the host's CPU.
- **The root cause of the remaining latency is the backend's single event loop, not PostgreSQL.** Under 10 VU, the backend's main thread measured **99–100% busy** (`/proc/1/task/*/stat`), while PostgreSQL used **165–191% of 16 cores**. P8-07's "PostgreSQL is the ceiling" was true of the pre-ADR-096 tree, when the audit list ran a parallel sequential count.
- **The CPU cost per request, measured one endpoint at a time:** devices 11.4 ms, filtered devices 11.5, records **25.5**, audit 17.3, dashboard **43.5**. The dashboard is a fifth of the mix and about 40% of its backend CPU.
- **Fixed (ADR-119):**
  - The record list's count no longer carries the three LEFT includes, and its page is a deferred join (`subQuery: true`). Page 200 went from **6,592 buffers / 52 ms to 622 buffers / 2.1–4.5 ms**.
  - Migration **0109** adds a partial covering index of live records. The four record counts (the list's and three dashboard figures) are index-only: **1,510 → 361 buffers**, Heap Fetches 0.
  - Sequelize's CLS namespace moved from `cls-hooked` to `AsyncLocalStorage`, and `cls-hooked` was removed. Its process-wide async hook with destroy tracking taxed every promise.
  - The JWT ring hands `jsonwebtoken` cached KeyObjects. Before, every verify made jsonwebtoken try `createPublicKey` on the HS secret, which throws, and every request re-hashed each key for its id.
- **Not demonstrated end to end.** Interleaved before/after load runs on this shared host stayed inside its noise. The DB-side figures (plans, buffers) are stable, and the record rests on them, as ADR-096's did.

## Stack

- **Compose project `callib-u06`:** `deploy/compose/docker-compose.yml` + `docker-compose.e2e.yml` + a scratch override.
  - backend: 2 CPU / 4 GiB, `RATE_LIMIT_MAX=100000000`, `BATCH_JOBS_INLINE=true`;
  - postgres: `pgvector/pgvector:pg18` with `pg_stat_statements` and `track_io_timing`;
  - Redis, RabbitMQ and Mailpit; no ClamAV, nginx or frontend. Ports 27230–27232 on 127.0.0.1.
- **Production mode for every measurement.** The demo seed is refused in production (P10-16), so the backend was booted once with `E2E_NODE_ENV=development` to run `/migration/seeding` and `/migration/seed-demo`, then restarted in production. `scripts/load/p807-seed.sql` then ran in psql. Per tenant (demo-alpha, demo-beta): 5,000 devices, 50,000 records, 2.16M `iot_readings` and 500,000 `audit_logs`.
- **Images.** `callib-u06/backend:before` was built from `git archive HEAD` (1100658). `callib-u06/backend:after` was built from a scratch worktree of `dded70c` plus only this change's files, never from the shared working tree, which held other lanes' edits. For profiling, the builder stage of the same Dockerfile ran `node dist/index.js` (with and without `--cpu-prof`) on the stack network.
- **Load generator.** `grafana/k6` (latest) in a container on the same network and the **same desktop Docker host**. That host also ran another lane's CI reproduction (`ci2-*`) at 100–400% CPU throughout, with a load average of 8–13 on 16 cores. **Every figure is a shared-host number, not a production number.**
- **Removed afterwards, by name:** see § Cleanup.

## 1. Baseline (before image)

`scripts/load/p807-baseline.k6.js`, unchanged. The mix is 5 endpoints, random pages 1–400, and every response is checked for the caller's tenant.

| Run | req/s | p95 ms: devices / find / records / audit / dashboard | p50 (devices / records) | p99 (devices / records) |
|---|---|---|---|---|
| 1 VU 45 s | 20.0 | 57 / 66 / 91 / 56 / 113 | 31 / 54 | 77 / 117 |
| 1 VU 45 s (A/B round 1) | 32.9 | 34 / 38 / 55 / 30 / 61 | 19 / 34 | 43 / 64 |
| 10 VU 60 s #1 | 39.0 | 408 / 421 / 438 / 341 / 646 | 181 / 219 | 554 / 566 |
| 10 VU 60 s #2 | 84.5 | 161 / 175 / 188 / 168 / 284 | 85 / 98 | 211 / 232 |
| 10 VU 60 s #3 | 58.1 | 293 / 317 / 340 / 318 / 531 | 115 / 140 | 408 / 491 |
| 10 VU 60 s #4 | 72.7 | 204 / 215 / 227 / 197 / 334 | 97 / 115 | 310 / 311 |
| 10 VU 60 s #5 | 64.4 | 200 / 226 / 234 / 210 / 372 | 117 / 135 | 284 / 340 |
| 10 VU 50 s (thread sample) | 66.7 | 195 / 190 / 227 / 194 / 333 | 112 / 131 | 256 / 270 |
| A/B before r1 | 61.6 | 213 / 240 / 244 / 223 / 402 | 118 / 139 | 304 / 403 |
| A/B before r2 | 87.8 | 172 / 156 / 173 / 153 / 287 | 85 / 98 | 246 / 262 |
| A/B before r3 (contended) | 23.1 | 591 / 642 / 688 / 647 / 1,022 | 306 / 356 | 825 / 926 |

- **Totals:** 0 tenant leaks, 0 × 408, 0 × 429 and 0 × 5xx in every run.
- **A run is "contended"** when the backend's own CPU per request more than doubled: 44.7 ms against 12–17 ms. Contention lowers the CPU a process gets per tick, not the work it has to do.

## 2. Where the time goes

**Threads.** Under 10 VU, per-thread CPU of the backend was sampled from `/proc/1/task/*/stat` over 15–25 s:
- `node-MainThread` was at **99–100%** in three samples;
- the V8 and libuv workers were at 0–1%;
- `docker stats` showed PostgreSQL at **165–191%**.

The event loop is saturated, so latency is queueing in it.

**CPU per request, one endpoint at a time** (4 VU, 30 s, main-thread ticks ÷ requests):

| Endpoint | ms of backend CPU / request | req/s |
|---|---|---|
| `GET /calibration-devices` | 11.4 | 85.9 |
| `GET /calibration-devices?find=` | 11.5 | 84.7 |
| `GET /calibration-records` | **25.5** | 35.7 |
| `GET /audit` | 17.3 | 52.7 |
| `GET /dashboard/metrics` | **43.5** | 20.9 |

**CPU profile.** `node --cpu-prof` was run under the mixed load, and boot was excluded when reading it:
- Sequelize self time was about 20% and lodash about 8% (Sequelize's `cloneDeep` of every options object);
- async_hooks destroy tracking (`registerDestroyHook`, `promiseInitHookWithDestroyTracking`) was about 5%, from `cls-hooked`;
- `jsonwebtoken`'s `createPublicKey` was 1.7%, inside `verifyAccessToken` on every request;
- socket writes (pg, Redis) were about 5%.

**PostgreSQL.** `pg_stat_statements` after the 1 VU run (179–204 calls each). The top statements by total time:

| Statement | mean ms | buffers/call |
|---|---|---|
| dashboard: records count, `is_compliant = true` | 22.5 | 1,510 |
| dashboard: records count | 21.7 | 1,510 |
| records list: `count("CalibrationRecord"."id")` with 3 LEFT JOINs | 21.0 | 1,510 |
| records list: rows, page N | 17.4 | 6,561 |
| devices list `find`: count with the warehouse join | 14.3 | 177 |
| devices list `find`: rows | 7.9 | 103 |

**`EXPLAIN (ANALYZE, BUFFERS)`, alpha tenant, best of two:**
- **Records count:** an Index Scan on `calibration_records_tenant_id`, 50,000 rows, with `Filter: deleted_at IS NULL AND NOT is_deleted AND superseded_by_id IS NULL`. That is 1,510 buffers and 21–44 ms. PostgreSQL had already removed the three LEFT JOINs (join removal), so they cost planning only. The cost is the heap visit per record: no index holds the filtered columns.
- **Records rows, page 200** (`LIMIT 10 OFFSET 1990`): Nested Loop Left Join over 2,000 records, then `Memoize` → `calibration_devices_pkey` 2,000 times. That is 6,592 buffers and 52 ms. The joins ran before the LIMIT, and 1,990 joined rows were thrown away.
- **Devices `find` count:** a 5,000-row filter of three `ILIKE '%…%'`, 177 buffers, 21 ms. The cost is the case-folding CPU (see § Left open).
- **Devices rows, page 400:** an Index Scan on `tenant_id` plus a sort of 5,000 rows, 13 ms.

## 3. The change

**Record list** (`services/calibrationRecords.service.ts#fetchCalibrationRecords`):
- `findAndCountAll` became `Promise.all([count({ where }), findAll({ …, subQuery: true })])`.
- The count has no includes. Each include is a to-one LEFT JOIN, which can neither add nor drop a record, so the total is unchanged.
- The page is selected inside a subquery and joined outside it.
- `count === 0 → rows []` (findAndCountAll's rule) is kept.
- The tenant hooks still add the predicate to the root WHERE (now inside the subquery) and to every include's ON clause.

**Migration `0109-calibration-records-live-index`:**
```sql
CREATE INDEX CONCURRENTLY calibration_records_tenant_live_date ON calibration_records
  (tenant_id, calibration_date DESC) INCLUDE (is_compliant, superseded_by_id)
  WHERE is_deleted = false AND deleted_at IS NULL
```
It follows 0093's pattern: CONCURRENTLY, an INVALID index is rebuilt, no try/catch, and no model declares the index (the ADR-100 Am. 3 trap).

**CLS namespace:**
- `utils/clsNamespace.util.ts` is an AsyncLocalStorage namespace with cls-hooked's `run`/`bind`/`get`/`set` semantics.
- `config/index.ts` installs it with `Sequelize.useCLS`.
- `cls-hooked` was removed from `backend/package.json` and the root lockfile (`npm uninstall --package-lock-only`). Its `async-hook-jl` and `emitter-listener` went with it.

**JWT** (`utils/jwt.util.ts#verificationKeys`):
- Each ring key carries its KeyObject: `createSecretKey` for HS*, `createPublicKey` for RS*/ES*, and a public KeyObject is kept as it is.
- The ring is memoized on the exact environment values it was built from. A rotation therefore applies on the next call, as S-26 requires.

## 4. Evidence

**Identity on PostgreSQL 18.** `verify-records.js` ran in the builder image on the stack network. It ran the pre-change service and the changed one on the same database in the alpha tenant's context, and compared `JSON.stringify` of rows, meta and count. **8 of 8 SAME:**
- pages 1, 200 and 5,001 (past the end);
- `isCompliant=false`, limit 25;
- one device;
- `includeSuperseded`;
- a date range;
- a device with no records (0 rows, total 0).

**Plans after, as `callibrator_app`** (`SET ROLE`):

| Statement | Before | After |
|---|---|---|
| list count | Index Scan `_tenant_id`, 1,510 buffers, 16.6 ms | **Index Only Scan `calibration_records_tenant_live_date`, Heap Fetches 0, 361 buffers**, 10.1 ms |
| list page 200 | 6,592 buffers, 52.5 ms | **622 buffers**, 2.1 ms (no 0109) / 4.5 ms (with 0109, noisy host). `Limit` under the joins; 10 device lookups (30 buffers) |
| dashboard records total | 1,510 buffers, 11.5 ms | Index Only Scan, 361 buffers, 11.7 ms |
| dashboard compliant | 1,510 buffers, 11.3 ms | Index Only Scan, 361 buffers, 8.1 ms |
| dashboard last 30 days | 2 buffers | Index Only Scan, 3 buffers |

The counts still read 50,000 index entries, so their time is CPU-bound at about 8–12 ms. An exact count is O(rows). See § Left open.

**Migration 0109, live on PG 18:**
- Through the migrator, on the loaded database: up (0.94 s) → `indisvalid = t`; down → absent; up → valid; up again → no-op.
- `migrate:verify` ("[schema-verify] OK: 73 tables, 926 columns and 13 control objects").
- **Boot path.** The `after` image booted on a database where 0109 had been taken down, and applied 0109 itself: index valid, "[schema-verify] OK: 74 tables, 927 columns", "Database queries now run as the application role callibrator_app".

**Tests, all new or adapted ones named:**
- `src/tests/services/recordsList.u06.test.ts`, 4 tests: count with no JOIN and `count(*)`, the same WHERE as the page, the tenant predicate present; filters reach both; the subquery shape with LEFT, tenant-scoped joins outside it; no total → no rows.
- `src/tests/migrations/0109-calibration-records-live-index.test.ts`, 8 tests.
- `src/tests/utils/clsNamespace.u06.test.ts`, 9 tests:
  - semantics: outside a context, run/inherit/isolate, concurrent contexts, bind;
  - a REAL Sequelize managed transaction reaching every query inside the callback and none outside, two concurrent transactions isolated;
  - config/index never requires cls-hooked;
  - cls-hooked is not a dependency.
  - **The 7 semantic and Sequelize tests also pass when the namespace is cls-hooked's own** (a scratch swap in the worktree). They pin cls-hooked's behaviour, not merely the new code's.
- `src/tests/utils/jwt.keyMemo.u06.test.ts`, 4 tests, with real jsonwebtoken and real RSA keys: KeyObjects, one per key; rotation applies on the next call and leaves when removed; RS256 with and without `JWT_PUBLIC_KEY`.
- **Fail-before.** The four files were copied into a `git worktree` of `dded70c` (node_modules by junction), with the new util so its semantics could load. Results:
  - **6 of 17 failed**: the two cls-hooked guards, the two KeyObject tests, the count shape and the subquery shape;
  - **8 of 8** migration tests failed: the module did not exist.
  - The 11 that passed there are the preservation tests: semantics, rotation, the RS256 fallback, filters reaching both statements, and no-total-no-rows.
- **Adapted, not weakened:**
  - `calibrationRecords.service.test.js`: the `findAndCountAll` double became `count` + `findAll` doubles through one `listResolves` helper. Same 32 tests, same names, and every where/limit/offset/include assertion now reads `findAll`'s options.
  - `jwt.test.js`: two assertions expected the string secret to reach `verify`. They now check that the KeyObject's bytes are that secret. Same names, same count.

**Gates on the changed files:**
- `npx eslint`: clean on all 12 files.
- `npm run typecheck`: none of its errors are in this change's files. The two reported errors come from other lanes' uncommitted edits: `attachment.controller.ts`, `storage.controller.ts` and `bodyShapes.w10.test.ts`.
- `npm run ratchet`: 695 `.js` files, at the floor.
- `npm run build:dist`: 610 TypeScript files.
- `TSX_DISABLE_CACHE=1 npm run load:check`: "OK (dist via node)", 600 modules + 105 in boot order. With `-- --src`: "OK (src via tsx)".
- Full `npm run test:coverage -- --ci`: see § Coverage.

## 5. After — the same script, interleaved with the before image

Each round swapped the backend image on the same database. "before" dropped 0109 first, and "after" booted and applied it. `VACUUM ANALYZE calibration_records` ran before each round. Each round had a 15 s warm-up at 4 VU, then 60 s at 10 VU.

| Round | Image | req/s | p95 ms: devices / find / records / audit / dashboard | backend CPU ms/req |
|---|---|---|---|---|
| 1 | before | 61.6 | 213 / 240 / 244 / 223 / 402 | 17.0 |
| 1 | after | 94.1 | 160 / 168 / 167 / 149 / 295 | 11.6 |
| 2 | before | 87.8 | 172 / 156 / 173 / 153 / 287 | 12.2 |
| 2 | after | 79.1 | 192 / 196 / 196 / 190 / 339 | 13.7 |
| 3 | before (contended) | 23.1 | 591 / 642 / 688 / 647 / 1,022 | 44.7 |
| 3 | after (contended) | 26.9 | 578 / 625 / 578 / 577 / 935 | 40.7 |

- **At 1 VU:** before 34–91 ms p95 on the lists; after 79–91 ms in one run taken at a busier moment.
- **0 tenant leaks, 0 × 408 / 429 / 5xx** in every run.
- **What this shows.** The after image is never worse beyond the noise, and it was better in round 1. Round 2 reversed it, and round 3 shows the host, not the code. **This record does not claim an end-to-end p95 improvement.**

**The service-path microbenchmark** (`bench-cls.js`) ran the REAL records and devices list services with the tenant hooks, 10 in flight and the database a double, in CPU ms per iteration:
- `cls-hooked` vs AsyncLocalStorage (same service), four interleaved pairs: 8.21 → 6.76, 5.59 → 5.29, 5.95 → 5.28, 10.94 → 6.24. The ALS namespace was lower in all four.
- before vs after (whole change), five pairs: 6.59 → 4.14, 3.87 → 4.05, 5.15 → 5.40, 5.24 → 8.58, 7.23 → 4.58. That is inconclusive.

## 6. The paths the baseline never measured

`scripts/load/u06-search-document.k6.js` (new), 10 VU, 60 s, same stack:
- global search runs as the load tenants. Every device result is checked for the caller's serial prefix.
- the certificate document (`GET /certificates/:id/document`) runs for the default tenant's three demo certificates.

| Image | search p95 | document p95 | req/s |
|---|---|---|---|
| before, 1 VU 30 s | 103 ms | 94 ms | 19.7 |
| before | 646 · 208 · 193 · 558 ms | 345 · 107 · 104 · 306 ms | 40–130 |
| after | 241 · 622 · 348 ms | 126 · 322 · 189 ms | 49–93 |

- 0 tenant leaks and 0 × 5xx.
- **Search is under 500 ms p95 in 4 of 7 runs at 10 VU. Not met.** Each search runs three FTS statements, and a dynamicAccess probe per type. A broad term (`Maker`) ranks all 5,000 of a tenant's devices: an Index Scan on `tenant_id` plus a top-N sort, 11 ms. The GIN index is used only for selective terms.
- **The certificate document is far inside its 5 s budget** (AC-33 is about render time; the document is HTML since ADR-095).

## Coverage

`npm run test:coverage -- --ci`, Node 26.10.0, on the shared working tree with other lanes' uncommitted edits: **886 suites passed, 37 skipped, 0 failed; 15,016 tests passed, 246 skipped; exit 0 (every 100% threshold met)**, 2026-10-05. An earlier run that day reported `clsNamespace.util.ts` at 50% branches. A comment in that file was edited while the run was going, which shifted its line map; the file is 100% alone and in the re-run. That earlier run is not counted.

## Left open

- **The p95 target needs an uncontended host to be decided.** On this host, 10 VU met it in 8 of 9 baseline runs and 2 of 3 after-runs, and every miss was a contended run. A run from a separate load-generator host, or a dedicated one, is still owed (P8-07).
- **Horizontal scale is now the lever.** One backend process uses one core: the container is limited to 2 CPU and uses about 1. PostgreSQL has headroom (about 190% of 16). A second replica, which added nothing in P8-07 when PostgreSQL was saturated, should now add throughput. It was not measured here.
- **Dashboard, 43.5 ms of CPU per call, about 40% of the mix's CPU.** A short per-tenant cache (its payload already carries `generatedAt`) is the obvious fix. It changes freshness, which is a contract decision, so it was not made here.
- **Exact counts are O(rows):** 8–12 ms at 50,000 records even index-only. ADR-096's cap or an estimate would bound them, and both change `meta.total`. Not needed at today's volume.
- **The devices `find` filter** is three leading-wildcard `ILIKE`s, at 14–21 ms for the count. A `pg_trgm` GIN index would serve it. Not done: it needs the extension.
- **Ordering ties.** The record list orders by `calibration_date` only, and the seed has 5,000 records per date. The new page and the old one returned the same rows in all 8 identity cases, but a tiebreaker (`id`) would make paging deterministic. That is a separate, visible change.
- **Global search p95** (above).

## Cleanup

Removed by name at the end:
- containers `callib-u06-*` (the compose project with `down -v`, plus `callib-u06-prof`, `callib-u06-ab`, `callib-u06-bench`);
- images `callib-u06/backend:before`, `:after` and `callib-u06/backend-builder:before`;
- the scratch worktree (`git worktree remove`).

`grafana/k6:latest` was pulled for this run and removed afterwards. No prune was run.
