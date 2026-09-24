# 01 — Event Catalog

Every event name this system will ever POST to a webhook, and every event name it accepts a subscription for and then never sends.

Source: `backend/src/constants/webhookEvents.js` (the catalogue), `backend/src/services/webhook.service.js`, and the emit sites named below. Decision: A-11 and **ADR-054** (`MEMORY/DECISIONS.md`).

---

## Read This Before The Table

> **As-built since 2026-09-24 (A-11).** Until then the only code that called `emitEvent` was the calibration scan, and every other name a tenant could subscribe to — including the `certificate.signed` in the Swagger example — was stored and never fired. The catalogue below lists what the code **emits**; `tests/services/webhookEmit.a11.test.js` fails if a name in `constants/webhookEvents.js` has no emit site, or if the frontend's list differs from it.

The subscription model still accepts any well-formed name (`webhook.validator.js`: lowercase dotted, max 50 per webhook). A name outside this catalogue is stored and **never fires** — the form lets an admin type a custom one, and older subscriptions may hold names from before the catalogue existed.

## The Catalogue

| Event | Fired when | Emit site | Timing |
|---|---|---|---|
| `device.calibration_due` | the calibration scan finds a device due | `calibrationScheduler.service.js#runCalibrationScan` | after the scan's work-order insert (autocommitted) |
| `device.overdue` | the scan finds a device past its date | same | same |
| `certificate.approved` | `pending_approval` → `approved` | `certificate.service.js#approveCertificate` | `transaction.afterCommit` |
| `certificate.signed` | `approved` → `signed` | `certificate.service.js#signCertificate` | `transaction.afterCommit` |
| `certificate.revoked` | → `revoked` | `certificate.service.js#revokeCertificate` | `transaction.afterCommit` |
| `work_order.created` | a maintenance work order is created (by a user or by the calibration scan) | `maintenance.service.js#createWorkOrder` | after the insert (autocommitted — the service opens no transaction) |
| `work_order.completed` | a work order's status changes **into** `Completed` | `maintenance.service.js#updateWorkOrder` | after the update (autocommitted) |
| `stock_transfer.completed` | a stock transfer is completed and the stock moved | `stock.service.js#updateTransferStatus` | `transaction.afterCommit` |
| `capa.created` | a CAPA is raised against a non-conformance | `qms.service.js#createCapa` | `transaction.afterCommit` |
| `capa.closed` | a CAPA's status changes **into** `CLOSED` | `qms.service.js#updateCapa` | `transaction.afterCommit` |

**Removed from the offered list: `webhook.test`.** The frontend used to offer it as a subscribable event. `POST /webhooks/:id/test` sends it to the named webhook without consulting subscriptions, so subscribing to it did nothing. It remains the event name on a test delivery.

**Deliberately not in the catalogue** (no emit site was added, so none is offered): certificate create / update / delete / submit, work-order delete, stock create / adjust / opname, non-conformance create / update, e-signature workflows, tickets. Each is a new public contract and a data-export decision (see [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) § outbound channel); add them through § Adding An Event when someone needs them.

### Payloads of the A-11 events

`data` carries identifiers, numbers and statuses only — never free text (a revocation reason, a CAPA action plan) and never a name or email. The acting user appears as a UUID.

| Event | `data` |
|---|---|
| `certificate.approved` | `certificateId`, `certificateNumber`, `deviceId`, `status` (`approved`), `approvedBy` |
| `certificate.signed` | `certificateId`, `certificateNumber`, `deviceId`, `status` (`signed`), `signedBy` |
| `certificate.revoked` | `certificateId`, `certificateNumber`, `deviceId`, `status` (`revoked`), `revokedBy` |
| `work_order.created` | `workOrderId`, `deviceId`, `type`, `status`, `priority` |
| `work_order.completed` | `workOrderId`, `deviceId`, `type`, `status` (`Completed`) |
| `stock_transfer.completed` | `transferId`, `itemName`, `quantity`, `fromWarehouseId`, `toWarehouseId`, `approvedBy` |
| `capa.created` | `capaId`, `capaNumber`, `ncId`, `ncNumber`, `status` (`DRAFT`), `dueDate` (or `null`) |
| `capa.closed` | `capaId`, `capaNumber`, `ncId`, `status` (`CLOSED`), `closedBy` (or `null`) |

A transition event fires once, on the transition: re-saving an already-`Completed` work order or an already-`CLOSED` CAPA emits nothing.

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

It makes **one** attempt, synchronously with the HTTP request, and a failed test is dead-lettered at once rather than retried. It is sent even to a deactivated webhook. See [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) § The Test Endpoint.

