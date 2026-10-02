/**
 * Calibration Device controller, `/api/v1/calibration-devices`.
 *
 * P9-20 (ADR-087): converted from calibrationDevices.controller.js, behaviour
 * unchanged. `req.tenantId`, `req.user`, `req.query`, `req.params`, `req.body`
 * and `req.file` are read INLINE as the JavaScript read them (a missing user
 * throws the same TypeError, inside the wrapper). Everything the JavaScript
 * required at load is captured at load, in its order; `fs` is still required
 * inside the bulk import, at call time. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import calibrationDevicesService from "../services/calibrationDevices.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// A-282 (ADR-100): an API key (calibration scopes) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { success as loadedSuccess, error as loadedError } from "../utils/response.util";
import {
  getCalibrationDevicesQuery as loadedListQuery,
  calibrationDeviceIdSchema as loadedIdSchema,
  createCalibrationDeviceSchema as loadedCreateSchema,
  updateCalibrationDeviceSchema as loadedUpdateSchema,
} from "../validators/calibrationDevices.validator";
import { validateInput } from "../validators/input";
import type * as Fs from "fs";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const auditPrincipal = loadedAuditPrincipal;
const logger = loadedLogger;
const success = loadedSuccess;
const error = loadedError;
const getCalibrationDevicesQuery = loadedListQuery;
const calibrationDeviceIdSchema = loadedIdSchema;
const createCalibrationDeviceSchema = loadedCreateSchema;
const updateCalibrationDeviceSchema = loadedUpdateSchema;
const validate = validateInput;

/** A service result, as `send` reads it. */
interface ServiceResult {
  status: number;
  message: string;
  data: unknown;
}

/**
 * Send a service result down the path its status belongs on. The service
 * RETURNS its 404 and 409 outcomes; forwarding those through success() sent
 * `success: true` with a 409 status (the A-103 defect class). A 409 from
 * a serial-number conflict (A-92) goes out as `success: false` with its
 * explanation as the message.
 *
 * @param res
 * @param result
 */
const send = (res: Response, result: ServiceResult): Response =>
  result.status >= 400
    ? error(res, result.message, result.status)
    : success(res, result.data, null, result.message, result.status);

/** The caller's tenant: the one `auth` resolved (a super admin's override), else the user's. */
const tenantOf = (req: Request): TenantId =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty tenant falls back (ADR-038 rule 3)
  (req.tenantId || (req.user as { tenantId: TenantId }).tenantId);

const getAllCalibrationDevices = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.query, getCalibrationDevicesQuery);
  const result = await calibrationDevicesService.fetchCalibrationDevices({
    tenantId,
    find: validated.find,
    page: validated.page,
    limit: validated.limit,
    status: validated.status,
    category: validated.category,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

const getSpecificCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const result = await calibrationDevicesService.fetchSpecificCalibrationDevice(
    tenantId,
    calibrationDeviceId,
  );

  send(res, result);
});

const createCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.body, createCalibrationDeviceSchema);
  const result = await calibrationDevicesService.createCalibrationDevice(
    tenantId,
    validated,
    auditPrincipal(req),
  );

  send(res, result);
});

const updateCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const validated = validate(req.body, updateCalibrationDeviceSchema);
  const result = await calibrationDevicesService.updateCalibrationDevice(
    tenantId,
    calibrationDeviceId,
    validated,
    auditPrincipal(req),
  );

  send(res, result);
});

const deleteCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const result = await calibrationDevicesService.deleteCalibrationDevice(
    tenantId,
    calibrationDeviceId,
    auditPrincipal(req),
  );

  send(res, result);
});

// A-133 (ADR-075): 404 for not-found and another tenant's device alike; 409
// with a state explanation for a device that is not deleted or whose serial a
// live device now holds.
const restoreCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const result = await calibrationDevicesService.restoreCalibrationDevice(
    tenantId,
    calibrationDeviceId,
    auditPrincipal(req),
  );

  send(res, result);
});

const bulkImportCalibrationDevices = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);

  if (!req.file) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the wrapper reads `status` and `message` off a plain object (ADR-038 rule 3)
    throw {
      status: 400,
      message: "No CSV file uploaded",
    };
  }
  const file = req.file;

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required at call time
  const fs = require("fs") as typeof Fs;
  try {
    const result = await calibrationDevicesService.bulkImportCalibrationDevices(
      tenantId,
      file.path,
      auditPrincipal(req),
    );

    send(res, result);
  } finally {
    fs.unlink(file.path, (err) => {
      if (err && err.code !== "ENOENT") {
        logger.error("Failed to delete temp import file", {
          path: file.path,
          code: err.code,
          error: err.message,
        });
      }
    });
  }
});

export = {
  getAllCalibrationDevices,
  getSpecificCalibrationDevice,
  createCalibrationDevice,
  updateCalibrationDevice,
  deleteCalibrationDevice,
  restoreCalibrationDevice,
  bulkImportCalibrationDevices,
};
