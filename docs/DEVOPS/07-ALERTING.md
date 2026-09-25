# 07 — Alerting

Signals: [`05-MONITORING.md`](./05-MONITORING.md). This document is what wakes someone up, and what does not.

---

## The Rule

**An alert that fires and is ignored has trained everyone to ignore alerts.**

Every alert below has to be actionable: a person receiving it must know what to do. A signal nobody would act on is a dashboard line, not an alert.

## Severity

| Level | Response | Examples |
|---|---|---|
| **P1** — page | immediate | service down, database unreachable, suspected cross-tenant exposure |
| **P2** — notify | within the hour | scheduler failed, backup failed, error rate elevated |
| **P3** — ticket | next working day | disk at 80%, certificate expiring, dependency advisory |

## P1 — Page

| Alert | Condition |
|---|---|
| Service down | `/health` non-200 sustained |
| Database unreachable | `database: "disconnected"` |
| **Suspected cross-tenant exposure** | any signal — treated as SEV-1 until **proven** otherwise |
| Evidence integrity | any suggestion `audit_logs` or `calibration_records` were altered |
| Operator credential compromise | anomalous `SUPERADMIN` activity |
| Disk full | writes failing |
| Crash loop | repeated restarts |

Cross-tenant exposure defaults to P1 because the default assumption while it is open is **that it happened** ([`../SECURITY/12-INCIDENT-RESPONSE.md`](../SECURITY/12-INCIDENT-RESPONSE.md)).

## P2 — Notify

### Scheduled jobs — the most important category here

**A scheduled compliance job failing silently is worse than one that never ran, because everyone believes it did.**

The retention purge failed **every night** with `column "tenantId" does not exist` until somebody looked.

| Alert |
|---|
| a scheduler did not run in its window |
| a scheduler ran and **failed** |
| a tenant backup failed |
| the calibration sweep did not complete |
| **an infrastructure backup job failed** |

If only one thing gets alerting first, make it this category.

### Dependencies

| Alert | Consequence to state in the alert |
|---|---|
| **Redis down** | brute-force protection weakened; **duplicate side effects possible** |
| RabbitMQ down | jobs queue up |
| ClamAV down | **uploads are being rejected** — fail-closed by default |
| Object storage unreachable | uploads and downloads failing |

The Redis alert must say what it means. "Redis is down" reads as a caching problem; the real consequences are that **passkey sign-in and the OIDC provider stop working and registration answers 429**, and brute-force limits drop to per-replica memory. (This line previously cited lost idempotency claims; there are none.)

### Errors and abuse

| Alert | Suggests |
|---|---|
| 5xx rate elevated | |
| **500 from a bad input value** | **a missing validator** — it should have been a 400 |
| **408 responses** | a request exceeded 30 s; a bug signal, not a normal outcome |
| Lockout rate rising | credential stuffing |
| 429 rate rising on one tenant | scripted misuse, or a broken integration |
| **`audit_logs` `EXPORT` volume rising** | **data exfiltration** |
| Uploads rejected for scanner error | ClamAV is down and uploads have stopped |

### Jobs and delivery

| Alert |
|---|
| a batch job in **`PROCESSING`** past a threshold — not a resting state; a crashed worker leaves exactly that |
| `FAILED` job rate rising |
| queue depth growing without draining |
| webhook `exhausted` deliveries rising |
| repeated webhook failures to one destination |

## P3 — Ticket

| Alert | Threshold |
|---|---|
| Disk usage | > 80% on `./data`, `./uploads`, `./log` |
| DB pool near max | |
| p95 latency degrading | |
| **TLS certificate expiring** | 30 days — including tenant custom domains |
| Dependency advisory | |
| `audit_logs` or `iot_readings` growth rate | partitioning conversation |

## Alerts With Domain Meaning

These have no equivalent in a generic setup and are the ones worth building.

| Alert | Why it matters |
|---|---|
| Certificate PDF rendering failing | **`PUPPETEER_EXECUTABLE_PATH` wrong — fails at first use, not startup**, in a compliance-critical path |
| Public verification endpoint failing | an auditor cannot verify a certificate |
| ACME provisioning failing | **`ACME_DIRECTORY_URL` may still point at staging** |
| A tenant's calibration overdue count spiking | their compliance problem, and possibly a support call incoming |
| A scheduler double-running | more than one replica is running schedulers |

