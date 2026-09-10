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

The Redis alert must say what it means. "Redis is down" reads as a caching problem; the actual consequence is that idempotency claims are unavailable and the outage window will need reviewing for duplicates.

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

## Current State

**No alerting is in place.** Signals available today are `/health`, container health checks, application logs, `audit_logs`, and the RabbitMQ management UI.

That is stated plainly rather than described as something it is not. Alerting sits in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md) under operational maturity.

**Start with scheduled-job outcomes.** It is the failure mode this system is most exposed to, and the one that has already happened.

## After an Alert Fires

Every P1 and significant P2 gets a record in [`../../MEMORY/records/`](../../MEMORY/records/) naming the **mechanism**, not just the symptom, and producing at least one of:

- a test that fails without the fix,
- a **mechanism** rather than a rule,
- a new monitoring signal,
- a documentation amendment.

A rule that depends on someone remembering is not a control.
