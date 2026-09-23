# 04 — Webhook Retry

How many times a delivery is attempted, how far apart, what the delivery row says at each point, and what a deploy in the middle of it destroys.

Source: `backend/src/services/webhook.service.js`, `backend/src/models/webhookDelivery.model.js`.

---

## The Short Version

**Retries are four `setTimeout` waits inside the Node process that emitted the event.** 1 s, 2 s, 4 s, 8 s. The whole retry window is about **15 seconds**. There is no queue, no worker, no persistence of the schedule, and no resumption: every pending retry dies with the process, on restart, deploy, crash or scale-down.

A receiver that is down for a minute has missed the event permanently. This is [A-10](../../TASKS/AUDIT-2026-09-REMEDIATION.md).

## The Numbers

`webhook.service.js:25`:

```js
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 5;
const TIMEOUT_MS   = Number(process.env.WEBHOOK_TIMEOUT_MS)   || 8000;
```

`webhook.service.js:211`:

```js
const backoff = Math.min(2 ** attempt * 500, 30000);
```

The wait happens *after* an attempt, and only when `attempt < MAX_ATTEMPTS` — so `n` attempts means `n − 1` waits.

| After attempt | `2 ** attempt * 500` | Wait |
|---|---|---|
| 1 | 1 000 | 1 s |
| 2 | 2 000 | 2 s |
| 3 | 4 000 | 4 s |
| 4 | 8 000 | 8 s |
| 5 | — | none; the loop ends |
| | | **15 s of backoff, total** |

**The 30 s cap is unreachable at the default.** `2 ** attempt * 500` first exceeds 30 000 at `attempt = 6`, so the cap only binds if `WEBHOOK_MAX_ATTEMPTS` is set above 6. At the shipped default it is dead code.

**15 seconds is the backoff, not the wall clock.** Each attempt can itself take up to `WEBHOOK_TIMEOUT_MS` (8 s), enforced by an `AbortController` whose timer is cleared in a `finally`. Against a receiver that accepts the connection and never answers, the worst case is `5 × 8 s + 15 s ≈ 55 seconds` from emit to `exhausted`. Against a receiver that refuses the connection, it is 15 seconds plus change.

| Variable | Default | Effect |
|---|---|---|
| `WEBHOOK_MAX_ATTEMPTS` | 5 | total attempts; `n − 1` backoff waits |
| `WEBHOOK_TIMEOUT_MS` | 8000 | per-attempt abort |

Both are read **at module load**, into `const`s. Changing either requires a restart.

## The Delivery State Machine

One row in `webhook_deliveries` per (webhook, event), created by `emitEvent` or `testWebhook`, then **updated in place** on every attempt. The table is not an attempt log — it is a delivery log with an attempt counter. `attempts` is the count; the individual attempts are not retained, and only the last error survives.

| Status | Meaning |
|---|---|
| `pending` | the row exists; no attempt has completed |
| `failed` | this attempt failed and another will follow |
| `success` | a `2xx` was received; the loop returned |
| `exhausted` | the last attempt failed; we have stopped |

`failed` and `exhausted` being distinct is the point. `failed` answers "still trying"; `exhausted` answers "we gave up". Collapsing them loses the only question an operator actually asks.

What each outcome writes (`webhook.service.js:183`):

| Outcome | `status` | `attempts` | `responseStatus` | `lastError` | `deliveredAt` |
|---|---|---|---|---|---|
| `res.ok` (2xx) | `success` | attempt no. | the HTTP status | cleared to `null` | now |
| non-2xx | `failed`, or `exhausted` on the last attempt | attempt no. | the HTTP status | `HTTP <status>` | untouched |
| abort (timeout) | `failed` / `exhausted` | attempt no. | **not written** | `timeout` | untouched |
| any other throw | `failed` / `exhausted` | attempt no. | **not written** | `err.message` | untouched |

Three consequences worth knowing before you read a row:

- **`res.ok` is the success criterion** — the `fetch` definition, `200–299`. A `3xx` is not success (and see [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) § redirects for what actually happens to one). A `204` is.
- **`responseStatus` is never cleared.** A delivery that got a `500` on attempt 1 and then timed out on attempts 2–5 ends `exhausted` with `responseStatus = 500` and `lastError = "timeout"`. The two columns are from different attempts.
- **A row can stay `pending` forever.** `pending` is only overwritten when an attempt *completes*. A process that dies between `WebhookDelivery.create` and the first update leaves `pending` with `attempts = 0`, and nothing will ever touch it again.

