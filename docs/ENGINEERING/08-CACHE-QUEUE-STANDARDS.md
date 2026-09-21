# 08 — Cache and Queue Standards

Redis and RabbitMQ: what each holds today, and the rules for adding to either.

---

## Redis: Two Clients, Not One

| Client | File | Used for | When Redis is down |
|---|---|---|---|
| **rate limiter** | `services/rateLimiter.redis.service.js` — its own `ioredis` instance | brute-force counters, lockouts, request quotas | falls back to an **in-process** `Map` — limits still apply, per replica |
| **shared helper** | `services/redis.service.js` — `get`, `set`, `del`, `delPattern`, `acquireLock`, `releaseLock` | caching (roles, tenants, permissions, vendors, public branding), the registration lock, **WebAuthn challenges**, **OIDC authorisation requests, codes and refresh tokens** | helpers return `null` / `false`; WebAuthn answers 503, OIDC flows fail, registration answers 429 |

### Readiness is `status`, not `connected`

```js
const isReady = (client) => Boolean(client) && client.status === "ready";
```

Until 2026-09-21 every helper guarded on `client.connected` — a node-redis v3 property **ioredis does not have**. Each helper therefore returned early while Redis was connected and healthy. Registration, passkeys and the OIDC provider were all broken in production, and the unit tests were green because their mock fabricated a `connected` getter (A-24).

The lesson generalises: **a mock of a third-party client must expose only what the real client exposes.**

## What Is Stored, and Why It Matters

| Kind | Examples | Consequence of loss |
|---|---|---|
| **state** | WebAuthn challenges, OIDC codes and refresh tokens, lockout counters | a flow fails, or a security control weakens |
| **coordination** | `lock:register:<email>:<username>` | duplicate registrations race |
| **cache** | role and permission lookups, tenant branding | slower, correct |

Only the last is a cache in the ordinary sense. Redis is **not optional** for a production deployment.

## Key Rules

- **Prefix by purpose.** As-built: `lock:<key>`, `webauthn:challenge:<userId>`, `oidc:authreq:<id>`, `oidc:code:<code>`, `oidc:refresh:<token>`, and cache keys from `redis.service.js#cacheKeys` (`user:<userId>`, `user:email:<email>`, …). Build keys with a named function beside the feature; do not hand-format them at the call site.
- **A key holding tenant data contains the tenant id.** Otherwise a leak outlives the bug that caused it, until the key expires.
- **Every key has a TTL.** State keys: the flow's lifetime (WebAuthn challenge: minutes). Cache keys: short, with explicit invalidation on write.
- **Single-use values are consumed atomically** — read and delete, so a replayed code or challenge fails.

## Locks and Claims

`acquireLock(key, ttlMs)` is `SET key <random> EX <ttl> NX`; `releaseLock` deletes only if the value still matches (Lua), so a slow holder cannot release a lock that expired and was re-acquired by someone else.

**Check-then-mark is racy.** Two workers both pass "not processed yet" before either marks it. Claim with `SET NX`, and **release the claim when the attempt fails** — otherwise "retry three times" becomes "try once, no-op twice", with logs identical to three successes.

**As-built, there are no worker idempotency claims.** Earlier documentation described them; the only lock in the codebase is the registration lock. Where at-least-once delivery could double an effect today:

| Consumer | Protected by |
|---|---|
| Stripe webhooks | natural idempotency — `Invoice.findOrCreate` on `stripeInvoiceId`, status updates. But `upsertInvoice` never updates an existing row, so an invoice that failed and was later paid stays **Open** (A-25) |
| email queue | nothing — a redelivered message sends the email again |
| batch jobs | job status in the database |

## RabbitMQ

| Queue | Producer | Consumer | Dead letter |
|---|---|---|---|
| `batch_jobs` | `batchJob.service.js` | `workers/batchJob.worker.js` | `batch_jobs_dlq` |
| `email_queue` | `emailQueue.service.js` | the same module | `email_dlq` |

Rules:

- **Durable queues, persistent messages.** A broker restart must not lose accepted work.
- **Prefetch bounded** (`BATCH_PREFETCH`, default 5; email uses `RABBITMQ_PREFETCH_COUNT`).
- **Ack after the effect, not before.** A crash between ack and effect loses the job silently.
- **Every queue has a dead-letter queue**, and something watches it (P7-02).
- `BATCH_JOBS_INLINE=true` runs jobs in-process with no broker — development only. In production it makes a job synchronous with the request that queued it and reintroduces the 30-second timeout the queue exists to avoid.

### Things that should be on the queue and are not

**Webhook delivery** runs in-process: `setTimeout` backoff of 1, 2, 4, 8 seconds, about 15 seconds end to end, and every pending retry is lost on restart (A-10). The service's own comment names RabbitMQ with a DLQ as the intended design. New work that must outlive a request does not copy the in-process pattern.

## MQTT

Not a queue in this system. The backend is an optional MQTT **client** of an external broker for IoT telemetry; see [`../DEVELOPER/07-IOT-INGEST.md`](../DEVELOPER/07-IOT-INGEST.md).
