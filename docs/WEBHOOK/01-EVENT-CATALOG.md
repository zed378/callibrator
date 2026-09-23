# 01 — Event Catalog

Every event name this system will ever POST to a webhook, and every event name it accepts a subscription for and then never sends.

Source: `backend/src/services/webhook.service.js`, `backend/src/services/calibrationScheduler.service.js`, `backend/src/models/webhook.model.js`.

---

## Read This Before The Table

The subscription model accepts **any** string as an event name. `events` on `webhooks` is a JSONB array with no enum, no allowlist and no validator (`webhook.model.js`, `webhooks.route.js` — the router mounts no `validate(schema)` at all). A tenant can subscribe to `certificate.signed`, `workorder.completed`, `capa.raised`, `stock.transferred`, or `banana`. All five are stored. None of them is ever fired.

**The only code in the repository that calls `webhookService.emitEvent` is the calibration scan.** Two call-sites' worth of event names, on one ternary:

```js
// calibrationScheduler.service.js:134
await webhookService.emitEvent(
  device.tenantId,
  isOverdue ? "device.overdue" : "device.calibration_due",
  { ... },
);
```

That is the whole catalogue. Certificates, work orders, stock transfers, CAPA, e-signatures and tickets emit nothing. This is recorded as [A-11](../../TASKS/AUDIT-2026-09-REMEDIATION.md).

A catalogue that listed the events a reasonable person would expect this product to send — rather than the events it sends — would be the PR-4 failure this repository opens `CLAUDE.md` with. So the table below is split, and every row says which side it is on.

## The Catalogue

| Event | Status | Fired by |
|---|---|---|
| `device.calibration_due` | **emitted** | `calibrationScheduler.service.js:134` |
| `device.overdue` | **emitted** | `calibrationScheduler.service.js:134` |
| `webhook.test` | **emitted, but only on request** — never by domain activity | `webhook.service.js#testWebhook` |
| `certificate.signed` | **subscribable, never fired** — appears only as the Swagger example on `webhooks.route.js:43` and in `tests/e2e/modules/webhooks.e2e.test.js` | nothing |
| anything else | **subscribable, never fired** | nothing |

`certificate.signed` is called out by name because it is the one non-existent event a reader will meet before this document: it is the example value in the `POST /api/v1/webhooks` request-body schema, so it is what the Swagger "Try it" button pre-fills. Subscribing to it produces a webhook that is never called, with no error anywhere.

The frontend registration form (`frontend/src/app/dashboard/webhooks/components/WebhookModal.tsx:22`) offers exactly `*`, `device.calibration_due`, `device.overdue` and `webhook.test`, and lets the user type any other string as a custom event. The form is honest about the catalogue; the API example is not.

## `device.calibration_due` and `device.overdue`

One event per device, per scan, emitted from `runCalibrationScan` in `calibrationScheduler.service.js`.

**Which of the two** is decided by `new Date(device.nextCalibrationDate) < reference` — strictly in the past is `device.overdue`, otherwise `device.calibration_due`. The scan's due window is `now + CALIBRATION_REMINDER_LEAD_DAYS` (default `0`), so with the default lead of zero, a device that is exactly at its date and a device three weeks past it both appear in the same scan, on opposite sides of that comparison.

**When:** the cron in `calibrationScheduler.middleware.js`, `CALIBRATION_SCHEDULER` (default `0 1 * * *`, 01:00 daily). `CALIBRATION_SCHEDULER=disabled` turns the whole scan off — and with it, every webhook this system sends. The scan can also be triggered on demand through `calibrationScheduler.controller.js`.

**Not sent when the device is skipped.** The scan's idempotency guard skips any device that already has an `Open` or `InProgress` `Preventative` work order. A device that is overdue for six weeks produces **one** `device.overdue` — on the first scan after it came due — and then silence until that work order is closed and the date advanced. A receiver that treats the absence of the event as "no longer overdue" will be wrong.

### Payload

`data` is the third argument to `emitEvent`, verbatim:

| Field | Type | Source | Notes |
|---|---|---|---|
| `deviceId` | UUID string | `device.id` | `calibration_devices.id` |
| `name` | string | `device.name` | `STRING(255)`, not null |
| `serialNumber` | string \| null | `device.serialNumber` | `STRING(100)`, nullable |
| `nextCalibrationDate` | ISO 8601 string \| null | `device.nextCalibrationDate` | model type is `DATE`, so this is a full timestamp, not a date |
| `workOrderId` | UUID string \| null | `woResult?.data?.id \|\| null` | the work order the scan just created; `null` if creation returned an unexpected shape |

There is **no** `tenantId` in `data`. The tenant is implied by which webhook received the POST, and the receiver is expected to know which tenant it registered for.

There is no device status, no location, no assigned owner, no calibration interval and no previous calibration date. A receiver that needs any of those must call the API back.

## `webhook.test`

`POST /api/v1/webhooks/:id/test` creates a delivery with event `webhook.test` and payload:

