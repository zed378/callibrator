/**
 * Q-02 (ADR-084) — POST /calibration-devices/:calibrationDeviceId/reinstate.
 *
 * The one way a retired calibration device leaves `retired`: a tenant
 * administrator's correction with a reason, audited in the same transaction
 * (services/calibrationDeviceReinstate.service.ts). Another tenant's device
 * answers 404, like one that does not exist.
 *
 * P9-20 (ADR-087): converted from calibrationDeviceReinstate.controller.js,
 * behaviour unchanged. `req.tenantId`, `req.user`, `req.params` and `req.body`
 * are read INLINE as the JavaScript read them. Everything it required at load
 * is captured at load, in its order. `export =` keeps the exact object
 * `require()` returned.
 */
import type { Request, Response } from "express";
import reinstateService from "../services/calibrationDeviceReinstate.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import { error as loadedError, sendResult as loadedSendResult } from "../utils/response.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;
const error = loadedError;
const sendResult = loadedSendResult;

const reinstateCalibrationDevice = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty tenant falls back (ADR-038 rule 3)
  const tenantId = req.tenantId || (req.user as { tenantId: TenantId }).tenantId;
  const result = await reinstateService.reinstate(
    tenantId,
    // As before: the raw path parameter (validateUuid ran on the route).
    req.params["calibrationDeviceId"] as string,
    req.body,
    auditActor(req),
  );

  if (result.status === 400) {
    return error(res, result.message, 400, null, { errors: result.errors });
  }
  return sendResult(res, result);
});

export = { reinstateCalibrationDevice };
