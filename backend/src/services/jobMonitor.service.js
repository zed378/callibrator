/**
 * Scheduled-job outcomes, made visible (P7-02).
 *
 * "A scheduled compliance job failing silently is worse than one that never
 * ran, because everyone believes it did." The data-retention purge failed
 * every night with `column "tenantId" does not exist` until somebody looked.
 * Before this module every scheduler caught its own error, logged one line,
 * and carried on; nothing recorded that a run happened, nothing noticed a run
 * that did not, and nothing woke anybody.
 *
 * WHAT THIS DOES, for every job wrapped with `runMonitored`:
 *
 *  - RECORDS each run durably: start, finish, duration, outcome, error,
 *    consecutive failures, last success. One JSON file per job under
 *    JOB_STATUS_DIR (default `<storage>/log/jobs/`, which is the log volume
 *    in compose), written atomically (temp file + rename). It survives a
 *    restart, which is what lets the watchdog report a run that was MISSED
 *    because the process was down at the scheduled minute.
 *  - ALERTS on failure through alert.service (log at `error` + optional
 *    webhook/email) with what the failure means and what to do. It alerts on
 *    the FIRST failure of a streak and then at most once per
 *    JOB_ALERT_REPEAT_HOURS (default 24) while the job keeps failing, and says
 *    so once when it recovers — so a job that runs every 15 seconds cannot
 *    produce 5,760 alerts a day and train everyone to ignore them.
 *  - WATCHES the schedule: `registerJob` keeps the cron task, and the watchdog
 *    (JOB_WATCHDOG_SCHEDULER, default every 5 minutes) alerts when a job's
 *    expected run is more than its grace period in the past and no run (here
 *    or on another replica) has started since.
 *  - WATCHES batch jobs: a `batch_jobs` row resting in PROCESSING longer than
 *    BATCH_JOB_STUCK_MINUTES (default 60) alerts.
 *  - RUNS A SINGLETON JOB ONCE ACROSS REPLICAS (S-33): before a singleton
 *    job runs it claims `job-run:<name>:<minute>` in Redis with SET NX. The
 *    replica that loses the claim records `skipped` and does nothing. When
 *    Redis is unavailable the claim is NOT enforced and the job runs anyway:
 *    two replicas taking the same tenant backup is waste, a backup nobody took
 *    is data loss. That trade is deliberate and logged at `warn`.
 *  - EXPOSES the state as JSON (`getJobStates`) and as Prometheus text
 *    (`renderMetrics`) for GET /api/v1/health/jobs and /api/v1/health/metrics.
 *
 * `runMonitored` never rejects: a scheduler's cron callback must not produce
 * an unhandled rejection, and the failure has already been recorded and
 * alerted by the time it returns.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const cron = require("node-cron");
const storagePath = require("../utils/storagePath.util");
const { logger } = require("../middlewares/activityLog.middleware");
const { raiseAlert, SEVERITY } = require("./alert.service");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const DEFAULT_GRACE_MS = 60 * MINUTE_MS;
const DEFAULT_WATCHDOG_SCHEDULE = "*/5 * * * *";
const DEFAULT_BATCH_STUCK_MINUTES = 60;
const DEFAULT_ALERT_REPEAT_HOURS = 24;
/** A job that ran with the same outcome is re-persisted at most this often. */
const PERSIST_MIN_INTERVAL_MS = 5 * MINUTE_MS;
/** How long a singleton claim lives: it only has to outlast replica skew. */
const CLAIM_TTL_MS = 30 * MINUTE_MS;

/**
 * Every scheduled job, with what its failure means and what to do about it.
 * `singleton`: run on exactly one replica per scheduled minute.
 */
