/**
 * Binding a user to a client facility (P21-09; ADR-124 § 4, Am. 2 § 6; spec
 * MEMORY/specs/P19-04-client-facilities.md § 10.1; AM-1, AM-3, AM-14).
 *
 * `PUT /users/:userId/client-facility` is the ONE way a user's facility changes: bind (a
 * facility), re-bind (another facility), unbind (null — the role across every facility named
 * explicitly), or confirm an SSO/SCIM user unbound. The rules, in order:
 *
 *  0. the pre-invitation gate (`FACILITY_BINDING_ENABLED`): off → 409, nothing read;
 *  1. the actor is UNBOUND (re-checked here, AM-14) — 403;
 *  2. the target is loaded in the actor's context (another tenant's → 404), is not the actor
 *     (400 — an administrator binding itself would drop out of administration mid-act) and is not
 *     a super admin (404);
 *  3. bind: the facility is the tenant's (404), not its self facility (409), `active` (409); the
 *     resulting role is one of FACILITY_BOUND_ROLES (400); the same facility and role → 409;
 *  4. unbind: the role is required (400) — an unbound HEALTHCARE ADMIN of a provider is a tenant
 *     administrator, so it is chosen consciously;
 *  5. one transaction: the user row locked; `callibrator.facility_binding` names the user (0123's
 *     `users_facility_binding_guard` admits the change only under it); the update carries the
 *     typed `facilityBinding` option (the hooks' AM-6 refusal admits only it); EVERY session of
 *     the user revoked (AM-1, OQ-1 answered yes); one audit row per affected facility (§ 16).
 *     After commit: the permission cache cleared, the user's sockets disconnected (best effort —
 *     the socket re-check's `scopeDrift` catches it within a minute anyway).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import sessionService from "./session.service";
import redisService from "./redis.service";
import { AppError } from "../utils/appError.util";
import { sql, type SqlRunner } from "../utils/sql.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { isSuperAdminRoleName } from "../utils/role.util";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { facilityBindingEnabled } from "../config/facility";
import { FACILITY_BOUND_ROLES } from "../constants/facilityAccess";
import { logger } from "../middlewares/activityLog.middleware";
import type { UserFacilityBindingInput } from "@callibrator/contracts/clientFacilities";
import type { TenantId } from "../types/ids";

/** The transaction-local setting 0123's binding guard reads. */
export const FACILITY_BINDING_SETTING = "callibrator.facility_binding";

/** What the binding did, as its audit rows name it. */
export type BindingOperation = "BIND_FACILITY" | "UNBIND_FACILITY" | "REBIND_FACILITY" | "CONFIRM_UNBOUND";

/** The answer: the user's binding after the change. */
export interface BindingResult {
  readonly userId: string;
  readonly clientFacilityId: string | null;
  readonly roleId: string | null;
  readonly operation: BindingOperation;
  readonly sessionsRevoked: number;
}

const BOUND_ROLE_NAMES: readonly string[] = FACILITY_BOUND_ROLES;
const dbRunner = db as unknown as SqlRunner;

/** Disconnect the user's sockets after commit (lazy: config/socket loads the socket server). */
const disconnectSockets = (userId: string): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the socket server loads after the services
    const { getIo } = require("../config/socket") as { getIo: () => { in(room: string): { disconnectSockets(close: boolean): void } } };
    getIo().in(`user_${userId}`).disconnectSockets(true);
  } catch (error) {
    // No socket server (a worker, a test): the re-check's scopeDrift closes them within a minute.
    logger.warn("Facility binding: sockets not disconnected now", { userId, error: String(error) });
  }
};

/** The role a binding leaves the user with: loaded, active, never the super admin's. */
const loadRole = async (roleId: string, transaction: Transaction): Promise<{ id: string; name: string }> => {
  const role = await models.Roles.findByPk(roleId, { attributes: ["id", "name", "status"], transaction });
  if (!role) {
    throw new AppError(404, "Role not found");
  }
  if (isSuperAdminRoleName(role.name)) {
    throw new AppError(403, "Forbidden: cannot assign the SUPER_ADMIN role");
  }
  if (role.status !== "active") {
    throw new AppError(400, "Cannot assign inactive role to user");
  }
  return { id: role.id, name: role.name };
};

