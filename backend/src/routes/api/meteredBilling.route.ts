/**
 * Metered Billing Routes
 *
 * Routes for metered billing and usage analytics.
 * Mounted at /api/v1/metered-billing
 *
 * P9-21 (ADR-087): converted from meteredBilling.route.js. Every route, gate
 * and middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: meteredBilling.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants";
import {
  getUsageMetrics,
  getBillingHistory,
  estimateCost,
  getPlanDetails,
  getUsageAlerts,
  createUsageAlert,
  deleteUsageAlert,
  getAnalytics,
} from "../../controllers/meteredBilling.controller";
import {
  createUsageAlert as createAlertValidator,
  estimateCost as estimateCostValidator,
  getAnalytics as getAnalyticsValidator,
  getBillingHistory as billingHistoryValidator,
} from "../../validators/meteredBilling.validator";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// ADR-043. This was `rbac(["TENANT_ADMIN", "BILLING_ADMIN"])`, which denied
// everyone but the SUPERADMIN: "BILLING_ADMIN" is a role name that exists in no
// constants file and no seed, so rbac dropped it, and "TENANT_ADMIN" is a
// logical tier no seeded role is named after — leaving a level bar of 8 that no
// principal could clear, because no loader projected a level.
//
// Metered billing is a menu with a read/write distinction, not a privilege
// floor, and `metered-billing` is the one slug of the five affected surfaces
// that exists in MENU_SLUGS, the menu-group seed AND ROLE_MENU_ASSIGNMENTS — so
// it is the one that can convert today. Reading usage is `read`; creating or
// deleting a usage alert is `write` (write implicitly satisfies read).
const billingRead = [auth, dynamicAccess(MENU_SLUGS.METERED_BILLING, "read")];
const billingWrite = [auth, dynamicAccess(MENU_SLUGS.METERED_BILLING, "write")];

router.get("/usage", ...billingRead, getUsageMetrics);

router.get(
  "/history",
  ...billingRead,
  validate(billingHistoryValidator, { from: "query" }),
  getBillingHistory,
);

router.post(
  "/estimate",
  ...billingRead,
  validate(estimateCostValidator),
  estimateCost,
);

router.get("/plan", ...billingRead, getPlanDetails);

router.get("/alerts", ...billingRead, getUsageAlerts);

router.post(
  "/alerts",
  ...billingWrite,
  validate(createAlertValidator),
  createUsageAlert,
);

router.delete(
  "/alerts/:alertId",
  ...billingWrite,
  validateUuid("alertId"),
  deleteUsageAlert,
);

router.get(
  "/analytics",
  ...billingRead,
  validate(getAnalyticsValidator, { from: "query" }),
  getAnalytics,
);

export = router;
