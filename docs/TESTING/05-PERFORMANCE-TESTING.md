# 05 — Performance Testing

---

## Targets

From [`../PLAN/17-ACCEPTANCE-CRITERIA.md`](../PLAN/17-ACCEPTANCE-CRITERIA.md).

| Measure | Target | Why that number |
|---|---|---|
| Dashboard first meaningful paint | **under 2s** on hospital wifi | Rina has 60 seconds total for her morning check |
| Tenant-scoped list, p95 | **under 500ms** | Budi searches for a device many times a day |
| **408 responses** | **zero** | the app times out at 30s; a 408 is a bug signal, not a normal outcome |
| Certificate PDF render | under 5s | |
| Public pages Lighthouse | 90+ | |
| **Verification page interactive** | as fast as achievable | measured on a **stranger's** phone |

The verification page gets the strictest budget and the fewest dependencies, because there is no fallback: the auditor has one device, no account, and one attempt.

## Current State

**One baseline exists, taken 2026-09-28 (P8-07, ADR-086 §3), and it does not meet the list target above low concurrency.** Until then no load testing had been performed; this section said so until the baseline was recorded. The figures are in [Hot-Path Budgets](#hot-path-budgets) below, each labelled.

Targets above are design intentions, not measurements. Saying so is more useful than reporting numbers nobody has taken.

Load testing sits in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md) under operational maturity.

## Hot-Path Budgets

