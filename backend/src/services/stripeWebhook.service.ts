// src/services/stripeWebhook.service.ts
//
// Handles Stripe billing webhooks: verifies the signature (raw body), then
// reconciles Subscription / Invoice / Tenant state. Plan changes propagate to
// Tenant.plan so the Phase-6 feature gating follows the paid plan, and dunning
// (repeated payment failure) suspends the tenant.
//
// P9-17 (ADR-087, Stage C): converted from stripeWebhook.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned
// (`{ constructEvent, handleEvent }`). Everything the `.js` destructured is
// captured once at load. The two secrets are still read ONCE, at load (the
// key through config/billing since ADR-111, the webhook secret through `env`); the
// production check is still read per call (`isProduction()`). The Stripe SDK
// is still `require`d lazily, on the first verified event, and never at this
// module's load. The handlers call each other through local bindings, as the
// `.js` did.

import { Transaction as LoadedTransaction, type CreationAttributes } from "sequelize";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import {
  DUNNING_SUSPENSION_REASON as LOADED_DUNNING_SUSPENSION_REASON,
  isDunningSuspension as loadedIsDunningSuspension,
} from "../constants/tenantSuspension";
import { env, isProduction } from "../config/env";
import { stripeSecretKey } from "../config/billing";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const Transaction = LoadedTransaction;
const { Subscription, Invoice, Tenant, TenantSettings } = models;
const logger = loadedLogger;
const db = loadedDb;
const auditService = loadedAuditService;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const DUNNING_SUSPENSION_REASON = LOADED_DUNNING_SUSPENSION_REASON;
const isDunningSuspension = loadedIsDunningSuspension;

type SubscriptionRow = ModelInstance<"Subscription">;
type InvoiceRow = ModelInstance<"Invoice">;
type TenantRow = ModelInstance<"Tenant">;
type TenantPlan = TenantRow["plan"];
type SubscriptionPatch = Parameters<SubscriptionRow["update"]>[0];
type InvoicePatch = Parameters<InvoiceRow["update"]>[0];

// ADR-111: in production with billing enabled a missing key stops the boot
// here, naming the variable; elsewhere the placeholder stands in.
const STRIPE_SECRET_KEY = stripeSecretKey();
const WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");

/** The part of the Stripe client this module uses. */
interface StripeClient {
  webhooks: {
    constructEvent: (payload: unknown, header: unknown, secret: string) => unknown;
  };
}

let stripe: StripeClient | undefined;
const getStripe = (): StripeClient => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: the .js's `if (!stripe)` (ADR-038 rule 3)
  if (!stripe) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the SDK is loaded on the first verified event, never at this module's load (see the file header)
    stripe = (require("stripe") as (key: string) => StripeClient)(STRIPE_SECRET_KEY);
  }
  return stripe;
};

/** A Stripe event, as far as this module reads it (a JavaScript caller may pass anything). */
interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: StripeObject | null } | null;
}

/** The fields of an invoice or subscription object the handlers read. */
interface StripeObject {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  status?: string;
  amount_due?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  attempt_count?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: { plan?: string | null } | null;
  items?: { data?: ({ price?: { nickname?: string | null } | null } | null)[] | null } | null;
}

// Verify + parse the webhook. Requires the RAW request body (Buffer).
const constructEvent = (rawBody: unknown, signature: unknown): unknown => {
  if (WEBHOOK_SECRET) {
    return getStripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  }
  // No signing secret configured — only allow unverified parsing off-production.
  if (isProduction()) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  logger.warn(
    "STRIPE_WEBHOOK_SECRET not set — accepting UNVERIFIED Stripe webhook (non-production only)",
  );
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  return JSON.parse(text) as unknown;
};

// Looked up by the status Stripe sends: a plain object, as built.
const STRIPE_TO_SUB_STATUS: Record<string, SubscriptionRow["status"]> = {
  active: "Active",
  trialing: "Active",
  past_due: "PastDue",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Unpaid",
  incomplete_expired: "Canceled",
};
const VALID_TENANT_PLANS: unknown[] = ["free", "professional", "business", "enterprise"];

