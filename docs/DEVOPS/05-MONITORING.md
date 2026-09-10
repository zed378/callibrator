# 05 — Monitoring

---

## Health Endpoints

| Endpoint | Returns |
|---|---|
| `GET /health` | 200 with uptime, memory, pid, node version, `database: "connected"`; **503** with `database: "disconnected"` |
| `GET /` | 200 liveness |

`/health` calls `db.authenticate()`, which makes it a genuine **readiness** probe.

**Do not use it as a liveness probe.** A liveness probe that fails restarts the container, and restarting a healthy process during a database blip turns a brief outage into a crash loop.

| Probe | Endpoint |
|---|---|
| Liveness | `GET /` |
| Readiness | `GET /health` |

The frontend health check (`wget --spider :3000`) proves the server is serving. A frontend that is healthy while the API is down is **correct** — it renders error states.

## What to Watch

### Availability

| Signal | Alert when |
|---|---|
| `/health` non-200 | any, sustained |
| `database: "disconnected"` | any |
| Container restarts | more than expected |
| Redis, RabbitMQ reachability | any failure |

### Latency

| Signal | Threshold |
|---|---|
| p95 tenant-scoped list | > 500 ms |
| p95 dashboard metrics | > 2 s |
| **408 responses** | **any** — the app times out at 30 s, and a 408 in normal operation is a bug signal, not a normal outcome |
| Certificate PDF render | > 5 s |

### Saturation

| Signal | Alert when |
|---|---|
| DB pool utilisation | near `DB_POOL_MAX` |
| Connection acquire timeouts | any |
| Disk on `./data`, `./uploads`, `./log` | > 80% |
| Memory | approaching the limit |

The pool acquire timeout is set to 30 s to match the request timeout, so a request waiting for a connection fails at roughly the moment the request itself gives up. Acquire timeouts appearing at all mean the pool is undersized.

### Errors

| Signal | Meaning |
|---|---|
| 5xx rate | |
| **500 from a bad input value** | **a missing validator** — it should have been a 400 |
| 401 rate rising | credential stuffing, or a broken client |
| 403 rate rising | a stale menu tree, or probing |
| 429 rate rising on one tenant | scripted misuse, or a broken integration |

The second row is worth alerting on specifically. A bad enum reaching the database always produces a 500 rather than a 400, and it always sends the investigation to the wrong layer.

## Domain Signals

These are the ones a generic monitoring setup will not have, and they are the ones that matter.

### Scheduled jobs

**A scheduled compliance job failing silently is worse than one that never ran, because everyone believes it did.**

The retention purge failed **every night** with `column "tenantId" does not exist` until someone looked.

| Alert |
|---|
| a scheduler did not run in its window |
| a scheduler ran and **failed** |
| a tenant backup failed |
| the calibration sweep did not complete |

### Batch jobs

| Alert |
|---|
| a job in **`PROCESSING`** past a threshold — it is not a resting state, and a crashed worker leaves exactly that |
| `FAILED` rate rising |
| queue depth growing without being drained |

### Webhooks

| Alert |
|---|
| `exhausted` deliveries rising |
| repeated failures to one destination |

`exhausted` is distinct from `failed`: we have stopped trying. That distinction exists so this alert is possible.

### Duplicate side effects

Redis holds worker idempotency claims. **A Redis outage window is a window in which duplicates were possible** — duplicate emails, duplicate webhook deliveries, duplicate job side effects.

Redis coming back is not the end of the incident. Alert on the outage, and review the window.

## Security Signals

| Signal | Suggests |
|---|---|
| Lockout rate rising | credential stuffing |
| **`audit_logs` `EXPORT` volume rising** | **data exfiltration** |
| Login IPs from unexpected geography | account compromise |
| A super-admin action outside normal hours | worth a look, always |
| Storage growth outpacing device growth | upload abuse |
| Uploads rejected for scanner error | ClamAV is down and uploads have stopped |

`EXPORT` exists as its own `audit_logs.action` value precisely so this alert is possible.

## Logs

| Source | |
|---|---|
| `accessLog` | every request |
| `activityLog` | user activity |
| `audit_logs` | the compliance trail — a **database table**, not a log |
| Container stdout | application logs |
| `./log` volume | file logs |

**Every log line carries the `X-Request-Id`**, which is what ties a client-side symptom to a server-side line.

Redaction is a **key-name walk at any depth**, not a fixed path list. See [`06-LOGGING.md`](./06-LOGGING.md).

## Dashboards

| Dashboard | Shows |
|---|---|
| Availability | health, restarts, dependency reachability |
| Latency | p50/p95/p99 by route group |
| Errors | 4xx and 5xx by route and by tenant |
| Saturation | pool, disk, memory, queue depth |
| Domain | scheduler outcomes, job states, webhook delivery |
| Security | lockouts, `EXPORT` volume, super-admin actions |

Per-tenant breakdowns matter: one tenant with a broken integration generating half the platform's 429s is a support conversation, not an infrastructure problem.

## Current State

There is no metrics stack wired up. Signals available today:

- `/health`, polled by compose and Kubernetes
- container health checks
- `accessLog` and `activityLog`
- `audit_logs`, queryable at `/api/v1/audit`
- RabbitMQ management UI on 15672

**Structured log shipping and alerting are not in place.** They are in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md) under operational maturity, and in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

Stating that plainly is more useful than describing a monitoring setup that does not exist.

## Where to Start

If only one thing gets instrumented first, make it **scheduled-job outcomes**. A silent nightly failure in a compliance job is the failure mode this system is most exposed to, and the one that has already happened.
