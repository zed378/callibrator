/**
 * Billing: `/api/v1/billing` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from billing.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: billing.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { updateSubscription as updateSubscriptionSchema } from "../../validators/billing.validator";
import {
  getSubscription,
  updateSubscription,
  fetchInvoices,
  handleStripeWebhook,
} from "../../controllers/billing.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/subscription",
  auth,
  dynamicAccess("billing", "read", { checkTenant: true }),
  getSubscription,
);

router.patch(
  "/subscription",
  auth,
  dynamicAccess("billing", "update", { checkTenant: true }),
  validate(updateSubscriptionSchema),
  updateSubscription,
);

router.get(
  "/invoices",
  auth,
  dynamicAccess("billing", "read", { checkTenant: true }),
  fetchInvoices,
);

// Stripe calls this: no auth, the signature is the authentication (verified in
// the handler against the raw body index.js keeps on req.rawBody).
router.post("/webhook", handleStripeWebhook);

export = router;
