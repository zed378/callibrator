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
 *
 * P9-18 (ADR-087, Stage C leaves): converted from jobMonitor.service.js with
 * no behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order); the functions call each other directly,
 * as before. `fs`, `os` and `path` are the module objects. `cron` is node-cron's
 * default export: node-cron 4 is an ES-module-shaped build whose default export
 * holds the same `schedule` and `validate` functions as the module itself, and a
 * `jest.mock("node-cron")` factory is its own default. `scheduleSetting`,
 * `storagePath`, the logger and the three alert helpers are captured once at
 * load, as the `.js` destructured them. `redis.service`, `sequelize` and the
 * models barrel are still required lazily, inside the functions that use them:
 * loading this module must not load the database layer. Environment reads go
 * through src/config/env (P9-06), at call time.
 */
import fs from "fs";
import os from "os";
import path from "path";
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import loadedStoragePath from "../utils/storagePath.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import alertService from "./alert.service";
import backupVerifyService from "./backupVerify.service";
import { env } from "../config/env";
import type RedisService from "./redis.service";
import type * as SequelizeModule from "sequelize";
import type { ModelsBarrel } from "../types/models";

const scheduleSetting = loadedScheduleSetting;
const storagePath = loadedStoragePath;
const logger = loadedLogger;
const { raiseAlert, SEVERITY, describeRouting } = alertService;

/** What a job's failure means and what to do; how it runs across replicas. */
interface JobDefinition {
  title: string;
  meaning: string;
  action: string;
  singleton: boolean;
  graceMs?: number;
  incomplete?: { meaning: string; action: string };
}

/** A job's recorded state: in memory, and persisted as JSON. */
interface JobState {
  job: string;
  enabled: boolean | null;
  schedule: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSkippedAt: string | null;
  lastOutcome: "success" | "failure" | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  runs: { success: number; failure: number; skipped: number };
  nextExpectedAt: string | null;
  overdueSince: string | null;
  alerting: boolean;
  lastAlertAt: string | null;
  lastIncomplete: string | null;
  consecutiveIncomplete: number;
  incompleteAlerting: boolean;
  lastIncompleteAlertAt: string | null;
  persistError?: unknown;
}

/** The cron task a scheduler hands over; only `getNextRun` and `stop` are read. */
interface JobTask {
  getNextRun?: () => Date | null;
  stop?: () => unknown;
  disabled?: boolean;
}

/** A run's options (see runMonitored). */
interface RunOptions {
  isFailure?: (result: unknown) => string | null | undefined;
  isIncomplete?: (result: unknown) => string | null | undefined;
  singleton?: boolean;
  now?: Date;
}

/** What one monitored run did. */
type RunOutcome =
  | { outcome: "skipped" }
  | { outcome: "failure"; result: unknown; error: string }
  | { outcome: "success"; result: unknown };

/** The fields a caught error is read for. */
const errorOf = (err: unknown): { code?: unknown; message?: unknown } => err as { code?: unknown; message?: unknown };

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
const JOBS: Readonly<Record<string, JobDefinition>> = Object.freeze({
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
    // ADR-082: a sweep that ran out of its budget (W-17) is not a failure, but
    // data past its window is still held — somebody must know.
    incomplete: {
      meaning:
        "The retention purge ran out of its time budget: some tenants still hold data past its retention window. The rest is purged on the next run.",
      action:
        "If this repeats, the backlog is growing faster than one run removes it: raise RETENTION_SWEEP_BUDGET_MS or RETENTION_PURGE_BATCH_SIZE, or run the purge by hand for the affected tenants.",
    },
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
    // ADR-082: the run stopped at QUARANTINE_SWEEP_MAX_ENTRIES (W-17).
    incomplete: {
      meaning:
        "The quarantine sweep stopped at its entry limit: uploads/.quarantine holds more files than one run examines. Something is leaving uploads there — usually a crash loop mid-scan.",
      action:
        "Find what is crashing during upload scans (the backend's restarts and the virus scanner), then let the hourly sweep drain the directory.",
    },
    singleton: true,
  },
  // ADR-070 — middlewares/webhookDeliveryPurgeScheduler.middleware.js.
  "webhook-delivery-purge": {
    title: "Webhook delivery purge",
    meaning:
      "Finished webhook deliveries past the retention window were NOT removed. Nothing is lost; webhook_deliveries keeps growing until a run succeeds.",
    action: "Read the error (usually the database); the next daily run retries and removes the backlog in bounded batches.",
    singleton: true,
  },
  // D-22 (ADR-083) — middlewares/attachmentFileSweepScheduler.middleware.js.
  "attachment-file-sweep": {
    title: "Deleted attachment file sweep",
    meaning:
      "Files of attachments deleted longer ago than the retention window were NOT removed. They are unreachable, but they stay on disk until a run succeeds.",
    action: "Read the error (usually the database or permissions on the uploads volume); the next daily run retries in bounded batches.",
    singleton: true,
  },
});

