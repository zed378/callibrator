# 06 — Logging

---

## What Logs Exist

| Source | Written by | Holds |
|---|---|---|
| `accessLog` | `accessLog.middleware.js` | every request |
| `activityLog` | `activityLog.middleware.js` | user activity |
| **`audit_logs`** | `auditLog.middleware.js` | the **compliance trail** — a database table |
| stdout | the application | operational logs |
| `./log` volume | file output | |

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

It is the only thing tying a client-side symptom to a server-side line, and the one piece of information a user can safely quote in a bug report. Every error state in the UI surfaces it.

## Redaction

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

The `./log` volume needs rotation. An unrotated log fills the disk, and a full disk stops writes — including `audit_logs`, which is the one thing that must never fail to write.

| Log | Retention |
|---|---|
| Access | 30 days |
| Application | 30 days |
| Activity | 90 days |
| **`audit_logs`** | **indefinite — a compliance decision, not an ops one** |

## Aggregation

Not currently in place. Logs live in container stdout and the `./log` volume.

Structured JSON logging and shipping is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md). Whatever ships them must not undo the redaction — an aggregator with its own parsing can re-expose a field the application redacted, and a leak into a third-party log store is a leak.
