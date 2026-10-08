/**
 * The field app's server routes (P21-03c; P19-08 spec § 11.3). Named exports only.
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { fieldWipe } from "@callibrator/contracts/inspectionSessions";
import { recordFieldWipe } from "../services/fieldWipe.service";
import type { TenantId } from "../types/ids";

/** POST /field/wipes. */
export const wipe = asyncHandler(async (req: Request, res: Response) => {
  success(res, await recordFieldWipe(req.tenantId as TenantId, validated(req, fieldWipe), auditPrincipal(req)), "Field data wipe recorded", 201);
});
