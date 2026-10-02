/**
 * Reports: `/api/v1/reports` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from reports.route.js. Every route and middleware
 * is in the same order as before (checked against the mounted route table).
 * The contract is code-first: reports.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone. The controller is now imported
 * before the gate is built (imports are hoisted); building a gate has no effect
 * beyond its closure.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import reportingController from "../../controllers/reporting.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// AZ-01 (G-02): every report was `auth` alone, so an API key of any scope and
// any custom role read the whole reporting surface. Gated on the seeded
// `reports` menu — the menu that shows the Reports page. The seed grants it
// (read) to every seeded role, so this changes nothing for them; it makes the
// grant mean something for custom roles and for API keys (`reports:read`).
const canReadReports = dynamicAccess("reports", "read");

router.get("/summary", auth, canReadReports, reportingController.summary);

router.get("/compliance", auth, canReadReports, reportingController.compliance);

router.get("/calibration-workload", auth, canReadReports, reportingController.calibrationWorkload);

router.get("/overdue-devices", auth, canReadReports, reportingController.overdueDevices);

router.get("/inventory", auth, canReadReports, reportingController.inventory);

export = router;
