# 04 — Webhook Retry

How many times a delivery is attempted, how far apart, what the delivery row says at each point, and what happens to a delivery across a restart.

Source: `backend/src/services/webhook.service.js`, `backend/src/middlewares/webhookDeliveryScheduler.middleware.js`, `backend/src/models/webhookDelivery.model.js`, migration `0043-webhook-durable-delivery.js`. Decision: **ADR-054** (`MEMORY/DECISIONS.md`).

---

## The Short Version

> **As-built since 2026-09-24 (A-10, ADR-054).** Until then retries were four `setTimeout` waits (1-2-4-8 s) inside the emitting process, and a restart lost every one of them. That is gone.

**`webhook_deliveries` is the queue** — a database outbox. Every retry's schedule is a column (`next_attempt_at`) on the delivery row, not a timer in memory. A dispatcher claims due rows with `FOR UPDATE SKIP LOCKED`, at boot and every 15 seconds, so a restart resumes where the previous process stopped and two replicas never send the same attempt.

**12 attempts over about 20.5 hours**, then the row is `exhausted` — the dead letter.

A-10's Definition of Done named RabbitMQ with a dead-letter queue. The outbox replaced it by decision; ADR-054 records why, and what it costs.

## The Numbers

```js
const MAX_ATTEMPTS    = Number(process.env.WEBHOOK_MAX_ATTEMPTS)    || 12;
const TIMEOUT_MS      = Number(process.env.WEBHOOK_TIMEOUT_MS)      || 8000;
const BACKOFF_BASE_MS = Number(process.env.WEBHOOK_BACKOFF_BASE_MS) || 60 * 1000;
const BACKOFF_CAP_MS  = Number(process.env.WEBHOOK_BACKOFF_CAP_MS)  || 6 * 60 * 60 * 1000;
const LEASE_MS        = Number(process.env.WEBHOOK_LEASE_MS)        || 5 * 60 * 1000;
const BATCH_SIZE      = Number(process.env.WEBHOOK_DISPATCH_BATCH)  || 50;

const backoffMs = (attempt) => Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
```

The wait follows a failed attempt `n` and is `backoffMs(n)`; `n` attempts means `n − 1` waits.

| After attempt | Wait until the next |
|---|---|
| 1 | 1 min |
| 2 | 2 min |
| 3 | 4 min |
| 4 | 8 min |
| 5 | 16 min |
| 6 | 32 min |
| 7 | 64 min |
| 8 | 128 min |
| 9 | 256 min |
| 10 | 6 h (cap) |
| 11 | 6 h (cap) |
| 12 | none — `exhausted` |
| | **1231 min ≈ 20.5 h of backoff** |

A retry is due at `next_attempt_at`; it is sent on the first dispatcher pass after that, so each wait can run up to one poll interval (15 s) longer.

| Variable | Default | Effect |
|---|---|---|
| `WEBHOOK_MAX_ATTEMPTS` | 12 | attempts before the dead letter |
| `WEBHOOK_TIMEOUT_MS` | 8000 | per-attempt abort |
| `WEBHOOK_BACKOFF_BASE_MS` | 60000 | first wait; doubles per attempt |
| `WEBHOOK_BACKOFF_CAP_MS` | 21600000 | the longest wait (6 h) |
| `WEBHOOK_LEASE_MS` | 300000 | how long a claimed row is invisible to other claimers — keep it well above `WEBHOOK_TIMEOUT_MS` |
| `WEBHOOK_DISPATCH_BATCH` | 50 | rows claimed per pass |
| `WEBHOOK_DISPATCH_SCHEDULER` | `*/15 * * * * *` | the dispatcher's cron (seconds field); `disabled`/`off` stops all retries |

All are read at module load; changing one requires a restart.

## The Delivery State Machine

One row in `webhook_deliveries` per (webhook, event), created by `emitEvent` or `testWebhook` and updated in place. `attempts` is the count; only the last error survives.

**Retention (ADR-070).** A finished row — `success` or `exhausted` — is deleted once its `updated_at` is older than `WEBHOOK_DELIVERY_RETENTION_DAYS` (default 30, never below 7) by the daily purge (`WEBHOOK_DELIVERY_PURGE_SCHEDULER`, 03:43; off with `SCHEDULERS_ENABLED=false`). It works tenant by tenant, 1,000 rows per transaction and at most 50,000 per run, each batch with a `system:webhook-delivery-purge` audit row. A `pending` or `failed` row is never purged. The delivery log therefore shows 30 days.

| Status | `next_attempt_at` | Meaning |
|---|---|---|
| `pending` | the database's `now()` at creation | not attempted yet — due immediately |
| `failed` | now + backoff(attempts) | the last attempt failed; another is scheduled |
| `success` | `NULL` | a `2xx` was received |
| `exhausted` | `NULL` | the dead letter: attempts ran out, or the webhook was deleted or deactivated |

While an attempt is in flight, `next_attempt_at` holds the **lease** (claim time + 5 min). If the sender dies, the row is simply due again when the lease passes: nothing is stranded.

What each outcome writes:

| Outcome | `status` | `attempts` | `responseStatus` | `lastError` | `next_attempt_at` |
|---|---|---|---|---|---|
| 2xx | `success` | n | the HTTP status | `null` | `NULL` |
| non-2xx (incl. a 3xx — never followed) | `failed` / `exhausted` | n | the HTTP status | `HTTP <status>` or the redirect message | backoff / `NULL` |
| abort (timeout) | `failed` / `exhausted` | n | `null` | `timeout` | backoff / `NULL` |
| any other throw (connection refused, SSRF refusal) | `failed` / `exhausted` | n | `null` | the message | backoff / `NULL` |
| webhook deleted since the event | `exhausted` | unchanged | unchanged | `webhook deleted` | `NULL` |
| webhook deactivated since the event | `exhausted` | unchanged | unchanged | `webhook deactivated` | `NULL` |