Every number here is labelled **TARGET** (a budget, not yet shown to hold) or **MEASURED** (taken, with its source). A number with neither label is a defect in this table. This section is what [`TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) **U-06** points at; it prepares U-06 for closing and does not close it.

**Where MEASURED comes from:** the P8-07 baseline — [`MEMORY/records/2026-09-28-p8-scale-cards.md`](../../MEMORY/records/2026-09-28-p8-scale-cards.md) § P8-07. Load `scripts/load/p807-baseline.k6.js` (grafana/k6, `limit=10`, two tenants, every response checked for the caller's tenant); data `scripts/load/p807-seed.sql` (per tenant: 5,000 devices, 50,000 calibration records, 2.16M `iot_readings`, 500,000 `audit_logs`); one backend replica (2 CPU / 4 GiB), PostgreSQL 18, Redis, no RabbitMQ, `RATE_LIMIT_MAX` raised out of the way. **The load generator shared a desktop Docker host with the stack**, so every measured figure is a lower bound on what a separate-host run would show, not a production number.

| Hot path | Endpoint | Budget (method) | Label | Result |
|---|---|---|---|---|
| Device list | `GET /api/v1/calibration-devices?page=&limit=10` | p95 **< 500 ms** (AC-31), tenant of 5,000 devices | TARGET | **MEASURED** p95 49 ms at 1 VU; **576 ms at 10 VU — not met**; 1.01–1.71 s at 50 VU |
| Device list, filtered | `GET /api/v1/calibration-devices?find=…&limit=10` | p95 **< 500 ms** (AC-31) | TARGET | **MEASURED** p95 54 ms at 1 VU; **603 ms at 10 VU — not met**. The record's "search" column is this request, not global search |
| Calibration record list | `GET /api/v1/calibration-records?page=&limit=10` | p95 **< 500 ms** (AC-31), 50,000 records | TARGET | **MEASURED** p95 56 ms at 1 VU; **616 ms at 10 VU — not met** |
| Dashboard metrics | `GET /api/v1/dashboard/metrics` | p95 **< 500 ms**, so AC-30's "first paint under 2 s on a hospital network" is not spent on the API alone. The 500 ms figure is proposed here, extending AC-31; AC-30 itself is a frontend measure | TARGET | **MEASURED** p95 64 ms at 1 VU; **613 ms at 10 VU — not met**. `getDashboardMetrics` issues 20 queries in one `Promise.all` against a pool of 20: at 10 VU each, it raised the device-list p95 from 320 ms to 726 ms (pool 60: 360 → 574 ms) — a finding, not fixed |
| Global search | `GET /api/v1/search` | p95 **< 500 ms**, the tenant-scoped read budget (AC-31) applied to a union over many tables — proposed here | TARGET | **Not measured.** The P8-07 script does not call `/search` |
| Certificate PDF generation | `POST /api/v1/certificates/:certificateId/pdf` | render **< 5 s** (AC-33), and backend memory stable under sustained rendering | TARGET | **Not measured, and cannot be yet:** the shipped backend image answers 500 on this route (`TASKS/BACKLOG.md` **M-11** — `puppeteer-core` not packaged) |
| Audit list (context) | `GET /api/v1/audit?page=&limit=10` | p95 **< 500 ms** (AC-31), 500,000 rows | TARGET | **MEASURED** p95 140 ms at 1 VU; **732 ms at 10 VU**. Its exact `count(...)` was 39 of 72 active queries under load — the main PostgreSQL cost |
| Timeouts, tenant isolation | all of the above | 0 × 408 (AC-32), 0 cross-tenant rows | TARGET | **MEASURED** over 35,963 requests / 15 runs: 0 × 408, 0 × 429, 0 acquire timeouts, **0 tenant leaks**; backend memory 320–345 MiB |

What the measured rows say: the lists meet AC-31 unloaded and miss it from 10 concurrent users on one replica, and the ceiling is PostgreSQL (790–940% CPU under two-replica load; exact counts over all history), so a second replica added no throughput. ADR-086 §3 records the decision: query-shaped fixes first (bounded or estimated counts, an audit date window), a read replica only if p95 still fails.

Still to measure before U-06 can close: global search; certificate PDF render time and memory (after M-11); IoT ingest; any run from a host separate from the stack.

## Test With Data, Not With an Empty Database

An empty database hides an entire class of problem. Defect #15 — the certificate list returning zero rows — was **only visible once there was data**.

For performance the same applies more strongly:

| Table | Realistic volume |
|---|---|
| `calibration_devices` | 5,000 per tenant |
| `calibration_records` | 5 years of history |
| **`iot_readings`** | the highest-volume table by far |
| `audit_logs` | monotonic, **no delete path** |
| `attachments` | with real file sizes |

`iot_readings` and `audit_logs` are the two that will decide when partitioning stops being optional.

## The Rate Limiter Will Fight You

| Environment | Global budget |
|---|---|
| production | 5,000 / 15 min |
| otherwise | **100,000 / 15 min** |

The non-production figure exists precisely because test traffic exhausts a production budget. `RATE_LIMIT_MAX` overrides either way.

**Set it deliberately for a load test, and confirm what you measured was throughput and not throttling.** A test that hits the limiter is measuring the limiter.

## What to Measure

### Read paths

| Path | Watch |
|---|---|
| `GET /dashboard/metrics` | one endpoint, many aggregates — the busiest query in the product |
| `GET /calibration-devices` with filters | the `next_calibration_date` index earning its keep |
| `GET /audit` with a date range | high-volume, append-only |
| `GET /search` | unions many tables |
| `GET /certificates/verify/:n` | **public and unauthenticated** — the most exposed lookup |

### Write paths

| Path | Watch |
|---|---|
| `POST /calibration-records` | writes a record, updates the device, writes an audit row, notifies — all in one transaction |
| Stock transfer transitions | quantity movement under a transaction |
| Attachment upload | quota check, scanner, storage write |
| `POST /iot/ingest` | the highest-frequency write |

### The one that shares a process

There is **no embedded MQTT broker** (A-17; corrected under ADR-088 — this line said there was). The backend is an MQTT *client* of an external broker, and its message handler runs on the API's event loop, so a telemetry flood still degrades the API, and that coupling is worth measuring rather than assuming.

## Saturation to Watch

| Signal | Threshold |
|---|---|
| DB pool utilisation | near `DB_POOL_MAX` (10 dev / 20 prod) |
| **Connection acquire timeouts** | **any** — the pool is undersized |
| Redis latency | |
| RabbitMQ queue depth | growing without draining |
| Memory under PDF rendering | **Chromium is bursty** |

`DB_POOL_ACQUIRE_TIMEOUT` is 30s, matching the request timeout, so a request waiting for a connection fails at roughly the moment the request itself gives up. Acquire timeouts appearing at all mean the pool is too small.

**Chromium memory is the one most likely to surprise.** A container limit sized for the steady state will OOM-kill on the first certificate.

## Frontend

| Measure | Tool |
|---|---|
| Lighthouse, public pages | CI |
| Bundle size | `@next/bundle-analyzer` |
| Render cost | React DevTools Profiler |

Two things worth checking specifically:

**Store subscriptions.** `useStore((s) => s.field)` versus `const { field } = useStore()` — the compiler cannot narrow a subscription, and the wide form re-renders on every store change. It is the most common cause of a dashboard that feels sluggish under live notifications.

**The verification page's bundle.** It should not pull in the editor, the charting library or the motion stack because they happen to share a chunk.

## Test Under Real Conditions

| Condition | Why |
|---|---|
| **Throttled to slow 3G** | hospital wifi is not a fast connection |
| **375px viewport** | two of six personas work on a phone |
| A real, old device for `/verify` | the one case a simulator does not settle |

The honest test is the slow one.

## Reporting Loads

Reports run against the **operational database** with indexes chosen for them. There is no warehouse (PR-10).

**The trigger for action is measured impact on operational p95** — not a threshold anyone guessed in advance. When reporting queries start affecting the dashboard, the answer is a **read replica** before it is a warehouse.

That trigger cannot fire without measurement, which is the strongest argument for doing any of this.

## Growth Tables

| Table | Managed by |
|---|---|
| `iot_readings` | retention purge |
| **`audit_logs`** | **nothing** — purging needs a compliance decision, not an engineering one |

Neither is partitioned. Partitioning is the right answer when retention alone stops being enough, and it makes old data cheap to keep rather than necessary to delete.

## What a Load Test Must Prove

Not just throughput.

- [ ] p95 targets met under realistic concurrency
- [ ] **no 408s**
- [ ] **no cross-tenant leakage under concurrency** — the `AsyncLocalStorage` context must not bleed between requests
- [ ] no connection acquire timeouts
- [ ] queue depth drains
- [ ] memory stable under sustained PDF rendering
- [ ] the rate limiter was not what was measured

The third is the one a conventional load test omits and this system cannot afford to. Tenant isolation depends on `AsyncLocalStorage`, and a context that leaks under concurrency is a cross-tenant read that no functional test would find.
