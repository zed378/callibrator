/**
 * The actor of a request, for the audit row a service writes inside its
 * transaction (A-41, MEMORY/specs/A-41-audit-inside-transaction.md).
 *
 * `tenantId` is the actor's HOME tenant (req.user.tenantId), not a SUPER_ADMIN
 * x-tenant-id override: it is where a change to a global resource (a role) is
 * recorded (BR-A41-4). Missing values are null, never undefined — and a null
 * tenant makes the audit insert fail and the change roll back, which is the
 * intended fail-closed behaviour, not something to paper over here.
 *
 * @param {import("express").Request} req
 * @returns {{userId: string|null, tenantId: string|null, ipAddress: string|null, userAgent: string|null}}
 */
const auditActor = (req) => ({
  userId: (req.user && req.user.id) || null,
  tenantId: (req.user && req.user.tenantId) || null,
  ipAddress: req.ip || null,
  userAgent: (req.headers && req.headers["user-agent"]) || null,
});

module.exports = { auditActor };
