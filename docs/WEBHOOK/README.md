# Outbound Webhooks

What this system POSTs to a tenant-registered URL, how that POST is signed, and what happens when it fails.

> **Target standard: TypeScript, strict (ADR-038).** The webhook module is **JavaScript/CommonJS** today — `backend/src/services/webhook.service.js`, `backend/src/controllers/webhook.controller.js`, `backend/src/routes/api/webhooks.route.js`, `backend/src/models/webhook.model.js`, `backend/src/models/webhookDelivery.model.js`. Documents here name `.js` files because those are the files, and label current behaviour **as-built**. The database is PostgreSQL only (ADR-039).

These documents are for two readers: the engineer writing a receiver that consumes our deliveries, and the engineer maintaining the sender.

## Documents

| | Document | Covers |
|---|---|---|
| 00 | Webhook Architecture — **not written** | linked from [`../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md`](../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md); that link is broken today |
| 01 | [Event Catalog](./01-EVENT-CATALOG.md) | every event name, split into emitted and never-emitted, with payloads |
| 03 | [Webhook Security](./03-WEBHOOK-SECURITY.md) | the HMAC scheme, the secret's lifecycle, SSRF, and what leaves the tenant |
| 04 | [Webhook Retry](./04-WEBHOOK-RETRY.md) | the retry loop, the delivery state machine, and what a restart loses |

There is no `02-`. The number is unassigned; nothing links to it.

## The Short Version

**Two domain events exist.** `device.calibration_due` and `device.overdue`, both emitted by the nightly calibration scan. Every other event name a subscriber can register — including the `certificate.signed` in the route's own Swagger example — is accepted, stored, and never fired. See [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md).

**The signature is `HMAC-SHA256` over the raw request body**, hex, in `X-Webhook-Signature: sha256=<hex>`. There is no timestamp in it and no replay protection. See [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md).

**Retries are four `setTimeout` waits in the sending process** — 1 s, 2 s, 4 s, 8 s — and every pending retry dies with the process. A deploy during delivery loses it silently. See [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md).

**A webhook is an outbound channel out of the tenant.** Its URL decides where hospital device data is POSTed. Until 2026-09-23 every route managing one was `auth` alone. Read [`03-WEBHOOK-SECURITY.md`](./03-WEBHOOK-SECURITY.md) before touching the router.

## Related

| For | Read |
|---|---|
| the seven endpoints and their tables | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/webhooks` |
| the module summary and its env vars | [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md) |
| the isolation these deliveries depend on | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the open remediation items | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02, A-10, A-11 |

**Not covered here:** the *inbound* Stripe webhook at `POST /api/v1/billing/webhook` (`billing.route.js:117`, `stripeWebhook.service.js`). It shares the word and nothing else — different direction, different signature scheme, different owner.
