// Tenant-related permission constants
// Used for ABAC (Attribute-Based Access Control) middleware

/**
 * Tenant permissions for fine-grained access control.
 * Each permission maps to a domain.action pattern used by the ABAC middleware.
 */
const TENANT_PERMISSIONS = {
  READ: "tenant:read",
  UPDATE: "tenant:update",
  DELETE: "tenant:delete",
  PROVISION: "tenant:provision",
  SUSPEND: "tenant:suspend",
  RESTORE: "tenant:restore",
};

module.exports = {
  TENANT_PERMISSIONS,
};
