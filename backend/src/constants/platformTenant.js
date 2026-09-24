/**
 * A-125 (ADR-051 Q-14, F-7) — the reserved PLATFORM tenant.
 *
 * `audit_logs.tenant_id` is NOT NULL, and until A-125 a platform operation —
 * creating or deleting a tenant, changing a global role or its grants — was
 * recorded under the acting super admin's HOME tenant (BR-A41-4). The seeded
 * super admin's home is "Default Hospital Tenant", an ordinary hospital: its
 * admins could read every other hospital's creation and deletion in their own
 * trail, and those rows would have gone with it (F-7).
 *
 * Platform operations are now recorded here instead. A change to ONE tenant's
 * data (its settings, its users, its suspension or offboarding) is still
 * recorded in that tenant, where its own auditor looks.
 *
 * The row is created by migration 0034 and by the seed (migration.service.js
 * seedPlatformTenant) if absent. It is not a customer:
 *  - the Tenant model's hooks (models/tenant.model.js) hide it from EVERY
 *    Tenant query — listings, counts, findByPk, the x-tenant-id resolution —
 *    unless the query passes `includePlatformTenant: true`. So it is absent
 *    from tenant listings and selection screens, cannot be edited, suspended
 *    or deleted through the tenant API (404), and cannot be selected;
 *  - its audit trail is readable only by a super admin
 *    (GET /api/v1/audit?scope=platform).
 *
 * The id is FIXED so code, migrations and a restored database agree on it
 * without a lookup. It is v4-shaped (version 4, variant 8) so every UUID
 * validator accepts it, and it can never collide with NO_TENANT_UUID
 * (utils/tenantScope.util.js), which is all zeros.
 *
 * Kept in its own module (like auditActions.js) so a test that mocks the
 * constants barrel cannot empty it.
 */
const PLATFORM_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const PLATFORM_TENANT = Object.freeze({
  id: PLATFORM_TENANT_ID,
  name: "Callibrator Platform",
  subdomain: "callibrator-platform",
  email: "platform@callibrator.invalid",
  plan: "enterprise",
  status: "active",
  code: "PLATFORM",
});

/**
 * @param {*} tenantId
 * @returns {boolean} whether `tenantId` names the PLATFORM tenant
 */
const isPlatformTenant = (tenantId) =>
  tenantId !== undefined && tenantId !== null && String(tenantId) === PLATFORM_TENANT_ID;

module.exports = { PLATFORM_TENANT_ID, PLATFORM_TENANT, isPlatformTenant };
