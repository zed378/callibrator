/**
 * Roles, menu groups, role assignment and role-menu permissions:
 * `/api/v1/roles` (super admin only).
 *
 * P9-20 (ADR-087): converted from roles.controller.js, behaviour unchanged.
 * These handlers answer with `res.status().json()` directly (not `success()`),
 * read `req.query` / `req.params` / `req.body` as the JavaScript did (the role
 * create/update bodies have been parsed by `validate()` on the route; the
 * others are read raw), and fall back the same way (`|| 20`, `|| {}`,
 * `|| "read"`). Everything the JavaScript destructured at load is still
 * captured at load.
 *
 * 2026-10-11 (ADR-137): every answer is the house envelope `{ success, status,
 * message, data }` (plus the top-level `meta` of the two lists). It was
 * `{ success, data }`, `{ success, message }` on a removal and on a not-found;
 * `data` itself is unchanged on every success, and is `null` on a removal and
 * a not-found.
 */
import type { Request, Response } from "express";
import rolesService from "../services/roles.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";

const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;

/** The list query the two list routes read raw (no schema), as the JavaScript did. */
interface ListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

/** The role body `validate(createRoleSchema | updateRoleSchema)` left on `req.body`. */
interface RoleBody {
  name: string;
  nameToShow?: string | null | undefined;
  description?: string | null | undefined;
  roleLevel?: unknown;
  status?: string | undefined;
}

/** The menu-group body, read raw (the route validates it with an open schema, or not at all). */
interface MenuBody {
  name: string;
  slug?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/**
 * `req.query`, typed as the list routes read it.
 *
 * @param req - the request
 * @returns the raw query
 */
const listQueryOf = (req: Request): ListQuery => req.query;

/**
 * `req.params`, typed as these routes read them (`validateUuid` checks `:id`;
 * the permission and assignment routes read theirs unchecked, as before).
 *
 * @param req - the request
 * @returns the raw path parameters
 */
const paramsOf = (req: Request): { id: string; roleId: string; menuGroupId: string; userId: string } =>
  req.params as { id: string; roleId: string; menuGroupId: string; userId: string };

/**
 * The body, typed as each handler reads it. `req.body || {}` where the
 * JavaScript wrote it: an absent body reads as an empty object.
 *
 * @param req - the request
 * @returns the body, or `{}` when there is none
 */
const bodyOrEmpty = <T>(req: Request): Partial<T> => {
  const body: unknown = req.body;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  return body || {};
};

/**
 * The audit actor plus the caller's own role level, which bounds the level a
 * role create or edit may grant (F-19, ADR-105).
 *
 * @param req - the request
 * @returns the actor the service records and checks
 */
const roleActor = (req: Request): ReturnType<typeof auditActor> & { roleLevel: number | null } => ({
  ...auditActor(req),
  roleLevel: (req.user as { role?: { roleLevel?: number | null } } | undefined)?.role?.roleLevel ?? null,
});

/** Pagination, the top-level sibling of `data` on the two lists. */
interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Answer with the house envelope (CLAUDE.md, ADR-137): `success` follows the status.
 *
 * @param res - the response
 * @param status - the HTTP status, repeated in the body
 * @param message - what happened
 * @param data - the answer's data (`null` when there is none)
 * @param meta - a list's pagination
 * @returns the response
 */
const answer = (res: Response, status: number, message: string, data: unknown, meta?: ListMeta): Response =>
  res.status(status).json({ success: status < 400, status, message, data, ...(meta === undefined ? {} : { meta }) });

// ==========================================
//                     ROLES
// ==========================================

export const getAllRoles = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = listQueryOf(req);
  const result = await rolesService.getAllRoles({
    // As built: NaN (absent or non-numeric) falls back to 20 / page 1.
    limit: parseInt(limit as string) || 20,
    offset: ((parseInt(page as string) || 1) - 1) * (parseInt(limit as string) || 20),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" and absent both read as ""
    search: search || "",
  });
  // F-19: the house envelope — pagination is a top-level `meta` (CLAUDE.md).
  return answer(res, 200, "Roles retrieved", result.data, {
    total: result.count,
    page: result.page,
    limit: result.limit,
    totalPages: Math.max(1, Math.ceil(result.count / result.limit)),
  });
});

