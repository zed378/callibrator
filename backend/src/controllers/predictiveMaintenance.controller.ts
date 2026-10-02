/**
 * Predictive maintenance, `/api/v1/predictive-maintenance`.
 *
 * P9-18 (ADR-087): converted from predictiveMaintenance.controller.js,
 * behaviour unchanged. The handlers keep their own try/catch and hand an error
 * to `next`, as before. The tenant comes from the request's tenant context (a
 * missing store throws inside the try, as it did); `req.user` is read without
 * a guard. `Op`, the service, `success`, `CalibrationDevice`, `tenantStorage`
 * and `auditPrincipal` are captured at load, as the `.js` destructured them;
 * the service is read through its module object at call time. `export =`
 * keeps the exact object `require()` returned.
 */
import type { NextFunction, Request, Response } from "express";
import { Op as LoadedOp } from "sequelize";
import predictiveMaintenanceService from "../services/predictiveMaintenance.service";
import { success as loadedSuccess } from "../utils/response.util";
import models from "../models";
import { tenantStorage as loadedTenantStorage } from "../middlewares/tenantContext.middleware";
// A-282 (ADR-100): an API key (calibration:write) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import type { TenantId, UserId } from "../types/ids";

const Op = LoadedOp;
const success = loadedSuccess;
const { CalibrationDevice } = models;
const tenantStorage = loadedTenantStorage;
const auditPrincipal = loadedAuditPrincipal;

/** The request's tenant context (read without a guard, as before). */
interface TenantStore {
  tenantId: TenantId;
}

const analyzeDevice = async (req: Request, res: Response, next: NextFunction): Promise<Response | undefined> => {
  try {
    const { deviceId } = req.params as { deviceId: string };
    const { tenantId } = tenantStorage.getStore() as TenantStore;

    // A-190: the recommendation is audited under the caller.
    const result = await predictiveMaintenanceService.analyzeDevice(tenantId, deviceId, auditPrincipal(req));
    // success(res, data, meta, message, statusCode) SENDS the response — it is
    // not a body builder. Passing the message as `res` made `res.status`
    // undefined and threw on every call.
    return success(res, result, null, "Analysis complete");
  } catch (error) {
    next(error);
  }
  return undefined;
};

const getRecommendations = async (_req: Request, res: Response, next: NextFunction): Promise<Response | undefined> => {
  try {
    const { tenantId } = tenantStorage.getStore() as TenantStore;

    const devices = await CalibrationDevice.findAll({
      where: {
        tenantId,
        // Must be Op.ne, not the Mongo-style `$ne`: Sequelize dropped string
        // operator aliases in v5, so `{ $ne: null }` was compared as a literal
        // value — `= '[object Object]'` — and 500'd with
        // "invalid input syntax for type integer".
        recommendedCalibrationInterval: {
          [Op.ne]: null,
        },
      },
      attributes: ["id", "name", "serialNumber", "calibrationIntervalDays", "recommendedCalibrationInterval", "recommendationReason"],
    });

    return success(res, devices, null, "Recommendations retrieved");
  } catch (error) {
    next(error);
  }
  return undefined;
};

// A-145 — the interval change and its audit row are written together by the
// service; the approving user is the caller.
const approveRecommendation = async (req: Request, res: Response, next: NextFunction): Promise<Response | undefined> => {
  try {
    const { deviceId } = req.params as { deviceId: string };
    const { tenantId } = tenantStorage.getStore() as TenantStore;

    const device = await predictiveMaintenanceService.approveRecommendation(
      tenantId,
      deviceId,
      (req.user as { id: UserId }).id,
    );

    return success(res, device, null, "Recommendation applied successfully");
  } catch (error) {
    next(error);
  }
  return undefined;
};

const controller = { analyzeDevice, getRecommendations, approveRecommendation };

export = controller;
