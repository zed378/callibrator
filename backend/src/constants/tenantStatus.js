/**
 * The values of `tenants.status` (models/tenant.model.js: an ENUM of
 * lower-case strings).
 *
 * A-143: auth.middleware compared the x-tenant-id override's tenant against
 * the literal "ACTIVE", which the ENUM never holds, so a super admin's
 * override never applied. Compare against these.
 *
 * Kept in its own module (like platformTenant.js) so a test that mocks the
 * constants barrel cannot empty it.
 */
const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
});

/**
 * @param {*} status - a tenant's status, in whatever case it arrives
 * @returns {boolean} whether it is the active status
 */
const isActiveTenantStatus = (status) =>
  String(status === undefined || status === null ? "" : status).toLowerCase() === TENANT_STATUS.ACTIVE;

module.exports = { TENANT_STATUS, isActiveTenantStatus };