const findSubscription = async ({
  stripeSubscriptionId,
  stripeCustomerId,
}: {
  stripeSubscriptionId: string | null | undefined;
  stripeCustomerId: string | null | undefined;
}): Promise<SubscriptionRow | null> => {
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

// ------------------------------------------------------------------
// A-276 (ADR-094) — what a billing event may do to a tenant's status.
//
// This used to set `active` on every payment and `suspended` on repeated
// failure, unconditionally and unaudited: a paid invoice lifted a suspension
// the platform operator had imposed, and re-activated an offboarded tenant.
// Now:
//  - dunning suspends only an ACTIVE tenant, and marks the suspension as its
//    own (`suspension_reason` = DUNNING_SUSPENSION_REASON, no `suspended_by`);
//  - a payment lifts only that suspension. An operator's suspension and an
//    offboarding stay; the payment is recorded against them, so the operator
//    sees it arrived;
//  - every decision is one audit row under PLATFORM and one under the tenant
//    (the A-165 rule), actor `system:billing-webhook`, naming the Stripe event,
//    in the same transaction as the tenant write.
// ------------------------------------------------------------------

interface StatusSnapshot {
  status: TenantRow["status"];
  suspensionReason: string | null;
  suspendedBy: string | null;
}

const statusSnapshot = (tenant: TenantRow): StatusSnapshot => ({
  status: tenant.status,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty reason is recorded as null (ADR-038 rule 3)
  suspensionReason: tenant.suspensionReason || null,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id is recorded as null (ADR-038 rule 3)
  suspendedBy: tenant.suspendedBy || null,
});

const auditBillingDecision = async (
  transaction: InstanceType<typeof Transaction>,
  tenant: TenantRow,
  eventId: string | undefined,
  operation: string,
  before: Record<string, unknown>,
  after: Record<string, unknown> = statusSnapshot(tenant) as unknown as Record<string, unknown>,
): Promise<void> => {
  const entry = {
    systemActor: SYSTEM_ACTORS.BILLING_WEBHOOK,
    action: "UPDATE" as const,
    resourceType: "Tenant",
    resourceId: tenant.id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty event id is recorded as null (ADR-038 rule 3)
    changes: { operation, stripeEventId: eventId || null, before, after },
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId: tenant.id }, { transaction });
};

const writeLifecycleSetting = (tenantId: TenantId, value: string, transaction: InstanceType<typeof Transaction>): Promise<unknown> =>
  TenantSettings.upsert({ tenantId, key: "lifecycle_status", value }, { transaction });

/**
 * A payment: lift a dunning suspension, and nothing else.
 */
const liftDunningSuspension = async (
  tenantId: TenantId | null | undefined,
  eventId: string | undefined,
  transaction: InstanceType<typeof Transaction>,
): Promise<"no-tenant" | "active" | "lifted" | "kept"> => {
  const tenant = tenantId ? await Tenant.findByPk(tenantId, { transaction }) : null;
  if (!tenant) {
    return "no-tenant";
  }
  if (tenant.status === "active") {
    return "active";
  }
  const before = statusSnapshot(tenant) as unknown as Record<string, unknown>;
  if (!isDunningSuspension(tenant)) {
    // An operator's suspension or an offboarding: the payment does not lift it.
    await auditBillingDecision(transaction, tenant, eventId, "BILLING_PAYMENT_STATUS_KEPT", before);
    logger.warn("Stripe payment received for a tenant the operator suspended or offboarded; status kept", {
      tenantId,
      status: tenant.status,
    });
    return "kept";
  }
  tenant.status = "active";
  tenant.suspensionReason = null;
  tenant.suspendedAt = null;
  tenant.suspendedBy = null;
  tenant.gracePeriodExpiresAt = null;
  await tenant.save({ transaction });
  await writeLifecycleSetting(tenant.id, "ACTIVE", transaction);
  await auditBillingDecision(transaction, tenant, eventId, "BILLING_DUNNING_LIFTED", before);
  return "lifted";
};

/**
 * Dunning: suspend an ACTIVE tenant, marking the suspension as dunning's.
 */
const suspendForDunning = async (
  tenantId: TenantId | null | undefined,
  eventId: string | undefined,
  transaction: InstanceType<typeof Transaction>,
): Promise<"no-tenant" | "suspended" | "unchanged"> => {
  const tenant = tenantId ? await Tenant.findByPk(tenantId, { transaction }) : null;
  if (!tenant) {
    return "no-tenant";
  }
  // Already suspended (by anyone) or offboarded: dunning has nothing to add,
  // and must not relabel an operator's suspension as its own.
  if (tenant.status !== "active") {
    return "unchanged";
  }
  const before = statusSnapshot(tenant) as unknown as Record<string, unknown>;
  tenant.status = "suspended";
  tenant.suspensionReason = DUNNING_SUSPENSION_REASON;
  tenant.suspendedAt = new Date();
  tenant.suspendedBy = null;
  await tenant.save({ transaction });
  await writeLifecycleSetting(tenant.id, "SUSPENDED", transaction);
  await auditBillingDecision(transaction, tenant, eventId, "BILLING_DUNNING_SUSPEND", before);
  return "suspended";
};

/**
 * A-305 (ADR-100): the plan drives feature gating, so a change is written in
 * a transaction with its two audit rows (PLATFORM and the tenant, the A-165
 * rule) as `system:billing-webhook`, naming the Stripe event and the plan
 * before and after. It used to be a bare `Tenant.update`, unrecorded. An
 * unchanged plan, an unknown plan and a missing tenant write nothing.
 */