export const getRoleById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  const role = await rolesService.getRoleById(id);
  if (!role) {
    return answer(res, 404, "Role not found", null);
  }
  return answer(res, 200, "Role retrieved", role);
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  // A-294: `roleLevel` is validated (1–8, createRoleSchema) and the service
  // clamps and persists it (ADR-043); it used to be dropped here, so every
  // role created through the API had level 1 and failed every privileged gate.
  // F-19 (ADR-105): Display Name and a starting status are accepted too; the
  // caller's own level bounds the level it may grant.
  const { name, nameToShow, description, roleLevel, status } = req.body as RoleBody;
  const role = await rolesService.createRole(
    { name, nameToShow, description, roleLevel, status },
    roleActor(req),
  );
  const fullRole = await rolesService.getRoleById(role.id);
  return answer(res, 201, "Role created", fullRole);
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  // F-19 (ADR-105): Display Name and Level were dropped here, so an edit of
  // either answered 200 and changed nothing.
  const { name, nameToShow, description, roleLevel, status } = req.body as Partial<RoleBody>;
  const role = await rolesService.updateRole(
    id,
    { name, nameToShow, description, roleLevel, status },
    roleActor(req),
  );
  return answer(res, 200, "Role updated", role);
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  const result = await rolesService.deleteRole(id, auditActor(req));
  return answer(res, 200, result.message, null);
});

// ==========================================
//                     MENU GROUPS
// ==========================================

export const getAllMenus = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = listQueryOf(req);
  const result = await rolesService.getAllMenus({
    // As built: NaN (absent or non-numeric) falls back to 20 / page 1.
    limit: parseInt(limit as string) || 20,
    offset: ((parseInt(page as string) || 1) - 1) * (parseInt(limit as string) || 20),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" and absent both read as ""
    search: search || "",
  });
  // F-19: the house envelope — pagination is a top-level `meta` (CLAUDE.md).
  return answer(res, 200, "Menu groups retrieved", result.data, {
    total: result.count,
    page: result.page,
    limit: result.limit,
    totalPages: Math.max(1, Math.ceil(result.count / result.limit)),
  });
});

export const getMenuById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  const menu = await rolesService.getMenuById(id);
  if (!menu) {
    return answer(res, 404, "Menu group not found", null);
  }
  return answer(res, 200, "Menu group retrieved", menu);
});

export const createMenu = asyncHandler(async (req: Request, res: Response) => {
  const menu = await rolesService.createMenu(bodyOrEmpty<MenuBody>(req) as MenuBody, auditActor(req));
  return answer(res, 201, "Menu group created", menu);
});

export const updateMenu = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  const menu = await rolesService.updateMenu(id, bodyOrEmpty<MenuBody>(req), auditActor(req));
  return answer(res, 200, "Menu group updated", menu);
});

export const deleteMenu = asyncHandler(async (req: Request, res: Response) => {
  const { id } = paramsOf(req);
  const result = await rolesService.deleteMenu(id, auditActor(req));
  return answer(res, 200, result.message, null);
});

// ==========================================
//                     ROLE ASSIGNMENT
// ==========================================

export const assignRoleToUser = asyncHandler(async (req: Request, res: Response) => {
  const { userId, roleId } = bodyOrEmpty<{ userId: string; roleId: string }>(req);
  const user = await rolesService.assignRoleToUser(userId as string, roleId as string, auditActor(req));
  return answer(res, 200, "Role assigned to user", user);
});

export const removeRoleFromUser = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = paramsOf(req);
  const result = await rolesService.removeRoleFromUser(userId, auditActor(req));
  return answer(res, 200, result.message, null);
});

// ==========================================
//                     PERMISSIONS (Role-Menu)
// ==========================================

export const assignPermissionToRole = asyncHandler(async (req: Request, res: Response) => {
  const { roleId } = paramsOf(req);
  const { menuGroupId, permissionType } = bodyOrEmpty<{ menuGroupId: string; permissionType: string }>(req);
  const permission = await rolesService.assignMenuToRole(
    roleId,
    menuGroupId as string,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" reads as "read"
    permissionType || "read",
    auditActor(req),
  );
  return answer(res, 201, "Permission assigned successfully", permission);
});

export const removePermissionFromRole = asyncHandler(async (req: Request, res: Response) => {
  const { roleId, menuGroupId } = paramsOf(req);
  const result = await rolesService.removeMenuFromRole(roleId, menuGroupId, auditActor(req));
  return answer(res, 200, result.message, null);
});
