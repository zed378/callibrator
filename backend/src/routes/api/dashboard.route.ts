/**
 * Dashboard metrics: `/api/v1/dashboard` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from dashboard.route.js. The route, its gate and
 * its middleware are in the same order as before (checked against the mounted
 * route table). The contract is code-first: dashboard.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import dashboardController from "../../controllers/dashboard.controller";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-304 (ADR-100): the metrics are the load call of the home page (the
// `home` menu entry). Every role holds `home` read (ROLE_MENU_ASSIGNMENTS),
// so the gate takes the page from nobody; it was `auth` alone (ADR-058's
// ACCEPTED exemption), open to every role and every API key.
router.get("/metrics", auth, dynamicAccess(MENU_SLUGS.HOME, "read"), dashboardController.getDashboardMetrics);

export = router;
