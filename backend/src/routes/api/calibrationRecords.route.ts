/**
 * Calibration records, `/api/v1/calibration-records` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from calibrationRecords.route.js. Every route,
 * gate and middleware is in the same order as before (checked against the
 * mounted route table). The contract is code-first: calibrationRecords.openapi.ts
 * (P9-25, ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-127, ADR-051 Q-17
import calibrationRecordsController from "../../controllers/calibrationRecords.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/",
  auth,
  dynamicAccess("calibration", "read"),
  calibrationRecordsController.getAllCalibrationRecords,
);

router.post(
  "/",
  auth,
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.createCalibrationRecord,
);

router.get(
  "/:calibrationRecordId",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "read"),
  calibrationRecordsController.getSpecificCalibrationRecord,
);

// P6-03: a correction writes a NEW, superseding record; the original is never changed.
router.post(
  "/:calibrationRecordId/corrections",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.correctCalibrationRecord,
);

// Q-51: an API key is refused (403). voided_by names the person who voids a
// regulated record (a users FK), and a void is final — a person answers for it.
router.post(
  "/:calibrationRecordId/void",
  auth,
  denyApiKey,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.voidCalibrationRecord,
);

export = router;