const JOBS = Object.freeze({
  "scheduled-backup": {
    title: "Scheduled tenant backup",
    meaning:
      "Tenant backups were NOT all taken, or expired ones were NOT pruned. The newest restorable backup of the affected tenants is older than you think.",
    action:
      "Read the error and <backup>/last-scheduled-backup.json, fix the cause, then take a manual backup of each failed tenant (Tenants > Backups).",
    singleton: true,
  },
  "retention-sweep": {
    title: "Data-retention purge",
    meaning:
      "Retention purge failed: data past its retention window was NOT purged. This is a GDPR/retention-policy breach for every day it continues.",
    action:
      "Read the error, fix it, then run the purge by hand for each tenant (POST /api/v1/tenants/:tenantId/purge as a super admin) and confirm the counts.",
    singleton: true,
  },
  "calibration-scan": {
    title: "Calibration sweep",
    meaning:
      "The calibration sweep did not complete: devices coming due or overdue may have NO work order and NO notification.",
    action:
      "Read the error, fix it, then trigger the scan (POST /api/v1/calibration-scheduler/run) and check the overdue list.",
    singleton: true,
  },
  "session-cleanup": {
    title: "Expired-session cleanup",
    meaning:
      "Expired sessions were NOT deleted. They cannot authenticate, but the sessions table keeps growing.",
    action: "Read the error; the next nightly run retries. Investigate if it fails twice.",
    singleton: true,
  },
  "tenant-lifecycle": {
    title: "Tenant lifecycle (grace-period offboarding)",
    meaning:
      "Suspended tenants past their grace period were NOT all offboarded; their data is retained beyond the agreed window.",
    action: "Read the error and the per-tenant failures, fix them, and let the next run offboard them.",
    singleton: true,
  },
  "webhook-dispatch": {
    title: "Webhook dispatcher",
    meaning:
      "Webhook retries are NOT being delivered. Receivers are missing events until the dispatcher recovers.",
    action: "Read the error (usually the database). Deliveries are durable and resume when it recovers.",
    // Replicas share the work through FOR UPDATE SKIP LOCKED, not a claim.
    singleton: false,
    graceMs: 10 * MINUTE_MS,
  },
  "quarantine-sweep": {
    title: "Upload quarantine sweep",
    meaning:
      "Files abandoned in uploads/.quarantine by a crash mid-scan were NOT removed. They are unscanned and unreachable, but they use disk.",
    action: "Read the error (usually permissions on the uploads volume).",
    singleton: true,
  },
});

const states = new Map();
const tasks = new Map();
const lastPersistedAt = new Map();
let watchdogTask = null;
let batchAlertAt = 0;
const instanceId = `${os.hostname()}:${process.pid}`;

const positiveNumberEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const repeatMs = () => positiveNumberEnv("JOB_ALERT_REPEAT_HOURS", DEFAULT_ALERT_REPEAT_HOURS) * HOUR_MS;

const statusDir = () => process.env.JOB_STATUS_DIR || storagePath("log", "jobs");
const statusFile = (name) => path.join(statusDir(), `${name}.json`);

/**
 * The definition of a job; an unknown name gets a generic one rather than a
 * throw, so a new scheduler is monitored even before it is described here.
 * @param {string} name
 */
const definitionOf = (name) =>
  JOBS[name] || {
    title: `Scheduled job "${name}"`,
    meaning: `The scheduled job "${name}" failed; whatever it does did not happen.`,
    action: "Read the error in the log.",
    singleton: false,
  };

const graceMs = (name) =>
  definitionOf(name).graceMs ||
  positiveNumberEnv("JOB_OVERDUE_GRACE_MINUTES", DEFAULT_GRACE_MS / MINUTE_MS) * MINUTE_MS;

const blankState = (name) => ({
  job: name,
  enabled: null,
  schedule: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSkippedAt: null,
  lastOutcome: null,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastDurationMs: null,
  consecutiveFailures: 0,
  runs: { success: 0, failure: 0, skipped: 0 },
  nextExpectedAt: null,
  overdueSince: null,
  alerting: false,
  lastAlertAt: null,
});

/**
 * The persisted state of a job, or a blank one. A corrupt file is reported
 * and replaced, never trusted.
 * @param {string} name
 */
