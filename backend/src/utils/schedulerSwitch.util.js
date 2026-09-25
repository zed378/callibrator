/**
 * One switch for "this instance is not the scheduler" (W-02, ADR-060).
 *
 * Every singleton scheduler reads its cron expression through
 * `scheduleSetting(envName, default)`. With `SCHEDULERS_ENABLED=false` that
 * returns "disabled" for all of them, whatever their own variables say — so
 * an API replica is switched off with ONE variable, and a scheduler added
 * later cannot escape the switch by having a variable nobody remembered to
 * set (the S-40 / W-02 failure: the chart's "not the scheduler" branch once
 * disabled one job of four). A test enumerates every `cron.schedule` call site
 * in src/ and fails when one does not go through here.
 *
 * DEFAULT: enabled. A single-instance deployment (compose, the VM) that never
 * set the variable keeps every job — defaulting to off would silently stop
 * backups and the retention purge on every existing deployment at upgrade,
 * and a job nobody runs is a worse failure than one that runs twice. Running
 * twice is also bounded now: singleton jobs claim their minute in Redis
 * (jobMonitor.service, S-33), and the calibration scan — the one job whose
 * double run a customer would see — is held to one work order per device by
 * the database (W-03, migration 0060).
 *
 * EXEMPT: the webhook dispatcher (WEBHOOK_DISPATCH_SCHEDULER). It is safe on
 * every replica — its claim is FOR UPDATE SKIP LOCKED (ADR-054) — and the
 * chart deliberately runs it on API pods. The enumeration test names it.
 */
const { logger } = require("../middlewares/activityLog.middleware");

const DISABLED = "disabled";

/** True unless SCHEDULERS_ENABLED is set to a false-like value. */
const schedulersEnabled = () => {
  const raw = (process.env.SCHEDULERS_ENABLED || "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(raw);
};

/**
 * The cron expression a singleton scheduler should use on this instance.
 *
 * @param {string} envName - the job's own variable, e.g. "RETENTION_SCHEDULER"
 * @param {string} defaultSchedule - its code default
 * @returns {string} a cron expression, or "disabled"
 */
const scheduleSetting = (envName, defaultSchedule) => {
  if (!schedulersEnabled()) {
    logger.info(`${envName} ignored: SCHEDULERS_ENABLED=false, this instance runs no singleton scheduler`);
    return DISABLED;
  }
  return process.env[envName] || defaultSchedule;
};

module.exports = { scheduleSetting, schedulersEnabled, DISABLED };
