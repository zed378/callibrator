/**
 * P21-09e — provisioning by an identity provider in a multi-facility tenant (spec
 * MEMORY/specs/P19-04-client-facilities.md § 10.6; threat model AM-15; G-18).
 *
 * In a tenant that has a client facility besides its own (`is_self = false`), an account created
 * by SSO just-in-time provisioning or by SCIM cannot know where it belongs: it is created with
 * `facility_binding_pending = true` and refused at `auth` with `FACILITY_BINDING_PENDING` until an
 * unbound administrator binds it, or confirms it unbound (`PUT /users/:userId/client-facility`).
 * A tenant with only its self facility is unchanged (G-31).
 *
 * An identity provider never sets or clears a facility: any attribute naming one is a 400, and a
 * BOUND user cannot be given a role outside the bound set (400; the database trigger
 * `users_facility_bound_role` holds it too). Named exports only.
 */
import type { Transaction } from "sequelize";
import models from "../models";
import { AppError } from "../utils/appError.util";
import { FACILITY_BOUND_ROLES } from "../constants/facilityAccess";

/** Whether the tenant serves a client facility besides its own (the provisioning then pends). */
export const tenantHasClientFacilities = async (tenantId: string, transaction: Transaction): Promise<boolean> =>
  (await models.ClientFacility.count({ where: { tenantId, isSelf: false }, transaction })) > 0;

const FACILITY_KEY = /facility/i;

/** The first key (at any depth) of `input` that names a facility, or null. */
const facilityKeyIn = (input: unknown, depth = 0): string | null => {
  if (depth > 4 || input === null || typeof input !== "object") {
    return null;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FACILITY_KEY.test(key)) {
      return key;
    }
    const nested = facilityKeyIn(value, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
};

/**
 * Refuse a provisioning payload (or a PATCH path) that names a facility.
 *
 * @param input - a SCIM body, a PATCH value, or a PATCH path string
 * @throws {AppError} 400
 */
export const assertNoFacilityAttribute = (input: unknown): void => {
  const named = typeof input === "string" ? (FACILITY_KEY.test(input) ? input : null) : facilityKeyIn(input);
  if (named) {
    throw new AppError(400, `An identity provider cannot set or clear a user's facility ("${named}"); an administrator binds users.`);
  }
};

const BOUND_ROLE_NAMES: readonly string[] = FACILITY_BOUND_ROLES;

/**
 * Refuse a role change that would leave a BOUND user with a role outside the bound set.
 *
 * @param user - the user being changed (its loaded facility)
 * @param roleId - the role it would get, if any
 * @throws {AppError} 400 naming the four roles
 */
export const assertBoundRole = async (user: { clientFacilityId?: string | null }, roleId: string | null | undefined): Promise<void> => {
  if (!user.clientFacilityId || !roleId) {
    return;
  }
  const role = await models.Roles.findByPk(roleId, { attributes: ["id", "name"] });
  if (!role || !BOUND_ROLE_NAMES.includes(role.name)) {
    throw new AppError(400, `A facility-bound user must hold one of the roles: ${BOUND_ROLE_NAMES.join(", ")}.`);
  }
};