const loadState = (name) => {
  const state = blankState(name);
  try {
    const raw = JSON.parse(fs.readFileSync(statusFile(name), "utf8"));
    Object.assign(state, raw, { job: name, runs: { ...state.runs, ...raw.runs } });
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Job status for "${name}" is unreadable and was reset: ${err.message}`);
    }
  }
  return state;
};

/** @param {string} name */
const stateOf = (name) => {
  if (!states.has(name)) {
    states.set(name, loadState(name));
  }
  return states.get(name);
};

/**
 * Write a job's state atomically. A write failure is logged and recorded on
 * the state, never thrown: losing the file must not lose the alert.
 * @param {object} state
 */
async function persist(state) {
  const file = statusFile(state.job);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await fs.promises.rename(tmp, file);
    state.persistError = null;
    lastPersistedAt.set(state.job, Date.now());
  } catch (err) {
    state.persistError = err.message;
    logger.error(`Could not persist job status for "${state.job}": ${err.message}`, { file });
  }
}

/** The task's next scheduled run as ISO, or null. */
const nextRunOf = (name) => {
  const task = tasks.get(name);
  const next = task && typeof task.getNextRun === "function" ? task.getNextRun() : null;
  return next ? next.toISOString() : null;
};

/**
 * Claim this scheduled minute of a singleton job across replicas.
 * @param {string} name
 * @param {Date} at
 * @returns {Promise<boolean>} true when THIS process should run it
 */
async function claimRun(name, at) {
  const { getRedisConnection } = require("./redis.service");
  let client;
  try {
    client = getRedisConnection();
  } catch {
    client = null;
  }
  if (!client || client.status !== "ready") {
    logger.warn(
      `${definitionOf(name).title}: Redis unavailable, running WITHOUT the single-instance claim (another replica may run it too)`,
    );
    return true;
  }
  const key = `job-run:${name}:${at.toISOString().slice(0, 16)}`;
  try {
    const result = await client.set(key, instanceId, "PX", CLAIM_TTL_MS, "NX");
    return result === "OK";
  } catch (err) {
    logger.warn(
      `${definitionOf(name).title}: single-instance claim failed (${err.message}); running anyway`,
    );
    return true;
  }
}

/**
 * Alert on a failure: the first of a streak, then once per repeat interval.
 * @param {string} name
 * @param {object} state
 * @param {Date} now
 */
async function alertFailure(name, state, now) {
  const due = !state.alerting || !state.lastAlertAt || now - new Date(state.lastAlertAt) >= repeatMs();
  if (!due) {
    return;
  }
  const def = definitionOf(name);
  state.alerting = true;
  state.lastAlertAt = now.toISOString();
  await raiseAlert({
    key: `job.${name}.failed`,
    severity: SEVERITY.CRITICAL,
    title: `${def.title} FAILED`,
    meaning: def.meaning,
    action: def.action,
    detail: `${state.lastError} (consecutive failures: ${state.consecutiveFailures}; last success: ${state.lastSuccessAt || "never recorded"})`,
    context: { job: name, consecutiveFailures: state.consecutiveFailures, instance: instanceId },
  });
}

/**
 * Run one scheduled invocation of a job, record its outcome, alert on
 * failure. Never rejects.
 *
 * @param {string} name  a key of JOBS
 * @param {() => Promise<*>} fn  the job; a throw is a failure
 * @param {object} [options]
 * @param {(result: *) => (string|null|undefined)} [options.isFailure]
 *   a partial failure the job reports in its result rather than throws;
 *   return a reason to fail the run
 * @param {boolean} [options.singleton]  overrides the definition
 * @param {Date} [options.now]  for tests
 * @returns {Promise<{outcome: "success"|"failure"|"skipped", result?: *, error?: string}>}
 */
async function runMonitored(name, fn, options = {}) {
  const def = definitionOf(name);
  const state = stateOf(name);
  const startedAt = options.now || new Date();
  const singleton = options.singleton === undefined ? def.singleton : options.singleton;

  if (singleton && !(await claimRun(name, startedAt))) {
    state.runs.skipped += 1;
    state.lastSkippedAt = startedAt.toISOString();
    state.nextExpectedAt = nextRunOf(name);
    state.overdueSince = null;
    logger.info(`${def.title}: another instance claimed this run; skipped here`);
    await persist(state);
    return { outcome: "skipped" };
  }

  const previousOutcome = state.lastOutcome;
  state.lastStartedAt = startedAt.toISOString();
  state.nextExpectedAt = nextRunOf(name);
  state.overdueSince = null;

  let result;
  let error = null;
  try {
    result = await fn();
    const reason = options.isFailure ? options.isFailure(result) : null;
    if (reason) {
      error = String(reason);
    }
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }

  const finishedAt = new Date();
  state.lastFinishedAt = finishedAt.toISOString();
  state.lastDurationMs = Math.max(0, finishedAt - startedAt);

  if (error) {
    state.lastOutcome = "failure";
    state.lastError = error;
    state.lastFailureAt = state.lastFinishedAt;
    state.consecutiveFailures += 1;
    state.runs.failure += 1;
    await alertFailure(name, state, finishedAt);
  } else {
    state.lastOutcome = "success";
    state.lastError = null;
    state.lastSuccessAt = state.lastFinishedAt;
    state.consecutiveFailures = 0;
    state.runs.success += 1;
    if (state.alerting) {
      state.alerting = false;
      await raiseAlert({
        key: `job.${name}.failed`,
        severity: SEVERITY.RESOLVED,
        title: `${def.title} recovered`,
        meaning: `${def.title} succeeded again.`,
        action: "Check that the runs it missed have been caught up.",
        context: { job: name, instance: instanceId },
      });
    }
  }

  const stale = Date.now() - (lastPersistedAt.get(name) || 0) >= PERSIST_MIN_INTERVAL_MS;
  if (error || previousOutcome !== state.lastOutcome || stale) {
    await persist(state);
  }

  return error ? { outcome: "failure", result, error } : { outcome: "success", result };
}

/**
 * Record that a job is scheduled (and hand the watchdog its cron task).
 *
 * A persisted `nextExpectedAt` that is already in the past with no run since
 * is KEPT: that is a run missed while the process was down, and the watchdog
 * must report it rather than have it overwritten by the next future slot.
 *
 * @param {string} name
 * @param {{getNextRun: () => Date|null}} task  the node-cron task
 * @param {string} schedule  the cron expression, for the report
 */
function registerJob(name, task, schedule) {
  const state = stateOf(name);
  tasks.set(name, task);
  state.enabled = true;
  state.schedule = schedule;
  const now = Date.now();
  const expected = state.nextExpectedAt ? new Date(state.nextExpectedAt).getTime() : null;
  const lastSeen = Math.max(
    state.lastStartedAt ? new Date(state.lastStartedAt).getTime() : 0,
    state.lastSkippedAt ? new Date(state.lastSkippedAt).getTime() : 0,
  );
  const missedWhileDown = expected !== null && expected < now && lastSeen < expected;
  if (!missedWhileDown) {
    state.nextExpectedAt = nextRunOf(name);
  }
}

/**
 * Record that a job is switched off by configuration, so the report says
 * "disabled" rather than showing nothing (a job nobody sees is a job
 * everybody assumes runs).
 * @param {string} name
 * @param {string} reason
 */
function markDisabled(name, reason) {
  const state = stateOf(name);
  state.enabled = false;
  state.schedule = reason;
  tasks.delete(name);
}

/**
 * A scheduler whose cron expression is invalid does not start. That is a job
 * the operator believes is scheduled and is not — so besides the log line the
 * scheduler writes, it is an alert, and the report shows it as disabled.
 * @param {string} name
 * @param {string} envName  the variable holding the bad expression
 * @param {string} value
 * @returns {Promise<void>}
 */
function refuseSchedule(name, envName, value) {
  markDisabled(name, `invalid ${envName}`);
  const def = definitionOf(name);
  return raiseAlert({
    key: `job.${name}.not-scheduled`,
    severity: SEVERITY.CRITICAL,
    title: `${def.title} is NOT SCHEDULED`,
    meaning: `${envName}="${value}" is not a valid cron expression, so the job will never run. ${def.meaning}`,
    action: `Fix ${envName} (or set it to "disabled" on purpose) and restart the backend.`,
    context: { job: name, envName },
  }).then(() => undefined);
}

/**
 * One watchdog pass: alert on every job whose expected run is overdue.
 * @param {Date} [now]
 * @returns {Promise<string[]>} the overdue job names
 */
async function checkOverdue(now = new Date()) {
  const overdue = [];
  for (const name of tasks.keys()) {
    const state = stateOf(name);
    if (!state.nextExpectedAt) {
      continue;
    }
    const expected = new Date(state.nextExpectedAt);
    const lastSeen = Math.max(
      state.lastStartedAt ? new Date(state.lastStartedAt).getTime() : 0,
      state.lastSkippedAt ? new Date(state.lastSkippedAt).getTime() : 0,
    );
    if (now - expected <= graceMs(name) || lastSeen >= expected.getTime()) {
      continue;
    }
    overdue.push(name);
    const first = !state.overdueSince;
    if (first) {
      state.overdueSince = now.toISOString();
    }
    if (first || !state.lastAlertAt || now - new Date(state.lastAlertAt) >= repeatMs()) {
      const def = definitionOf(name);
      state.lastAlertAt = now.toISOString();
      await raiseAlert({
        key: `job.${name}.missed`,
        severity: SEVERITY.CRITICAL,
        title: `${def.title} DID NOT RUN`,
        meaning: `It was due at ${state.nextExpectedAt} and has not started. ${def.meaning}`,
        action: `Check that exactly one backend instance is running its schedulers and that the process was up at the scheduled time. ${def.action}`,
        detail: `last run started: ${state.lastStartedAt || "never recorded"}`,
        context: { job: name, expectedAt: state.nextExpectedAt, instance: instanceId },
      });
    }
    await persist(state);
  }
  return overdue;
}

/**
 * One watchdog pass over `batch_jobs`: alert when rows rest in PROCESSING
 * past the threshold. Cross-tenant by design — this is a platform check —
 * so it opts out of tenant scoping explicitly.
 * @param {Date} [now]
 * @returns {Promise<number>} how many are stuck
 */
async function checkStuckBatchJobs(now = new Date()) {
  const { Op } = require("sequelize");
  const { BatchJob } = require("../models");
  const minutes = positiveNumberEnv("BATCH_JOB_STUCK_MINUTES", DEFAULT_BATCH_STUCK_MINUTES);
  const cutoff = new Date(now.getTime() - minutes * MINUTE_MS);
  const stuck = await BatchJob.findAll({
    where: { status: "PROCESSING", updatedAt: { [Op.lt]: cutoff } },
    attributes: ["id", "tenantId", "updatedAt"],
    limit: 20,
    skipTenantScope: true,
  });
  if (stuck.length === 0) {
    batchAlertAt = 0;
    return 0;
  }
  if (!batchAlertAt || now.getTime() - batchAlertAt >= repeatMs()) {
    batchAlertAt = now.getTime();
    await raiseAlert({
      key: "batch-jobs.stuck",
      severity: SEVERITY.WARNING,
      title: "Batch jobs stuck in PROCESSING",
      meaning: `${stuck.length}${stuck.length === 20 ? "+" : ""} batch job(s) have been PROCESSING for more than ${minutes} minutes. Whatever they were doing has probably died with a process, and their users are still waiting.`,
      action: "Inspect the listed batch_jobs rows; mark them FAILED (or re-run them) once you know why the worker stopped.",
      detail: stuck.map((job) => job.id).join(", "),
      context: { count: stuck.length, minutes },
    });
  }
  return stuck.length;
}

/** One watchdog tick. Never rejects. */
async function watchdogTick() {
  try {
    await checkOverdue();
  } catch (err) {
    logger.error(`Job watchdog: overdue check failed: ${err.message}`);
  }
  try {
    await checkStuckBatchJobs();
  } catch (err) {
    logger.error(`Job watchdog: batch-job check failed: ${err.message}`);
  }
}

/**
 * Start the watchdog once per process. JOB_WATCHDOG_SCHEDULER=disabled turns
 * it off; an invalid expression falls back to the default, loudly — the
 * watchdog is the thing that notices schedulers that are not running, so it
 * must not be the one that silently is not.
 */
function startWatchdog() {
  if (watchdogTask) {
    return;
  }
  let schedule = process.env.JOB_WATCHDOG_SCHEDULER || DEFAULT_WATCHDOG_SCHEDULE;
  if (schedule === "disabled" || schedule === "off") {
    logger.warn("Job watchdog disabled via JOB_WATCHDOG_SCHEDULER: missed runs will NOT alert");
    watchdogTask = { disabled: true };
    return;
  }
  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid JOB_WATCHDOG_SCHEDULER "${schedule}"; using the default "${DEFAULT_WATCHDOG_SCHEDULE}"`,
    );
    schedule = DEFAULT_WATCHDOG_SCHEDULE;
  }
  watchdogTask = cron.schedule(schedule, watchdogTick);
}