## How Subscriptions Match

`emitEvent` selects webhooks with:

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

- **`"*"` means all events** — one row in the JSONB array, matched by the second branch. A webhook subscribed to `["*"]` receives every event in the catalogue above (not `webhook.test`, which is never matched).
- **Matching is exact string equality inside the array.** There is no prefix matching. `["device."]` and `["device.*"]` match nothing.
- **`isActive: false` suppresses delivery at emit time and at every retry.** A webhook deactivated or deleted while a retry is scheduled dead-letters the remaining attempts — see [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md).
- **One delivery row per matching webhook**, so `["device.overdue", "*"]` still yields exactly one POST: the `Op.or` is over rows, not over array elements.

## The Envelope On The Wire

`attemptDelivery` (`webhook.service.js`) builds and signs this, and nothing else:

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

The same object is re-serialized identically on every retry, so the **body** is byte-identical across attempts. The signature is not: it covers `X-Webhook-Timestamp`, which is fresh on every attempt ([`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md)).

## Emission and Transactions

The rule this repository applies to audit rows — write it inside the transaction — inverts for webhooks: an event announced for a change that then rolls back announces something that did not happen, so emission must follow the commit.

> **As-built since 2026-09-24 (A-11): by design.** Inside a transaction, a service calls `webhookService.emitAfterCommit(transaction, tenantId, event, payload)` next to its audit row. That registers the emit on `transaction.afterCommit`: it runs only after a successful COMMIT, and a rollback — a thrown error, a refused transition, a failed COMMIT — discards it. Where a service opens no transaction (`maintenance.service.js`), the write has already autocommitted and `emitAfterCommit(null, …)` emits at once. **Calling `emitEvent` directly inside a transaction callback is a defect.** Proven against PostgreSQL in `tests/services/webhook.durable.a10.live.test.js` ("emitAfterCommit: a rolled-back transaction emits nothing; a committed one emits exactly once") and per service in `tests/services/webhookEmit.a11.test.js`.

The emit is not in the transaction, so a process killed between the COMMIT and the delivery-row insert loses that one event. The window is milliseconds; ADR-054 records it.

`emitEvent` itself is best-effort and **cannot fail its caller**: the whole body is wrapped in `try/catch`, returning `{ matched: 0, error }` and logging at `error` level. A calibration scan — or a certificate approval — never fails because a webhook could not be enqueued. The corollary is that a webhook that was never enqueued leaves no trace except a log line — and in production those go to a file, not stdout (see [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md)).

## Tenant Scoping On The Emit Path

The scan runs from cron, outside any request (and the delivery dispatcher likewise — see [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) § How The Queue Works), so there is **no `AsyncLocalStorage` context**. `tenantScope.util.js#resolveScope` returns `{ mode: "skip" }` when there is no context — deliberately, so schedulers and migrations can work — which means the global Sequelize hooks add **no** tenant predicate to the `Webhook.findAll` inside `emitEvent`.

**On the cron path, the explicit `where: { tenantId }` in `emitEvent` is the entire isolation.** It is not belt-and-braces over the hooks; it is the belt. `emitEvent` is called with `device.tenantId`, one device at a time, and the `WebhookDelivery.create` is given the same `tenantId` explicitly for the same reason.

Anyone refactoring `emitEvent` to drop that predicate as "redundant, the hooks handle it" would fan every tenant's events out to every tenant's webhooks. It is redundant on the request path and load-bearing on the cron path.

## Adding An Event

The registry is `backend/src/constants/webhookEvents.js`. The steps are:

1. Add the name to `WEBHOOK_EVENTS` — `<domain>.<verb>`, snake_case, matching `work_order.completed`.
2. Emit it with `webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.X, payload)` inside the mutation's transaction (or with `null` after an autocommitted write). Identifiers and statuses only in the payload.
3. Add the row and its payload to the tables at the top of this document.
4. Add it to `PREDEFINED_EVENTS` in `frontend/src/app/dashboard/webhooks/components/WebhookModal.tsx` — `webhookEmit.a11.test.js` fails until the two lists match, and until the name has an emit site.
5. Add a test that the event fires after commit and not after a rollback.

A new event is an addition to a public contract. Renaming or removing one silently stops deliveries for every subscriber, with no error on either side — the subscription simply stops matching.

## Related

| For | Read |
|---|---|
| signing, the secret, SSRF, what leaves the tenant | [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) |
| attempts, backoff, the delivery state machine | [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) |
| the endpoints | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) |
| the calibration scan that produces these events | [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md) |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-11 |
