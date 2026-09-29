# 05 — Monitoring

---

## Health Endpoints

> **Corrected (ADR-088).** This section used to show `/health` returning uptime, memory, pid, the Node version and `database: "connected"`, and `GET /` as the liveness probe. That was the pre-A-06/A-15 handler; none of those fields is returned any more, and none should be assumed by a client.

| Endpoint | Gate | Returns |
|---|---|---|
| `GET /live` | none | 200 `OK` (plain text). **Dependency-free** — liveness |
| `GET /ready` | none | 200 `READY` / **503** `NOT READY` (plain text) — readiness over PostgreSQL, Redis and RabbitMQ |
| `GET /health` | none | 200 `{"status":"ok"}` / **503** `{"status":"unavailable"}` — the same verdict as `/ready`, as JSON. Nothing else: no runtime detail, no dependency named |
| `GET /api/v1/health` | `auth` + `denyApiKey` + `superAdminOnly` | the per-dependency breakdown in the response envelope — `postgres`, `redis`, `rabbitmq` (required), `mqtt`, `clamav` (optional; `"not configured"` when switched off, ClamAV `"unknown"` when enabled) with `latencyMs`/`error`; **503** when a required dependency is unhealthy |
| `GET /api/v1/health/jobs` | super admin (same chain) | scheduled-job state (P7-02); **503** when a job's last run failed or it is overdue |
| `GET /api/v1/health/metrics` | `Authorization: Bearer <METRICS_TOKEN>` | Prometheus text (P7-02); **404** while `METRICS_TOKEN` is unset or shorter than 32 characters, 401 on a wrong token |
| `GET /` | none | 200 `{"status":"Success","message":"Your API is running"}` — not used by any probe |

Sources: `backend/src/routes/internal/health.route.js`, `backend/src/controllers/health.controller.js`, `backend/src/services/health.service.js`, `backend/src/middlewares/metricsAuth.middleware.js`; mounted in `backend/index.js` (`/api/v1/health` before the public probes). The public verdict is cached for `HEALTH_CACHE_TTL_MS` (default 5000 ms), each probe is capped at `HEALTH_PROBE_TIMEOUT_MS` (default 2000 ms), and the gated breakdown always probes fresh. The three public paths are exempt from the `FORCE_HTTPS` redirect (S-09, ADR-081).

`/health` and `/ready` are genuine **readiness** probes: they fail when PostgreSQL, Redis or RabbitMQ is unreachable, not the database alone.

**Do not use them as a liveness probe.** A liveness probe that fails restarts the container, and restarting a healthy process during a datastore blip turns a brief outage into a crash loop.

| Probe | Endpoint |
|---|---|
| Liveness | `GET /live` |
| Readiness (and the Helm startup probe, and the compose healthcheck) | `GET /health` |

The frontend health check (`wget --spider :3000`) proves the server is serving. A frontend that is healthy while the API is down is **correct** — it renders error states.

## What to Watch

### Availability

| Signal | Alert when |
|---|---|
| `/health` non-200 | any, sustained |
| a required dependency `unhealthy` in `GET /api/v1/health` (the public `/health` names none — ADR-088) | any |
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

A Redis outage means passkey sign-in and the OIDC provider fail, registration answers 429, caching stops, and rate limiting drops to per-replica memory. It does **not** open a duplicate window: there are no idempotency claims to lose. Duplicate side effects — a redelivered email sent twice, a webhook retried — are possible **regardless** of Redis, because nothing deduplicates them (see `docs/ENGINEERING/08-CACHE-QUEUE-STANDARDS.md`).

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

- `/health`, polled by compose and Kubernetes; `GET /api/v1/health` (super admin) for the per-dependency breakdown
- **scheduled-job state** (P7-02, 2026-09-24): `GET /api/v1/health/jobs` (super admin; 503 when a job failed or is overdue) and **`GET /api/v1/health/metrics`** — Prometheus text, bearer `METRICS_TOKEN`, off (404) until the token is set. The only Prometheus endpoint the application has; it covers scheduled jobs only
- container health checks
- JSON logs on stdout (A-14), `request completed` per request with `requestId` and a numeric `durationMs`; the morgan access log on disk
- `audit_logs`, queryable at `/api/v1/audit`
- RabbitMQ management UI on 15672

**Alerting exists for scheduled jobs only** ([`07-ALERTING.md`](./07-ALERTING.md) § Current State). **Log shipping is configured but not deployed** — a Vector template in `deploy/observability/` ([`06-LOGGING.md`](./06-LOGGING.md) § Shipping). Everything else in this document is design.

Stating that plainly is more useful than describing a monitoring setup that does not exist.

## Where to Start

If only one thing gets instrumented first, make it **scheduled-job outcomes**. A silent nightly failure in a compliance job is the failure mode this system is most exposed to, and the one that has already happened.