const maybeUpdateTenantPlan = async (tenantId: TenantId | null | undefined, plan: unknown, eventId: string | undefined): Promise<void> => {
  if (!tenantId || !plan || !VALID_TENANT_PLANS.includes(plan)) {
    return;
  }
  await db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(tenantId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!tenant || tenant.plan === plan) {
      return;
    }
    const before = { plan: tenant.plan };
    tenant.plan = plan as TenantPlan;
    await tenant.save({ transaction });
    await auditBillingDecision(transaction, tenant, eventId, "BILLING_PLAN_CHANGE", before, { plan });
  });
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
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): Stripe's 0 / "" / null all take the default here */
const upsertInvoice = async (sub: SubscriptionRow, obj: StripeObject, status: "Paid" | "Open"): Promise<InvoiceRow> => {
  const stripeInvoiceId = obj.id;
  const amountDue = (obj.amount_due || 0) / 100;
  const amountPaid = (obj.amount_paid || 0) / 100;
  const currency = (obj.currency || "usd").toUpperCase();
  const invoiceUrl = obj.hosted_invoice_url || null;

  const existing = await Invoice.findOne({ where: { stripeInvoiceId: stripeInvoiceId as string } });

  if (!existing) {
    const values: Record<string, unknown> = {
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      amountDue,
      amountPaid,
      currency,
      status,
      invoiceUrl,
      stripeInvoiceId,
    };
    return Invoice.create(values as CreationAttributes<InvoiceRow>);
  }

  // DECIMAL comes back from pg as a string; Number() it before comparing.
  const storedPaid = Number(existing.amountPaid) || 0;
  const settled = existing.status === "Paid" && status !== "Paid";

  const patch: Record<string, unknown> = {
    amountDue,
    amountPaid: Math.max(storedPaid, amountPaid),
    currency,
    status: settled ? "Paid" : status,
    // A later event without a hosted url must not erase the one we have.
    invoiceUrl: invoiceUrl || existing.invoiceUrl,
  };
  await existing.update(patch as InvoicePatch);

  return existing;
};
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

// ------------------------------------------------------------------
// EVENT HANDLERS
// ------------------------------------------------------------------

/** What a handler answers; the controller logs it and acknowledges the event. */
type HandlerResult = Record<string, unknown> & { handled: boolean };

const handleInvoicePaid = async (obj: StripeObject, eventId: string | undefined): Promise<HandlerResult> => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.subscription,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  await upsertInvoice(sub, obj, "Paid");
  await sub.update({ status: "Active" });
  // A-276: a payment lifts a dunning suspension, never the operator's.
  const tenant = await db.transaction((transaction) => liftDunningSuspension(sub.tenantId, eventId, transaction));
  return { handled: true, subscriptionId: sub.id, tenant };
};

const handleInvoicePaymentFailed = async (obj: StripeObject, eventId: string | undefined): Promise<HandlerResult> => {
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
  let tenant = "unchanged";
  if (suspend) {
    tenant = await db.transaction((transaction) => suspendForDunning(sub.tenantId, eventId, transaction));
  }
  return { handled: true, subscriptionId: sub.id, suspended: tenant === "suspended" };
};

/** The subscription fields an update event writes. */
interface SubscriptionEventPatch {
  status: unknown;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  planId?: unknown;
}

const handleSubscriptionUpdated = async (obj: StripeObject, eventId: string | undefined): Promise<HandlerResult> => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.id,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an unknown Stripe status keeps the stored one (ADR-038 rule 3)
  const patch: SubscriptionEventPatch = { status: STRIPE_TO_SUB_STATUS[obj.status as string] || sub.status };
  if (obj.current_period_start) {
    patch.currentPeriodStart = new Date(obj.current_period_start * 1000);
  }
  if (obj.current_period_end) {
    patch.currentPeriodEnd = new Date(obj.current_period_end * 1000);
  }
  /* eslint-disable @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): the .js's `&&` chain and `||` over Stripe's plan fields */
  const plan =
    (obj.metadata && obj.metadata.plan) ||
    (obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.nickname);
  /* eslint-enable @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-nullish-coalescing */
  if (plan) {
    patch.planId = plan;
  }
  await sub.update(patch as unknown as SubscriptionPatch);
  await maybeUpdateTenantPlan(sub.tenantId, plan, eventId); // feature gating follows the plan
  if (patch.status === "Active") {
    await db.transaction((transaction) => liftDunningSuspension(sub.tenantId, eventId, transaction));
  }
  return { handled: true, subscriptionId: sub.id, status: patch.status };
};

const handleSubscriptionDeleted = async (obj: StripeObject, eventId: string | undefined): Promise<HandlerResult> => {
  const sub = await findSubscription({
    stripeSubscriptionId: obj.id,
    stripeCustomerId: obj.customer,
  });
  if (!sub) {
    return { handled: false, reason: "subscription not found" };
  }
  await sub.update({ status: "Canceled" });
  await maybeUpdateTenantPlan(sub.tenantId, "free", eventId); // downgrade to free features
  return { handled: true, subscriptionId: sub.id };
};

const handleEvent = async (event: StripeEvent): Promise<HandlerResult> => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-nullish-coalescing -- as built: the .js expression, kept (ADR-038 rule 3)
  const obj = (event.data && event.data.object) || {};
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- as built: any other type, undefined included, takes the default (ADR-038 rule 3)
  switch (event.type) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return handleInvoicePaid(obj, event.id);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(obj, event.id);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(obj, event.id);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(obj, event.id);
    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the type is interpolated as sent (ADR-038 rule 3)
      return { handled: false, reason: `unhandled event type: ${event.type}` };
  }
};

export = { constructEvent, handleEvent };
