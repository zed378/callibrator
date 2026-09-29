# 00 — Webhook Architecture

The whole outbound webhook pipeline on one page: how a domain event becomes a signed POST, where it waits, how it is retried, where it ends up when it cannot be delivered, and when its record is deleted. This is the index above [`01`](./01-EVENT-CATALOG.md), [`03`](./03-WEBHOOK-SECURITY.md) and [`04`](./04-WEBHOOK-RETRY.md). It names each mechanism once and links to the document that owns the detail.

> **Target standard: TypeScript, strict (ADR-038).** As built, the pipeline is **JavaScript/CommonJS**. That covers `webhook.service.js`, `webhookDeliveryPurge.service.js`, `webhook.controller.js`, `webhooks.route.js`, `webhook.validator.js`, `webhook.model.js`, `webhookDelivery.model.js` and the two scheduler middlewares. The one exception is the event catalogue, `backend/src/constants/webhookEvents.ts`, which was converted under Phase 9 (ADR-087 item 8). Its JavaScript callers `require` it without an extension. The database is PostgreSQL only (ADR-039).

**Sources** (all under `backend/src/` unless noted):

- `services/webhook.service.js`: emit, claim, deliver, sign, CRUD, rotation.
- `services/webhookDeliveryPurge.service.js`
- `middlewares/webhookDeliveryScheduler.middleware.js`
- `middlewares/webhookDeliveryPurgeScheduler.middleware.js`
- `controllers/webhook.controller.js`
- `routes/api/webhooks.route.js`
- `models/webhook.model.js` and `models/webhookDelivery.model.js`
- migrations `0022-encrypt-webhook-secrets.js`, `0043-webhook-durable-delivery.js` and `0090-webhook-secret-rotation-overlap.js`
- the boot wiring in `backend/index.js:642` and `:646`

**Decisions:** ADR-054 (the outbox), ADR-070 decision 6 (the purge), ADR-085 decisions 5–7 (secret refusal, rotation overlap, audit path). All three are in `MEMORY/DECISIONS.md`.

---

## The Short Version

There is **no message broker in this pipeline.** `webhook_deliveries` is the queue, the retry schedule, the dead-letter list and the tenant-visible delivery log, all in one PostgreSQL table.

A-10's Definition of Done asked for RabbitMQ with a dead-letter queue. ADR-054 replaced that with a database outbox and records why. RabbitMQ is used in this codebase, but only by `rabbitmq.service.js` for batch jobs and the email queue. No webhook code imports it.

```
 domain service                    webhook_deliveries (the outbox)                 receiver
 ──────────────                    ───────────────────────────────                 ────────
 mutation + audit row
   │  inside its transaction
   ▼
 emitAfterCommit(tx, …) ──COMMIT──► emitEvent ── INSERT one row per matching ──┐
   (rollback: nothing)               │           webhook: status 'pending',     │
                                     │           next_attempt_at = now()        │
                                     ▼                                          │
                            first attempt, at once ◄────────────────────────────┤
                            (≤ 10 in flight per process,                        │
                             past that the row waits)                           │
                                                                                │
 dispatcher: at boot, then every 15 s, on every replica                         │
   claim: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)  ◄─────────────┘
          sets a 5-min lease on next_attempt_at
   │
   ▼
 deliverClaimed ── re-read the webhook ── deleted/deactivated? ──► 'exhausted'
   │
   ▼
 attemptDelivery ── DNS/SSRF check ── sign v1 (+ previous) ── POST, redirect:"manual" ──► 2xx ► 'success'
   │                                                                                    │
   │                                     non-2xx · 3xx · timeout · refusal ◄────────────┘
   ▼
 attempt < 12 ?  yes ──► 'failed', next_attempt_at = now + min(1 min × 2^(n−1), 6 h)
                 no  ──► 'exhausted' (the dead letter)

 purge: daily 03:43, singleton ── DELETE 'success'/'exhausted' rows older than 30 days
```

## The Stages