**The webhook is re-read before every attempt**, tenant-scoped: a webhook deleted or deactivated in response to an incident stops receiving at once, instead of for the rest of a 20-hour schedule. Its current `url` and `secret` are used, so a `PATCH` or rotation mid-schedule applies to the remaining attempts.

## How The Queue Works

```
emitEvent(tenantId, event, payload)
  └ per matching active webhook: INSERT row (pending, next_attempt_at = now())
  └ dispatchDelivery(id, tenantId) — the first attempt, off the caller's path

claim — one statement:
  UPDATE webhook_deliveries
     SET next_attempt_at = now() + make_interval(secs => :leaseSeconds), updated_at = now()
   WHERE id IN (SELECT id FROM webhook_deliveries
                 WHERE status IN ('pending','failed') AND next_attempt_at <= now()
                 [AND id = :id AND tenant_id = :tenantId]      -- the first attempt
                 ORDER BY next_attempt_at LIMIT :limit
                 FOR UPDATE SKIP LOCKED)
  RETURNING id, tenant_id

deliverClaimed(row) — read delivery + webhook by (id, tenant_id), POST, write the outcome
```

- **Replicas:** `SKIP LOCKED` means two dispatchers claiming at the same instant lock disjoint rows; the lease keeps a claimed row out of every later claim until its outcome is written.
- **Restart:** the dispatcher runs a pass at boot. Every row that was due, or whose lease has expired, is sent. Tested — see below.
- **The first attempt** uses the same claim (by id, bound to the tenant), so an emit and a concurrent dispatcher tick cannot both send it.
- **Tenant isolation:** the dispatcher's claim is deliberately cross-tenant — it is a system worker with no request context, like the calibration scan — and every read after it is scoped by the claimed row's own `tenant_id`. The partial index `webhook_deliveries_due (next_attempt_at) WHERE status IN ('pending','failed')` serves the claim.

**At-least-once, not exactly-once.** A receiver can see the same delivery twice (a lease that expired while a very slow POST was still in flight; a `2xx` whose outcome write failed). The delivery id is the same both times; deduplicate on it.

**The emit gap.** Domain events are emitted from `transaction.afterCommit` ([`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) § Emission). A process killed between the business COMMIT and the delivery-row INSERT loses that event. Milliseconds wide; recorded in ADR-054.

## Rows From Before 0043

Migration 0043 handed the old loop's leftovers to the dispatcher: `pending`/`failed` rows under 24 h old got `next_attempt_at = now()` and resume; older ones became `exhausted`, with `0043: retry schedule lost before durable delivery; not resumed (older than 24 h)` appended to `last_error`.

## The Test Endpoint

`POST /api/v1/webhooks/:id/test` makes **one** attempt, synchronously, and returns its result (`deliveryId`, `status`, `responseStatus`, `attempts`, `lastError`). A failed test is `exhausted` at once — the caller wants the answer now, not a retry tomorrow. It is sent even to a deactivated webhook (testing before activating is the point), and it bypasses subscription matching. At most one 8 s timeout, well inside the 30 s request timeout.

## For A Receiver

| Rule | Why |
|---|---|
| **Verify the v1 signature and reject stale timestamps** | the recipe is in [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| **Answer `2xx` quickly; do the work afterwards** | over 8 s is aborted and counted as a failure |
| **Deduplicate on `X-Webhook-Delivery`** | delivery is at-least-once; the id and the body are identical on every attempt (the timestamp and signature are not) |
| **Expect retries for ~20 h** | a receiver that is down for an hour still gets the event |
| **`5xx`, `429`, `401` are all "retry later"** | there is no `Retry-After` handling; the schedule is fixed |

## Observability

- **The delivery log** — `GET /api/v1/webhooks/:id/deliveries`, rendered by `DeliveriesPanel.tsx`. `status = 'exhausted'` is the dead-letter list; `last_error` says why.
- **Log lines:** `Webhook delivery exhausted after <n> attempt(s): <id>` (warn), and `Webhook dispatch: claimed=…, errors=…` for each pass that found work (info). Winston writes to files in production — [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md).
- There is still no metric or alert on the dead-letter count, and no manual redelivery endpoint.

## What The Tests Prove

| Test file | What |
|---|---|
| `tests/services/webhook.durable.a10.live.test.js` | **real PostgreSQL 18** (opt-in, `WEBHOOK_PG_LIVE_TEST=1`): restart survival across separately loaded module graphs; two replicas dispatching 30 due rows send each exactly once (`SKIP LOCKED`); a leased row is invisible until the lease expires; two-tenant isolation of events, claims, listing and test; a rolled-back transaction emits nothing, a committed one emits once |
| `tests/services/webhook.delivery.a10.test.js` | a **real HTTP receiver** in-process (`tests/fixtures/webhookReceiver.js`) verifying every request with the documented recipe: signature accepted; replay stale / tampered / duplicate; wrong secret → 401 → retry scheduled; restart survival; 12 attempts then dead letter; two-tenant isolation |
| `tests/services/webhook.service.test.js` | every branch of claim / deliver / dispatch / emit / emitAfterCommit, the schedule arithmetic, env overrides |
| `tests/middlewares/webhookDeliveryScheduler.middleware.test.js` | the boot pass, the schedule, disable/invalid, no overlap |

## Related

| For | Read |
|---|---|
| what is being delivered, and when it is emitted | [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) |
| the signature and the receiver's recipe | [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| the `webhook_deliveries` columns | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/webhooks` |
| why not RabbitMQ | `MEMORY/DECISIONS.md` § ADR-054 |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-10 |
