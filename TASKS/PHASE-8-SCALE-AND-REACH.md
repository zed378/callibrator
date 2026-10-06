# Phase 8 — Scale and Reach

**Every task here is trigger-driven, not scheduled.**

Building any of it before its trigger fires is infrastructure to maintain for a problem nobody has measured. The point of writing them down now is that the triggers are known and the prerequisites are ordered — not that the work is due.

---

## The Horizontal Scaling Prerequisites

**P8-01, P8-02 and P8-03 are the hard prerequisites for more than one backend replica.** None is difficult. They simply have to happen **before** replica count goes above one, not after somebody notices duplicated backups.

The Helm chart guards one of the four (schedulers). The other three fail **quietly**.

---

### P8-01 — Object storage off local disk

| | |
|---|---|
| **Status** | ✅ **DONE in code** (2026-10-05, ADR-086 Amendment 1, [record](../MEMORY/records/2026-10-05-p8-01-storage-cutover.md)) · 🚫 **BLOCKED only on the production target**: a production S3 bucket or NFS export and the **ambient credential chain** (IAM role / service account), which the owner or operator provides. (2026-09-28 it was BLOCKED outright, ADR-086 §2.) |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-40 |

> **What changed (2026-09-23):** **A-40** found two things that land inside this card's
> assumptions. The storage driver cache is **per process**, so a driver change does not propagate
> across replicas — the very configuration this card performs. And the migration tool reports a
> copy as `migrated` **without verifying it** when the checksum is null, so "existing objects
> migrated with `npm run migrate:storage`" is currently a claim the tool makes rather than one it
> proves.

**Why:** `STORAGE_DRIVER=local` and more than one replica are **incompatible**. Replica A writes an attachment, replica B serves the download, and the object is not there.

~~The abstraction already exists — this is a configuration change plus a migration of existing objects, not new code.~~ **Wrong (U-09, 2026-10-05):** no request path used the abstraction; every file was written to and served from the host's disk whatever `STORAGE_DRIVER` said. **Built 2026-10-05 (ADR-086 Am. 1):** every stored file goes through `services/storage` — attachments, certificate PDFs, the public image class, tenant backups, GDPR exports — with files written before the cut-over read from their legacy paths until `migrate:storage` copies them.

