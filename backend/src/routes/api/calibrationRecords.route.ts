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
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants/roleConstants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-127, ADR-051 Q-17
import calibrationRecordsController from "../../controllers/calibrationRecords.controller";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { applyRecordEsignature, recordEsignaturesParams } from "@callibrator/contracts/esignatures";
import { applyToRecordHandler, recordApplications } from "../../controllers/userEsignature.controller";

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
// P20-06 (spec P18-01-02 § 4.3, ADR-124 Am. 5): a tenant administrator's act,
// narrowed in the release that gives the technicians `calibration` write
// (UD-4 (b)) — a correction (a new superseding record) stays open to them.
router.post(
  "/:calibrationRecordId/void",
  auth,
  denyApiKey,
  validateUuid("calibrationRecordId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.voidCalibrationRecord,
);

// P21-15 (ADR-140; spec P21-15 v2 § 4): the personal e-signature applied to a record — `performed` by
// its performer, `reviewed` by anyone else with calibration write — re-entering a credential (the
// signing budget per user and address: the A-185 class). An API key is refused (a person signs). The
// read answers every application with its link, its specimen and the integrity now.
const signingBudget = requestBudget("esigSign", { keyOf: (req) => (req.user as { id: string }).id });

router.post(
  "/:calibrationRecordId/esignatures",
  auth,
  denyApiKey,
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  validateUuid("calibrationRecordId"),
  validate(applyRecordEsignature, { from: ["params", "body"] }),
  signingBudget,
  applyToRecordHandler,
);

router.get(
  "/:calibrationRecordId/esignatures",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "read"),
  validate(recordEsignaturesParams, { from: "params" }),
  recordApplications,
);

export = router;
