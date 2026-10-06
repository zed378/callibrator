# 2026-10-05 — U-06b: the dashboard is cached for 30 s per scope; search reads its permissions once and only its tenant's matches; 0109 no longer crash-loops the boot

**ADR:** [ADR-120](../DECISIONS.md) · **Task:** `TASKS/BACKLOG.md` U-06 (follow-on to [ADR-119](../DECISIONS.md), [record](./2026-10-05-u06-list-performance.md)) · **Migrations:** `0110` (new), `0109` (fixed before release) · **Tree:** `dded70c` + U-06's runtime files (the "before"), + this change (the "after"); images built from a scratch worktree, never from the shared working tree.

## Summary

- **Dashboard (decided by the coordinator under the owner's delegation):**
  - **Cache.** A per-scope cache of the aggregates, 30 s TTL, in Redis, with an in-process LRU fallback. It is never shared across tenants, and a cache failure never fails the request.
  - **Page.** It shows "Updated at / Diperbarui pukul HH:MM:SS" from `data.generatedAt`.
  - **10 VU, dashboard only, uncontended:**

    | | Before | After |
    |---|---|---|
    | p95 | 197–344 ms | **61–64 ms** |
    | Backend CPU per request | 11.6–17.4 ms | **3.4–3.7 ms** |
    | Throughput | 60–88 req/s | **286–316 req/s** |
    | PostgreSQL statements per request | 23.1 | **2.05** |
- **Global search.** The task's premise (leading-wildcard `ILIKE`, sequential per-type queries) did not hold: search runs full-text search, concurrently, each statement limited. The measured costs were:
  - **Six permission loads per request** (13.0 Redis GETs per search). Now 1 (**3.0 GETs**).
  - **Every tenant's matches read** by 0003's GIN index. Now a per-tenant `(tenant_id, search_vector)` GIN index (btree_gin, migration 0110); a selective term reads only the caller's matches.
  - **End to end on this host, search is inside the noise.** Before: p95 78–90 ms at 10 VU, search only. After: 53–182 ms. **It meets < 500 ms in every run of both images** (18 runs at 10 VU, 0 × 5xx, 0 tenant leaks). U-06's 193–646 ms was host contention.
- **A boot crash-loop in U-06's migration 0109, fixed before release.**
  - Its `INCLUDE (...)` index broke Sequelize's `showIndex`, which `db.sync()` runs at every boot. The cause was in Sequelize's parser and was proven with it.
  - 0109 now uses key columns; the counts stay index-only.
  - A guard runs the real parser over every migration index.

## Stack

- **Compose project `callib-u06b`:** `docker-compose.yml` + `docker-compose.e2e.yml` + a scratch override.
  - backend: 2 CPU / 4 GiB, `RATE_LIMIT_MAX=100000000`, `BATCH_JOBS_INLINE=true`;
  - postgres: `pgvector/pgvector:pg18` with `pg_stat_statements` and `track_io_timing`;
  - Redis, RabbitMQ and Mailpit. Ports 27250–27252 on 127.0.0.1.
- **Seed.** Booted once in development to run `/migration/seeding` and `/migration/seed-demo`, then `scripts/load/p807-seed.sql` (per load tenant: 5,000 devices, 50,000 records, 2.16M iot readings, 500,000 audit rows). Every measurement ran in production mode.
- **Images.**
  - `callib-u06b/backend:before`: a `git worktree` of `dded70c` plus U-06's runtime files (`calibrationRecords.service`, `0109`, `clsNamespace.util`, `config/index`, `jwt.util`, `migrator`).
  - `callib-u06b/backend:after`: the same plus this change, with the worktree's `openapi.json` regenerated.
  - For the CPU profile, the builder stage ran `node --cpu-prof dist/index.js` on the stack network.
- **Load generator.** `grafana/k6` on the same network, on the **same desktop Docker host**. Other containers' CPU was sampled at every round's start and end (below). Unsampled load outside Docker (other lanes' jest and `next build` on Windows) is visible only as a jump in the backend's CPU per request.
- **The stack was rebuilt once.** The coordinator paused all lanes mid-run; the stack was removed with `down -v` and rebuilt with the same seed on resumption.

## 1. Where search's time went (before image)

**`pg_stat_statements` per search request** (1 VU, 1,131 requests). There are 5 statements:
- the user load (`auth`, with includes), 0.09 ms;
- `tenant_settings`, 0.02 ms;
- three full-text statements: devices 1.57 ms mean, stocks 0.03 ms, certificates 0.02 ms.

The database is ~1.8 ms of a request.

**`node --cpu-prof`** under 10 VU, search only, boot excluded:
- Sequelize 21% self, mostly `auth`'s user load and common to every route;
- lodash 6.6%;
- Redis `get` 14% inclusive. Of that, **`loadPermissionSources` was 8.3%**: the role matrix and the override matrix, read and JSON-parsed 6 times per search.
- The search controller was 9.3% inclusive.
- Logging (winston, morgan) about 6%; response serialisation and compression about 6.5%.

**Redis `INFO commandstats`:** 4,838 GETs for 372 searches, **13.0 per request**. That is 1 session read plus 6 × (role matrix + overrides).

**Plans as `callibrator_app`, alpha tenant:**

| Term | Before (0003's GIN) |
|---|---|
| `infusion` | Bitmap Index Scan on `idx_calibration_devices_search`: 2,000 rows, **343 heap blocks, Rows Removed by Filter: 1000** (the other tenant's), 1.8–2.5 ms (TIMING OFF), 11 ms cold |
| `Maker` (all 5,000) | Bitmap scan on `calibration_devices_tenant_id`, top-N sort of 5,000 `ts_rank`s, 4–12 ms |
| `Device 00012` | GIN, 2 rows → 1, 2 heap blocks |
| `DEMO` | 0 rows: `DEMOA-12` is the token `demoa`, and full-text search does not prefix-match (a relevance gap, not a cost) |

## 2. The change

- **`services/dashboardCache.service.ts`** (new), used by `controllers/dashboard.controller.ts`:
  - Redis `SETEX` with a 30 s TTL. The fallback is a 500-entry in-process LRU when Redis is not ready or a command throws.
  - Concurrent misses for one key share one computation (single flight).
  - Keys are `dashboard:metrics:v1:tenant:<own>:<own>` and `…:platform:<tenant|global>`. A non-UUID target is not cached.
  - `dashboard.openapi.ts` documents `generatedAt` as "computed at, up to 30 s before the response". `openapi.json` and the frontend `schema.d.ts` were regenerated.
- **`frontend/src/app/dashboard/components/DashboardUpdatedAt.tsx`** (new), rendered under the hero:
  - "Updated at HH:MM:SS" / "Diperbarui pukul HH:MM:SS", local time, in a `<time dateTime>`.
  - The language comes from the `locale` cookie, and `lang` is set on the element.
  - The two strings live in the component, not the dictionaries: the dashboard is English until Phase 11 (ADR-098 §4), and the dictionaries were another lane's files today.
- **`middlewares/dynamicAccess.middleware.ts`:** one `loadPermissionSources` per request (a `WeakMap` keyed by the request, used only for the same principal object).
- **`controllers/search.controller.ts`:** the type probes run concurrently. Each still goes through `dynamicAccess(<menu>, "read")` (A-04), and `next(err)` still denies (A-13).
- **Migration `0110-search-tenant-gin`:**
  - `CREATE EXTENSION IF NOT EXISTS btree_gin`;
  - per table, `CREATE INDEX CONCURRENTLY <t>_tenant_id_search_vector … USING gin (tenant_id, search_vector)`, then `DROP INDEX CONCURRENTLY IF EXISTS idx_<t>_search`;
  - `down` restores 0003's indexes first and keeps the extension.
- **Migration `0109`** (unreleased, ADR-119): `INCLUDE (is_compliant, superseded_by_id)` became trailing key columns.
- **`deploy/helm/callibrator/values.yaml`:** a note naming the one-time `CREATE EXTENSION btree_gin` step for a database user that is neither the owner nor holds CREATE.

## 3. The 0109 boot crash

**Observed.** On the first production restart of the before image, every boot logged `TypeError: Cannot read properties of undefined (reading 'match')` at `sequelize/lib/dialects/postgres/query.js:111`, inside `showIndex` ← `CalibrationRecord.sync` ← `migrationLock.util`, then "Failed to start server". The server crash-looped.

**Cause.**
- The catalog row was `indkey = "2 6 11 18"` with the definition `… USING btree (tenant_id, calibration_date DESC) INCLUDE (is_compliant, superseded_by_id) WHERE ((is_deleted = false) AND (deleted_at IS NULL))`.
- Sequelize splits the text between the first `(` and the last `)` on commas. That gives 3 pieces against 4 index keys, and piece 4 is undefined.
- U-06 applied 0109 at the end of a boot and never booted again.

**Fix.** The definition `(tenant_id, calibration_date DESC, is_compliant, superseded_by_id) WHERE …` gives 4 pieces. The backend booted on it. The counts are still Index Only Scans with Heap Fetches 0 (63 and 47 buffers, about 7 ms, alpha tenant).

**Guard.** `src/tests/migrations/indexDefinitionSync.u06b.test.ts` drives Sequelize's real postgres `Query` over a connection double that returns the catalog row exactly as PG 18 rendered it:
- the INCLUDE form throws;
- 0109 as built parses;
- 0110's three indexes parse;
- no migration contains `) INCLUDE (`.

## 4. Evidence

### Tests (new or adapted, all named)

**Backend:**
- `src/tests/services/dashboardCache.u06b.test.ts` (16):
  - key isolation;
  - two tenants alternating while cached, with Redis up and with it down;
  - the platform view kept apart from the tenant view;
  - a tenant's `?tenantId=` ignored;
  - the TTL on Redis and on the fallback (fake clock at 29.999 s and 30 s);
  - a Redis read or write throwing (still 200);
  - a failed computation is not cached;
  - single flight;
  - a non-UUID target is not cached;
  - LRU eviction.
- `src/tests/controllers/search.permissionLoads.u06b.test.ts` (6): the REAL gate, controller and service.
  - 1 role-matrix and 1 override load per search;
  - A-04 types and tables;
  - the next request reloads (a changed grant applies);
  - a replaced principal is not served from the memo;
  - a failed load denies, and the next request retries;
  - no menus → 403 with one load.
- `src/tests/migrations/0110-search-tenant-gin.test.ts` (10) and `src/tests/migrations/indexDefinitionSync.u06b.test.ts` (4).

**Frontend:**
- `src/app/dashboard/components/DashboardUpdatedAt.test.tsx` (5);
- `src/app/dashboard/__tests__/page.test.tsx`: +1 case, "U-06b: says when the figures were computed".

**Adapted, not weakened:**
- `dashboard.controller.test.js` and `dashboardMetrics.gate.a304.test.ts`: `clearDashboardCache()` in `beforeEach`, so every case still observes its service call. No assertion changed.
- `0109-calibration-records-live-index.test.ts`: the expected DDL is the key-column form.

### Fail-before

The new tests ran in the scratch worktree reset to the before state: the old controllers and middleware, the INCLUDE 0109, and no 0110.

**21 of 36 backend tests failed:**
- 7 cache cases: the TTL ×3, the fallback, single flight, the platform/tenant key split, and the write-throws case;
- 3 search cases: the load count, the reload count, and the 403 load count;
- the `INCLUDE` guard;
- the 10 cases of 0110 (module absent).

**The 15 that passed are preservation tests:**
- tenant isolation (which holds with no cache too);
- A-04;
- the failed-load denial;
- the parser cases, including "the INCLUDE form throws".

**Frontend:** the page case failed on the old `page.tsx`; 8 of 9 cases passed.

**Related suites:** every suite naming `dynamicAccess`, `search.controller` or `search.service`, 115 suites and 1,827 tests, passed after the change.

### Live, PostgreSQL 18

- **0110 up** at the after image's boot: 0.329 s; three indexes `indisvalid = t`; 0003's gone; `btree_gin` installed.
- **A reboot:** healthy, no "Failed to start" (Sequelize's showIndex parsed the GIN definitions).
- **Down** through the migrator (`src/scripts/migrate.ts down` from the host, through a temporary TCP proxy to the stack's PostgreSQL): reverted in 0.11 s; `idx_*_search` back and valid; the extension kept.
- **Up again** at the after image's next boot: 0.354 s.
- **`migrate up` no-op;** `migrate:verify`: "[schema-verify] OK: 73 tables, 926 columns and 13 control objects" (the boot's own check said 74 / 927, as in U-06).
- **The before image** booted on a database where 0110 was recorded applied (an executed name it does not know): healthy.
- **btree_gin and a non-superuser owner** (scratch database, same server):
  - a `NOSUPERUSER NOCREATEDB` role owning the database ran `CREATE EXTENSION IF NOT EXISTS btree_gin` and built a `(uuid, tsvector)` GIN index CONCURRENTLY: OK;
  - a role that is neither the owner nor holds CREATE got `ERROR: permission denied to create extension "btree_gin"` with `HINT: Must have CREATE privilege on current database`. The migration has no catch, so it fails and is not recorded. The operator step is named in the Helm values and the migration header.
  - The scratch roles and database were dropped.

### Plans after 0110 (`callibrator_app`, alpha tenant, TIMING OFF)

| Term | After |
|---|---|
| `Device 00012` | **Bitmap Index Scan on `calibration_devices_tenant_id_search_vector`, 1 row, 1 heap block**, 0.9 ms (before: 2 rows, 2 blocks) |
| `M1` | composite GIN, **100 rows, 100 heap blocks** (the tenant's only) |
| `infusion` (1,000 of the tenant's 5,000) | the planner prefers `calibration_devices_tenant_id` + filter: 177 buffers, the tenant's rows only, **none of the other tenant's**, 1.5–2.8 ms |
| `Maker` | the same b-tree plan, 4.8–7.9 ms: `ts_rank` over 5,000 matches (unchanged; see § Left open) |

### Redis GETs per search request (1 VU, `INFO commandstats` after `CONFIG RESETSTAT`)

| Image | GETs | Requests | Per request |
|---|---|---|---|
| before | 4,838 | 372 | **13.0** |
| after | 2,052 | 680 | **3.0** |

### PostgreSQL statements per dashboard request (10 VU, 30 s, `pg_stat_statements` after a reset; both runs on a loaded host)

| Image | Statements | Requests | Per request | The `stock_opnames` count statement |
|---|---|---|---|---|
| before | 20,104 | 870 | **23.1** | 870 calls |
| after | 4,232 | 2,060 | **2.05** | **2 calls** (one per tenant per 30 s window) |

## 5. Before / after, end to end

Each round:
- `run.sh`: k6 at 10 VU for 60 s, with the backend's CPU from `/proc/1/stat`;
- after a 15 s warm-up at 4 VU;
- other containers' CPU sampled at each round's start and end.

**Order:**
- B1, B2 (before);
- A1, A2, A3 (after; 0110 up);
- 0110 down → B3 (before);
- 0110 up → A4 (after).

| Round | Image | Others' CPU (start → end) | search only: p95 / CPU ms per req / req/s | search + document: p95 search / document | dashboard only: p95 / CPU ms / req/s | P8-07 mix: dashboard / lists p95 |
|---|---|---|---|---|---|---|
| B1 | before | 8% → 1% | 88 / 5.1 / 208 | 149 / 82 | 258 / 14.4 / 71 | 232 / 136–144 |
| B2 | before | **363%** → 7% | 88 / 5.3 / 199 | 117 / 62 | 197 / 11.6 / 88 | 189 / 110–122 |
| A1 | after | 8% → 53% | 130 / 6.7 / 160 | 84 / 85 | **64 / 3.7 / 286** | **131** / 138–163 |
| A2 | after | **375%** → 2% | 133 / 6.2 / 166 | 108 / 108 | **61 / 3.4 / 316** | **165** / 187–210 |
| A3 | after | 1% (end) | 71 / 4.3 / 245 · 53 / 3.5 / 301 | — | — | — |
| B3 | before | 23% (end) | 78 / 4.6 / 232 · 90 / 5.4 / 199 | — | 344 / 17.4 / 60 | — |
| A4 | after | 39% (end); 1-VU CPU per request doubled → **contended** | 115 / 6.4 / 169 · 182 / 8.0 / 133 | — | 183 / 8.8 / 119 | — |

- **Totals: 0 tenant leaks, 0 × 5xx and 0 failed checks in every run.**
- **Dashboard.** Clearly better: about 4× the throughput and a third of the latency. Even A4, on a visibly contended host, beat every before run.
- **Search.**
  - Every run of both images is under the 500 ms target.
  - The A/B difference is inside this host's noise. The same image's search-only p95 moved 53–182 ms with no code change, and the backend's CPU per request moved 3.5–8.0 ms with it.
  - **No end-to-end search gain is claimed.** The mechanism is the evidence: 13 → 3 Redis GETs, and the plans.
- **P8-07 mix.** A2's lists (187–210 ms) are worse than B2's. A2 started on a host at 375% other-container CPU; A1's lists were 138–163. Not attributed to the change.
- **Contention after the rebuild.** The last runs (A4 and the statement-count runs) went with load outside Docker. The 1-VU backend CPU per request was 20–40 ms, against 11 ms on a quiet host.

## Gates

All on the shared working tree, with other lanes' uncommitted edits.

**Backend:**
- `npx eslint`: clean on the 14 changed backend files.
- `npm run typecheck`: 0 errors.
- `npm run ratchet`: 695 `.js` files, at the floor.
- `npm run build:dist`: 612 TypeScript files.
- `TSX_DISABLE_CACHE=1 npm run load:check`: "OK (dist via node)". With `-- --src`: "OK (src via tsx)". 105 modules in boot order.
- `openapi:check`: current. `openapi:lint`: no new error (15 warnings, as before).
- **`npm run test:coverage -- --ci`** (Node 26.10.0): **890 suites passed, 37 skipped; 15,052 tests passed, 246 skipped; All files 100 / 100 / 100 / 100; exit 0**, in 629 s on a busy host.

**Frontend:**
- `npm run typecheck`: 0 errors.
- `npx eslint` on the 5 changed files: clean.
- `npm test -- --ci`: 295 suites, 3,107 tests passed; coverage 93.93 / 84.74 / 89.6 / 94.56 against the 90 / 81 / 86 / 91 gate; exit 0.
- `api:types` regenerated.
- `npm run build` (`next build`): OK.

## Left open

- **A dedicated-host run.** Every figure here is from a shared desktop host. The search A/B needs one to show an end-to-end effect, if any.
- **Broad-term ranking.** `Maker` ranks all 5,000 of a tenant's matches (4–12 ms in PostgreSQL). It is bounded by the tenant now, not the platform. Capping the candidate set would change which rows a broad search returns: a relevance decision, not made.
- **Prefix and partial matches.** `DEMO` finds no `DEMOA-12`. Full-text search tokenises the serial whole. A `pg_trgm` or prefix (`:*`) search would change results, so it is a product decision. The device list's `find` (`ILIKE`) is unaffected and still open from ADR-119.
- **The rest of the backend's per-request cost is common to every route.** `auth`'s user load with includes (Sequelize, about 15%), logging (about 6%) and compression. That and replicas are the next levers (ADR-119).
- **Dashboard invalidation on write.** Not done; 30 s is the bound (ADR-120).

## Cleanup

Removed by name at the end:
- the compose project `callib-u06b` (`down -v`: containers, volumes, network);
- `callib-u06b-prof`, `callib-u06b-pgproxy`;
- images `callib-u06b/backend:before`, `:after`, `callib-u06b/backend-builder:before`, `alpine/socat`, `grafana/k6:latest` (pulled for this run);
- the scratch worktree: its `node_modules` junctions removed with `rmdir`, then `git worktree remove`.

No prune was run.
