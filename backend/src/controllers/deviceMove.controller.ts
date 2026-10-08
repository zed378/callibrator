/**
 * P21-09d — moving a device between client facilities (spec MEMORY/specs/P19-04-client-facilities.md
 * § 11.2): the handlers. The parameters and body arrive validated (`validate(schema, { from })` on
 * the route) and are read with `validated(req, schema)`; the tenant comes from the request.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { deviceMove, deviceMovesParams } from "@callibrator/contracts/clientFacilities";
import { listDeviceMoves, moveDevice } from "../services/deviceMove.service";
import type { TenantId } from "../types/ids";

/** POST /calibration-devices/:calibrationDeviceId/move — the device and its history change facility. */
export const move = asyncHandler(async (req: Request, res: Response) => {
  const result = await moveDevice(req.tenantId as TenantId, validated(req, deviceMove), auditPrincipal(req));
  success(res, result, "Device moved", 200);
});

/** GET /calibration-devices/:calibrationDeviceId/moves — the device's moves, newest first. */
export const moves = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationDeviceId } = validated(req, deviceMovesParams);
  success(res, await listDeviceMoves(req.tenantId as TenantId, calibrationDeviceId), "Device moves retrieved", 200);
});
