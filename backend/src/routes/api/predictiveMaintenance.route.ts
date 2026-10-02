/**
 * Predictive maintenance: `/api/v1/predictive-maintenance` (index.js mounts
 * it).
 *
 * P9-18 (ADR-087): converted from predictiveMaintenance.route.js. Every route
 * and middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: predictiveMaintenance.openapi.ts
 * (P9-25, ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import predictiveMaintenanceController from "../../controllers/predictiveMaintenance.controller";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// All endpoints require authentication and "predictiveMaintenance" menu permissions
router.use(auth);

router.post(
  "/analyze/:deviceId",
  validateUuid("deviceId"),
  dynamicAccess("calibration", "write", { checkTenant: true }),
  predictiveMaintenanceController.analyzeDevice,
);

router.get(
  "/recommendations",
  dynamicAccess("calibration", "read", { checkTenant: true }),
  predictiveMaintenanceController.getRecommendations,
);

// A-145 — reviewed and deliberately NOT a Part 11 authoring route (no
// denyPlatformAuthoring): it sets calibrationIntervalDays, the same field
// PUT /calibration-devices/:id edits with the same `calibration` write grant.
// The change and its audit row are written in one transaction.
router.post(
  "/recommendations/:deviceId/approve",
  validateUuid("deviceId"),
  dynamicAccess("calibration", "write", { checkTenant: true }),
  predictiveMaintenanceController.approveRecommendation,
);

export = router;
