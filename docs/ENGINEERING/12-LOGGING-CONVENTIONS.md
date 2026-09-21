# 12 — Logging Conventions

How to log from application code. What the logs are and where they go operationally is [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md).

---

## Use the Shared Logger

```js
const { logger } = require("../middlewares/activityLog.middleware");

logger.info("Certificate signed", { requestId: req.requestId, certificateId, tenantId });
logger.error("Webhook delivery exhausted", { deliveryId, url: redactUrl(webhook.url) });
```

winston, JSON format, timestamped. **No `console.*` in application code** — as-built, `config/socket.js` still uses `console.log` for connect and disconnect, which is the only application output that reaches stdout in production.

## Levels

| Level | Use |
|---|---|
| `error` | something failed that someone should look at |
| `warn` | degraded, self-healing, or an unexpected-but-handled input |
| `info` | a state change worth reconstructing later |
| `http` | **do not use** — see below |
| `debug` | development detail; off in production |

**`logger.http` is silently dropped in production.** winston orders levels `error < warn < info < http < verbose < debug`, and production runs at `info`. The per-request REQUEST/RESPONSE lines in `activityLog.middleware.js` use `http`, so none of them is written: 0 of 640 lines in the reference deployment's combined log. Per-request completion belongs at `info` (A-14).

## Every Request-Scoped Line Carries `requestId`

`X-Request-Id` is assigned before logging runs and returned to the client. Put it on every line written while handling a request, so a user's error report — which shows the id — leads straight to the log.

## Structure, Not Sentences

```js
// ✅ fields are queryable
logger.warn("Quota exceeded", { tenantId, metric, usage, limit });

// ❌ a sentence you have to regex
logger.warn(`Tenant ${tenantId} exceeded ${metric}: ${usage}/${limit}`);
```

Durations are **numbers** in milliseconds (`durationMs: 42`), not `"42ms"` strings — the current activity logger writes strings, which no aggregator can sum.

## Never Log

- passwords, OTPs, tokens, API keys, session ids, webhook secrets, storage credentials;
- full request or response bodies;
- a signed URL — the signature is a credential until it expires;
- personal data beyond an id (GDPR: logs are harder to erase than rows).

Log the **id** of the thing, never its secret.

## What Deserves a Line

| Log it | Do not |
|---|---|
| authentication failure and lockout | every successful read |
| permission denial | the fact that a function was entered |
| a state transition on an evidence-bearing record | a value you could read from the database |
| an external call that failed, with its duration | the payload of a successful one |
| a swallowed error — and ask whether it should be swallowed | nothing, when you swallow an error |

A `catch` that logs and returns a default is where outages hide. `getUsage` logged "Failed to get usage" on every call and returned zero; the log line was the only evidence, and nobody was reading it.

## `audit_logs` Is Not a Log

It is a database table, written inside the transaction of the action it records, with no delete path. Application logs are for operating the system; `audit_logs` is evidence. Writing one does not substitute for the other.
