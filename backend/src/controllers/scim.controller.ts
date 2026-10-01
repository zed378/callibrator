// P9-20 (ADR-087): converted from scim.controller.js with no behaviour change.
// `export =` keeps the exact object `require()` returned (the same keys, in the
// same order). The service is the module object; every other load-time
// destructure is kept as a capture at load. Request data is read through typed
// views of the request; the emitted expressions are the `.js` ones.
import type { Request, Response } from "express";

import scimService from "../services/scim.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import {
  scimUserSchema as loadedScimUserSchema,
  scimGroupSchema as loadedScimGroupSchema,
  scimPatchSchema as loadedScimPatchSchema,
} from "../validators/scim.validator";
import { validateInput as loadedValidate } from "../validators/input";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const scimUserSchema = loadedScimUserSchema;
const scimGroupSchema = loadedScimGroupSchema;
const scimPatchSchema = loadedScimPatchSchema;
const validate = loadedValidate;

/** The principal the SCIM gate let through: a scoped API key, or a super admin's JWT. */
type ScimRequest = Request & {
  user?: { id?: string; tenantId: string; isApiKey?: boolean };
};

/** The list query, as the query string carries it. */
interface ListQuery {
  startIndex?: string | number;
  count?: string | number;
  filter?: unknown;
}

/**
 * A-37 (ADR-075) — who is provisioning: the API key (budgeted and audited as
 * `system:scim`), or null for a super admin's JWT, which is neither.
 * A-278 (ADR-094): `userId` names the super admin, whose every write is now
 * audited as that user; it is null for a key (which is not a user).
 *
 * @param {import("express").Request} req
 * @returns {{apiKeyId: (string|null), userId: (string|null), ipAddress: (string|null), userAgent: (string|null)}}
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: every empty value reads as null */
const scimActor = (req: ScimRequest): { apiKeyId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null } => ({
  apiKeyId: req.user?.isApiKey ? (req.user.id as string) : null,
  userId: req.user && !req.user.isApiKey ? req.user.id || null : null,
  ipAddress: req.ip || null,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…]` tolerates a request object without headers
  userAgent: req.headers?.["user-agent"] || null,
});
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/** The caller's tenant, read as `req.user?.tenantId` (the SCIM gate always sets a principal). */
const tenantOf = (req: ScimRequest): string => req.user?.tenantId as string;

const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const { startIndex = 1, count = 100, filter } = r.query as ListQuery;
  const result = await scimService.getUsers(tenantOf(r), Number(startIndex), Number(count), filter);
  success(res, result, null, "SCIM users fetched");
});

const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const result = await scimService.getUserById(tenantOf(r), r.params["id"] as string);
  success(res, result, null, "SCIM user fetched");
});

const createUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimUserSchema);
  const result = await scimService.createUser(tenantOf(r), validated, scimActor(r));
  res.status(201).json({ success: true, status: 201, message: "SCIM user created", data: result });
});

const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimUserSchema);
  const result = await scimService.updateUser(tenantOf(r), r.params["id"] as string, validated, scimActor(r));
  success(res, result, null, "SCIM user updated");
});

const patchUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimPatchSchema);
  const result = await scimService.patchUser(
    tenantOf(r),
    r.params["id"] as string,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `validated.Operations || []`
    validated.Operations || [],
    scimActor(r),
  );
  success(res, result, null, "SCIM user patched");
});

const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  await scimService.deleteUser(tenantOf(r), r.params["id"] as string, scimActor(r));
  res.status(204).json({ success: true, status: 204, message: "SCIM user deleted", data: null });
});

const getGroups = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const { startIndex = 1, count = 100, filter } = r.query as ListQuery;
  const result = await scimService.getGroups(tenantOf(r), Number(startIndex), Number(count), filter);
  success(res, result, null, "SCIM groups fetched");
});

const getGroupById = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const result = await scimService.getGroupById(tenantOf(r), r.params["id"]);
  success(res, result, null, "SCIM group fetched");
});

const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimGroupSchema);
  const result = await scimService.createGroup(tenantOf(r), validated, scimActor(r));
  res.status(201).json({ success: true, status: 201, message: "SCIM group created", data: result });
});

const updateGroup = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimGroupSchema);
  const result = await scimService.updateGroup(tenantOf(r), r.params["id"], validated, scimActor(r));
  success(res, result, null, "SCIM group updated");
});

const patchGroup = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  const validated = validate(r.body, scimPatchSchema);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `validated.Operations || []`
  const result = await scimService.patchGroup(tenantOf(r), r.params["id"], validated.Operations || [], scimActor(r));
  success(res, result, null, "SCIM group patched");
});

const deleteGroup = asyncHandler(async (req: Request, res: Response) => {
  const r = req as ScimRequest;
  await scimService.deleteGroup(tenantOf(r), r.params["id"], scimActor(r));
  res.status(204).json({ success: true, status: 204, message: "SCIM group deleted", data: null });
});

const controller = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  patchUser,
  deleteUser,
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  patchGroup,
  deleteGroup,
};

export = controller;