/** Every job's state, for the gated JSON report. */
const getJobStates = () =>
  [...states.values()]
    .map((state) => ({ ...state, runs: { ...state.runs } }))
    .sort((a, b) => a.job.localeCompare(b.job));

const seconds = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);

/**
 * Prometheus text exposition of every job's state. A gauge of 0 for a
 * timestamp means "never".
 * @returns {string}
 */
function renderMetrics() {
  const jobs = getJobStates();
  const lines = [];
  const family = (metric, type, help, valueOf) => {
    lines.push(`# HELP ${metric} ${help}`, `# TYPE ${metric} ${type}`);
    for (const state of jobs) {
      for (const [labels, value] of valueOf(state)) {
        lines.push(`${metric}{job="${state.job}"${labels}} ${value}`);
      }
    }
  };
  family("callibrator_job_enabled", "gauge", "1 when the job is scheduled on this instance.", (s) => [["", s.enabled ? 1 : 0]]);
  family("callibrator_job_last_success_timestamp_seconds", "gauge", "Unix time of the last successful run (0 = never).", (s) => [["", seconds(s.lastSuccessAt)]]);
  family("callibrator_job_last_run_timestamp_seconds", "gauge", "Unix time the last run started (0 = never).", (s) => [["", seconds(s.lastStartedAt)]]);
  family("callibrator_job_last_duration_seconds", "gauge", "Duration of the last run.", (s) => [["", (s.lastDurationMs || 0) / 1000]]);
  family("callibrator_job_last_run_failed", "gauge", "1 when the last run failed.", (s) => [["", s.lastOutcome === "failure" ? 1 : 0]]);
  family("callibrator_job_consecutive_failures", "gauge", "Failures since the last success.", (s) => [["", s.consecutiveFailures]]);
  family("callibrator_job_overdue", "gauge", "1 when the job missed its scheduled run.", (s) => [["", s.overdueSince ? 1 : 0]]);
  family("callibrator_job_runs_total", "counter", "Runs by outcome, since the status file was created.", (s) =>
    ["success", "failure", "skipped"].map((outcome) => [`,outcome="${outcome}"`, s.runs[outcome]]),
  );
  return `${lines.join("\n")}\n`;
}

/** Forget all in-memory state (tests; a process restart does the same). */
function reset() {
  states.clear();
  tasks.clear();
  lastPersistedAt.clear();
  if (watchdogTask && typeof watchdogTask.stop === "function") {
    watchdogTask.stop();
  }
  watchdogTask = null;
  batchAlertAt = 0;
}

module.exports = {
  JOBS,
  DEFAULT_WATCHDOG_SCHEDULE,
  CLAIM_TTL_MS,
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
  checkOverdue,
  checkStuckBatchJobs,
  watchdogTick,
  startWatchdog,
  getJobStates,
  renderMetrics,
  statusFile,
  reset,
};
