/**
 * Quota, `/api/v1/quota` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from quota.route.js. The route, its gate and its
 * middleware are in the same order as before (checked against the mounted
 * route table). The contract is code-first: quota.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants";
import quotaController from "../../controllers/quota.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// AZ-01 / G-03 (ADR-088): plan, seats, storage and entitlements are the billing
// page's data (PlanQuotaCard is the only consumer), so they carry its gate.
router.get("/", auth, dynamicAccess(MENU_SLUGS.BILLING, "read"), quotaController.getUsage);

export = router;