An SSRF rejection from `assertResolvedHostIsPublic` is one of the "any other throw" cases: `lastError` becomes `URL host resolves to a disallowed (internal) address`, and — because the check runs at the top of every attempt — the delivery burns all five attempts on it.

## Durability: What A Restart Destroys

```js
// webhook.service.js:242 — inside emitEvent, per matching webhook
deliverWithRetry(webhook, delivery).catch((e) =>
  logger.error(`Webhook delivery error: ${e.message}`),
);
```

No `await`. The promise is a detached in-process chain of `await new Promise(r => setTimeout(r, backoff))`. Its entire state — which webhook, which attempt, how long to wait — lives in a closure in the heap of one Node process.

**A restart, deploy, crash, OOM kill or scale-down during that window loses it.** There is no queue to redeliver from, no scan on boot that picks up `pending` or `failed` rows, and no manual redelivery endpoint. The row is left at whatever it said when the process died — `pending`, or `failed` mid-schedule — **forever, with no terminal state and no alarm.** A `failed` row older than about a minute is a delivery that was abandoned, not one still in flight, and nothing in the schema records the difference.

A rolling deploy at 01:00 is the concrete case: the calibration scan runs at `0 1 * * *` by default, the retry window is 15 seconds wide, and a deploy that restarts the backend in that window silently drops every device event of that night.

The service's own header comment names the intended design:

> `Delivery is in-process (async, DB-tracked). For a multi-instance deployment this dispatch would move behind a durable queue (RabbitMQ) with a dedicated worker + DLQ — deferred, as one process is sufficient for the single-binary deploy…`

That is an accurate statement of what was deferred and why. It is **not** a claim that the current design is durable on one process, and it should not be read as one: a single process still restarts.

### Multi-instance is worse than "not yet done"

With more than one backend replica, `emitEvent` runs on whichever replica ran the cron. `node-cron` in `calibrationScheduler.middleware.js` has no leader election and no distributed lock, so **every replica runs the scan**. The scan's idempotency guard (skip devices with an open `Preventative` work order) is a read-then-write with no lock, so two replicas racing it can both pass the check.

The failure mode is duplicate work orders *and* duplicate webhook deliveries — with **different** `webhook_deliveries.id` values, so a receiver deduplicating on the delivery id cannot collapse them. This has not been observed; it is read off the code. The reference deployment runs one replica, which is why it has not bitten.

## Between Attempts, Nothing Is Re-read

`deliverWithRetry(webhook, delivery)` holds the Sequelize instances it was handed. Across the whole retry window it never reloads either.

- **`isActive` is checked at emit time only.** Deactivating a webhook — or deleting it — while a retry is in flight does not stop the remaining attempts. `deleteWebhook` is a soft delete (`softDelete()` sets `isDeleted`, per `webhook.model.js`), and the in-memory instance keeps its `url` and `secret`. Deletion takes effect for the *next* event, not this one.
- **`url` and `secret` are pinned for the delivery.** A `PATCH` mid-window does not redirect the remaining attempts; they go to the URL captured at emit. Bounded, and probably what you want — but say so rather than assume it.

The window is 15 seconds, so the practical exposure is small. It stops being small the moment the retry schedule is lengthened to hours, which is exactly what A-10 asks for. **Whoever implements A-10 must add an `isActive` / `isDeleted` re-check before each attempt**, or a webhook deleted in response to an incident will keep delivering for hours.

## The Test Endpoint Is Not Fire-And-Forget

`testWebhook` (`webhook.service.js:254`) is the one path that **awaits** the retry loop:

```js
await deliverWithRetry(webhook, delivery).catch(() => {});
const fresh = await WebhookDelivery.findByPk(delivery.id);
```

So `POST /api/v1/webhooks/:id/test` holds the HTTP request open for the full schedule — up to ~55 seconds against a black-holed receiver — and returns the settled result (`deliveryId`, `status`, `responseStatus`, `attempts`, `lastError`). That result is genuinely useful; the blocking is the cost.

`backend/index.js:290` mounts `connect-timeout` at **30 s**, with a `408` handler. A test delivery whose schedule runs past 30 s therefore exceeds the request timeout while the loop continues in the background; the loop's eventual `success()` call would then be writing to a response that has already been sent.

