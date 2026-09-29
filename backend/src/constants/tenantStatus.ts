/**
 * The values of `tenants.status` (models/tenant.model.js: an ENUM of
 * lower-case strings).
 *
 * A-143: auth.middleware compared the x-tenant-id override's tenant against
 * the literal "ACTIVE", which the ENUM never holds, so a super admin's
 * override never applied. Compare against these.
 *
 * Kept in its own module (like platformTenant.ts) so a test that mocks the
 * constants barrel cannot empty it.
 */
export const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
} as const);

/** One `tenants.status` value. */
export type TenantStatus = (typeof TENANT_STATUS)[keyof typeof TENANT_STATUS];

/**
 * @param status - a tenant's status, in whatever case it arrives
 * @returns whether it is the active status
 */
export const isActiveTenantStatus = (status: string | number | null | undefined): boolean =>
  String(status ?? "").toLowerCase() === TENANT_STATUS.ACTIVE;
