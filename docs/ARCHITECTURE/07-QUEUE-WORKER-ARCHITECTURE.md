# 07 — Queue and Worker Architecture

RabbitMQ (`RABBITMQ_URL`, default `amqp://localhost:5672`). Worker: `backend/src/workers/`.

---

## What Runs Asynchronously

| Work | Why it cannot be synchronous |
|---|---|
| Batch import and export | a 5,000-row hospital inventory exceeds the 30s request timeout |
| Report generation | a full audit-trail export for a busy tenant takes minutes |
| Notification fan-out | a calibration sweep notifying 400 users must not block a request |
| Email delivery | SMTP latency is not the caller's problem |
| Webhook delivery with retry | the receiver may be down; retry is the whole point |
| Tenant backup | large, scheduled, resumable |
| Data-retention purge | large, scheduled |
| Document embedding for RAG | LLM provider latency |

## Inline Mode

```
BATCH_JOBS_INLINE=true
```

Processes jobs in-process with no broker. This exists so local development needs nothing but a database — a developer should be able to `git clone`, start Postgres, and have a working system.

Leave it unset in production. Inline mode makes the job synchronous with whatever triggered it, which reintroduces the timeout it was meant to avoid.

`BATCH_PREFETCH` (default 5) bounds how many messages a consumer holds unacknowledged.

## Batch Jobs

`batch_jobs` is the tracking table:

| Column | Purpose |
|---|---|
| `type` | what kind of job |
| `status` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `progress` | 0–100 |
| `totalItems`, `processedItems` | the numbers behind the percentage |
| `resultUrl` | where the output landed |
| `errorDetails` | why it failed |

Surface: `/dashboard/batch-jobs`.

**A job must terminate.** `PROCESSING` is not a resting state, and a job stuck there is indistinguishable from one that is working. A worker crash must leave the row recoverable — either reclaimed by another consumer or marked `FAILED` by a sweep — and this is the failure mode most worth testing.

## Idempotency — the part that matters

The pattern that reads correctly and is wrong:

```js
// RACY — do not do this
const already = await redis.get(key);
if (already) return;
await doWork();
await redis.set(key, "1");
```

Two consumers can both pass the `get` before either `set`. The result is a payment credited twice, or an email sent twice, with nothing in the logs looking abnormal.

The correct primitive is one atomic operation:

```js
const claimed = await redis.set(key, "1", "NX", "EX", ttl);
if (!claimed) return;              // someone else has it
try {
  await doWork();
} catch (err) {
  await redis.del(key);            // RELEASE, or the retry does nothing
  throw err;
}
```

The release is not optional. Without it, "retry three times" becomes "try once, no-op twice" — and the logs of that are identical to three successful attempts, which is why it survives review.

## Delivery Semantics

At-least-once. RabbitMQ redelivers on nack and on connection loss. The consumer must therefore be idempotent, and idempotency is what makes duplicate delivery safe rather than something to be prevented.

Acknowledge **after** the work, never before. Acknowledging first turns a crash into silent data loss.

## Webhook Delivery

`webhooks` and `webhook_deliveries`:

| Column | Purpose |
|---|---|
| `event` | what happened |
| `payload` | JSONB body |
| `status` | `pending`, `success`, `failed`, `exhausted` |
| `attempts` | retry count |
| `responseStatus` | what the receiver said |
| `lastError` | why it failed |
| `deliveredAt` | when it succeeded |

`exhausted` is a distinct terminal state from `failed`. `failed` means this attempt failed and another will follow; `exhausted` means we have stopped trying. Collapsing them loses the ability to answer "did we give up, or are we still going?".

Payloads are signed with the per-webhook `secret` so the receiver can verify origin.

## Scheduled Work

`node-cron`, installed at app assembly:

| Variable | Job |
|---|---|
| `SESSION_CLEANUP_SCHEDULER` | expired sessions |
| `BACKUP_SCHEDULER` | tenant backups |
| `RETENTION_SCHEDULER` | data-retention purge; `disabled` turns it off |
| calibration sweep | due and overdue notifications |

### Scheduled jobs and multiple replicas

**A cron job installed in every replica runs once per replica.** Two backend replicas means every scheduled backup runs twice and every retention purge runs twice.

Two mitigations, and the system currently relies on the second:

1. Leader election by Redis lease — one replica holds the schedule.
2. Deployment discipline — exactly one replica runs the schedulers.

The Helm chart guards this: a configuration with more than one cron-enabled replica **fails to render** rather than deploying a stack that silently double-runs every job. See [`../DEVOPS/09-KUBERNETES.md`](../DEVOPS/09-KUBERNETES.md).

Note that a lease is not consensus. It bounds duplication; idempotency is what makes the remaining duplication harmless.

## System Tasks and Tenant Scope

Background work spanning tenants sets `isSystemTask` in the `AsyncLocalStorage` context, which skips the tenant predicate.

That is a deliberate, auditable hole in the isolation model. A worker that sets it and then handles tenant-specific work without re-scoping is a cross-tenant bug with no error to signal it. Set it as narrowly as possible, and never for the duration of a whole consumer loop.

## Operational

```yaml
rabbitmq:
  image: rabbitmq:3.13-management-alpine
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "check_port_connectivity"]
    interval: 10s
    retries: 15
    start_period: 60s
```

`check_port_connectivity`, not `ping`. `ping` proves the Erlang node is up; only the port check proves the AMQP listener on 5672 is accepting connections, which is what the backend actually needs. RabbitMQ with the management plugin can take a while on first boot, hence the long start period.

Management UI on 15672.

## MQTT Is Separate

IoT telemetry ingest uses an **embedded** `aedes` MQTT broker inside the Express process (`MQTT_HOST`, `MQTT_PORT`), not RabbitMQ.

Embedding it means a hospital deployment does not need a separate broker to accept device telemetry — which matters in an on-premise install where every additional service is a procurement conversation.

The trade-off: the MQTT broker scales with the API process and does not survive its restart. For telemetry, where a dropped reading is a gap in a trend rather than lost evidence, that is acceptable. It would not be acceptable for anything on the calibration path.
