/**
 * P9-21 / P9-25 (ADR-103) — the contract of `billing.route.ts`, code-first.
 *
 * The override body is the object `validate()` mounts
 * (`validators/billing.validator` → `@callibrator/contracts/billing`). The
 * invoice list reads its filters RAW from `req.query`. The Stripe webhook is
 * public and answers Stripe in its own shapes, documented as they are.
 * Examples are synthetic.
 */
import { z } from "zod";
import { updateSubscription } from "../../validators/billing.validator";
import {
  INVOICE_STATUSES,
  invoiceListItem,
  stripeWebhookAck,
  stripeWebhookRefusal,
  subscriptionResponse,
} from "@callibrator/contracts/billing";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** The filters `billing.service#fetchInvoices` reads, raw from `req.query`. */
const invoiceQuery = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (capped by the server)", example: 20 }),
  status: z.enum(INVOICE_STATUSES).optional(),
});

/** The webhook's body: a Stripe event, verified against the `Stripe-Signature` header. */
const stripeEvent = z
  .looseObject({ id: z.string(), type: z.string(), data: z.looseObject({}) })
  .meta({ description: "A Stripe event (the raw bytes are what the signature covers)" });

const access = (action: string) => ({ kind: "dynamicAccess", resource: "billing", action }) as const;

export default defineRouteDocs({
  router: "api/billing.route",
  mount: "/api/v1/billing",
  tag: "Billing",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/subscription",
      operationId: "getSubscription",
      summary: "Get the tenant's subscription",
      description: "A tenant with none gets its basic subscription created by this first read, audited under the reader (P6-11).",
      permission: access("read"),
      audited: true,
      success: { status: 200, description: "The subscription", data: subscriptionResponse },
    },
    {
      method: "patch",
      path: "/subscription",
      operationId: "updateSubscription",
      summary: "Override the tenant's subscription (manually billed only)",
      description:
        "A Stripe-billed subscription refuses every change (409): Stripe is the source of truth. On a manually billed " +
        "one, a `status` change must be a recorded payment transition and needs a `reason` (400 without one). A field " +
        "sent with its current value is not a change and writes nothing (A-225).",
      permission: access("update"),
      audited: true,
      body: updateSubscription,
      success: { status: 200, description: "The subscription after the change", data: subscriptionResponse },
      conflict: "the subscription is billed through Stripe, or the status change is not a transition from the current status.",
      errors: [404],
    },
    {
      method: "get",
      path: "/invoices",
      operationId: "listInvoices",
      summary: "List the tenant's invoices",
      description: "Newest first, each with its subscription `{ id, planId }`.",
      permission: access("read"),
      audited: false,
      query: invoiceQuery,
      success: { status: 200, description: "A page of invoices; pagination in the top-level `meta`", list: invoiceListItem },
    },
    {
      method: "post",
      path: "/webhook",
      operationId: "stripeWebhook",
      summary: "Stripe billing webhook (signature-verified, no auth)",
      description:
        "Public: the `Stripe-Signature` header over the raw body is the authentication. Receives Stripe events " +
        "(invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted) and reconciles subscription, " +
        "invoice and tenant state. Answers Stripe in its own shapes, NOT the envelope: 200 `{ received, type, handled, … }`; " +
        "400 when the signature cannot be verified; 500 `{ received: true, error }` on a processing failure, so that " +
        "Stripe retries.",
      permission: null,
      audited: false,
      body: stripeEvent,
      success: { status: 200, description: "Event received", body: stripeWebhookAck },
      errorBodies: {
        400: {
          description: "The signature could not be verified",
          body: stripeWebhookRefusal,
          example: { success: false, message: "Webhook Error: No signatures found matching the expected signature for payload" },
        },
      },
    },
  ],
});