/**
 * Bind, re-bind or unbind `input.userId` (spec § 10.1).
 *
 * @param tenantId - the actor's tenant
 * @param input - the validated params and body
 * @param actor - the administrator
 * @returns the binding after the change
 */
export const setBinding = async (tenantId: TenantId, input: UserFacilityBindingInput, actor: AuditActorInput): Promise<BindingResult> => {
  if (!facilityBindingEnabled()) {
    throw new AppError(409, "Facility-bound accounts are not enabled yet.");
  }
  if (tenantStorage.getStore()?.facilityBound === true) {
    throw new AppError(403, "Only an administrator who is not bound to a facility can change bindings.");
  }
  if (input.userId === actor.userId) {
    throw new AppError(400, "You cannot change your own facility binding.");
  }
  const result = await db.transaction(async (transaction) => {
    const user = await models.User.findOne({
      where: { id: input.userId, tenantId },
      include: [{ model: models.Roles, as: "role", attributes: ["id", "name"], required: false }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user || isSuperAdminRoleName(user.role?.name)) {
      throw new AppError(404, "User not found");
    }
    const from = user.clientFacilityId ?? null;
    const to = input.clientFacilityId;
    let roleId = user.roleId ?? null;
    let operation: BindingOperation;

    if (to) {
      const facility = await models.ClientFacility.findOne({ where: { id: to, tenantId }, attributes: ["id", "isSelf", "status"], transaction });
      if (!facility) {
        throw new AppError(404, "Client facility not found");
      }
      if (facility.isSelf) {
        throw new AppError(409, "Users are not bound to the tenant's own facility — leave them unbound.");
      }
      if (facility.status !== "active") {
        throw new AppError(409, `Users cannot be bound to a facility that is ${facility.status}.`);
      }
      const role = input.roleId ? await loadRole(input.roleId, transaction) : { id: roleId, name: user.role?.name ?? "" };
      if (!BOUND_ROLE_NAMES.includes(role.name)) {
        throw new AppError(400, `A facility-bound user must hold one of the roles: ${BOUND_ROLE_NAMES.join(", ")}.`);
      }
      if (from === to && role.id === roleId) {
        throw new AppError(409, "This user is already bound to this facility with this role.");
      }
      roleId = role.id;
      operation = from ? "REBIND_FACILITY" : "BIND_FACILITY";
    } else {
      if (!input.roleId) {
        throw new AppError(400, "Choose the role this user will hold across every facility.");
      }
      if (!from && !user.facilityBindingPending) {
        throw new AppError(409, "This user is not bound to a facility.");
      }
      roleId = (await loadRole(input.roleId, transaction)).id;
      operation = from ? "UNBIND_FACILITY" : "CONFIRM_UNBOUND";
    }

    await sql(dbRunner, "SELECT set_config($1, $2, true)", [FACILITY_BINDING_SETTING, user.id], { transaction });
    const roleBefore = user.roleId ?? null;
    const binding: Parameters<typeof user.update>[0] = { clientFacilityId: to as typeof user.clientFacilityId, roleId: roleId, facilityBindingPending: false };
    await user.update(binding, { transaction, facilityBinding: true });
    const sessionsRevoked = await sessionService.revokeOtherSessions(user.id, null, "FACILITY_BINDING_CHANGED", { transaction });

    // One row per affected facility (§ 16): the old one and the new one — so each facility's
    // breach-scoping trail shows the account entering or leaving it.
    const facilities = [...new Set([from, to].filter((f): f is string => Boolean(f)))];
    const changes = { operation, from, to, roleBefore, roleAfter: roleId, reason: input.reason, sessionsRevoked };
    for (const clientFacilityId of facilities.length > 0 ? facilities : [null]) {
      await auditService.logAction(
        {
          tenantId,
          ...auditEntryActor(actor),
          action: "UPDATE",
          resourceType: "User",
          resourceId: user.id,
          ...(clientFacilityId ? { clientFacilityId } : {}),
          changes,
        },
        { transaction },
      );
    }
    return { userId: user.id, clientFacilityId: to, roleId, operation, sessionsRevoked };
  });
  await redisService.del(redisService.cacheKeys.userPermissions(result.userId)).catch((error: unknown) => {
    logger.warn("Facility binding: permission cache not cleared", { userId: result.userId, error: String(error) });
  });
  disconnectSockets(result.userId);
  return result;
};