| Stage | What happens, as built | Code | Detail |
|---|---|---|---|
| **Emit** | A service calls `emitAfterCommit(transaction, tenantId, event, payload)` inside its transaction. The emit runs from `transaction.afterCommit`, so a rollback emits nothing. With no transaction it emits immediately. `emitEvent` never throws to its caller: a failure is logged and returned as `{ matched: 0, error }`. | `webhook.service.js#emitAfterCommit` (632), `#emitEvent` (569) | [`01`](./01-EVENT-CATALOG.md) § Emission and Transactions |
| **Match** | Active webhooks of that tenant whose `events` JSONB contains the event name or `"*"`. Exact string match only: no prefixes, no wildcards other than `"*"`. | `emitEvent` (571–577) | [`01`](./01-EVENT-CATALOG.md) § How Subscriptions Match |
| **Enqueue** | One `webhook_deliveries` row per matching webhook: `status: 'pending'`, `next_attempt_at` = the **database's** `now()`. From this point the delivery survives a restart. | `emitEvent` (582–595) | [`04`](./04-WEBHOOK-RETRY.md) § The Delivery State Machine |
| **First attempt** | Made at once, through the same claim the dispatcher uses. Since W-17 at most `WEBHOOK_EMIT_CONCURRENCY` (default 10) first attempts are in flight per process. A row past that cap gets no immediate attempt and is counted as `deferred`. It is already due, so the next dispatcher pass sends it. | `emitEvent` (596–611), `dispatchDelivery` (526) | not in `04`. This row is the only place it is written down |
| **Claim** | One raw-SQL statement: `UPDATE … WHERE id IN (SELECT … WHERE status IN ('pending','failed') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT … FOR UPDATE SKIP LOCKED) RETURNING id, tenant_id`. It pushes `next_attempt_at` forward by the lease (`WEBHOOK_LEASE_MS`, 5 min), so no other claimer sees the row while its POST is in flight. | `claim` (438) | [`04`](./04-WEBHOOK-RETRY.md) § How The Queue Works |
| **Deliver** | The delivery and its webhook are re-read by `(id, tenant_id)` inside `runForTenant(tenantId)`. A deleted or deactivated webhook dead-letters the row, except a `webhook.test` delivery, which is still sent. `attemptDelivery` then does four things in order. It re-resolves DNS and refuses an internal address (`assertResolvedHostIsPublic`, every attempt). It signs `v1=HMAC(secret, "<ts>.<body>")`, plus `X-Webhook-Signature-Previous` inside a rotation window. It POSTs with `redirect: "manual"`, so a 3xx is a failure and is never followed. It aborts after `WEBHOOK_TIMEOUT_MS` (8 s). | `deliverInTenant` (536), `deliverClaimed` (472), `attemptDelivery` (358) | [`03`](./03-WEBHOOK-SECURITY.md) § The Signature, § SSRF |
| **Retry** | A failed attempt sets `status: 'failed'` and `next_attempt_at = now + min(BASE × 2^(n−1), CAP)`, which at the defaults is 1 min doubling to a 6 h cap. The dispatcher picks the row up when it is due. | `deliverClaimed` (508–515), `backoffMs` (69) | [`04`](./04-WEBHOOK-RETRY.md) § The Numbers |
| **Dead letter** | After `WEBHOOK_MAX_ATTEMPTS` (12, about 20.5 h of backoff), or at once for a deleted or deactivated webhook, or after one attempt for `webhook.test`: `status: 'exhausted'`, `next_attempt_at: NULL`, the reason in `last_error`. Nothing re-sends an exhausted row. | `deliverClaimed` (479–486, 508–518) | [`04`](./04-WEBHOOK-RETRY.md) § The Delivery State Machine |
| **Purge** | Daily at 03:43, `success` and `exhausted` rows whose `updated_at` is older than `WEBHOOK_DELIVERY_RETENTION_DAYS` (default 30, never below 7) are deleted. The purge goes tenant by tenant, 1,000 rows per transaction and at most 50,000 per run, with one `system:webhook-delivery-purge` audit row per batch. A `pending` or `failed` row is never purged. | `webhookDeliveryPurge.service.js#purgeFinishedDeliveries` (125) | [`04`](./04-WEBHOOK-RETRY.md) § The Delivery State Machine › Retention |

## Which Process Runs What

Everything runs inside the API process. There is no separate worker.

| Job | Started by | Runs on | Switched off by |
|---|---|---|---|
| first attempts | `emitEvent`, in whichever request or job emitted | the replica that emitted | nothing: they are the emit |
| dispatcher | `initWebhookDeliveryScheduler()`, `backend/index.js:642`. One pass immediately (this is what makes a restart resume), then `*/15 * * * * *` | **every replica.** Its schedule is read straight from `WEBHOOK_DISPATCH_SCHEDULER`, not through `scheduleSetting`, so `SCHEDULERS_ENABLED=false` does **not** stop it. `SKIP LOCKED` plus the lease make concurrent dispatchers safe | `WEBHOOK_DISPATCH_SCHEDULER=disabled` or `off`. First attempts are still made, but **no retry ever is** |
| purge | `initWebhookDeliveryPurge()`, `backend/index.js:646` | a **singleton** job, through `scheduleSetting` (ADR-060) | `WEBHOOK_DELIVERY_PURGE_SCHEDULER=disabled`, or `SCHEDULERS_ENABLED=false` |

Both scheduled jobs are registered with `jobMonitor.service` (`runMonitored`, `registerJob`), so the monitor records and alerts on a **pass that throws**. A receiver refusing deliveries is not a failed pass. It is the dispatcher working as intended, and nothing alerts on it (see § What Is Not Built).

## Tenant Isolation Along The Pipeline

The dispatcher is the one component that is cross-tenant by design, which makes it the part to review first on any change.

