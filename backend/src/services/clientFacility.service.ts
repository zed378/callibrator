/**
 * Client facilities — the database-layer service of P20-07 (ADR-124 and its Amendments 2–3; spec
 * MEMORY/specs/P19-04-client-facilities.md § 4.3).
 *
 * ONE function today: `createSelfFacility`, the explicit, audited call every tenant-creation path
 * makes (tenant.service#createTenant, tenantHierarchy.service#createSubOrganization, the seeds in
 * migration.service) so that every tenant has exactly one `is_self` facility — the one the
 * database places a device in when none is named (migration 0118's default trigger, Am. 3).
 * Migration 0117 gave every tenant that existed one. A database trigger creating it was rejected
 * (spec § 4.3: invisible to memoryDb, unaudited, a second mechanism); the guard
 * tests/guards/tenantCreateSelfFacility.guard proves no creation path forgets the call.
 *
 * The rest of the client-facility service (create, edit, status, delete, binding, move) is
 * P21-09's.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Transaction } from "sequelize";
import models from "../models";
import auditService from "./audit.service";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import { toClientFacilityId, type ClientFacilityId } from "../types/ids";
import type { ModelInstance } from "../types/models";

/** The self facility's code (migration 0117 writes the same). */
export const SELF_FACILITY_CODE = "SELF";

/** The longest facility name the column holds. */
const NAME_MAX_LENGTH = 255;

/** The tenant a self facility is made for — the members read. */
export interface SelfFacilityTenant {
  readonly id: string;
  readonly name: string;
}

/** Who creates it: a user, or (a seed, a boot step) nobody — then the back-fill's system actor. */
export interface SelfFacilityActor {
  readonly userId?: string | null | undefined;
}

/**
 * The facility name the database accepts (0117's CHECK `client_facilities_name_normalised`): the
 * tenant's name trimmed, inner whitespace collapsed, at most 255 characters; `SELF` if nothing is left.
 *
 * @param tenantName - the tenant's name
 * @returns the self facility's name
 */
export const selfFacilityName = (tenantName: string): string =>
  tenantName.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH).trim() || SELF_FACILITY_CODE;

/**
 * Ensure `tenant` has its self facility, inside the caller's transaction: find it, else create it
 * with ONE `CREATE` audit row in the new facility's own tenant (`changes.operation`
 * CREATE_SELF_FACILITY), stamped with the facility. Idempotent — a seed re-run, or a tenant
 * migration 0117 already served, finds the existing row and writes nothing.
 *
 * `skipTenantScope` (reviewed): the row belongs to the tenant being CREATED, never the caller's
 * own — the super admin's context skips the scope anyway, and a seed has none; the option keeps a
 * scoped context from stamping its own tenant onto another's facility.
 *
 * @param tenant - the tenant (`id`, `name`)
 * @param actor - the creating user, if any
 * @param options - `transaction`: the tenant creation's own
 * @returns the self facility
 */
export const createSelfFacility = async (
  tenant: SelfFacilityTenant,
  actor: SelfFacilityActor | null = null,
  { transaction = null }: { transaction?: Transaction | null } = {},
): Promise<ModelInstance<"ClientFacility">> => {
  const { ClientFacility } = models;
  const existing = await ClientFacility.findOne({
    where: { tenantId: tenant.id, isSelf: true },
    skipTenantScope: true,
    ...(transaction ? { transaction } : {}),
  });
  if (existing) {
    return existing;
  }
  const userId = actor?.userId ?? null;
  const facility = await ClientFacility.create(
    {
      tenantId: tenant.id as ModelInstance<"ClientFacility">["tenantId"],
      name: selfFacilityName(tenant.name),
      code: SELF_FACILITY_CODE,
      kind: "other",
      isSelf: true,
      status: "active",
      createdBy: userId as ModelInstance<"ClientFacility">["createdBy"],
    },
    { skipTenantScope: true, ...(transaction ? { transaction } : {}) },
  );
  const facilityId: ClientFacilityId = toClientFacilityId(facility.id);
  await auditService.logAction(
    {
      tenantId: tenant.id,
      ...(userId ? { userId } : { systemActor: SYSTEM_ACTORS.CLIENT_FACILITY_BACKFILL }),
      action: "CREATE",
      resourceType: "ClientFacility",
      resourceId: facilityId,
      clientFacilityId: facilityId,
      changes: {
        operation: "CREATE_SELF_FACILITY",
        ...(userId ? {} : { actor: SYSTEM_ACTORS.CLIENT_FACILITY_BACKFILL }),
        tenantId: tenant.id,
        before: {},
        after: { name: facility.name, code: facility.code, kind: facility.kind, isSelf: true, status: facility.status },
      },
    },
    { transaction },
  );
  return facility;
};
