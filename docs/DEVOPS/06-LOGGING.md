# 06 — Logging

---

## What Logs Exist

> Rewritten 2026-09-24 (batch 6, P7-03) — this table described the pre-A-14 logger (files only, empty `docker logs`). As-built detail: [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md).

| Source | Written by | Holds |
|---|---|---|
| **stdout (JSON)** | winston, `activityLog.middleware.js` | **everything the application logs, in production included** (A-14): one JSON object per line, redacted, with `requestId` on every line written during a request |
| `request completed` line | `activityLogger` | the per-request record: `requestId, method, url, statusCode, durationMs, userId, tenantId` at `info` |
| alert lines | `alert.service` (P7-02) | scheduled-job failures, missed runs, stuck batch jobs — level `error`, field `alert.key` |
| `log/activity/*` files | winston | only with `LOG_TO_FILE=true` (default: on outside production, off in production); bounded |
| `log/access/` | morgan, `accessLog.middleware.js` | a text line per request — a local fallback |
| `log/jobs/*.json` | `jobMonitor.service` (P7-02) | each scheduled job's last-run state — status, not a log |
| **`audit_logs`** | services, inside their transactions | the **compliance trail** — a database table |

## `audit_logs` Is Not a Log

It is a **database table**, append-only, with no delete path, queryable at `GET /api/v1/audit`, and written **inside the transaction of the action it describes**.

| | Application logs | `audit_logs` |
|---|---|---|
| Purpose | operate the system | prove what happened |
| Retention | rotated, purgeable | **purging requires a compliance decision** |
| Deletable | yes | **no path exists** |
| Loss | inconvenient | a compliance incident |

Do not conflate them. An application log line about an update is not an audit row, and an audit row is not a substitute for operational logging.

Detail: [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md).

## Every Line Carries the Request Id

`crypto.randomUUID()` per request → `req.requestId` → `X-Request-Id`, exposed through CORS.

Since 2026-09-24 (P7-03) that is literally true of the **log lines**, not only of the response: `activityLogger` runs the request inside an `AsyncLocalStorage` and the logger's `requestIdFormat` stamps the id on every line written on the request's behalf — a service's `logger.error` included. `console.*` output (24 sites) does not carry it.

It is the only thing tying a client-side symptom to a server-side line, and the one piece of information a user can safely quote in a bug report. Every error state in the UI surfaces it.

## Redaction

> **As-built since A-14/A-228: the redactor exists** — `redactFormat` in `activityLog.middleware.js`
> walks every record at any depth on a copy, as described below (details and tests:
> [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md) § Redaction). `auditAction`, which
> logged whole bodies, was deleted (A-43). *(This note said "there is no redactor" until 2026-09-24.)*

**Redaction is a key-name walk at any depth, not a fixed path list.**

A path list only covers the shapes someone thought of. A nested object under an innocuous key is exactly where a secret hides, and it must also scrub bearer tokens appearing as **values** under unremarkable key names.

### Never logged

```
password  ·  mfaSecret  ·  otpCode  ·  webauthnPublicKey
tenant_keys.privateKey  ·  tenant storage credentials
JWT access and refresh tokens  ·  API key plaintext
webhooks.secret  ·  calibration_devices.iotDeviceToken
Authorization headers  ·  Cookie headers
```

### The self-verifying test problem

**A test generated from the code it tests verifies consistency, never correctness.**

A redaction test that iterates the same key set the redactor uses cannot catch a key being **deleted** from that set — both sides change together and the test stays green.

The fixes: an independently maintained list of things that must never appear, or a mutation check that removes a key and confirms the right test fails.

### The highest-consequence leak

`audit_logs.changes` is written from model attributes. A careless implementation serialises a password hash, an MFA secret, a tenant private key or an S3 credential into a table that is **append-only with no delete path**.

**A secret in `audit_logs` is permanent.** There is no cleanup path. Redaction on the way in is the only control.

## Personal Data

GDPR applies to platform users. Logs carrying personal data are subject to retention and DSAR obligations, which is a good reason to log less of it.

| Log | Contains |
|---|---|
| `accessLog` | IP, user agent, path |
| `activityLog` | user id, action |
| `audit_logs` | actor, IP, user agent, **before and after state** |

