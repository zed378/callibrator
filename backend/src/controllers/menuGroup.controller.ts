/**
 * Menu groups and role menu assignments, `/api/v1/menu-groups` (also mounted
 * at `/api/v1/menu-group-roles`).
 *
 * P9-18 (ADR-087): converted from menuGroup.controller.js, behaviour
 * unchanged. Each handler validates its body with the menu-group validator's
 * own schemas (`checkInput`, a 400 naming every failure) as before; the
 * schemas are read through the validator module at call time. `req.user` is
 * read without a guard (`auth` runs first). The service is read through its
 * module object at call time; the utilities are captured at load, as the `.js`
 * destructured them. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import type { z } from "zod";
import { success as loadedSuccess } from "../utils/response.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import menuGroupService from "../services/menuGroup.service";
import {
  getAssignmentsSchema,
  createMenuGroupSchema,
  updateMenuGroupSchema,
  assignMenuItemSchema,
  assignMenuGroupSchema,
  revokeMenuItemSchema,
  revokeMenuGroupSchema,
  bulkAssignMenuGroupsSchema,
  bulkRevokeMenuGroupsSchema,
} from "../validators/menuGroup.validator";
import { checkInput as loadedCheckInput } from "../validators/input";

const success = loadedSuccess;
const AppError = LoadedAppError;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const auditActor = loadedAuditActor;
// The validator's schemas, captured at load (the `.js` held the module; its exports never change).
const schemas = {
  getAssignmentsSchema,
  createMenuGroupSchema,
  updateMenuGroupSchema,
  assignMenuItemSchema,
  assignMenuGroupSchema,
  revokeMenuItemSchema,
  revokeMenuGroupSchema,
  bulkAssignMenuGroupsSchema,
  bulkRevokeMenuGroupsSchema,
};
const checkInput = loadedCheckInput;

type Service = typeof menuGroupService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

const validate = <S extends z.ZodType>(data: unknown, schema: S): z.output<S> => {
  const checked = checkInput(data, schema);
  if (!checked.ok) {
    throw new AppError(400, "Validation failed: " + checked.errors.map((d) => d.message).join(", "));
  }
  return checked.value;
};

/** The audit actor of a menu change (auditActor(req), typed for the service). */
const actorOf = (req: Request): Arg<"createMenuGroup", 1> => auditActor(req);

/** The body, which Express 5 leaves undefined when none was sent. */
const bodyOf = (req: Request): Record<string, unknown> | undefined => req.body as Record<string, unknown> | undefined;

// ==========================================
// FILTER/GET ALL MENU GROUPS
// ==========================================
const filterMenuGroups = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  // req.body?.roleId, not req.body.roleId. Express 5 no longer defaults an
  // absent body to {}, and this handler serves two GET routes — so the
  // unguarded read threw "Cannot read properties of undefined (reading
  // 'roleId')" and surfaced as a 500 on /menu-groups and /menu-groups/admin.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty query value falls back to the body's
  const roleId = (req.query["roleId"] || bodyOf(req)?.["roleId"]) as Arg<"listMenuGroups", 0>;
  const data = await menuGroupService.listMenuGroups(roleId);
  return success(res, data, null, "Menu groups fetched successfully", 200);
}, {});

// ==========================================
// GET ROLE MENU ASSIGNMENTS (PERSONALIZED MENU)
// ==========================================
const getRoleMenuAssignments = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { roleId } = validate(req.body, schemas.getAssignmentsSchema);
  // ADR-102: the requester decides whose effective permission the menu shows
  // (their own, overrides included, when roleId is their role).
  const data = await menuGroupService.getRoleMenuAssignments(roleId, req.user);
  return success(
    res,
    data,
    null,
    "Role menu assignments fetched successfully",
    200,
  );
}, {});

// ==========================================
// MY EFFECTIVE PERMISSIONS (ADR-102)
// ==========================================
const getMyPermissions = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const data = await menuGroupService.getMyPermissions(req.user as Arg<"getMyPermissions", 0>);
  return success(res, data, null, "Effective permissions fetched successfully", 200);
}, {});