The first is the one most likely to be missed: PDF rendering fails at first use rather than at startup, so a deployment can look completely healthy and be unable to issue a certificate.

## What Must Not Alert

| Not an alert | Why |
|---|---|
| A single 4xx | clients send bad requests |
| A single failed login | that is what lockout is for |
| A single 429 | the limiter is working |
| Browser autoplay suppression | not an error |
| A frontend healthy while the API is down | correct — it renders error states |
| Individual webhook retries | only **exhaustion** matters |

## Routing

| Severity | Channel |
|---|---|
| P1 | page the on-call |
| P2 | team channel |
| P3 | ticket queue |

Security-relevant alerts — cross-tenant, evidence integrity, operator credentials, `EXPORT` volume — route to security **as well as** operations. The person who can read the audit trail is not necessarily the person watching disk usage.

## An Alert Must Say What to Do

```
✗  "Scheduler failed"

✓  "Retention purge failed at 02:00 for tenant <id>: column "tenantId" does not exist.
    Compliance job — data past its retention window was NOT purged.
    Runbook: docs/DEVOPS/07-ALERTING.md#retention-purge-failure"
```

The difference is whether the person receiving it at 2am knows whether it can wait.

## Current State — scheduled jobs (P7-02, 2026-09-24)

**Scheduled-job alerting is in place in the application.** Everything else in this document is still *design*: there is no metrics stack, no pager integration and no alert on dependencies, errors or disk. Stated plainly so nobody reads the tables above as running rules.

Decision record: **[ADR-066](../../MEMORY/DECISIONS.md)** (P7-02). Code: [`backend/src/services/jobMonitor.service.js`](../../backend/src/services/jobMonitor.service.js), [`backend/src/services/alert.service.js`](../../backend/src/services/alert.service.js).

### What is monitored

Every scheduler runs its job through `jobMonitor.runMonitored`:

| Job (`alert.context.job`) | Env var | Default | A run FAILS when |
|---|---|---|---|
| `scheduled-backup` | `BACKUP_SCHEDULER` | `0 0 * * *` | it throws, or its outcome is `ok: false` (a tenant failed, a prune error or refusal) |
| `retention-sweep` | `RETENTION_SCHEDULER` | `0 2 * * *` | it throws, or any tenant errored |
| `calibration-scan` | `CALIBRATION_SCHEDULER` | `0 1 * * *` | it throws, or any device errored |
| `session-cleanup` | `SESSION_CLEANUP_SCHEDULER` | `0 2 * * *` | it throws |
| `tenant-lifecycle` | `TENANT_LIFECYCLE_SCHEDULER` | `30 2 * * *` | it throws, or any tenant failed to offboard |
| `webhook-dispatch` | `WEBHOOK_DISPATCH_SCHEDULER` | every 15 s | the pass throws (a receiver refusing a delivery is the dispatcher *working*) |
| `quarantine-sweep` (S-33) | `QUARANTINE_SWEEP_SCHEDULER` | `17 * * * *` | it throws, or a quarantined file could not be removed |

A partial failure is a **failure**: "overdue devices got no work order" must not read as success.

### What happens on a failure

