/**
 * Calibration scheduler, `/api/v1/calibration-scheduler` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from calibrationScheduler.route.js. Every route,
 * gate and middleware is in the same order as before (checked against the
 * mounted route table). The contract is code-first: calibrationScheduler.openapi.ts
 * (P9-25, ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import calibrationSchedulerController from "../../controllers/calibrationScheduler.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/due",
  auth,
  dynamicAccess("maintenance", "read", { checkTenant: true }),
  calibrationSchedulerController.listDue,
);

router.post(
  "/run",
  auth,
  dynamicAccess("maintenance", "create", { checkTenant: true }),
  calibrationSchedulerController.runScan,
);

export = router;
