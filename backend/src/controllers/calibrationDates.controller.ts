/**
 * P21-05 (ADR-133 § 2; spec MEMORY/specs/P19-05-calibration-dates.md § 7): the quick
 * external-calibration entry's handler. The path's device and the body arrive validated
 * (`validate(calibrationDateEntry, { from: ["params", "body"] })`); the tenant and the actor come
 * from the request (an API key records as `api_key_id`, Q-51).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { calibrationDateEntry } from "@callibrator/contracts/calibrationRecords";
import { recordExternalCalibration } from "../services/calibrationDates.service";
import type { TenantId } from "../types/ids";

/** POST /calibration-devices/:calibrationDeviceId/calibration-dates — 201, the record, the derived date, the notices. */
export const recordDate = asyncHandler(async (req: Request, res: Response) => {
  const result = await recordExternalCalibration(req.tenantId as TenantId, validated(req, calibrationDateEntry), auditPrincipal(req));
  success(res, { ...result.record, device: result.device, notices: result.notices }, "External calibration recorded", 201);
});
