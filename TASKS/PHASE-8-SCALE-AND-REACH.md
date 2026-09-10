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
| **Status** | ⏳ TODO |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` |

**Why:** `STORAGE_DRIVER=local` and more than one replica are **incompatible**. Replica A writes an attachment, replica B serves the download, and the object is not there.

The abstraction already exists — this is a configuration change plus a migration of existing objects, not new code.

**Definition of Done**
- [ ] `STORAGE_DRIVER=s3` or `nfs` in the target environment
- [ ] existing objects migrated with `npm run migrate:storage`
- [ ] S3 credentials from the **ambient chain** (IAM role / service account), not static keys in a Secret
- [ ] a test: an attachment written by one instance downloads through another
- [ ] `STORAGE_S3_PREFIX` understood as a convenience, **not an isolation boundary**

---

### P8-02 — Socket.IO Redis adapter

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/FRONTEND/06-REALTIME.md` |

**Why:** without it, a notification reaches **only the replica holding that client's connection**. Which users hear about an event becomes a function of load balancing.

**Definition of Done**
- [ ] the Redis adapter wired in
- [ ] a test: an event emitted on instance A reaches a client connected to instance B
- [ ] the reverse proxy still passes upgrade headers — verified by a **live notification**, not by reading the annotation

**Abuse case:** long-polling fallback masks the problem in testing. Socket.IO falls back silently, and a test that only checks the notification arrives will pass over a broken WebSocket path.

---

### P8-03 — Migration advisory lock or init container

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Trigger** | before `replicaCount > 1` |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**Why:** **the backend runs `db.sync()` and migrations at boot.** Two replicas starting together will both attempt them.

**Definition of Done**
- [ ] either an init container running migrations once, or a PostgreSQL advisory lock around the migration step
- [ ] a test: two instances starting simultaneously produce one migration run
- [ ] the losing instance waits rather than starting against a half-migrated schema

---

### P8-04 — Read replica for reporting

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Trigger** | **measured** impact of reporting queries on operational p95 |
| **Spec refs** | `docs/PLAN/14-ANALYTICS-AND-REPORTING.md` (PR-10) |

**Why:** reporting runs against the operational database with indexes chosen for it. That is correct at current scale and wrong eventually.

**The answer is a read replica before it is a warehouse.** A warehouse is a second copy of the data to keep consistent and a second place tenant isolation could leak — for a problem a replica solves more cheaply.

**Definition of Done**
- [ ] the trigger **measured**, not assumed — P8-07 first
- [ ] report and dashboard queries routed to the replica
- [ ] replication lag bounded and **surfaced** — a compliance figure read from a stale replica needs an "as of" timestamp
- [ ] tenant scoping verified on the replica path; the hooks must apply there too

**Abuse case:** a replica is added, reporting moves, and nobody checks that the tenant predicate survived the connection change.

---

### P8-05 — Partition `iot_readings`

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Trigger** | row count makes retention purging insufficient |

**Why:** the highest-volume table in the system, currently managed by retention purge alone (PR-11).

**Partitioning makes old data cheap to keep rather than necessary to delete** — which matters more for the next task than this one.

**Definition of Done**
- [ ] partitioned by date
- [ ] `(device_id, timestamp)` queries still use an index — the pair is how every query reads it
- [ ] retention drops partitions rather than deleting rows
- [ ] MySQL behaviour considered, or the divergence recorded

---

### P8-06 — Partition `audit_logs`

| | |
|---|---|
| **Status** | ⏳ TODO |
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
| **Status** | ⏳ TODO |
| **Trigger** | **before any of the above is sized** |
| **Spec refs** | `docs/TESTING/05-PERFORMANCE-TESTING.md` |

**Why:** **no load testing has ever been performed. No baseline exists.** Every target in the acceptance criteria is a design intention, not a measurement.

This task is what makes P8-04, P8-05 and P8-06 fire on evidence rather than on someone's impression.

**Definition of Done**
- [ ] realistic data volumes — 5,000 devices per tenant, five years of records, real `iot_readings` volume
- [ ] `RATE_LIMIT_MAX` set deliberately, and **confirmation that throughput was measured rather than the limiter**
- [ ] p95 targets measured for tenant-scoped lists and the dashboard
- [ ] **zero 408s**
- [ ] **no cross-tenant leakage under concurrency** — the `AsyncLocalStorage` context must not bleed between requests
- [ ] no connection acquire timeouts
- [ ] memory stable under sustained PDF rendering — **Chromium is bursty**, and a limit sized for the steady state OOM-kills on the first certificate
- [ ] the MQTT ingest path measured; the broker **shares the API process**

**The third bold item is the one a conventional load test omits and this system cannot afford to.** Tenant isolation depends on `AsyncLocalStorage`; a context that leaks under concurrency is a cross-tenant read that no functional test would find.

**Abuse case:** the test hits the rate limiter and reports the limiter's throughput as the system's.

---

### P8-08 — Multi-region

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Trigger** | **a customer requirement**, not a technical one |

Not an engineering ambition. It becomes real when a customer's data-residency policy requires it, and not before.

Partial answers already exist: per-tenant object storage moves that data where the tenant wants it, and per-tenant LLM endpoints do the same for AI processing.

---

## Phase Exit

There is no exit. **Phase 8 is a set of standing triggers**, not a sprint.

The board's job here is to make sure that when a trigger fires, the response is already known — and that P8-01 through P8-03 are not discovered as prerequisites on the day someone scales a deployment to two replicas.
