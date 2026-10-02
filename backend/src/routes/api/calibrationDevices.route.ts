/**
 * Calibration devices, `/api/v1/calibration-devices` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from calibrationDevices.route.js. Every route,
 * gate and middleware is in the same order as before (checked against the
 * mounted route table). The contract is code-first: calibrationDevices.openapi.ts
 * (P9-25, ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants";
import { upload } from "../../utils/upload.util";
import calibrationDevicesController from "../../controllers/calibrationDevices.controller";
import reinstateController from "../../controllers/calibrationDeviceReinstate.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/",
  auth,
  dynamicAccess("calibration", "read"),
  calibrationDevicesController.getAllCalibrationDevices,
);

router.post(
  "/",
  auth,
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.createCalibrationDevice,
);

router.get(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "read"),
  calibrationDevicesController.getSpecificCalibrationDevice,
);

router.put(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.updateCalibrationDevice,
);

router.delete(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.deleteCalibrationDevice,
);

// A-133 (ADR-075): a tenant administrator restores a device deleted in error.
router.post(
  "/:calibrationDeviceId/restore",
  auth,
  validateUuid("calibrationDeviceId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.restoreCalibrationDevice,
);

// Q-02 (ADR-084): a retirement entered in error is reinstated, with a reason.
router.post(
  "/:calibrationDeviceId/reinstate",
  auth,
  validateUuid("calibrationDeviceId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
  reinstateController.reinstateCalibrationDevice,
);

router.post(
  "/bulk-import",
  auth,
  dynamicAccess("calibration", "write"),
  upload({
    folder: "imports",
    allowedMimes: ["text/csv"],
    allowedExtensions: [".csv"],
  }),
  calibrationDevicesController.bulkImportCalibrationDevices,
);

export = router;