```json
{ "message": "This is a test webhook delivery", "at": "<ISO 8601>" }
```

**It bypasses subscription matching entirely.** `testWebhook` constructs the `WebhookDelivery` against the named webhook directly; it never consults `events`. So a webhook subscribed to `["device.overdue"]` still receives the test, and a webhook subscribed to `["webhook.test"]` gains nothing from that subscription — the string is inert.

It also runs **synchronously** with respect to the HTTP request, unlike every other delivery. See [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) § The test endpoint is not fire-and-forget.

## How Subscriptions Match

`emitEvent` selects webhooks with (`webhook.service.js:221`):

```js
where: {
  tenantId,
  isActive: true,
  [Op.or]: [
    { events: { [Op.contains]: [event] } },
    { events: { [Op.contains]: ["*"] } },
  ],
}
```

Which is `events @> '["device.overdue"]'::jsonb OR events @> '["*"]'::jsonb`.

Consequences worth knowing:

- **`"*"` means all events** — one row in the JSONB array, matched by the second branch. A webhook subscribed to `["*"]` receives both device events and nothing else, because nothing else is emitted.
- **Matching is exact string equality inside the array.** There is no prefix matching. `["device."]` and `["device.*"]` match nothing.
- **`isActive: false` suppresses delivery at emit time**, not at retry time. A webhook deactivated while a retry is in flight still gets the remaining attempts — see [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md).
- **One delivery row per matching webhook**, so `["device.overdue", "*"]` still yields exactly one POST: the `Op.or` is over rows, not over array elements.

## The Envelope On The Wire

`attemptDelivery` (`webhook.service.js:145`) builds and signs this, and nothing else:

```json
{
  "id": "5c9a…",
  "event": "device.overdue",
  "createdAt": "2026-09-23T01:00:04.117Z",
  "data": { }
}
```

| Field | Meaning |
|---|---|
| `id` | the `webhook_deliveries.id` — **stable across every retry of this delivery**, and the receiver's deduplication key |
| `event` | the event name |
| `createdAt` | when the delivery row was created, **not** when this attempt was made |
| `data` | the payload above |

The same object is re-serialized identically on every retry, so the body and its signature are byte-identical across attempts.

## Emission and Transactions

The rule this repository applies to audit rows — write it inside the transaction — inverts for webhooks: an event announced for a change that then rolls back announces something that did not happen, so emission must follow the commit.

> **As-built, 2026-09-23: it does follow the commit, but by accident rather than by design.** `maintenance.service.js#createWorkOrder` opens no transaction at all; the insert autocommits, and `emitEvent` is called afterwards. There is no transaction for the emit to escape. The A-11 Definition of Done — "each event emitted **after** the transaction commits, never inside it" — has nothing to enforce yet, and will have the moment the scan is made transactional. Any new emit site added inside a `sequelize.transaction` callback is a defect.

`emitEvent` itself is best-effort and **cannot fail its caller**: the whole body is wrapped in `try/catch`, returning `{ matched: 0, error }` and logging at `error` level. A calibration scan never fails because a webhook could not be enqueued. The corollary is that a webhook that was never enqueued leaves no trace except a log line — and in production those go to a file, not stdout (see [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md)).

## Tenant Scoping On The Emit Path

The scan runs from cron, outside any request, so there is **no `AsyncLocalStorage` context**. `tenantScope.util.js#resolveScope` returns `{ mode: "skip" }` when there is no context — deliberately, so schedulers and migrations can work — which means the global Sequelize hooks add **no** tenant predicate to the `Webhook.findAll` inside `emitEvent`.

**On the cron path, the explicit `where: { tenantId }` in `emitEvent` is the entire isolation.** It is not belt-and-braces over the hooks; it is the belt. `emitEvent` is called with `device.tenantId`, one device at a time, and the `WebhookDelivery.create` is given the same `tenantId` explicitly for the same reason.

Anyone refactoring `emitEvent` to drop that predicate as "redundant, the hooks handle it" would fan every tenant's events out to every tenant's webhooks. It is redundant on the request path and load-bearing on the cron path.

## Adding An Event

There is no registry to add it to; there is no registry at all. The steps are:

1. Add the emit call. `emitEvent(tenantId, "<domain>.<verb>", payload)` — snake_case verb, matching `device.calibration_due`.
2. Place it **after** the commit of whatever it announces.
3. Add the row to the table at the top of this document, on the emitted side, with its payload table and its file:line.
4. Add it to `PREDEFINED_EVENTS` in `WebhookModal.tsx` so it can be subscribed to without typing.
5. Fix the Swagger example on `webhooks.route.js` if it still advertises an event that does not exist.

A new event is an addition to a public contract. Renaming or removing one silently stops deliveries for every subscriber, with no error on either side — the subscription simply stops matching.

## Related

| For | Read |
|---|---|
| signing, the secret, SSRF, what leaves the tenant | [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| attempts, backoff, the delivery state machine | [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) |
| the endpoints | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) |
| the calibration scan that produces these events | [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md) |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-11 |