> **Not verified against a running server.** The interaction between `connect-timeout`, this handler's position in the middleware stack, and the late `success()` write has been read out of `index.js`, not observed. The 30 s limit and the ~55 s worst case are both facts from the code; what the caller sees when they collide is not something this document can state. If you need to know, reproduce it against a receiver that accepts and never responds.

A test against a *reachable* receiver answers in well under a second, which is why this has not been a problem.

## For A Receiver

| Rule | Why |
|---|---|
| **Answer `2xx` immediately; do the work afterwards** | anything over 8 s is aborted and counted as a failure, and you will be sent the event again |
| **Deduplicate on `X-Webhook-Delivery`** | it is stable across every retry of a delivery, and the body's `id` is the same value. Retries of the same delivery are byte-identical, signature included |
| **Do not treat a new delivery id as freshness** | there is no timestamp and no replay protection — see [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| **Do not rely on receiving every event** | 15 seconds of retries, lost on restart. For anything that must not be missed, reconcile against the API on a schedule and use the webhook only as a prompt |
| **`5xx` and `429` get the same treatment as `500`** | there is no `Retry-After` handling; the backoff is fixed and short |

## Observability

There is no metric, no alert and no dashboard for delivery failure. What exists:

- **The delivery log.** `GET /api/v1/webhooks/:id/deliveries` — rows in `data`, pagination in a top-level `meta`, newest first, tenant-admin only. The dashboard renders it at `frontend/src/app/dashboard/webhooks/components/DeliveriesPanel.tsx`.
- **One log line on exhaustion.** `logger.warn("Webhook delivery exhausted: <id> -> <url>")`. In production the winston logger writes to files only, so this does **not** appear in `docker logs` — see [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md).
- **Nothing on abandonment.** A row stranded at `pending` or `failed` by a restart produces no log line at all, because no code runs to notice.

Querying `webhook_deliveries` for `status IN ('failed','exhausted')`, or for `status = 'pending'` older than a minute, is the only way to find broken subscriptions today.

## What The Tests Prove

`backend/src/tests/services/webhook.service.test.js` covers the loop:

- `"delivers event successfully on first attempt"`
- `"retries up to max attempts (5) and marks as exhausted on fetch status failure"`
- `"marks as timeout when fetch throws AbortError (timeout)"`
- `"logs error when background deliverWithRetry throws an error due to update failure"`

**Every one of them mocks `fetch`.** They prove the state machine — that five failures produce `exhausted`, that an `AbortError` writes `timeout` — and they prove nothing about what a real receiver sees, because no real request is made. Per `CLAUDE.md`: a mock proves the client, not the contract. The signature has never been verified by an independent implementation; a change to the signed bytes would leave all four of these green.

They also do not test durability, because durability is the thing that is missing: there is nothing to assert.

## The Planned Design — A-10

Not built. The [A-10](../../TASKS/AUDIT-2026-09-REMEDIATION.md) Definition of Done, **every box open as of 2026-09-23**:

- [ ] delivery moves onto RabbitMQ with a dead-letter queue
- [ ] a retry schedule measured in hours, not seconds
- [ ] a signed timestamp header, and receivers told to reject stale ones
- [ ] a restart during delivery resumes it — tested

Three things this document would add to whoever picks it up:

1. **The `isActive` / `isDeleted` re-check above.** An hours-long schedule makes a 15-second convenience into a real exposure.
2. **Keep `webhook_deliveries.id` as the delivery id and keep it stable across attempts.** It is already on the wire as `X-Webhook-Delivery` and inside the signed body; receivers that deduplicate on it must not be broken by the move to a queue.
3. **Give `pending` a deadline.** Whatever the transport, a row with no terminal state and no timestamp bounding it is indistinguishable from one still in flight, and that ambiguity is most of what makes today's log hard to act on.

## Related

| For | Read |
|---|---|
| what is being delivered | [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) |
| the signature the retries reuse unchanged | [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| the `webhook_deliveries` columns | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/webhooks` |
| the queue that is not used here | [`../ENGINEERING/08-CACHE-QUEUE-STANDARDS.md`](../ENGINEERING/08-CACHE-QUEUE-STANDARDS.md) |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-10 |
