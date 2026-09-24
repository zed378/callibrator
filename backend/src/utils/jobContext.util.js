/**
 * The tenant context a background job runs in (W-12, ADR-PENDING-async).
 *
 * A request gets its tenant context from tenantContext.middleware. A cron job,
 * a queue consumer or an MQTT handler has no request, and with no context the
 * isolation hooks (utils/tenantScope.util.js) SKIP: no predicate on a read,
 * no tenant stamped on a create. Every background query was then isolated only
 * by whatever `where` its call site remembered to write.
 *
 * Every job now declares, in code, which of the two things it is doing:
 *
 *  - `runForTenant(tenantId, fn)` — work FOR one tenant. The hooks confine
 *    every query inside `fn` to that tenant and stamp it on every create, even
 *    where the call site's own `where` forgot it. This is the normal case.
 *  - `runAsSystem(reason, fn)` — a genuinely cross-tenant read (e.g. "which
 *    devices are due, in every hospital"). It opts out of the predicate
 *    EXPLICITLY, with a reason, so each opt-out is greppable and reviewable
 *    (`grep -rn runAsSystem src/`) instead of being the silent default.
 *
 * Neither is a super-admin context: `isSuperAdmin` is false in both, so
 * nothing a job does is attributed to, or authorised as, an operator.
 */
const { tenantStorage } = require("../middlewares/tenantContext.middleware");

/**
 * Run `fn` confined to one tenant.
 *
 * @template T
 * @param {string} tenantId
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 * @throws {Error} when tenantId is empty — a job with no tenant must say so
 *   with runAsSystem, never fall through to an unscoped context
 */
const runForTenant = async (tenantId, fn) => {
  if (!tenantId) {
    throw new Error("runForTenant needs a tenantId; a cross-tenant job uses runAsSystem(reason, fn)");
  }
  return tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, fn);
};

/**
 * Run `fn` with the tenant predicate explicitly switched off.
 *
 * @template T
 * @param {string} reason - why this work must span tenants (kept on the
 *   context, so a debugger or a log can say which opt-out is active)
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 * @throws {Error} when no reason is given
 */
const runAsSystem = async (reason, fn) => {
  if (!reason) {
    throw new Error("runAsSystem needs a reason: every cross-tenant opt-out is named");
  }
  return tenantStorage.run({ tenantId: null, isSuperAdmin: false, isSystemTask: true, systemReason: reason }, fn);
};

module.exports = { runForTenant, runAsSystem };
