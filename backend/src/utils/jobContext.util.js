/**
 * The tenant context a background job runs in (W-12, ADR-060).
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
 *
 * W-12 / ADR-069 — the opt-outs are a CLOSED list. `runAsSystem` refuses a
 * reason that is not one of SYSTEM_TASKS, as audit.service#logAction refuses a
 * system actor that is not in constants/systemActors.js: a new cross-tenant
 * job adds its entry here, in review, instead of inventing a string at its
 * call site. `isSystemTask: true` appears nowhere else in src/ — a test
 * (jobContext.w12.test.js) holds both properties.
 */
const { tenantStorage } = require("../middlewares/tenantContext.middleware");

/**
 * Every reviewed cross-tenant opt-out, and why it must span tenants.
 * The value is the reason carried on the context (`systemReason`).
 */
const SYSTEM_TASKS = Object.freeze({
  /** batchJob.service#failAbandonedJobs — one conditional UPDATE over every tenant's stale rows. */
  BATCH_JOB_SWEEP: "batch-jobs: abandoned-job sweep across tenants",
  /** batchJob.service#failInterruptedJobs — the jobs this process was running, whatever their tenant. */
  BATCH_JOB_SHUTDOWN: "batch-jobs: shutdown with jobs in flight",
  /** calibrationScheduler.service — which devices are due, in every hospital (a page at a time). */
  CALIBRATION_SCAN: "calibration-scan: due devices across every tenant",
  /**
   * session.service#cleanupExpiredSessions — an expired session is expired
   * whatever its tenant, and a platform operator's session has none
   * (`sessions.tenant_id` is nullable), so a per-tenant loop would miss them.
   */
  SESSION_CLEANUP: "session-cleanup: expired sessions of every tenant and of platform operators",
  /**
   * quarantineSweep.service — the upload quarantine is ONE directory shared by
   * every tenant, and its file names carry no tenant. It reads no table.
   */
  QUARANTINE_SWEEP: "quarantine-sweep: the shared upload quarantine directory",
  /**
   * webhook.service#dispatchDue — the claim of due deliveries is one raw
   * `FOR UPDATE SKIP LOCKED` statement over every tenant's queue. Each claimed
   * delivery is then sent inside runForTenant(its own tenant).
   */
  WEBHOOK_DISPATCH: "webhook-dispatch: claim due deliveries across every tenant",
});

const SYSTEM_TASK_REASONS = Object.freeze(Object.values(SYSTEM_TASKS));

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
 * @param {string} reason - one of SYSTEM_TASKS: why this work must span
 *   tenants (kept on the context, so a debugger or a log can say which
 *   opt-out is active)
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 * @throws {Error} when no reason is given, or one that is not on SYSTEM_TASKS
 */
const runAsSystem = async (reason, fn) => {
  if (!reason) {
    throw new Error("runAsSystem needs a reason: every cross-tenant opt-out is named");
  }
  if (!SYSTEM_TASK_REASONS.includes(reason)) {
    throw new Error(
      `runAsSystem: "${reason}" is not a reviewed opt-out; add it to SYSTEM_TASKS in utils/jobContext.util.js`,
    );
  }
  return tenantStorage.run({ tenantId: null, isSuperAdmin: false, isSystemTask: true, systemReason: reason }, fn);
};

module.exports = { runForTenant, runAsSystem, SYSTEM_TASKS };