const states = new Map<string, JobState>();
const tasks = new Map<string, JobTask>();
const lastPersistedAt = new Map<string, number>();
let watchdogTask: JobTask | null = null;
let batchAlertAt = 0;
const instanceId = `${os.hostname()}:${String(process.pid)}`;

const positiveNumberEnv = (name: string, fallback: number): number => {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const repeatMs = (): number => positiveNumberEnv("JOB_ALERT_REPEAT_HOURS", DEFAULT_ALERT_REPEAT_HOURS) * HOUR_MS;

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty JOB_STATUS_DIR means the default, and storagePath() runs only then
const statusDir = (): string => env("JOB_STATUS_DIR") || storagePath("log", "jobs");
const statusFile = (name: string): string => path.join(statusDir(), `${name}.json`);

/**
 * The definition of a job; an unknown name gets a generic one rather than a
 * throw, so a new scheduler is monitored even before it is described here.
 * @param name - the job
 */
const definitionOf = (name: string): JobDefinition =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`; an unknown name has no entry
  JOBS[name] || {
    title: `Scheduled job "${name}"`,
    meaning: `The scheduled job "${name}" failed; whatever it does did not happen.`,
    action: "Read the error in the log.",
    singleton: false,
  };

const graceMs = (name: string): number =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  definitionOf(name).graceMs ||
  positiveNumberEnv("JOB_OVERDUE_GRACE_MINUTES", DEFAULT_GRACE_MS / MINUTE_MS) * MINUTE_MS;

const blankState = (name: string): JobState => ({
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
  lastIncomplete: null,
  consecutiveIncomplete: 0,
  incompleteAlerting: false,
  lastIncompleteAlertAt: null,
});

/**
 * The persisted state of a job, or a blank one. A corrupt file is reported
 * and replaced, never trusted.
 * @param name - the job
 */
const loadState = (name: string): JobState => {
  const state = blankState(name);
  try {
    // As built: the persisted JSON is merged over the blank state as it was written.
    const raw = JSON.parse(fs.readFileSync(statusFile(name), "utf8")) as Partial<JobState>;
    Object.assign(state, raw, { job: name, runs: { ...state.runs, ...raw.runs } });
  } catch (err) {
    if (errorOf(err).code !== "ENOENT") {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the error's message as it is
      logger.warn(`Job status for "${name}" is unreadable and was reset: ${errorOf(err).message}`);
    }
  }
  return state;
};

/** @param name - the job */
const stateOf = (name: string): JobState => {
  if (!states.has(name)) {
    states.set(name, loadState(name));
  }
  return states.get(name) as JobState;
};

/**
 * Write a job's state atomically. A write failure is logged and recorded on
 * the state, never thrown: losing the file must not lose the alert.
 * @param state - the job's state
 */
async function persist(state: JobState): Promise<void> {
  const file = statusFile(state.job);
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await fs.promises.rename(tmp, file);
    state.persistError = null;
    lastPersistedAt.set(state.job, Date.now());
  } catch (err) {
    state.persistError = errorOf(err).message;
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the error's message as it is
    logger.error(`Could not persist job status for "${state.job}": ${errorOf(err).message}`, { file });
  }
}

/** The task's next scheduled run as ISO, or null. */
const nextRunOf = (name: string): string | null => {
  const task = tasks.get(name);
  const next = task && typeof task.getNextRun === "function" ? task.getNextRun() : null;
  return next ? next.toISOString() : null;
};

/**
 * Claim this scheduled minute of a singleton job across replicas.
 * @param name - the job
 * @param at - the scheduled minute
 * @returns true when THIS process should run it
 */
async function claimRun(name: string, at: Date): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on first use, not with this module
  const { getRedisConnection } = require("./redis.service") as typeof RedisService;
  let client: ReturnType<typeof getRedisConnection> | null;
  try {
    client = getRedisConnection();
  } catch {
    client = null;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!client || client.status !== "ready"`
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
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the error's message as it is
      `${definitionOf(name).title}: single-instance claim failed (${errorOf(err).message}); running anyway`,
    );
    return true;
  }
}

