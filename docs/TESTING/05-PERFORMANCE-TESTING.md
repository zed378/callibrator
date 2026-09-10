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

**No load testing has been performed.** No baseline exists.

Targets above are design intentions, not measurements. Saying so is more useful than reporting numbers nobody has taken.

Load testing sits in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md) under operational maturity.

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

The **MQTT broker is embedded in the Express process**. A telemetry flood degrades the API, and that coupling is worth measuring rather than assuming.

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
