// Tenant-related permission constants
// Used for ABAC (Attribute-Based Access Control) middleware

/**
 * Tenant permissions for fine-grained access control.
 * Each permission maps to a domain.action pattern used by the ABAC middleware.
 *
 * `as const` types the values as literals; it emits nothing, so the object is
 * exactly as mutable at run time as it was in tenantConstants.js (P9-08).
 */
export const TENANT_PERMISSIONS = {
  READ: "tenant:read",
  UPDATE: "tenant:update",
  DELETE: "tenant:delete",
  PROVISION: "tenant:provision",
  SUSPEND: "tenant:suspend",
  RESTORE: "tenant:restore",
} as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[keyof typeof TENANT_PERMISSIONS];
