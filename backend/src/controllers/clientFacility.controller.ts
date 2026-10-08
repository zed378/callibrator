/**
 * Client facilities and user binding — the handlers (P21-09; spec
 * MEMORY/specs/P19-04-client-facilities.md § 10.1, § 13.1). Every body and parameter arrives
 * validated (`validate(schema, { from })` on the route) and is read with `validated(req, schema)`;
 * the tenant comes from the request context, never from input.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { userFacilityBinding } from "@callibrator/contracts/clientFacilities";
import { getMine } from "../services/clientFacilityAdmin.service";
import { setBinding } from "../services/userFacilityBinding.service";
import type { TenantId } from "../types/ids";

/** GET /client-facilities/mine (S-8): the caller's own facility, or null when unbound. */
export const mine = asyncHandler(async (_req: Request, res: Response) => {
  success(res, await getMine(), "Client facility retrieved", 200);
});

/** PUT /users/:userId/client-facility (§ 10.1): bind, re-bind, unbind, confirm unbound. */
export const bindUser = asyncHandler(async (req: Request, res: Response) => {
  const input = validated(req, userFacilityBinding);
  const result = await setBinding(req.tenantId as TenantId, input, auditPrincipal(req));
  success(res, result, "Facility binding changed", 200);
});