// ==========================================
// GET ROLES FOR SELECTION
// ==========================================
const getAvailableRoles = asyncHandlerWithMapping(async (_req: Request, res: Response) => {
  const roles = await menuGroupService.getAvailableRoles();
  return success(res, roles, null, "Roles fetched successfully", 200);
}, {});

// ==========================================
// CREATE MENU GROUP
// ==========================================
const createMenuGroup = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const value = validate(req.body, schemas.createMenuGroupSchema);
  const data = await menuGroupService.createMenuGroup(value as Arg<"createMenuGroup", 0>, actorOf(req));
  return success(res, data, null, "Menu group created successfully", 201);
}, {});

// ==========================================
// UPDATE MENU GROUP
// ==========================================
const updateMenuGroup = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const value = validate(req.body, schemas.updateMenuGroupSchema);
  const data = await menuGroupService.updateMenuGroup(value as Arg<"updateMenuGroup", 0>, actorOf(req));
  return success(res, data, null, "Menu group updated successfully", 200);
}, {});

// ==========================================
// DELETE MENU GROUP
// ==========================================
const deleteMenuGroup = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  const { menuGroupId } = (req.body || {}) as { menuGroupId?: string };
  if (!menuGroupId) {
    throw new AppError(400, "menuGroupId is required");
  }
  await menuGroupService.deleteMenuGroup(menuGroupId, actorOf(req));
  return success(res, null, null, "Menu group deleted successfully", 200);
}, {});

// ==========================================
// ASSIGN MENU TO ROLE (GROUP OR ITEM)
// ==========================================
const assignMenuGroupToRole = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const isItem = !!bodyOf(req)?.["menuItemId"];
  const schema = isItem
    ? schemas.assignMenuItemSchema
    : schemas.assignMenuGroupSchema;
  const value = validate(req.body, schema) as { roleId: string; menuItemId?: string; menuGroupId?: string };
  const roleId = value.roleId;
  const menuGroupId = (isItem ? value.menuItemId : value.menuGroupId) as string;

  const perm = await menuGroupService.assignMenuToRole({ roleId, menuGroupId }, actorOf(req));
  return success(res, perm, null, "Menu assigned successfully", 200);
}, {});

// ==========================================
// REVOKE MENU FROM ROLE (GROUP OR ITEM)
// ==========================================
const revokeMenuGroupFromRole = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const isItem = !!bodyOf(req)?.["menuItemId"];
  const schema = isItem
    ? schemas.revokeMenuItemSchema
    : schemas.revokeMenuGroupSchema;
  const value = validate(req.body, schema) as { roleId: string; menuItemId?: string; menuGroupId?: string };
  const roleId = value.roleId;
  const menuGroupId = (isItem ? value.menuItemId : value.menuGroupId) as string;

  await menuGroupService.revokeMenuFromRole({ roleId, menuGroupId }, actorOf(req));
  return success(res, null, null, "Menu revoked successfully", 200);
}, {});

// ==========================================
// BULK ASSIGN
// ==========================================
const bulkAssignMenuGroups = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const value = validate(req.body, schemas.bulkAssignMenuGroupsSchema);
  const data = await menuGroupService.bulkAssign(
    value.roleId,
    value.menuGroupIds,
    actorOf(req),
  );
  return success(res, data, null, "Bulk assignment completed", 200);
}, {});

// ==========================================
// BULK REVOKE
// ==========================================
const bulkRevokeMenuGroups = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const value = validate(req.body, schemas.bulkRevokeMenuGroupsSchema);
  const data = await menuGroupService.bulkRevoke(
    value.roleId,
    value.menuGroupIds,
    actorOf(req),
  );
  return success(res, data, null, "Bulk revocation completed", 200);
}, {});

const controller = {
  filterMenuGroups,
  getRoleMenuAssignments,
  getMyPermissions,
  getAvailableRoles,
  createMenuGroup,
  updateMenuGroup,
  deleteMenuGroup,
  assignMenuGroupToRole,
  revokeMenuGroupFromRole,
  bulkAssignMenuGroups,
  bulkRevokeMenuGroups,
};

export = controller;