Log the **user id**, not the email. A user id is meaningless outside the system; an email is personal data in every log aggregator it reaches.

## Client Error Reports

Reported with the `X-Request-Id`. **No personal data, no tokens, no request bodies.**

A client error report carrying a form payload is a data leak with good intentions — and the form in question may be a calibration record or a signature.

## Levels

| Level | Use |
|---|---|
| `error` | something failed and needs attention |
| `warn` | something unexpected, handled |
| `info` | significant lifecycle events — startup, shutdown, scheduler outcomes |
| `debug` | development only |

**`debug` must be off in production.** Debug logging is where redaction discipline slips, because the developer is trying to see the value.

## What Deserves a Log Line

| Event | Level |
|---|---|
| Startup, with a **configuration summary naming no values** | info |
| Missing required secret → **exit** | error |
| Database connection lost or restored | error / info |
| Redis, RabbitMQ connection state | warn / info |
| **Scheduler started, finished, failed** | info / error |
| Batch job started, finished, failed | info / error |
| Webhook delivery exhausted | warn |
| Rate limit triggered | warn |
| Authentication failure | warn |
| Tenant suspended or resumed | info |
| Certificate signed or revoked | info |
| Migration applied | info |

### Scheduler outcomes are the ones that matter

The retention purge failed **every night** with `column "tenantId" does not exist` until someone looked.

**A scheduled compliance job failing silently is worse than one that never ran, because everyone believes it did.** A log line is the minimum; an alert is the right answer ([`07-ALERTING.md`](./07-ALERTING.md)).

## Startup Logging

On boot, log a configuration **summary** — which driver, which dialect, which optional subsystems are enabled — naming no values.

```
storage driver: s3 (endpoint configured)     ✓
storage driver: s3 (key: AKIA…)              ✗
```

And when a required secret is missing, **name every missing variable at once** and exit. Naming one per restart turns a two-minute fix into a twenty-minute loop.

## Errors

The central mapper **forwards recognised error types only**.

A raw `pg` message carries SQL. A raw Node message carries a file path. Both are information disclosure, and no amount of care at the call site fixes an over-permissive mapper.

Unrecognised errors become a generic 500 with the request id — which is what a bug report needs anyway.

Log the **full** error server-side. Return the safe one.

## Rotation

| Log | Retention (as coded) |
|---|---|
| stdout (compose) | the Docker `json-file` driver: `max-size`/`max-file` per service in the prod overlay (50 MB × 5 backend) |
| stdout (Kubernetes) | the node's container-log rotation |
| `log/activity/*` (only with `LOG_TO_FILE`) | daily, 20 MB, gzip, **30 days — all four, exception and rejection included** (A-14) |
| Access (`log/access/`) | daily, gzip, `maxFiles: 30` (A-44 — it was `history: "30d"`, which pruned nothing) |
| **`audit_logs`** | **indefinite — a compliance decision, not an ops one** |

Rotation bounds file count, not disk: the volume still needs monitoring, because a full disk stops writes — including `audit_logs`.

## Shipping (P7-03)

**Nothing ships today; the pieces to do it exist.** Production writes JSON to stdout, so any collector of container output works with no application change.

- **compose:** [`deploy/observability/docker-compose.logging.yml`](../../deploy/observability/docker-compose.logging.yml) adds a Vector container reading the Docker socket with [`deploy/observability/vector.toml`](../../deploy/observability/vector.toml): parse the JSON lines, keep text lines as `message`, **redact again**, ship to Loki with low-cardinality labels (`service`, `level`, `alert`). `vector validate` passes and the transforms were exercised on sample lines; it has **not** been run against a Docker socket or a Loki (no Docker where it was written).
- **Kubernetes:** the cluster's node agent collects stdout; apply the same second redaction pass there. The chart sets no `LOG_TO_FILE`, so no files are written in the pod.

**Whatever ships them must not undo the redaction** — an aggregator with its own parsing can re-expose a field the application redacted, and a leak into a third-party log store is a leak. Hence the second pass, and hence the open DoD item: *redaction verified after shipping* means reading a line back **from the aggregator**, which has not been done.

**Alert on logs:** match `alert.key` (P7-02) — e.g. a Loki rule on `{service="backend", alert=~"job\\..*"}`. See [`07-ALERTING.md`](./07-ALERTING.md).
