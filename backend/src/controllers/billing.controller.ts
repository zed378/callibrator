/**
 * Billing: the tenant's subscription and invoices, and the Stripe webhook:
 * `/api/v1/billing`.
 *
 * P9-20 (ADR-087): converted from billing.controller.js, behaviour unchanged.
 * As the JavaScript did: the tenant comes from `req.user` (read inline, so a
 * request without a user throws the same TypeError); the invoice list passes
 * `req.query` values RAW; the override body is what `validate()` left on
 * `req.body`; `success()` answers with the service's status. The webhook is
 * NOT wrapped: it answers Stripe in its own shapes (400 on an unverifiable
 * request, 200 with the handler's result, 500 so that Stripe retries).
 */
import type { Request, Response } from "express";
import billingService from "../services/billing.service";
import stripeWebhookService from "../services/stripeWebhook.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// A-282 (ADR-100): an API key (billing scopes) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const logger = loadedLogger;
const auditPrincipal = loadedAuditPrincipal;

/** The principal `auth` set, destructured inline from `req.user` as before. */
interface Principal {
  tenantId: TenantId;
}

/** What reaches the service is what the JavaScript passed: the query values RAW, the body as validated. */
type InvoiceQuery = Parameters<typeof billingService.fetchInvoices>[0];
type OverrideBody = Parameters<typeof billingService.updateSubscription>[1];
type StripeEvent = Parameters<typeof stripeWebhookService.handleEvent>[0];

/** The list result's `data` (the JavaScript read `.rows` / `.meta` off it unguarded). */
interface ListData {
  rows: unknown;
  meta: object;
}

/** The webhook request: index.js keeps the raw bytes on `req.rawBody` for the signature check. */
interface WebhookRequest {
  rawBody?: unknown;
}

/** An error as the webhook reads it (`err.message`, whatever was thrown). */
interface Thrown {
  message?: unknown;
}

export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;

  // P6-11: a first read creates the basic subscription, audited under the reader.
  const result = await billingService.getSubscription(tenantId, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const updateSubscription = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const data = req.body as OverrideBody;

  // A-225: the override is audited under the acting user.
  const result = await billingService.updateSubscription(tenantId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const fetchInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { page, limit, status } = req.query;

  const query = {
    tenantId,
    page,
    limit,
    status,
  };
  const result = await billingService.fetchInvoices(query as InvoiceQuery);

  success(res, (result.data as ListData).rows, (result.data as ListData).meta, result.message, result.status);
});

// POST /api/v1/billing/webhook — Stripe calls this (no auth). Requires the raw
// request body (wired in index.js before the JSON body parser).
export const handleStripeWebhook = async (req: Request, res: Response): Promise<Response> => {
  let event: unknown;
  try {
    event = stripeWebhookService.constructEvent(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.rawBody || req.body`
      (req as unknown as WebhookRequest).rawBody || req.body,
      req.headers["stripe-signature"],
    );
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the message is interpolated whatever its type
    logger.warn(`Stripe webhook verification failed: ${(err as Thrown).message}`);
    return res
      .status(400)
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      .json({ success: false, message: `Webhook Error: ${(err as Thrown).message}` });
  }

  try {
    const result = await stripeWebhookService.handleEvent(event as StripeEvent);
    return res.status(200).json({ received: true, type: (event as StripeEvent).type, ...result });
  } catch (err) {
    // Non-2xx makes Stripe retry, which is the desired behaviour on a
    // transient processing failure.
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
    logger.error(`Stripe webhook processing error: ${(err as Thrown).message}`);
    return res.status(500).json({ received: true, error: (err as Thrown).message });
  }
};