1. **Recorded durably** — `JOB_STATUS_DIR/<job>.json` (default `<storage>/log/jobs/`, the log volume in compose): last start, finish, duration, outcome, error, consecutive failures, last success, next expected run. Written atomically. It survives a restart, which is what lets a run missed *while the process was down* be detected.
2. **Logged at `error`** with a structured `alert` object — `alert.key` (`job.<name>.failed`), `alert.severity`, `title`, `meaning`, `action`, `detail`. Production logs JSON to stdout (A-14), so a log pipeline can alert on `alert.key` with no application change ([`06-LOGGING.md`](./06-LOGGING.md)). **This line is the alert of record.**
3. **Pushed** when configured: `ALERT_WEBHOOK_URL` (one POST of `{ "text": …, "alert": {…} }` — `text` is what Slack/Mattermost render; the structured object is for everything else) and/or `ALERT_EMAIL_TO` (through the application's SMTP transport). A sink that fails is logged and never breaks the job.

Every alert says what it means and what to do. The retention one reads:

```
[CRITICAL] Data-retention purge FAILED
Retention purge failed: data past its retention window was NOT purged. This is a GDPR/retention-policy breach for every day it continues.
What to do: Read the error, fix it, then run the purge by hand for each tenant (POST /api/v1/tenants/:tenantId/purge as a super admin) and confirm the counts.
Detail: column "tenantId" does not exist (consecutive failures: 1; last success: 2026-09-23T02:00:04.311Z)
```

### Not training people to ignore alerts

- A job alerts on the **first** failure of a streak, then at most once per `JOB_ALERT_REPEAT_HOURS` (default 24) while it keeps failing, and **once** when it recovers (`severity: resolved`). A 15-second dispatcher that fails for a day produces two messages, not 5,760.
- An invalid cron expression is refused at boot **and alerted** (`job.<name>.not-scheduled`) — a job the operator believes is scheduled and is not is exactly the failure this exists for. `disabled`/`off` is a decision, not an alert; the report shows it as `enabled: false`.

### The watchdog — runs that did not happen

`JOB_WATCHDOG_SCHEDULER` (default every 5 minutes; `disabled` turns it off, loudly):

- **Missed run** — a job whose expected run is more than its grace period in the past (`JOB_OVERDUE_GRACE_MINUTES`, default 60; the dispatcher 10) with no run started since, *on this or another replica*. Also catches a run missed while the process was down: the expected time is persisted. Alert key `job.<name>.missed`.
- **Stuck batch job** — `batch_jobs` rows in `PROCESSING` longer than `BATCH_JOB_STUCK_MINUTES` (default 60). Alert key `batch-jobs.stuck`, severity `warning`.

### One run per replica — the Redis claim (S-33)

Each singleton job (everything but the dispatcher, which already shares work through `FOR UPDATE SKIP LOCKED`) claims `job-run:<name>:<scheduled minute>` in Redis with `SET NX` before it runs; the replica that loses records `skipped`. **When Redis is unavailable the claim is not enforced and the job runs anyway** — a duplicate tenant backup is waste, a backup nobody took is loss. That is why the Helm guard against `cron.enabled` with more than one replica stays.

### Reading the state

| | |
|---|---|
| `GET /api/v1/health/jobs` | super admin only; every job's recorded state in the envelope; **503** when any job's last run failed or it is overdue |
| `GET /api/v1/health/metrics` | Prometheus text, `Authorization: Bearer $METRICS_TOKEN` (≥ 32 chars). **404 while `METRICS_TOKEN` is unset** — off until an operator turns it on |

Metrics: `callibrator_job_enabled`, `callibrator_job_last_success_timestamp_seconds`, `callibrator_job_last_run_timestamp_seconds`, `callibrator_job_last_duration_seconds`, `callibrator_job_last_run_failed`, `callibrator_job_consecutive_failures`, `callibrator_job_overdue`, `callibrator_job_runs_total{outcome}`. Two alert rules cover the category for a Prometheus user:

```yaml
- alert: CallibratorJobFailed
  expr: callibrator_job_last_run_failed == 1
- alert: CallibratorJobOverdue
  expr: callibrator_job_overdue == 1
```

### Honest limits

- **Routing to a channel someone reads** is configuration: until `ALERT_WEBHOOK_URL`/`ALERT_EMAIL_TO` is set or the logs are shipped and matched, the alert is a log line. The template ([`deploy/compose/.env.example`](../../deploy/compose/.env.example)) says so.
- In Kubernetes the status files are on an `emptyDir` (the log volume): they survive a container restart, not a pod rescheduling — the alerts and metrics are the signal of record there.
- An **infrastructure** backup (the host `pg_dump`/WAL procedure) runs outside this process and is not monitored by it. Its runner must alert on its own exit code.
- Not verified against a live SMTP server or a live Slack webhook; the webhook sink is tested against a local HTTP server.

## After an Alert Fires

Every P1 and significant P2 gets a record in [`../../MEMORY/records/`](../../MEMORY/records/) naming the **mechanism**, not just the symptom, and producing at least one of:

- a test that fails without the fix,
- a **mechanism** rather than a rule,
- a new monitoring signal,
- a documentation amendment.

A rule that depends on someone remembering is not a control.
