/**
 * The webhook event catalogue (A-11).
 *
 * Every name here is EMITTED by domain code — the catalogue lists what this
 * system sends, never what a reader might expect it to send (PR-4). The
 * contract, with payloads and emit sites, is docs/WEBHOOK/01-EVENT-CATALOG.md.
 *
 * Emission rule: a domain event is announced only after the change it
 * describes has committed — `webhook.service#emitAfterCommit(transaction, …)`
 * registers the emit on `transaction.afterCommit`, so a rolled-back action
 * never fires a webhook.
 *
 * `webhook.test` is deliberately absent: `POST /webhooks/:id/test` sends it to
 * the named webhook without consulting subscriptions, so subscribing to it
 * does nothing. It is still the event name on a test delivery.
 *
 * Renaming or removing a name silently stops deliveries to every subscriber
 * (the subscription just stops matching) — treat this list as a public API.
 */
const WEBHOOK_EVENTS = Object.freeze({
  DEVICE_CALIBRATION_DUE: "device.calibration_due",
  DEVICE_OVERDUE: "device.overdue",
  CERTIFICATE_APPROVED: "certificate.approved",
  CERTIFICATE_SIGNED: "certificate.signed",
  CERTIFICATE_REVOKED: "certificate.revoked",
  WORK_ORDER_CREATED: "work_order.created",
  WORK_ORDER_COMPLETED: "work_order.completed",
  STOCK_TRANSFER_COMPLETED: "stock_transfer.completed",
  CAPA_CREATED: "capa.created",
  CAPA_CLOSED: "capa.closed",
});

/** Every subscribable name, in catalogue order. */
const WEBHOOK_EVENT_NAMES = Object.freeze(Object.values(WEBHOOK_EVENTS));

/** The synthetic event of `POST /webhooks/:id/test` — never subscription-matched. */
const WEBHOOK_TEST_EVENT = "webhook.test";

module.exports = { WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES, WEBHOOK_TEST_EVENT };
