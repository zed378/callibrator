# Outbound Webhooks

What this system POSTs to a tenant-registered URL, how that POST is signed, and what happens when it fails.

> **Target standard: TypeScript, strict (ADR-038).** The webhook module is **JavaScript/CommonJS** today — `backend/src/services/webhook.service.js`, `backend/src/controllers/webhook.controller.js`, `backend/src/routes/api/webhooks.route.js`, `backend/src/models/webhook.model.js`, `backend/src/models/webhookDelivery.model.js`, `backend/src/middlewares/webhookDeliveryScheduler.middleware.js`, `backend/src/middlewares/webhookDeliveryPurgeScheduler.middleware.js`, `backend/src/services/webhookDeliveryPurge.service.js`. The one exception is the event catalogue, `backend/src/constants/webhookEvents.ts`, converted under Phase 9 (ADR-087 item 8). *(Corrected 2026-09-28, ADR-088: this line named it `webhookEvents.js`.)* Documents here name each file by its real extension, and label current behaviour **as-built**. The database is PostgreSQL only (ADR-039).

These documents are for two readers: the engineer writing a receiver that consumes our deliveries, and the engineer maintaining the sender.

## Documents

| | Document | Covers |
|---|---|---|
| 00 | [Webhook Architecture](./00-WEBHOOK-ARCHITECTURE.md) | start here: emit → outbox → deliver → retry → dead letter → purge on one page, which process runs what, isolation along the pipeline, what is not built |
| 01 | [Event Catalog](./01-EVENT-CATALOG.md) | every event name, its emit site and its payload |
| 03 | [Webhook Security](./03-WEBHOOK-SECURITY.md) | the HMAC scheme, the secret's lifecycle, SSRF, and what leaves the tenant |
| 04 | [Webhook Retry](./04-WEBHOOK-RETRY.md) | the durable outbox, the retry schedule, the delivery state machine |

There is no `02-`. The number is unassigned; nothing links to it.

## The Short Version

**Ten domain events exist** (A-11, 2026-09-24): the calibration scan's `device.calibration_due` / `device.overdue`, and certificate approved / signed / revoked, work order created / completed, stock transfer completed, CAPA created / closed — each emitted only after its change commits. The catalogue is `backend/src/constants/webhookEvents.ts` (ADR-088: this said `.js`). See [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md).

**The signature is `v1=` HMAC-SHA256 over `<timestamp>.<raw body>`**, with the timestamp in `X-Webhook-Timestamp`. Receivers reject timestamps more than 5 minutes off and deduplicate on `X-Webhook-Delivery`. This replaced the unsigned-timestamp `sha256=` scheme on 2026-09-24 — a breaking change for receivers. See [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md).

**Delivery is durable** (A-10, ADR-054): `webhook_deliveries` is an outbox, claimed with `FOR UPDATE SKIP LOCKED` by a dispatcher that runs at boot and every 15 s. 12 attempts over ~20.5 h, then the row is `exhausted`. A restart resumes pending retries. See [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md).

**A webhook is an outbound channel out of the tenant.** Its URL decides where hospital device data is POSTed. Until 2026-09-23 every route managing one was `auth` alone. Read [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) before touching the router.

## Related

| For | Read |
|---|---|
| the eight endpoints and their tables (`POST /:id/rotate-secret` is the eighth; ADR-088: this said seven) | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/webhooks` |
| the module summary and its env vars | [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md) |
| the isolation these deliveries depend on | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the open remediation items | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02, A-10, A-11 |

**Not covered here:** the *inbound* Stripe webhook at `POST /api/v1/billing/webhook` (`billing.route.js:117`, `stripeWebhook.service.js`). It shares the word and nothing else — different direction, different signature scheme, different owner.
