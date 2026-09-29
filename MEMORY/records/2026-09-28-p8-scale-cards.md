# 2026-09-28 — Phase 8: the migration lock (P8-03), the first load baseline (P8-07), and the other cards' dispositions

**ADR:** [ADR-086](../DECISIONS.md) · **Cards:** P8-03 (done), P8-07 (partial), P8-02 (partial), P8-04/05/06 (triggers evaluated), P8-01/P8-08 (blocked) · **Tree:** `35ebd76` plus the working tree. Part of P8-03 reached `a31c601` unverified, when the session limit stopped the agent; it was verified here.

## P8-03 — schema step under an advisory lock

**Changed**

| File | What |
|---|---|
| `backend/src/utils/migrationLock.util.js` (new) | `withSchemaLock` holds a session advisory lock on a raw connection. A waiting instance polls and refuses the boot after `MIGRATION_LOCK_TIMEOUT_MS`. `runSchemaSetup` runs sync + migrations under that lock |
| `backend/index.js` | the boot calls `runSchemaSetup` instead of a bare `db.sync()` / `migrator.up()` |
| `backend/src/scripts/migrate.js` | `up` and `down` take the same lock; `pending` and `executed` do not; a lock timeout gives exit code 1 |
| `docs/DATABASE/13-MIGRATIONS.md` § Startup Behaviour | states the lock and ADR-086 |

**Tests**
- `src/tests/utils/migrationLock.p803.test.js`: 17 tests, 100% of the util.
- `src/tests/utils/migrationLock.p803.live.test.js`: opt-in with `MIGRATION_LOCK_LIVE_TEST=1` and a database whose
  name contains "scratch". 4 of 4 passed on PostgreSQL 18.6 (`pgvector/pgvector:pg18`):
  - "two instances starting simultaneously produce ONE migration run; the other waits and applies nothing"
  - "the run is verified by inspecting columns (P6-05), not by the migration log"
  - "the lock is free afterwards — a third boot takes it at once and applies nothing"
  - "`npm run migrate` (scripts/migrate.js up) WAITS for a held lock, then runs and exits 0"

**Fail-before** (`git worktree add <scratchpad>/p8/wt HEAD`, removed afterwards; the node_modules junction was
removed with `rm` on the link):
- HEAD's unlocked boot step, run by two instances at once: all three boot cases fail, and one instance throws
  `relname must be unique` inside `db.sync()`.
- At `35ebd76`, the migrate-CLI case fails with `Expected: "still-waiting", Received: 0`.

**Real replicas.** Two replicas of the image built from the working tree, started together on an empty PostgreSQL 18:
- `backend-2` logged `Applied 63 migration(s)`.
- `backend-1` logged `[migration-lock] another instance is migrating the schema; waiting…`, then
  `lock acquired after waiting` 4 s later, and applied nothing.
- Both logged `[schema-verify] OK: 72 tables, 867 columns and 8 control objects`.
- `schema_migrations` had 63 rows, 63 distinct.

## P8-07 — baseline

**Stack** (scratch compose project `callib-p8`, torn down afterwards):
- the backend image ×2 (2 CPU / 4 GiB each), PostgreSQL 18 and Redis;
- nginx with `deploy/compose/nginx/vm-http.conf`, and a stub frontend upstream;
- `NODE_ENV=production`, `RATE_LIMIT_MAX=100000000`, `BATCH_JOBS_INLINE=true`, no RabbitMQ.

**Data:** `scripts/load/p807-seed.sql` over the demo seed. Per tenant: 5,000 devices, 50,000 records,
2.16M `iot_readings`, 500,000 `audit_logs` (1,570 MB of readings and 306 MB of audit in total).

**Load:** `scripts/load/p807-baseline.k6.js`, run with `grafana/k6` in a container. Every response is checked for
the caller's tenant (row `tenantId`, `meta.total`, the dashboard's device total).

| Run | Requests | p95 (devices / search / records / audit / dashboard) | req/s |
|---|---|---|---|
| 1 VU, 45 s | 1,082 | 49 / 54 / 56 / 140 / 64 ms | 23 |
| 10 VU, 60 s | 2,235 | 576 / 603 / 616 / 732 / 613 ms | 37 |
| 25 VU, 60 s (two runs) | 1,324 · 2,911 | 1.64 s / … · 792–922 ms | 21 · 47 |
| 50 VU, 120 s / 60 s | 7,801 · 2,592 | 1.01–1.71 s | 64 · 41 |
| 50 VU, **two replicas**, 60 s | 3,188 | 1.81–2.22 s | 51 |

**Totals:** 35,963 requests over 15 runs.
- **0 tenant leaks**, 0 × 408, 0 × 429, 0 failed requests.
- 0 connection acquire timeouts in either replica's log (a `grep` for "408" matched only durations).
- Backend memory stable at 320–345 MiB.

**Where the time goes**
- CPU under two-replica load: each Node process at 100–130%, PostgreSQL at **790–940%**.
- `pg_stat_activity` sampled 15 × during load: the audit list's `count(...)` was 39 of 72 active queries.
- `EXPLAIN (ANALYZE)` of that count is a parallel sequential scan of 500,000 rows with 3 workers, taking **67 ms**.

**Dashboard fan-out vs. the pool.** `getDashboardMetrics` issues 20 queries in one `Promise.all`; the pool is 20.
Measured with 10 users each, on one replica:

| Pool | Device p95, alone | Device p95, with dashboard traffic | Combined req/s |
|---|---|---|---|
| 20 | 320 ms | 726 ms | 60 → 37 |
| 60 | 360 ms | 574 ms | 47 |

It is recorded as a finding, not fixed. Bounding the fan-out, or sizing the pool against it, is a capacity decision,
and PostgreSQL is already the saturated resource.

**Not measured**
- PDF memory: the image cannot render certificate PDFs (M-11).
- MQTT ingest: not run. The card's "broker shares the API process" premise is stale (A-17).
- Absolute numbers are a lower bound: the load generator shared a desktop Docker host with the stack.

## Dispositions (ADR-086 §2–3)

| Card | Disposition |
|---|---|
| P8-01 | BLOCKED. It needs a target S3/NFS environment and an ambient credential chain. A-40 is done |
| P8-02 | PARTIAL. Open: the fan-out test after a reconnect, and a live notification through the proxy |
| P8-04 | The trigger fired in part. Decided, by debate: query-shaped fixes first (bounded/estimated counts, an audit date window), a replica only if p95 still fails |
| P8-05 | Not triggered |
| P8-06 | Not triggered; the cost is an exact count, which partitioning does not bound. Also waits on Q-03 |
| P8-08 | BLOCKED on a customer data-residency requirement |

## Left open
- The P8-04 query work: bounded counts on the audit, records and devices lists, and a default audit window.
- P8-02's two open items.
- P8-07's PDF-memory and MQTT-ingest measurements.
- A load run from a separate host.
