/**
 * Aligned with the Subscription model and billing.service (which reads
 * `planId`, `billingCycle`, `status`): the previous `planName` field was
 * silently ignored by the service, and "Yearly" did not match the model's
 * "Annually" enum value.
 *
 * A-225: `reason` explains a manual status override (the service requires it
 * when the status changes); at least one updatable field must be sent.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/billing.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the billing routes.
 */
import { z } from "zod";

const updateSubscription = z
  .object({
    planId: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["Active", "PastDue", "Canceled", "Unpaid"]).optional(),
    billingCycle: z.enum(["Monthly", "Annually"]).optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.planId !== undefined || v.status !== undefined || v.billingCycle !== undefined, {
    error: "Provide at least one of planId, status, billingCycle",
  });

// ==========================================
// RESPONSES (P9-20/21, ADR-097 Am. 5: what the API answers, published code-first)
// ==========================================

const timestamp = z.iso.datetime();
const rowId = z.guid();

const SUBSCRIPTION_STATUSES = ["Active", "PastDue", "Canceled", "Unpaid"] as const;
const BILLING_CYCLES = ["Monthly", "Annually"] as const;
const INVOICE_STATUSES = ["Draft", "Open", "Paid", "Uncollectible", "Void"] as const;

/** The tenant's subscription (`Subscription.toJSON()`). */
const subscriptionResponse = z
  .object({
    id: rowId,
    tenantId: rowId,
    planId: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    billingCycle: z.enum(BILLING_CYCLES),
    currentPeriodStart: timestamp,
    currentPeriodEnd: timestamp,
    stripeCustomerId: z.string().nullable(),
    stripeSubscriptionId: z.string().nullable().meta({ description: "Set when Stripe bills it; then the subscription cannot be overridden (409)" }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({
    id: "Subscription",
    description: "The tenant's subscription.",
    example: {
      id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      planId: "basic",
      status: "Active",
      billingCycle: "Monthly",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  });

const invoiceFields = {
  id: rowId,
  tenantId: rowId,
  subscriptionId: rowId,
  amountDue: z.number().meta({ description: "DECIMAL(10,2), read as a number (D-21)" }),
  amountPaid: z.number().meta({ description: "DECIMAL(10,2), read as a number (D-21)" }),
  currency: z.string(),
  status: z.enum(INVOICE_STATUSES),
  invoiceUrl: z.string().nullable(),
  stripeInvoiceId: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const invoiceExample = {
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  subscriptionId: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
  amountDue: 49,
  amountPaid: 49,
  currency: "usd",
  status: "Paid",
  invoiceUrl: null,
  stripeInvoiceId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

/** An invoice row (`Invoice.toJSON()`), as the metered-billing history lists it. */
const invoiceRow = z
  .object(invoiceFields)
  .meta({ id: "InvoiceRow", description: "An invoice of the tenant's subscription.", example: invoiceExample });

/** An invoice as the billing list answers it, with its subscription `{ id, planId }`. */
const invoiceListItem = z
  .object({ ...invoiceFields, subscription: z.object({ id: rowId, planId: z.string() }).nullable() })
  .meta({
    id: "Invoice",
    description: "An invoice of the tenant's subscription, with its subscription.",
    example: { ...invoiceExample, subscription: { id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a", planId: "basic" } },
  });

/** What the Stripe webhook answers Stripe: NOT the house envelope. */
const stripeWebhookAck = z
  .looseObject({
    received: z.literal(true),
    type: z.string().meta({ description: "The Stripe event type" }),
    handled: z.boolean().meta({ description: "Whether this event type changed anything here" }),
  })
  .meta({ id: "StripeWebhookAck" });

/** The webhook's refusal of an unverifiable request (400): its own shape, not the envelope. */
const stripeWebhookRefusal = z.object({ success: z.literal(false), message: z.string() }).meta({ id: "StripeWebhookRefusal" });

export { updateSubscription };
export {
  SUBSCRIPTION_STATUSES,
  BILLING_CYCLES,
  INVOICE_STATUSES,
  subscriptionResponse,
  invoiceRow,
  invoiceListItem,
  stripeWebhookAck,
  stripeWebhookRefusal,
};

// The client-side (input) and handler-side (output) types of each schema.
export type UpdateSubscriptionInput = z.input<typeof updateSubscription>;
export type UpdateSubscriptionBody = z.output<typeof updateSubscription>;
