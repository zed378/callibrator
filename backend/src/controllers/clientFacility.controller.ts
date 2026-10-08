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
import {
  clientFacilityCreate,
  clientFacilityEdit,
  clientFacilityIdParams,
  clientFacilityListQuery,
  clientFacilityStatusRequest,
  userFacilityBinding,
} from "@callibrator/contracts/clientFacilities";
import {
  changeFacilityStatus,
  createFacility,
  deleteFacility,
  facilityOptions,
  facilityUsers,
  getFacility,
  getMine,
  listFacilities,
  updateFacility,
} from "../services/clientFacilityAdmin.service";
import { rbacAllows } from "../services/effectivePermission.service";
import type { PermissionPrincipal } from "../services/effectivePermission.service";
import { ROLE_NAMES } from "../constants/roleConstants";
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

// ------------------------------------------------------------------
// FACILITY ADMINISTRATION (P21-09c; spec § 13.1, § 4.4 – § 4.6)
// ------------------------------------------------------------------

/** GET /client-facilities: a page of the tenant's facilities — rows in `data`, paging in `meta`. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listFacilities(req.tenantId as TenantId, validated(req, clientFacilityListQuery));
  success(res, rows, meta, "Client facilities retrieved", 200);
});

/** GET /client-facilities/options: the pickers' short list. */
export const options = asyncHandler(async (req: Request, res: Response) => {
  success(res, await facilityOptions(req.tenantId as TenantId), "Client facility options retrieved", 200);
});

/** GET /client-facilities/:clientFacilityId. */
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const { clientFacilityId } = validated(req, clientFacilityIdParams);
  success(res, await getFacility(req.tenantId as TenantId, clientFacilityId), "Client facility retrieved", 200);
});

/** POST /client-facilities. */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const facility = await createFacility(req.tenantId as TenantId, validated(req, clientFacilityCreate), auditPrincipal(req));
  success(res, facility, "Client facility created", 201);
});

/** PATCH /client-facilities/:clientFacilityId. */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { clientFacilityId, ...changes } = validated(req, clientFacilityEdit);
  const facility = await updateFacility(req.tenantId as TenantId, clientFacilityId, changes, auditPrincipal(req));
  success(res, facility, "Client facility updated", 200);
});

/** POST /client-facilities/:clientFacilityId/status — `ended → active` needs a tenant administrator (§ 4.4). */
export const changeStatus = asyncHandler(async (req: Request, res: Response) => {
  const { clientFacilityId, ...input } = validated(req, clientFacilityStatusRequest);
  const tenantAdmin = rbacAllows(req.user as unknown as PermissionPrincipal, [ROLE_NAMES.TENANT_ADMIN]);
  const result = await changeFacilityStatus(req.tenantId as TenantId, clientFacilityId, input, { ...auditPrincipal(req), tenantAdmin });
  success(res, result, "Client facility status changed", 200);
});

/** DELETE /client-facilities/:clientFacilityId — only a facility nothing references (§ 4.6). */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { clientFacilityId } = validated(req, clientFacilityIdParams);
  await deleteFacility(req.tenantId as TenantId, clientFacilityId, auditPrincipal(req));
  success(res, null, "Client facility deleted", 200);
});

/** GET /client-facilities/:clientFacilityId/users: the facility's bound users. */
export const users = asyncHandler(async (req: Request, res: Response) => {
  const { clientFacilityId } = validated(req, clientFacilityIdParams);
  success(res, await facilityUsers(req.tenantId as TenantId, clientFacilityId), "Client facility users retrieved", 200);
});