/**
 * Alert on a failure: the first of a streak, then once per repeat interval.
 * @param name - the job
 * @param state - its state
 * @param now - the run's finish
 */
async function alertFailure(name: string, state: JobState, now: Date): Promise<void> {
  // As built: `now - date`, both operands converted to numbers.
  const due = !state.alerting || !state.lastAlertAt || +now - +new Date(state.lastAlertAt) >= repeatMs();
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: the recorded values as they are
    detail: `${state.lastError} (consecutive failures: ${state.consecutiveFailures}; last success: ${state.lastSuccessAt || "never recorded"})`,
    context: { job: name, consecutiveFailures: state.consecutiveFailures, instance: instanceId },
  });
}

/**
 * ADR-082 — a run that SUCCEEDED but left work behind (a bounded sweep that
 * stopped at its budget or its entry limit, W-17). Not a failure — the next
 * run continues — but it is a `warning` alert, throttled like a failure: the
 * first incomplete run of a streak, then at most once per repeat interval,
 * and once more when a run completes again.
 * @param name - the job
 * @param state - its state
 * @param reason - why the run is incomplete, or falsy
 * @param now - the run's finish
 * @returns true when the state changed and must be persisted
 */
async function trackIncomplete(name: string, state: JobState, reason: unknown, now: Date): Promise<boolean> {
  const def = definitionOf(name);
  if (!reason) {
    state.lastIncomplete = null;
    state.consecutiveIncomplete = 0;
    if (!state.incompleteAlerting) {
      return false;
    }
    state.incompleteAlerting = false;
    await raiseAlert({
      key: `job.${name}.incomplete`,
      severity: SEVERITY.RESOLVED,
      title: `${def.title} complete again`,
      meaning: `${def.title} finished all its work in one run again.`,
      action: "Nothing; the backlog is cleared.",
      context: { job: name, instance: instanceId },
    });
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  const what = def.incomplete || {
    meaning: `The scheduled job "${name}" finished without doing all its work; the rest waits for the next run.`,
    action: "Read the detail; investigate if it repeats.",
  };
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: String() of the job's reason
  state.lastIncomplete = String(reason);
  state.consecutiveIncomplete += 1;
  const due =
    // As built: `now - date`; a null date is the epoch.
    !state.incompleteAlerting || +now - +new Date(state.lastIncompleteAlertAt as string) >= repeatMs();
  if (due) {
    state.incompleteAlerting = true;
    state.lastIncompleteAlertAt = now.toISOString();
    await raiseAlert({
      key: `job.${name}.incomplete`,
      severity: SEVERITY.WARNING,
      title: `${def.title} INCOMPLETE`,
      meaning: what.meaning,
      action: what.action,
      detail: `${state.lastIncomplete} (consecutive incomplete runs: ${String(state.consecutiveIncomplete)})`,
      context: { job: name, consecutiveIncomplete: state.consecutiveIncomplete, instance: instanceId },
    });
  }
  return true;
}

/**
 * Run one scheduled invocation of a job, record its outcome, alert on
 * failure. Never rejects.
 *
 * @param name - a key of JOBS
 * @param fn - the job; a throw is a failure
 * @param options - `isFailure`: a partial failure the job reports in its
 *   result rather than throws (return a reason to fail the run);
 *   `isIncomplete` (ADR-082): a successful run that left work for the next
 *   one (return a reason to raise a `job.<name>.incomplete` warning);
 *   `singleton` overrides the definition; `now` is for tests
 */
async function runMonitored(name: string, fn: () => unknown, options: RunOptions = {}): Promise<RunOutcome> {
  const def = definitionOf(name);
  const state = stateOf(name);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  const startedAt = options.now || new Date();
  const singleton = options.singleton ?? def.singleton;

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

  let result: unknown;
  let error: string | null = null;
  try {
    result = await fn();
    const reason = options.isFailure ? options.isFailure(result) : null;
    if (reason) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript job's reason may be any value
      error = String(reason);
    }
  } catch (err) {
    const e = err as { message?: unknown } | null | undefined;
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `err && err.message ? err.message : String(err)`
    error = (e && e.message ? e.message : String(err)) as string;
  }

  const finishedAt = new Date();
  state.lastFinishedAt = finishedAt.toISOString();
  state.lastDurationMs = Math.max(0, +finishedAt - +startedAt);

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

  const incompleteChanged =
    !error && options.isIncomplete
      ? await trackIncomplete(name, state, options.isIncomplete(result), finishedAt)
      : false;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| 0`
  const stale = Date.now() - (lastPersistedAt.get(name) || 0) >= PERSIST_MIN_INTERVAL_MS;
  if (error || incompleteChanged || previousOutcome !== state.lastOutcome || stale) {
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
 * @param name - the job
 * @param task - the node-cron task
 * @param schedule - the cron expression, for the report
 */
function registerJob(name: string, task: JobTask, schedule: string): void {
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
 * @param name - the job
 * @param reason - why, for the report
 */
function markDisabled(name: string, reason: string): void {
  const state = stateOf(name);
  state.enabled = false;
  state.schedule = reason;
  tasks.delete(name);
}

/**
 * A scheduler whose cron expression is invalid does not start. That is a job
 * the operator believes is scheduled and is not — so besides the log line the
 * scheduler writes, it is an alert, and the report shows it as disabled.
 * @param name - the job
 * @param envName - the variable holding the bad expression
 * @param value - the expression
 */
function refuseSchedule(name: string, envName: string, value: string): Promise<undefined> {
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
 * @param now - the watchdog's clock
 * @returns the overdue job names
 */
async function checkOverdue(now = new Date()): Promise<string[]> {
  const overdue: string[] = [];
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
    if (+now - +expected <= graceMs(name) || lastSeen >= expected.getTime()) {
      continue;
    }
    overdue.push(name);
    const first = !state.overdueSince;
    if (first) {
      state.overdueSince = now.toISOString();
    }
    if (first || !state.lastAlertAt || +now - +new Date(state.lastAlertAt) >= repeatMs()) {
      const def = definitionOf(name);
      state.lastAlertAt = now.toISOString();
      await raiseAlert({
        key: `job.${name}.missed`,
        severity: SEVERITY.CRITICAL,
        title: `${def.title} DID NOT RUN`,
        meaning: `It was due at ${state.nextExpectedAt} and has not started. ${def.meaning}`,
        action: `Check that exactly one backend instance is running its schedulers and that the process was up at the scheduled time. ${def.action}`,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
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
 * @param now - the watchdog's clock
 * @returns how many are stuck
 */
async function checkStuckBatchJobs(now = new Date()): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on first use, not with this module
  const { Op } = require("sequelize") as typeof SequelizeModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the models barrel (and the database layer) load on first use, not with this module
  const { BatchJob } = require("../models") as ModelsBarrel;
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
      meaning: `${String(stuck.length)}${stuck.length === 20 ? "+" : ""} batch job(s) have been PROCESSING for more than ${String(minutes)} minutes. Whatever they were doing has probably died with a process, and their users are still waiting.`,
      action: "Inspect the listed batch_jobs rows; mark them FAILED (or re-run them) once you know why the worker stopped.",
      detail: stuck.map((job) => job.id).join(", "),
      context: { count: stuck.length, minutes },
    });
  }
  return stuck.length;
}

/** One watchdog tick. Never rejects. */
/* eslint-disable @typescript-eslint/restrict-template-expressions -- as built: the error's message as it is */
async function watchdogTick(): Promise<void> {
  try {
    await checkOverdue();
  } catch (err) {
    logger.error(`Job watchdog: overdue check failed: ${errorOf(err).message}`);
  }
  try {
    await checkStuckBatchJobs();
  } catch (err) {
    logger.error(`Job watchdog: batch-job check failed: ${errorOf(err).message}`);
  }
  // U-05 (ADR-116): the infrastructure backup's restore verification runs outside this
  // process; its outcome file is watched here, so a verifier that stopped is not silent.
  try {
    await backupVerifyService.checkRestoreVerification();
  } catch (err) {
    logger.error(`Job watchdog: backup verification check failed: ${errorOf(err).message}`);
  }
}
/* eslint-enable @typescript-eslint/restrict-template-expressions */

/**
 * Start the watchdog once per process. JOB_WATCHDOG_SCHEDULER=disabled turns
 * it off; an invalid expression falls back to the default, loudly — the
 * watchdog is the thing that notices schedulers that are not running, so it
 * must not be the one that silently is not.
 */
function startWatchdog(): void {
  if (watchdogTask) {
    return;
  }
  // ADR-082: say once, at boot, where an alert will go — or that it goes nowhere
  // but the log. "Nobody set up alert routing" must be visible, not assumed.
  const routing = describeRouting();
  if (routing.routed) {
    logger.info(`Alert routing: webhook=${routing.webhook}, email=${routing.email}`);
  } else {
    logger.warn(
      "Alert routing: NONE configured — alerts are log lines only. Set ALERT_WEBHOOK_URL (Slack-compatible) and/or ALERT_EMAIL_TO.",
    );
  }
  let schedule = scheduleSetting("JOB_WATCHDOG_SCHEDULER", DEFAULT_WATCHDOG_SCHEDULE);
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
const getJobStates = (): JobState[] =>
  [...states.values()]
    .map((state) => ({ ...state, runs: { ...state.runs } }))
    .sort((a, b) => a.job.localeCompare(b.job));

const seconds = (iso: string | null): number => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);

/**
 * Prometheus text exposition of every job's state. A gauge of 0 for a
 * timestamp means "never".
 * @returns the exposition text
 */
function renderMetrics(): string {
  const jobs = getJobStates();
  const lines: string[] = [];
  const family = (metric: string, type: string, help: string, valueOf: (state: JobState) => [string, number][]): void => {
    lines.push(`# HELP ${metric} ${help}`, `# TYPE ${metric} ${type}`);
    for (const state of jobs) {
      for (const [labels, value] of valueOf(state)) {
        lines.push(`${metric}{job="${state.job}"${labels}} ${String(value)}`);
      }
    }
  };
  family("callibrator_job_enabled", "gauge", "1 when the job is scheduled on this instance.", (s) => [["", s.enabled ? 1 : 0]]);
  family("callibrator_job_last_success_timestamp_seconds", "gauge", "Unix time of the last successful run (0 = never).", (s) => [["", seconds(s.lastSuccessAt)]]);
  family("callibrator_job_last_run_timestamp_seconds", "gauge", "Unix time the last run started (0 = never).", (s) => [["", seconds(s.lastStartedAt)]]);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| 0`
  family("callibrator_job_last_duration_seconds", "gauge", "Duration of the last run.", (s) => [["", (s.lastDurationMs || 0) / 1000]]);
  family("callibrator_job_last_run_failed", "gauge", "1 when the last run failed.", (s) => [["", s.lastOutcome === "failure" ? 1 : 0]]);
  family("callibrator_job_consecutive_failures", "gauge", "Failures since the last success.", (s) => [["", s.consecutiveFailures]]);
  family("callibrator_job_overdue", "gauge", "1 when the job missed its scheduled run.", (s) => [["", s.overdueSince ? 1 : 0]]);
  family("callibrator_job_last_run_incomplete", "gauge", "1 when the last run left work for the next one (ADR-082).", (s) => [["", s.lastIncomplete ? 1 : 0]]);
  family("callibrator_job_runs_total", "counter", "Runs by outcome, since the status file was created.", (s) =>
    (["success", "failure", "skipped"] as const).map((outcome): [string, number] => [`,outcome="${outcome}"`, s.runs[outcome]]),
  );
  return `${lines.join("\n")}\n`;
}

/** Forget all in-memory state (tests; a process restart does the same). */
function reset(): void {
  states.clear();
  tasks.clear();
  lastPersistedAt.clear();
  if (watchdogTask && typeof watchdogTask.stop === "function") {
    watchdogTask.stop();
  }
  watchdogTask = null;
  batchAlertAt = 0;
}

export = {
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
