// src/services/stripeWebhook.service.js
//
// Handles Stripe billing webhooks: verifies the signature (raw body), then
// reconciles Subscription / Invoice / Tenant state. Plan changes propagate to
// Tenant.plan so the Phase-6 feature gating follows the paid plan, and dunning
// (repeated payment failure) suspends the tenant.

const { Subscription, Invoice, Tenant } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe;
const getStripe = () => {
  if (!stripe) {
    stripe = require("stripe")(STRIPE_SECRET_KEY);
  }
  return stripe;
};

// Verify + parse the webhook. Requires the RAW request body (Buffer).
const constructEvent = (rawBody, signature) => {
  if (WEBHOOK_SECRET) {
    return getStripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  }
  // No signing secret configured — only allow unverified parsing off-production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  logger.warn(
    "STRIPE_WEBHOOK_SECRET not set — accepting UNVERIFIED Stripe webhook (non-production only)",
  );
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  return JSON.parse(text);
};

const STRIPE_TO_SUB_STATUS = {
  active: "Active",
  trialing: "Active",
  past_due: "PastDue",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Unpaid",
  incomplete_expired: "Canceled",
};
const VALID_TENANT_PLANS = ["free", "professional", "business", "enterprise"];

const findSubscription = async ({ stripeSubscriptionId, stripeCustomerId }) => {
  if (stripeSubscriptionId) {
    const s = await Subscription.findOne({ where: { stripeSubscriptionId } });
    if (s) {
      return s;
    }
  }
  if (stripeCustomerId) {
    return Subscription.findOne({ where: { stripeCustomerId } });
  }
  return null;
};

const setTenantStatus = async (tenantId, status) => {
  if (tenantId) {
    await Tenant.update({ status }, { where: { id: tenantId } });
  }
};

const maybeUpdateTenantPlan = async (tenantId, plan) => {
  if (tenantId && plan && VALID_TENANT_PLANS.includes(plan)) {
    await Tenant.update({ plan }, { where: { id: tenantId } });
  }
};

/**
 * Insert or UPDATE the local row for a Stripe invoice, keyed on
 * `stripeInvoiceId`.
 *
 * This used to be `Invoice.findOrCreate` with the status in `defaults`, which
 * only ever inserted: Stripe's normal dunning path is `invoice.payment_failed`
 * (row created `Open`) then `invoice.paid` (row found, nothing written), so an
 * invoice that was paid after a failure stayed `Open` with `amountPaid: 0`
 * forever while the subscription moved to `Active` (A-25).
 *
 * Two rules the plain upsert does not give you:
 *
 *  - **`Paid` is terminal.** Stripe does not guarantee event order, so a
 *    `payment_failed` for an earlier attempt can arrive after the `paid` that
 *    settled the invoice. A later non-`Paid` status does not downgrade the row.
 *  - **`amountPaid` never goes down.** The late `payment_failed` carries
 *    `amount_paid: 0`; taking it literally would erase a recorded payment.
 *
 * The lookup is deliberately NOT `.unscoped()`: `invoices` has no soft-delete
 * column at all (no `isDeleted`, no `deletedAt`, no `paranoid`) and the models
 * barrel registers no default scope, so there is no soft-deleted row to miss.
 * Tenant isolation is applied by the global hooks, not by a scope, so
 * `.unscoped()` would not have affected it either way.
 */
const upsertInvoice = async (sub, obj, status) => {
  const stripeInvoiceId = obj.id;
  const amountDue = (obj.amount_due || 0) / 100;
  const amountPaid = (obj.amount_paid || 0) / 100;
  const currency = (obj.currency || "usd").toUpperCase();
  const invoiceUrl = obj.hosted_invoice_url || null;

  const existing = await Invoice.findOne({ where: { stripeInvoiceId } });

  if (!existing) {
    return Invoice.create({
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      amountDue,
      amountPaid,
      currency,
      status,
      invoiceUrl,
      stripeInvoiceId,
    });
  }

  // DECIMAL comes back from pg as a string; Number() it before comparing.
  const storedPaid = Number(existing.amountPaid) || 0;
  const settled = existing.status === "Paid" && status !== "Paid";

  await existing.update({
    amountDue,
    amountPaid: Math.max(storedPaid, amountPaid),
    currency,
    status: settled ? "Paid" : status,
    // A later event without a hosted url must not erase the one we have.
    invoiceUrl: invoiceUrl || existing.invoiceUrl,
  });

  return existing;
};

// ------------------------------------------------------------------
// EVENT HANDLERS
// ------------------------------------------------------------------
const handleInvoicePaid = async (obj) => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.subscription,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  await upsertInvoice(sub, obj, "Paid");
  await sub.update({ status: "Active" });
  await setTenantStatus(sub.tenantId, "active"); // un-suspend on payment
  return { handled: true, subscriptionId: sub.id };
};

const handleInvoicePaymentFailed = async (obj) => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.subscription,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  const wasPastDue = sub.status === "PastDue";
  await sub.update({ status: "PastDue" });
  await upsertInvoice(sub, obj, "Open");
  // Dunning: a repeated failure (already past due) or high attempt count suspends.
  const suspend = wasPastDue || (obj.attempt_count && obj.attempt_count >= 3);
  if (suspend) {
    await setTenantStatus(sub.tenantId, "suspended");
  }
  return { handled: true, subscriptionId: sub.id, suspended: !!suspend };
};

const handleSubscriptionUpdated = async (obj) => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.id,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  const patch = { status: STRIPE_TO_SUB_STATUS[obj.status] || sub.status };
  if (obj.current_period_start) {
    patch.currentPeriodStart = new Date(obj.current_period_start * 1000);
  }
  if (obj.current_period_end) {
    patch.currentPeriodEnd = new Date(obj.current_period_end * 1000);
  }
  const plan =
    (obj.metadata && obj.metadata.plan) ||
    (obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.nickname);
  if (plan) {
    patch.planId = plan;
  }
  await sub.update(patch);
  await maybeUpdateTenantPlan(sub.tenantId, plan); // feature gating follows the plan
  if (patch.status === "Active") {
    await setTenantStatus(sub.tenantId, "active");
  }
  return { handled: true, subscriptionId: sub.id, status: patch.status };
};

const handleSubscriptionDeleted = async (obj) => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.id,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  await sub.update({ status: "Canceled" });
  await maybeUpdateTenantPlan(sub.tenantId, "free"); // downgrade to free features
  return { handled: true, subscriptionId: sub.id };
};

const handleEvent = async (event) => {
  const obj = (event.data && event.data.object) || {};
  switch (event.type) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return handleInvoicePaid(obj);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(obj);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(obj);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(obj);
    default:
      return { handled: false, reason: `unhandled event type: ${event.type}` };
  }
};

module.exports = { constructEvent, handleEvent };
