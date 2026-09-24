/**
 * P7-02 — jobMonitor.service: every scheduled run is recorded durably, a
 * failure alerts (once per streak, then at most once per repeat interval), a
 * recovery says so, a missed run is detected (including one missed while the
 * process was down), a batch job stuck in PROCESSING alerts, and a singleton
 * job runs on one replica per scheduled minute (S-33).
 *
 * The status files are written to a real temporary directory.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/alert.service", () => ({
  SEVERITY: { CRITICAL: "critical", WARNING: "warning", RESOLVED: "resolved" },
  raiseAlert: jest.fn(async () => ({ webhook: "not-configured", email: "not-configured" })),
}));
jest.mock("../../services/redis.service", () => ({ getRedisConnection: jest.fn() }));
jest.mock("../../models", () => ({ BatchJob: { findAll: jest.fn() } }));
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
  validate: jest.requireActual("node-cron").validate,
}));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { raiseAlert } = require("../../services/alert.service");
const { getRedisConnection } = require("../../services/redis.service");
const { BatchJob } = require("../../models");
const monitor = require("../../services/jobMonitor.service");

const HOUR = 60 * 60 * 1000;
const task = (next) => ({ getNextRun: jest.fn(() => next) });
const readStatus = (name) => JSON.parse(fs.readFileSync(monitor.statusFile(name), "utf8"));
const stateOf = (name) => monitor.getJobStates().find((s) => s.job === name);

describe("P7-02 jobMonitor.service", () => {
  const saved = { ...process.env };
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "p702-"));
    process.env = { ...saved, JOB_STATUS_DIR: dir };
    delete process.env.JOB_ALERT_REPEAT_HOURS;
    delete process.env.JOB_OVERDUE_GRACE_MINUTES;
    delete process.env.JOB_WATCHDOG_SCHEDULER;
    delete process.env.BATCH_JOB_STUCK_MINUTES;
    monitor.reset();
    getRedisConnection.mockReturnValue({ status: "wait" });
  });

  afterAll(() => {
    process.env = saved;
    monitor.reset();
  });

  describe("runMonitored", () => {
    it("records a successful run to a durable status file", async () => {
      const next = new Date("2026-09-26T01:00:00Z");
      monitor.registerJob("calibration-scan", task(next), "0 1 * * *");

      const run = await monitor.runMonitored("calibration-scan", async () => ({ errors: 0 }));

      expect(run).toEqual({ outcome: "success", result: { errors: 0 } });
      const onDisk = readStatus("calibration-scan");
      expect(onDisk).toEqual(
        expect.objectContaining({
          job: "calibration-scan",
          enabled: true,
          schedule: "0 1 * * *",
          lastOutcome: "success",
          lastError: null,
          consecutiveFailures: 0,
          nextExpectedAt: next.toISOString(),
          runs: { success: 1, failure: 0, skipped: 0 },
        }),
      );
      expect(onDisk.lastSuccessAt).toBeTruthy();
      expect(raiseAlert).not.toHaveBeenCalled();
    });

    it("a throw is a FAILED run: recorded, and alerted with what it means and what to do", async () => {
      const run = await monitor.runMonitored("retention-sweep", async () => {
        throw new Error('column "tenantId" does not exist');
      });

      expect(run).toEqual({ outcome: "failure", result: undefined, error: 'column "tenantId" does not exist' });
      expect(readStatus("retention-sweep")).toEqual(
        expect.objectContaining({ lastOutcome: "failure", consecutiveFailures: 1, alerting: true }),
      );
      expect(raiseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "job.retention-sweep.failed",
          severity: "critical",
          title: "Data-retention purge FAILED",
          meaning: expect.stringContaining("data past its retention window was NOT purged"),
          action: expect.stringContaining("run the purge by hand"),
          detail: expect.stringContaining("last success: never recorded"),
        }),
      );
    });

    it("alerts on the first failure of a streak only, then again after the repeat interval", async () => {
      const fail = async () => {
        throw "string thrown";
      };
      await monitor.runMonitored("webhook-dispatch", fail);
      await monitor.runMonitored("webhook-dispatch", fail);
      expect(raiseAlert).toHaveBeenCalledTimes(1);
      expect(stateOf("webhook-dispatch").lastError).toBe("string thrown");
      expect(stateOf("webhook-dispatch").consecutiveFailures).toBe(2);

      process.env.JOB_ALERT_REPEAT_HOURS = "0.0000001";
      await new Promise((r) => setTimeout(r, 5));
      await monitor.runMonitored("webhook-dispatch", fail);
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    });

    it("a partial failure reported in the result (isFailure) is a FAILED run", async () => {
      const run = await monitor.runMonitored("calibration-scan", async () => ({ errors: 2 }), {
        isFailure: (s) => (s.errors ? `${s.errors} device(s) failed` : null),
      });
      expect(run).toEqual({ outcome: "failure", result: { errors: 2 }, error: "2 device(s) failed" });
    });

    it("says once when a failing job recovers", async () => {
      await monitor.runMonitored("session-cleanup", async () => {
        throw new Error("db down");
      });
      await monitor.runMonitored("session-cleanup", async () => 3, { isFailure: () => null });
      await monitor.runMonitored("session-cleanup", async () => 3);

      expect(raiseAlert).toHaveBeenCalledTimes(2);
      expect(raiseAlert).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: "resolved", title: "Expired-session cleanup recovered" }),
      );
      expect(stateOf("session-cleanup")).toEqual(
        expect.objectContaining({ alerting: false, consecutiveFailures: 0, runs: { success: 2, failure: 1, skipped: 0 } }),
      );
    });

    it("an unknown job name is still monitored, with a generic description", async () => {
      await monitor.runMonitored("brand-new-job", async () => {
        throw new Error("x");
      });
      expect(raiseAlert).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Scheduled job "brand-new-job" FAILED' }),
      );
    });

    it("does not rewrite the file for an unchanged outcome within five minutes", async () => {
      await monitor.runMonitored("webhook-dispatch", async () => ({ claimed: 0 }));
      const first = fs.statSync(monitor.statusFile("webhook-dispatch")).mtimeMs;
      fs.unlinkSync(monitor.statusFile("webhook-dispatch"));
      await monitor.runMonitored("webhook-dispatch", async () => ({ claimed: 0 }));
      expect(first).toBeGreaterThan(0);
      expect(fs.existsSync(monitor.statusFile("webhook-dispatch"))).toBe(false);
      expect(stateOf("webhook-dispatch").runs.success).toBe(2);
    });

    it("a status file that cannot be written is logged and recorded, never thrown", async () => {
      const blocker = path.join(dir, "not-a-dir");
      fs.writeFileSync(blocker, "x");
      process.env.JOB_STATUS_DIR = blocker;

      const run = await monitor.runMonitored("webhook-dispatch", async () => ({}));

      expect(run.outcome).toBe("success");
      expect(stateOf("webhook-dispatch").persistError).toBeTruthy();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not persist job status for "webhook-dispatch"'),
        { file: path.join(blocker, "webhook-dispatch.json") },
      );
    });
  });

  describe("durable state across a restart", () => {
    it("loads the previous process's state from the status file", async () => {
      await monitor.runMonitored("retention-sweep", async () => {
        throw new Error("boom");
      });
      monitor.reset(); // a restart

      await monitor.runMonitored("retention-sweep", async () => {
        throw new Error("boom again");
      });
      // The streak continued across the restart: no second first-failure alert.
      expect(raiseAlert).toHaveBeenCalledTimes(1);
      expect(stateOf("retention-sweep").consecutiveFailures).toBe(2);
    });

    it("a corrupt status file is reported and replaced, never trusted", async () => {
      fs.writeFileSync(path.join(dir, "retention-sweep.json"), "{not json");
      await monitor.runMonitored("retention-sweep", async () => ({}));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Job status for "retention-sweep" is unreadable and was reset'),
      );
      expect(readStatus("retention-sweep").runs).toEqual({ success: 1, failure: 0, skipped: 0 });
    });

    it("keeps a past expected run that never started — a run missed while the process was down", async () => {
      const missed = new Date(Date.now() - 3 * HOUR).toISOString();
      fs.writeFileSync(
        path.join(dir, "scheduled-backup.json"),
        JSON.stringify({ nextExpectedAt: missed, lastStartedAt: new Date(Date.now() - 27 * HOUR).toISOString() }),
      );

      monitor.registerJob("scheduled-backup", task(new Date(Date.now() + HOUR)), "0 0 * * *");
      expect(stateOf("scheduled-backup").nextExpectedAt).toBe(missed);

      expect(await monitor.checkOverdue()).toEqual(["scheduled-backup"]);
      expect(raiseAlert).toHaveBeenCalledWith(
        expect.objectContaining({ key: "job.scheduled-backup.missed", title: "Scheduled tenant backup DID NOT RUN" }),
      );
    });

    it("replaces a past expected run that DID start with the next slot", () => {
      const past = new Date(Date.now() - 3 * HOUR);
      fs.writeFileSync(
        path.join(dir, "scheduled-backup.json"),
        JSON.stringify({ nextExpectedAt: past.toISOString(), lastSkippedAt: new Date(past.getTime() + 1000).toISOString() }),
      );
      const next = new Date(Date.now() + HOUR);
      monitor.registerJob("scheduled-backup", task(next), "0 0 * * *");
      expect(stateOf("scheduled-backup").nextExpectedAt).toBe(next.toISOString());
    });
  });

  describe("singleton claim across replicas (S-33)", () => {
    it("runs when this replica wins SET NX on job-run:<name>:<minute>", async () => {
      const set = jest.fn().mockResolvedValue("OK");
      getRedisConnection.mockReturnValue({ status: "ready", set });
      const fn = jest.fn(async () => ({ ok: true }));

      const run = await monitor.runMonitored("scheduled-backup", fn, { now: new Date("2026-09-25T00:00:03Z") });

      expect(run.outcome).toBe("success");
      expect(set).toHaveBeenCalledWith(
        "job-run:scheduled-backup:2026-09-25T00:00",
        expect.any(String),
        "PX",
        monitor.CLAIM_TTL_MS,
        "NX",
      );
    });

    it("skips, records `skipped`, and does not run when another replica holds the claim", async () => {
      getRedisConnection.mockReturnValue({ status: "ready", set: jest.fn().mockResolvedValue(null) });
      const fn = jest.fn();

      expect(await monitor.runMonitored("scheduled-backup", fn)).toEqual({ outcome: "skipped" });
      expect(fn).not.toHaveBeenCalled();
      expect(readStatus("scheduled-backup")).toEqual(
        expect.objectContaining({ runs: { success: 0, failure: 0, skipped: 1 }, lastOutcome: null }),
      );
    });

    it.each([
      ["Redis not ready", () => ({ status: "reconnecting" }), "Redis unavailable"],
      ["no client at all", () => null, "Redis unavailable"],
      [
        "getRedisConnection throws",
        () => {
          throw new Error("no url");
        },
        "Redis unavailable",
      ],
      ["SET fails", () => ({ status: "ready", set: jest.fn().mockRejectedValue(new Error("READONLY")) }), "claim failed (READONLY)"],
    ])("%s: runs anyway (a duplicate backup is waste, a missing one is loss) and warns", async (_label, impl, warning) => {
      getRedisConnection.mockImplementation(impl);
      const fn = jest.fn(async () => ({}));
      expect((await monitor.runMonitored("scheduled-backup", fn)).outcome).toBe("success");
      expect(fn).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(warning));
    });

    it("a non-singleton job never touches Redis; the option overrides the definition", async () => {
      await monitor.runMonitored("webhook-dispatch", async () => ({}));
      expect(getRedisConnection).not.toHaveBeenCalled();
      await monitor.runMonitored("scheduled-backup", async () => ({}), { singleton: false });
      expect(getRedisConnection).not.toHaveBeenCalled();
    });
  });

  describe("disabled and refused schedules", () => {
    it("markDisabled reports the job as disabled and stops watching it", async () => {
      monitor.registerJob("retention-sweep", task(new Date(Date.now() - 5 * HOUR)), "0 2 * * *");
      monitor.markDisabled("retention-sweep", "disabled via RETENTION_SCHEDULER");
      expect(stateOf("retention-sweep")).toEqual(
        expect.objectContaining({ enabled: false, schedule: "disabled via RETENTION_SCHEDULER" }),
      );
      expect(await monitor.checkOverdue()).toEqual([]);
    });

    it("refuseSchedule alerts that the job is NOT SCHEDULED", async () => {
      await expect(monitor.refuseSchedule("retention-sweep", "RETENTION_SCHEDULER", "nonsense")).resolves.toBeUndefined();
      expect(raiseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "job.retention-sweep.not-scheduled",
          title: "Data-retention purge is NOT SCHEDULED",
          meaning: expect.stringContaining('RETENTION_SCHEDULER="nonsense" is not a valid cron expression'),
        }),
      );
      expect(stateOf("retention-sweep").enabled).toBe(false);
    });
  });

  describe("checkOverdue", () => {
    it("is quiet within the grace period, alerts past it, and does not repeat on every pass", async () => {
      const expected = new Date(Date.now() - 30 * 60 * 1000);
      monitor.registerJob("calibration-scan", task(expected), "0 1 * * *");

      expect(await monitor.checkOverdue()).toEqual([]); // 30 min < 60 min grace

      const later = new Date(Date.now() + 2 * HOUR);
      expect(await monitor.checkOverdue(later)).toEqual(["calibration-scan"]);
      expect(await monitor.checkOverdue(later)).toEqual(["calibration-scan"]);
      expect(raiseAlert).toHaveBeenCalledTimes(1);
      expect(readStatus("calibration-scan").overdueSince).toBe(later.toISOString());

      // after the repeat interval it alerts again
      expect(await monitor.checkOverdue(new Date(later.getTime() + 25 * HOUR))).toEqual(["calibration-scan"]);
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    });

    it("re-alerts an overdue job that has never alerted before", async () => {
      monitor.registerJob("calibration-scan", task(new Date(Date.now() - 3 * HOUR)), "0 1 * * *");
      const later = new Date();
      await monitor.checkOverdue(later);
      // simulate a state with overdueSince but no lastAlertAt (e.g. hand-edited file)
      monitor.reset();
      fs.writeFileSync(
        path.join(dir, "calibration-scan.json"),
        JSON.stringify({ nextExpectedAt: new Date(Date.now() - 3 * HOUR).toISOString(), overdueSince: later.toISOString() }),
      );
      monitor.registerJob("calibration-scan", task(null), "0 1 * * *");
      raiseAlert.mockClear();
      await monitor.checkOverdue();
      expect(raiseAlert).toHaveBeenCalledTimes(1);
    });

    it("a run that started (or was skipped by another replica) clears overdue", async () => {
      monitor.registerJob("calibration-scan", task(new Date(Date.now() - 3 * HOUR)), "0 1 * * *");
      await monitor.checkOverdue();
      await monitor.runMonitored("calibration-scan", async () => ({}), { singleton: false });
      expect(stateOf("calibration-scan").overdueSince).toBeNull();
    });

    it("a run another replica claimed (skipped here) counts as the run having happened", async () => {
      const expected = new Date(Date.now() - 3 * HOUR);
      monitor.registerJob("calibration-scan", task(expected), "0 1 * * *");
      getRedisConnection.mockReturnValue({ status: "ready", set: jest.fn().mockResolvedValue(null) });
      await monitor.runMonitored("calibration-scan", jest.fn()); // skipped; next slot is still `expected`
      expect(await monitor.checkOverdue()).toEqual([]);
      expect(monitor.renderMetrics()).toContain('callibrator_job_overdue{job="calibration-scan"} 0');
    });

    it("an overdue job shows as overdue in the metrics", async () => {
      monitor.registerJob("calibration-scan", task(new Date(Date.now() - 3 * HOUR)), "0 1 * * *");
      await monitor.checkOverdue();
      expect(monitor.renderMetrics()).toContain('callibrator_job_overdue{job="calibration-scan"} 1');
    });

    it("ignores a job with no expected run, and honours JOB_OVERDUE_GRACE_MINUTES", async () => {
      monitor.registerJob("session-cleanup", task(null), "0 2 * * *");
      monitor.registerJob("tenant-lifecycle", {}, "30 2 * * *");
      monitor.registerJob("calibration-scan", task(new Date(Date.now() - 10 * 60 * 1000)), "0 1 * * *");
      expect(await monitor.checkOverdue()).toEqual([]);
      process.env.JOB_OVERDUE_GRACE_MINUTES = "5";
      expect(await monitor.checkOverdue()).toEqual(["calibration-scan"]);
    });

    it("the webhook dispatcher has its own, shorter, grace", async () => {
      monitor.registerJob("webhook-dispatch", task(new Date(Date.now() - 11 * 60 * 1000)), "*/15 * * * * *");
      expect(await monitor.checkOverdue()).toEqual(["webhook-dispatch"]);
    });
  });

  describe("checkStuckBatchJobs", () => {
    it("returns 0 and is quiet when nothing is stuck; the query is cross-tenant on purpose", async () => {
      BatchJob.findAll.mockResolvedValue([]);
      const now = new Date("2026-09-25T12:00:00Z");
      expect(await monitor.checkStuckBatchJobs(now)).toBe(0);
      const query = BatchJob.findAll.mock.calls[0][0];
      expect(query.skipTenantScope).toBe(true);
      expect(query.where.status).toBe("PROCESSING");
      expect(Object.getOwnPropertySymbols(query.where.updatedAt).map((s) => query.where.updatedAt[s])).toEqual([
        new Date("2026-09-25T11:00:00Z"),
      ]);
      expect(raiseAlert).not.toHaveBeenCalled();
    });

    it("alerts once when batch jobs rest in PROCESSING past BATCH_JOB_STUCK_MINUTES, then after the repeat interval", async () => {
      process.env.BATCH_JOB_STUCK_MINUTES = "15";
      BatchJob.findAll.mockResolvedValue([{ id: "b1" }, { id: "b2" }]);
      const now = new Date();
      expect(await monitor.checkStuckBatchJobs(now)).toBe(2);
      expect(await monitor.checkStuckBatchJobs(now)).toBe(2);
      expect(raiseAlert).toHaveBeenCalledTimes(1);
      expect(raiseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "batch-jobs.stuck",
          severity: "warning",
          meaning: expect.stringContaining("2 batch job(s) have been PROCESSING for more than 15 minutes"),
          detail: "b1, b2",
        }),
      );
      await monitor.checkStuckBatchJobs(new Date(now.getTime() + 25 * HOUR));
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    });

    it("says 20+ when the query hit its limit", async () => {
      BatchJob.findAll.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `b${i}` })));
      await monitor.checkStuckBatchJobs();
      expect(raiseAlert).toHaveBeenCalledWith(expect.objectContaining({ meaning: expect.stringContaining("20+ batch job(s)") }));
    });
  });

  describe("watchdog", () => {
    it("a tick runs both checks and survives either throwing", async () => {
      BatchJob.findAll.mockRejectedValue(new Error("db down"));
      await expect(monitor.watchdogTick()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith("Job watchdog: batch-job check failed: db down");

      monitor.registerJob("calibration-scan", { getNextRun: () => new Date(Date.now() - 5 * HOUR) }, "x");
      raiseAlert.mockRejectedValueOnce(new Error("alert broke"));
      BatchJob.findAll.mockResolvedValue([]);
      await monitor.watchdogTick();
      expect(logger.error).toHaveBeenCalledWith("Job watchdog: overdue check failed: alert broke");
    });

    it("starts once on the default schedule", () => {
      monitor.startWatchdog();
      monitor.startWatchdog();
      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect(cron.schedule).toHaveBeenCalledWith(monitor.DEFAULT_WATCHDOG_SCHEDULE, monitor.watchdogTick);
    });

    it("falls back to the default, loudly, on an invalid expression", () => {
      process.env.JOB_WATCHDOG_SCHEDULER = "every five";
      monitor.startWatchdog();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid JOB_WATCHDOG_SCHEDULER "every five"'));
      expect(cron.schedule).toHaveBeenCalledWith(monitor.DEFAULT_WATCHDOG_SCHEDULE, monitor.watchdogTick);
    });

    it("can be disabled, and says missed runs will not alert", () => {
      process.env.JOB_WATCHDOG_SCHEDULER = "disabled";
      monitor.startWatchdog();
      monitor.startWatchdog();
      expect(cron.schedule).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("missed runs will NOT alert"));
      monitor.reset();
    });
  });

  describe("status location", () => {
    it("defaults to <storage>/log/jobs, on the log volume", () => {
      delete process.env.JOB_STATUS_DIR;
      const storagePath = require("../../utils/storagePath.util");
      expect(monitor.statusFile("x")).toBe(path.join(storagePath("log", "jobs"), "x.json"));
    });
  });

  describe("reporting", () => {
    it("getJobStates is sorted and returns copies", async () => {
      await monitor.runMonitored("webhook-dispatch", async () => ({}));
      await monitor.runMonitored("calibration-scan", async () => ({}), { singleton: false });
      const states = monitor.getJobStates();
      expect(states.map((s) => s.job)).toEqual(["calibration-scan", "webhook-dispatch"]);
      states[0].runs.success = 99;
      expect(stateOf("calibration-scan").runs.success).toBe(1);
    });

    it("renderMetrics emits Prometheus text for every job", async () => {
      monitor.registerJob("retention-sweep", task(null), "0 2 * * *");
      await monitor.runMonitored("retention-sweep", async () => {
        throw new Error("x");
      });
      monitor.markDisabled("calibration-scan", "off");

      const text = monitor.renderMetrics();

      expect(text).toContain("# TYPE callibrator_job_last_run_failed gauge");
      expect(text).toContain('callibrator_job_last_run_failed{job="retention-sweep"} 1');
      expect(text).toContain('callibrator_job_enabled{job="retention-sweep"} 1');
      expect(text).toContain('callibrator_job_enabled{job="calibration-scan"} 0');
      expect(text).toContain('callibrator_job_last_success_timestamp_seconds{job="retention-sweep"} 0');
      expect(text).toContain('callibrator_job_consecutive_failures{job="retention-sweep"} 1');
      expect(text).toContain('callibrator_job_runs_total{job="retention-sweep",outcome="failure"} 1');
      expect(text).toContain('callibrator_job_overdue{job="calibration-scan"} 0');
      expect(text).toMatch(/callibrator_job_last_run_timestamp_seconds\{job="retention-sweep"\} \d{10}/);
      expect(text).toContain('callibrator_job_last_duration_seconds{job="calibration-scan"} 0');
      expect(text.endsWith("\n")).toBe(true);
    });
  });
});
