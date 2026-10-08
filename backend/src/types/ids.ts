/**
 * Branded identifiers (P9-05, docs/ENGINEERING/04 § Branded identifiers).
 *
 * `tenantId` and `userId` are both UUID strings and appear together in
 * hundreds of calls; swapping them compiles as plain strings. A brand makes
 * the swap a compile error. Brands are types only: at run time a `TenantId`
 * is the same string it always was.
 *
 * Seeded with the ONE brand a converted module uses (the tenant context store,
 * middlewares/tenantContext.middleware.ts). The validating constructor
 * (`toTenantId`) and the other brands (`UserId`, `DeviceId`, …) are added by
 * the first converted module that turns a raw string into one — no speculative
 * types (src/types/README.md). A brand assertion (`value as TenantId`) is
 * allowed ONLY in that constructor, in this file.
 */
declare const brand: unique symbol;

/** A nominal type: `T` that only its constructor can produce. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A tenant's id (`tenants.id`, a UUID). */
export type TenantId = Brand<string, "TenantId">;

/**
 * A user's id (`users.id`, a UUID). Added by P9-10's first model batch
 * (ADR-087 Amendment 7): the Kanban models declare their user keys with it.
 */
export type UserId = Brand<string, "UserId">;

/** A UUID (any version), case-insensitive — the shape of `users.id`. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The validating constructor of `UserId` (ADR-102: services/effectivePermission
 * is the first converted module that turns a principal's raw id into one).
 *
 * @throws {TypeError} when `value` is not a UUID
 */
export const toUserId = (value: string): UserId => {
  if (!UUID_SHAPE.test(value)) {
    throw new TypeError("A user id must be a UUID");
  }
  return value as UserId;
};

/**
 * The validating constructor of `TenantId` (P10-05: services/accessRequest is
 * the first converted module that turns a raw id — the tenant an approval has
 * just created — into one).
 *
 * @throws {TypeError} when `value` is not a UUID
 */
export const toTenantId = (value: string): TenantId => {
  if (!UUID_SHAPE.test(value)) {
    throw new TypeError("A tenant id must be a UUID");
  }
  return value as TenantId;
};

/**
 * The deny-branch sentinel of utils/tenantScope (P9-10 DoD, ADR-087 Amendment 11): a well-formed
 * UUID that no tenant row carries, so a deny predicate matches NOTHING. A constant, never input,
 * branded here because this file is the one place a brand assertion is allowed.
 */
export const NO_TENANT_ID = "00000000-0000-0000-0000-000000000000" as TenantId;

/*
 * The inspection catalogue (P20-01 / P20-03; spec MEMORY/specs/P19-01-inspection-catalogue.md § 4).
 * Types only, as `UserId` began: the models declare their keys with them. Their validating
 * constructors are added by the first module that turns a raw string into one (the catalogue
 * service, P21-01).
 */

/** A device type's id (`device_types.id`). */
export type DeviceTypeId = Brand<string, "DeviceTypeId">;

/** A library item definition's id (`inspection_item_definitions.id`). */
export type InspectionItemDefinitionId = Brand<string, "InspectionItemDefinitionId">;

/** A checklist template's id (`inspection_templates.id`). */
export type InspectionTemplateId = Brand<string, "InspectionTemplateId">;

/** A template version's id (`inspection_template_versions.id`) — the id a session pins. */
export type InspectionTemplateVersionId = Brand<string, "InspectionTemplateVersionId">;

/** A version's item id (`inspection_template_items.id`) — the id a result pins. */
export type InspectionTemplateItemId = Brand<string, "InspectionTemplateItemId">;

/** A tenant's catalogue proposal id (`inspection_template_proposals.id`). */
export type InspectionTemplateProposalId = Brand<string, "InspectionTemplateProposalId">;

/*
 * Client facilities (P20-07; ADR-124 and its Amendment 2; spec
 * MEMORY/specs/P19-04-client-facilities.md § 4). The second scope dimension: a health facility
 * inside the tenant that serves it. The hooks that read it are P21-09's.
 */

/** A client facility's id (`client_facilities.id`). */
export type ClientFacilityId = Brand<string, "ClientFacilityId">;

/** A device move's id (`client_facility_moves.id`) — the value of `callibrator.facility_move`. */
export type ClientFacilityMoveId = Brand<string, "ClientFacilityMoveId">;

/**
 * The validating constructor of `ClientFacilityId` (P20-07: services/clientFacility is the first
 * module that turns a raw id — the self facility it has just read or created — into one).
 *
 * @throws {TypeError} when `value` is not a UUID
 */
export const toClientFacilityId = (value: string): ClientFacilityId => {
  if (!UUID_SHAPE.test(value)) {
    throw new TypeError("A client facility id must be a UUID");
  }
  return value as ClientFacilityId;
};

/**
 * The facility dimension's deny sentinel (spec § 4): a well-formed UUID no v4 generator produces,
 * distinct from NO_TENANT_ID so a log says which branch denied. Migration 0117's CHECK refuses it
 * as a facility id, so a deny predicate on it matches nothing.
 */
export const NO_FACILITY_ID = "00000000-0000-0000-0000-00000000f000" as ClientFacilityId;