| Step | Isolation, as built |
|---|---|
| emit | an explicit `where: { tenantId, … }` in `emitEvent`, **plus** the global hooks whenever the caller runs inside a tenant context. Request paths and the calibration scan do: the scan runs each tenant's chunk inside `runForTenant` (`calibrationScheduler.service.js:330`, W-12). The explicit predicate stays regardless. [`01`](./01-EVENT-CATALOG.md) § Tenant Scoping On The Emit Path explains why it must never be removed as redundant |
| claim | raw SQL, so the hooks do not apply. The dispatcher's claim is **deliberately cross-tenant** and runs under `runAsSystem(SYSTEM_TASKS.WEBHOOK_DISPATCH)` (`dispatchDue`, 547). A first-attempt claim carries `AND id = :id AND tenant_id = :tenantId` |
| deliver | every row returns its own `tenant_id`. From there, all reads and writes run inside `runForTenant(that tenant)` **and** carry `tenantId` explicitly (W-12) |
| manage (the eight routes) | `auth, denyApiKey, rbac([TENANT_ADMIN])` on every route. `loadOwned` answers 404 for another tenant's id. `tests/routes/webhooks.twoTenant.test.js` covers every `:id` route |
| purge | tenant by tenant, inside `runForTenant`, with the tenant predicate explicit as well |

## The Management Surface

Eight routes, all in `routes/api/webhooks.route.js`, all behind `auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])`:

- `POST /`, which also carries `requireFeature("webhooks")`
- `GET /`
- `GET /:id`
- `PATCH /:id`
- `DELETE /:id`
- `GET /:id/deliveries`
- `POST /:id/test`
- `POST /:id/rotate-secret`

Every route that takes a body uses `validate(schema)`.

The signing secret is generated on the server and returned **once**. Three responses carry it: the create, a rotation, and a `PATCH` that changes the `url`. At rest it is a `kms.service` envelope. A caller-supplied `secret` is refused with 400. A rotation keeps the old secret signing for `overlapHours` (default 24, maximum 168, `0` ends it at once). A url change rotates with no overlap. [`03`](./03-WEBHOOK-SECURITY.md) owns all of this.

## Guarantees, And What Is Not Guaranteed

| Property | As built |
|---|---|
| a rolled-back change fires nothing | **yes.** The emit waits for `afterCommit` ([`01`](./01-EVENT-CATALOG.md)) |
| a committed change always fires | **no, but the window is narrow.** A process killed between COMMIT and the delivery-row INSERT loses that event. The window is milliseconds and is recorded in ADR-054 |
| a restart loses a scheduled retry | **no.** The retry is a column, and the boot pass resumes it |
| exactly once | **no, at-least-once.** A lease that expires during a very slow POST, or a `2xx` whose outcome write fails, sends the delivery again under the same id. Receivers deduplicate on `X-Webhook-Delivery` |
| ordering | **not guaranteed.** Read from the code: a pass claims up to 50 due rows ordered by `next_attempt_at` and sends them concurrently (`Promise.allSettled`), and retries interleave with new events. Nothing orders deliveries per webhook. No test asserts any order |
| a replay is detectable | **yes, for a receiver that checks.** The timestamp is signed and fresh on every attempt, and the delivery id is stable ([`03`](./03-WEBHOOK-SECURITY.md) § Verifying) |

## What Is Not Built

Each of these is an absence in the code as of 2026-09-28, not a hidden feature:

- **No metric or alert on dead letters.** An `exhausted` row produces one `warn` log line (`Webhook delivery exhausted after <n> attempt(s): <id>`) and nothing else. The delivery log (`GET /webhooks/:id/deliveries`, `DeliveriesPanel.tsx`) is the only view of it.
- **No redelivery.** There is no endpoint, script or UI that puts an `exhausted` row back into `failed`. A receiver that was down for longer than about 20.5 h loses those events.
- **No dual signing across the v1 change.** Receivers still verifying the pre-2026-09-24 `sha256=` scheme reject every delivery (ADR-054, bad implications).
- **No frontend for rotation.** `POST /rotate-secret` and `previousSecretExpiresAt` exist in the API. Per ADR-085 the dashboard has no rotate button yet (F-18).
- **No transactional outbox.** The delivery row is written after the business commit, not inside it (the emit gap above). ADR-054 records the stronger alternative and why it was not taken.

## Where To Read Next

| Question | Document |
|---|---|
| which events exist, where each is emitted, what `data` carries, how subscriptions match | [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) |
| how to verify a delivery; the secret's lifecycle and rotation; SSRF; who may repoint a webhook | [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| attempt counts, backoff, every env var, the state machine, retention, what the tests prove | [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) |
| the endpoints in API terms | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/webhooks` |
| how this fits the rest of the system | [`../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md`](../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md) |

## Evidence

These are the suites that exercise the pipeline end to end. They are named here, and [`04`](./04-WEBHOOK-RETRY.md) § What The Tests Prove says what each one asserts:

- `backend/src/tests/services/webhook.durable.a10.live.test.js`: real PostgreSQL 18, opt-in with `WEBHOOK_PG_LIVE_TEST=1`
- `backend/src/tests/services/webhook.delivery.a10.test.js`
- `backend/src/tests/services/webhookEmit.a11.test.js`
- `backend/src/tests/services/webhook.emitCap.w17.test.js`
- `backend/src/tests/services/webhook.secret.a51.test.js`
- `backend/src/tests/services/webhookDeliveryPurge.adr070.test.js`
- `backend/src/tests/routes/webhooks.twoTenant.test.js`
- `backend/src/tests/routes/routeGuards.a02.test.js`

This document was written from the code. None of these suites was run for it.
