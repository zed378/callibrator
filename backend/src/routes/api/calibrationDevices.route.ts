/**
 * Calibration devices, `/api/v1/calibration-devices` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from calibrationDevices.route.js. Every route,
 * gate and middleware is in the same order as before (checked against the
 * mounted route table). The contract is code-first: calibrationDevices.openapi.ts
 * (P9-25, ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants";
import { upload } from "../../utils/upload.util";
import calibrationDevicesController from "../../controllers/calibrationDevices.controller";
import reinstateController from "../../controllers/calibrationDeviceReinstate.controller";
import { validate } from "../../middlewares/validation.middleware";
import { deviceMove, deviceMovesParams } from "@callibrator/contracts/clientFacilities";
import { move as moveDevice, moves as listDeviceMoves } from "../../controllers/deviceMove.controller";
import { deviceIpmSessionsQuery } from "@callibrator/contracts/inspectionSessions";
import { deviceHistory as ipmDeviceHistory } from "../../controllers/ipmSession.controller";
import { validateScoped } from "../../middlewares/validation.middleware";
import { idempotency } from "../../middlewares/idempotency.middleware";
import calibrationDevicesService from "../../services/calibrationDevices.service";
import { AppError } from "../../utils/appError.util";
import type { TenantId } from "../../types/ids";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware";
import { calibrationDateEntry } from "@callibrator/contracts/calibrationRecords";
import { recordDate } from "../../controllers/calibrationDates.controller";
import { readCalibrationRecord } from "../../services/calibrationDates.service";
import {
  createCalibrationDeviceBoundSchema,
  createCalibrationDeviceSchema,
  deviceQrParams,
  updateCalibrationDeviceBoundSchema,
  updateCalibrationDeviceSchema,
} from "@callibrator/contracts/calibrationDevices";

// `Router` is `express.Router` (the same function).
const router = Router();

/**
 * P21-02a (ADR-127 § 7; P19-02 § 9.2): a replayed create answers the device RE-READ in the
 * current context (gone from view: 404).
 */
const replayCreate = idempotency({
  slug: "calibration",
  read: async (id, req) => {
    const result = await calibrationDevicesService.fetchSpecificCalibrationDevice(req.tenantId as TenantId, id);
    if (!result.data) {
      throw new AppError(404, result.message);
    }
    return result.data;
  },
});

router.get(
  "/",
  auth,
  dynamicAccess("calibration", "read"),
  calibrationDevicesController.getAllCalibrationDevices,
);

// P21-02a (spec P19-03 § 5, § 8.1): the contract is chosen by the principal's binding: a bound
// technician's has no QR, status or vendor (strict). `Idempotency-Key` replays an offline create.
router.post(
  "/",
  auth,
  dynamicAccess("calibration", "write"),
  validateScoped({ unbound: createCalibrationDeviceSchema, bound: createCalibrationDeviceBoundSchema }),
  replayCreate,
  calibrationDevicesController.createCalibrationDevice,
);

// P21-02a (spec P19-03 § 8.2; N-13, A-12, C-11): the QR lookup — registered BEFORE `/:calibrationDeviceId`.
// Marked (every bound role reads its facility's devices); unknown, deleted, another facility's and
// another tenant's QR answer the same 404.
router.get(
  "/by-qr/:qrCode",
  auth,
  dynamicAccess("calibration", "read"),
  validate(deviceQrParams, { from: "params" }),
  calibrationDevicesController.getCalibrationDeviceByQr,
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
  validateScoped({ unbound: updateCalibrationDeviceSchema, bound: updateCalibrationDeviceBoundSchema }),
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

// P21-09d (P19-04 spec § 11.2): a tenant administrator moves a device — and its whole history —
// to another client facility of the tenant. Unmarked: a facility-bound principal is refused (403
// FACILITY_ROUTE_REFUSED) before a parameter is read; the service re-checks it is unbound.
router.post(
  "/:calibrationDeviceId/move",
  auth,
  denyApiKey,
  validateUuid("calibrationDeviceId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
  validate(deviceMove, { from: ["params", "body"] }),
  moveDevice,
);

// The device's moves, for provider staff (a move names another client: unmarked).
router.get(
  "/:calibrationDeviceId/moves",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "read"),
  validate(deviceMovesParams, { from: ["params"] }),
  listDeviceMoves,
);

// P21-03 (spec P19-02 § 10.2): the device's IPM history with its chain links — `ipm` read,
// marked (N-2): the device is loaded in context first, another facility's is the 404.
router.get(
  "/:calibrationDeviceId/ipm-sessions",
  auth,
  dynamicAccess("ipm", "read"),
  validate(deviceIpmSessionsQuery, { from: ["params", "query"] }),
  ipmDeviceHistory,
);

// P21-05 (ADR-133 § 2; spec P19-05 § 7.2): an outside laboratory's calibration by its date and key
// data, NO file. `calibration` write; API keys allowed (a laboratory's system may post dates, Q-51);
// NOT facility-accessible (N-10: laboratory work — a bound principal is refused before a parameter
// is read, C-14). `Idempotency-Key` replays the record re-read in context.
router.post(
  "/:calibrationDeviceId/calibration-dates",
  auth,
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  validate(calibrationDateEntry, { from: ["params", "body"] }),
  idempotency({ slug: "calibration", read: (id) => readCalibrationRecord(id) }),
  recordDate,
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