**Definition of Done**
- [x] A-40 closed first: the driver cache is not per process, and a null-checksum copy is **verified**, not reported. DONE 2026-09-25 (ADR-057)
- [x] **every stored file goes through the storage layer** (the premise the card assumed; ADR-086 Am. 1). Identity on the default `local` driver: `routes/storedFiles.identity.p801.test.ts`
- [ ] `STORAGE_DRIVER=s3` or `nfs` in the **production** target environment — **owner/operator**. In a reproduced target: SeaweedFS, `scripts/storage/p801-live-check.sh` 44/44 (2026-10-05)
- [ ] existing objects migrated with `npm run migrate:storage`, **and the count of objects verified at the destination** — done on the reproduced target (the bucket's own listing, `p801-app-path-check.ts`); **owed on production data**. The tool now copies attachments, certificate PDFs, backups and public images (audited backfills)
- [ ] S3 credentials from the **ambient chain** (IAM role / service account), not static keys in a Secret — **owner/operator**; every run here used static keys
- [x] a test: an attachment written by one instance downloads through another — on the reproduced target the backend wrote to the bucket and the check read the object back from the bucket with its own client and through the backend after the legacy files were deleted (`p801-app-path-check.ts`); one backend process, so a two-replica run on production stays part of the box above
- [ ] `STORAGE_S3_PREFIX` understood as a convenience, **not an isolation boundary**

---

### P8-02 — Socket.IO Redis adapter

| | |
|---|---|
| **Status** | 🟡 **PARTIAL** (2026-09-28, ADR-086). The adapter and the cross-replica test are done (A-54), and open-socket revocation is done (ADR-085). **Open:** the fan-out test after a reconnect, and a live notification through the reverse proxy |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/FRONTEND/06-REALTIME.md` · ADR-031 · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-54, A-53, A-52, A-05 |

> **What changed (2026-09-23):** the audit verified this card from the code and the Helm values
> (**A-54**). The server is constructed with the **default in-memory adapter**; neither
> `@socket.io/redis-adapter` nor `socket.io-redis` is a dependency. That is consistent with
> `backend.replicaCount: 1`, and it is a **hard blocker on ever raising it** — sticky sessions do
> not help, because the emit happens server-side, not per client.
>
> Worth recording next to it: **A-30 made the rate limiter replica-safe** (it never used Redis
> before, so lockouts reset on every deploy). The limiter is ready for more than one replica now
> and the realtime layer is not, which makes this card the remaining one of the three
> prerequisites that is a code change rather than configuration.
>
> `config/socket.js` was substantially rewritten on 2026-09-23 under A-05 (`origin: "*"`, the token
> in the query string, no status or suspension check). **Two findings remain open against it** and
> both touch this card's Definition of Done: **A-53** — a reconnected socket never re-joins its
> board rooms, so live updates stop silently — and **A-52** — the socket token's `purpose: "socket"`
> claim is read nowhere, so it is an ordinary access token. A fan-out test written before A-53 is
> fixed can pass on the first connection and be wrong on every reconnect.

**Why:** without it, a notification reaches **only the replica holding that client's connection**. Which users hear about an event becomes a function of load balancing.

**Definition of Done**
- [x] the Redis adapter wired in (A-54): `config/socket.js#attachAdapter`, 2026-09-24
- [x] a test: an event emitted on instance A reaches a client connected to instance B: `socket.redisAdapter.live.test.js`, "A-54: an emit on replica A reaches a client connected only to replica B"
- [ ] **the same test after a reconnect** — A-53 fixed first, or the test proves only the happy path
- [ ] the reverse proxy still passes upgrade headers — verified by a **live notification**, not by reading the annotation
- [x] connect-time checks are not the only checks: a session revoked mid-connection disconnects the socket (P6-12 / A-48, Q-08). Every open socket is re-checked every 60 s (ADR-085)

**Abuse case:** long-polling fallback masks the problem in testing. Socket.IO falls back silently, and a test that only checks the notification arrives will pass over a broken WebSocket path.

**Abuse case:** the fan-out test connects once and never reconnects, so A-53 stays invisible behind a passing test.

---

### P8-03 — Migration advisory lock or init container

| | |
|---|---|
| **Status** | ✅ **DONE** 2026-09-28 (ADR-086): an advisory lock, not an init container |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**Why:** **the backend runs `db.sync()` and migrations at boot.** Two replicas starting together will both attempt them.

**Premise re-confirmed 2026-09-23** — unchanged by the remediation. `backend/index.js` still calls
`await db.sync()` and then `migrator.up()` during startup, and `src/config/migrator.js` now
registers **19** migrations from its static manifest (it was 18; `0019-add-signature-crypto-fields.js`
landed under ADR-040). More migrations means a longer window for two replicas to collide in, not a
smaller one.

**Definition of Done**
- [x] either an init container running migrations once, or a PostgreSQL advisory lock around the migration step. It is the lock, around `db.sync()` + `migrator.up()` (`utils/migrationLock.util.js#runSchemaSetup`, called from `index.js`). `npm run migrate` and `migrate:undo` take it too
- [x] a test: two instances starting simultaneously produce one migration run. `migrationLock.p803.live.test.js` passed 4/4 on PostgreSQL 18.6, and failed before the change on a HEAD worktree ("relname must be unique"). On two real replicas of the image, one logged `Applied 63 migration(s)`; the other waited and applied none
- [x] the losing instance waits rather than starting against a half-migrated schema. It polls every second and refuses the boot after `MIGRATION_LOCK_TIMEOUT_MS` (`migrationLock.p803.test.js`, 17 tests)
- [x] the run is verified by **inspecting columns** (P6-05), not by the migration log. Covered by the live case "the run is verified by inspecting columns"; both real replicas logged `[schema-verify] OK: 72 tables, 867 columns` — a blanket `try/catch` records a migration as applied while doing nothing, which is how 0008, 0013 and 0014 came to be marked done with their columns absent

---

### P8-04 — Read replica for reporting

| | |
|---|---|
| **Status** | ⏳ TODO. The **trigger fired in part** (2026-09-28, P8-07 baseline, ADR-086 §3): concurrent dashboard traffic took the device-list p95 from 320 to 726 ms. **Decided: query-shaped fixes come first** (bounded or estimated counts, a default audit date window); a replica only if p95 still fails after them. **Query-shaped fixes DONE 2026-09-29 (ADR-096, D-30):** the audit list counts at most 10,000 rows and reads 90 days by default, the dashboard holds at most 4 connections, the kanban N+1s are gone, and migration `0093` adds six per-tenant order indexes. The p95 re-measure on a dedicated host is still open — this host was too noisy to show one |
| **Trigger** | **measured** impact of reporting queries on operational p95 |
| **Spec refs** | `docs/PLAN/14-ANALYTICS-AND-REPORTING.md` (PR-10) |

**Why:** reporting runs against the operational database with indexes chosen for it. That is correct at current scale and wrong eventually.

**The answer is a read replica before it is a warehouse.** A warehouse is a second copy of the data to keep consistent and a second place tenant isolation could leak — for a problem a replica solves more cheaply.

**Definition of Done**
- [x] the trigger **measured**, not assumed — P8-07 first (ADR-086 §3)
- [ ] report and dashboard queries routed to the replica
- [ ] replication lag bounded and **surfaced** — a compliance figure read from a stale replica needs an "as of" timestamp
- [ ] tenant scoping verified on the replica path; the hooks must apply there too

**Abuse case:** a replica is added, reporting moves, and nobody checks that the tenant predicate survived the connection change.

---

### P8-05 — Partition `iot_readings`

| | |
|---|---|
| **Status** | ⏳ TODO. **Not triggered** (2026-09-28, ADR-086 §3): at 2.16M rows per tenant, the measured cost was counts, not table size |
| **Trigger** | row count makes retention purging insufficient |

**Why:** the highest-volume table in the system, currently managed by retention purge alone (PR-11).

**Partitioning makes old data cheap to keep rather than necessary to delete** — which matters more for the next task than this one.

**Definition of Done**
- [ ] partitioned by date
- [ ] `(device_id, timestamp)` queries still use an index — the pair is how every query reads it
- [ ] retention drops partitions rather than deleting rows
- [ ] PostgreSQL-native (ADR-039) — no MySQL consideration needed

---

### P8-06 — Partition `audit_logs`

| | |
|---|---|
| **Status** | ⏳ TODO. **Not triggered, and not scopable** (2026-09-28, ADR-086 §3). At 500,000 rows per tenant, the audit list costs 67 ms per request in an **exact count over all history**, which date partitioning does not bound. Retention is still undecided (Q-03) |
| **Trigger** | volume |

**Why:** `audit_logs` grows **monotonically and has no delete path**, by design.

**Purging it requires a compliance decision, not an engineering one** — and in a 21 CFR Part 11 context the retention period is likely measured in years after the last use of the device.

Partitioning is therefore the *only* engineering answer available: it keeps everything and makes keeping it cheap.

**Definition of Done**
- [ ] partitioned by date
- [ ] the append-only property **preserved** — no partition operation may become a delete path
- [ ] `resourceId` and `userId` queries still perform across partitions
- [ ] a test: the application role still cannot delete, on any partition

**Abuse case:** partition management becomes an indirect delete path, and the control that made `audit_logs` trustworthy is gone.

---

### P8-07 — Load and abuse testing at scale

| | |
|---|---|
| **Status** | 🟡 **PARTIAL** 2026-09-28 (ADR-086 §3). Baseline taken over 35,963 requests: **0 cross-tenant leaks, 0 × 408, 0 × 429, 0 × 5xx, 0 acquire timeouts**. The p95 target fails above low concurrency, and the ceiling is PostgreSQL. **Open:** PDF memory (blocked, M-11) and the MQTT ingest path |
| **Trigger** | **before any of the above is sized** |
| **Spec refs** | `docs/TESTING/05-PERFORMANCE-TESTING.md` |

**Why:** **no load testing has ever been performed. No baseline exists.** Every target in the acceptance criteria is a design intention, not a measurement.

This task is what makes P8-04, P8-05 and P8-06 fire on evidence rather than on someone's impression.

**Definition of Done**
- [x] realistic data volumes — 5,000 devices per tenant, five years of records, real `iot_readings` volume. `scripts/load/p807-seed.sql` gives each tenant 5,000 devices, 50,000 records, 2.16M readings and 500,000 audit rows
- [x] `RATE_LIMIT_MAX` set deliberately, and **confirmation that throughput was measured rather than the limiter**. It was 100,000,000; there were 0 × 429, and the `RateLimit-*` headers showed that budget
- [x] p95 targets measured for tenant-scoped lists and the dashboard: 49–140 ms unloaded, 576–732 ms at 10 users, 0.8–2.2 s at 25–50 users. The target is missed (ADR-086 §3)
- [x] **zero 408s**
- [x] **no cross-tenant leakage under concurrency** — the `AsyncLocalStorage` context must not bleed between requests. Every row's `tenantId` and every `meta.total` was checked against the caller in 35,963 responses: 0 leaks (`scripts/load/p807-baseline.k6.js`)
- [x] no connection acquire timeouts: 0 in both replicas' logs. The dashboard's 20 parallel counts against the 20-connection pool are recorded as a finding (ADR-086 §3)
- [ ] memory stable under sustained PDF rendering — **Chromium is bursty**, and a limit sized for the steady state OOM-kills on the first certificate. **BLOCKED:** the image cannot render certificate PDFs (M-11). API memory under sustained load was stable at ~320–345 MiB
- [ ] the MQTT ingest path measured. **Not run.** Premise corrected: there is **no embedded broker** (A-17). The backend is an MQTT *client*, and its message handler shares the API event loop

**The third bold item is the one a conventional load test omits and this system cannot afford to.** Tenant isolation depends on `AsyncLocalStorage`; a context that leaks under concurrency is a cross-tenant read that no functional test would find.

**Abuse case:** the test hits the rate limiter and reports the limiter's throughput as the system's.

---

### P8-08 — Multi-region

| | |
|---|---|
| **Status** | 🚫 **BLOCKED** (2026-09-28, ADR-086) on a customer data-residency requirement. None exists |
| **Trigger** | **a customer requirement**, not a technical one |

Not an engineering ambition. It becomes real when a customer's data-residency policy requires it, and not before.

Partial answers already exist: per-tenant object storage moves that data where the tenant wants it, and per-tenant LLM endpoints do the same for AI processing.

---

## Phase Exit

There is no exit. **Phase 8 is a set of standing triggers**, not a sprint.

**"Complete for this stop" (2026-09-30; working decision under the owner's delegation, awaiting the
owner's confirmation; ADR-109 §4).** For the "Phases 0–10 complete, then stop" milestone, Phase 8
counts as complete when every card is in one of three recorded states, and none is left unexplained:

| State | Cards | What must be written on the card |
|---|---|---|
| **DONE** | P8-03 | its record |
| **Not triggered** | P8-05, P8-06 | the measurement that says the trigger has not fired (ADR-086 §3) |
| **Blocked, blocker named** | P8-01 (code DONE 2026-10-05, ADR-086 Am. 1; blocked only on a **production** S3/NFS target and the ambient credential chain), P8-08 (a customer residency requirement) | the blocker, and who can remove it |
| **Still owed before the stop** | **P8-04 re-measure** — the query-shape fixes (D-30, ADR-096) are in; the p95 must be **measured again**, and a replica is built only if it still fails | the re-measured p95, dated |
| **Partial, not covered by this decision** | P8-02 (fan-out after a reconnect; a live notification through the proxy), P8-07 (MQTT ingest under load) | their open live checks stay listed; whether they block the stop is **the owner's call** |

This defines a stopping point, not an exit: the triggers stay standing after it. A card that is
"not triggered" today is not "done" — it is waiting.

The board's job here is to make sure that when a trigger fires, the response is already known — and that P8-01 through P8-03 are not discovered as prerequisites on the day someone scales a deployment to two replicas.
