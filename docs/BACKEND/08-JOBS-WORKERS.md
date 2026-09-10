# 08 — Jobs, Workers and Schedulers

RabbitMQ (`RABBITMQ_URL`). Worker: `backend/src/workers/`. Architecture: [`../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md`](../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md).

---

## What Runs Asynchronously

| Work | Why not synchronous |
|---|---|
| Bulk import and export | a 5,000-row inventory exceeds the 30s request timeout |
| Report generation | a full audit-trail export takes minutes |
| Notification fan-out | a calibration sweep notifying 400 users must not block a request |
| Email delivery | SMTP latency is not the caller's problem |
| Webhook delivery with retry | the receiver may be down; retry is the point |
| Tenant backup | large, scheduled, resumable |
| Data-retention purge | large, scheduled |
| Document embedding for RAG | LLM provider latency |

## Inline Mode

```
BATCH_JOBS_INLINE=true      # in-process, no broker
BATCH_PREFETCH=5            # unacknowledged messages per consumer
```

Inline exists so local development needs nothing but a database. A developer should be able to clone, start Postgres, and have a working system.

**Leave it unset in production.** Inline makes the job synchronous with whatever triggered it, reintroducing the timeout it exists to avoid.

## Batch Job Tracking

`batch_jobs`: `type`, `status` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), `progress`, `totalItems`, `processedItems`, `resultUrl`, `errorDetails`.

**`PROCESSING` is not a resting state.** A job stuck there is indistinguishable from one that is working, and a worker crash leaves exactly that.

A job must terminate. A crash must leave the row recoverable — reclaimed by another consumer, or swept to `FAILED` — and this is the failure mode most worth testing.

`totalItems` and `processedItems` alongside `progress`, because "47%" cannot tell a user whether that is 47 rows or 47,000.

## Idempotency — the part that matters

Delivery is **at-least-once**. RabbitMQ redelivers on nack and on connection loss; Stripe retries webhooks. Both are correct, and both produce duplicate side effects unless the consumer is idempotent.

### The pattern that reads correctly and is wrong

```js
// RACY — do not do this
const already = await redis.get(key);
if (already) return;
await doWork();
await redis.set(key, "1");
```

Two consumers can both pass the `get` before either `set`. The result is a payment credited twice, or an email sent twice, with **nothing in the logs looking abnormal**.

### The correct primitive

```js
const claimed = await redis.set(key, "1", "NX", "EX", ttl);
if (!claimed) return;                 // someone else has it

try {
  await doWork();
} catch (err) {
  await redis.del(key);               // RELEASE, or the retry does nothing
  throw err;
}
```

**The release is not optional.** Without it, "retry three times" becomes "try once, no-op twice" — and the logs of that are **identical to three successful attempts**, which is why it survives review.

### Acknowledge after the work

Never before. Acknowledging first turns a crash into silent data loss.

## The Redis Dependency

Idempotency claims live in Redis. **A Redis outage window is a window in which duplicates were possible** — duplicate emails, duplicate webhook deliveries, duplicate job side effects.

Redis coming back is not the end of that incident. The window needs reviewing, not assuming ([`../SECURITY/12-INCIDENT-RESPONSE.md`](../SECURITY/12-INCIDENT-RESPONSE.md)).

Redis persistence is on (`./data/redis:/data`) partly for this reason: losing claims on restart reopens the duplicate window for anything in flight.

## Webhook Delivery

`webhook_deliveries`: `status` (`pending`, `success`, `failed`, `exhausted`), `attempts`, `responseStatus`, `lastError`, `deliveredAt`.

`exhausted` is a **distinct terminal state** from `failed`: `failed` means this attempt failed and another will follow; `exhausted` means we have stopped trying. Collapsing them loses the ability to answer "did we give up, or are we still going?".

Payloads are signed with the per-webhook `secret`.

**A tenant-supplied URL is an SSRF vector** — the platform makes an outbound request from its own network position to an address the tenant chose. Destination validation is not optional.

## Schedulers

`node-cron`, installed at app assembly. The files live in `middlewares/`, which misleads — they are not per-request middleware.

| Variable | Job |
|---|---|
| `SESSION_CLEANUP_SCHEDULER` | expired sessions |
| `BACKUP_SCHEDULER` | tenant backups |
| `RETENTION_SCHEDULER` | data-retention purge; `disabled` turns it off |
| — | calibration due sweep |

### One replica, or every job runs twice

**A cron job installed in every replica runs once per replica.** Two backend replicas means every scheduled backup runs twice, every retention purge runs twice, every calibration sweep notifies twice.

Two mitigations; the system relies on the second:

1. Leader election by Redis lease.
2. **Deployment discipline** — exactly one replica runs schedulers.

The Helm chart **refuses to render** a configuration with more than one cron-enabled replica, turning a silent double-run into a deployment failure ([`../DEVOPS/09-KUBERNETES.md`](../DEVOPS/09-KUBERNETES.md)).

A lease is not consensus. It bounds duplication; **idempotency** makes the remainder harmless.

### Scheduled failures must be surfaced

The retention purge once failed **every night** with `column "tenantId" does not exist`, because the sessions branch used `tenantId` where the model attribute is `tenant_id`.

A scheduled compliance job failing silently is worse than one that never ran, because everyone believes it did. Scheduler outcomes need alerting, not just logging ([`../DEVOPS/07-ALERTING.md`](../DEVOPS/07-ALERTING.md)).

## `isSystemTask` and Tenant Scope

Background work spanning tenants sets `isSystemTask` in the CLS context, which **skips the tenant predicate**.

That is a deliberate, auditable hole in the isolation model.

**Set it as narrowly as possible.** A worker that sets it for the duration of a whole consumer loop turns every query in that loop into a cross-tenant query, and there will be no error to signal it.

Per-message, around the specific operation — never around the loop.

## MQTT Is Separate

IoT telemetry uses an **embedded `aedes` broker inside the Express process** (`MQTT_HOST`, `MQTT_PORT`), not RabbitMQ.

Embedding it means a hospital deployment does not need a separate broker — which matters in an on-premise install where every additional service is a procurement conversation.

The trade-off: it scales with the API process and does not survive its restart. For telemetry, where a dropped reading is a gap in a trend rather than lost evidence, that is acceptable. It would not be acceptable on the calibration path.

## Testing

| Assertion |
|---|
| a job terminates in `COMPLETED` or `FAILED`, never resting in `PROCESSING` |
| a worker crash leaves the job recoverable |
| the second delivery of the same message is a **no-op** |
| a **failed** attempt releases its claim and the retry actually retries |
| an exhausted webhook stops and is marked `exhausted`, not `failed` |
| `isSystemTask` is scoped to the operation, not the loop |
| a scheduler failure is surfaced, not only logged |

The fourth is the one most often missing, and it is the one that distinguishes working retry from the illusion of it.
