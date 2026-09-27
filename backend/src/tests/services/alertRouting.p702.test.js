/**
 * P7-02 / ADR-082 — the alert ROUTE, end to end, into a real HTTP receiver.
 *
 * alert.service.p702.test.js proves the webhook sink against a local server,
 * and jobMonitor.service.p702.test.js proves the monitor with alert.service
 * MOCKED. Neither proves the path an operator relies on: a scheduled job
 * fails, misses its run or leaves work behind, and a message arrives at the
 * configured ALERT_WEBHOOK_URL. Here nothing between the job and the socket is
 * mocked — the real jobMonitor, the real alert.service, the real scheduler
 * middlewares and (for the quarantine) the real sweep over a real directory.
 *
 * Mocked: the logger (to read it), Redis (absent: the singleton claim is then
 * not enforced, which is the documented fallback), node-cron's `schedule` (to
 * fire the job now instead of at 02:00), the models, and the retention
 * service's database work (its summary is the input under test).
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/redis.service", () => ({ getRedisConnection: jest.fn(() => null) }));
jest.mock("../../models", () => ({ BatchJob: { findAll: jest.fn(async () => []) } }));
jest.mock("../../services/dataRetention.service", () => ({ runRetentionSweep: jest.fn() }));
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.requireActual("node-cron").validate,
}));
// The quarantine lives in a per-test temporary directory, not backend/uploads.
let mockQuarantineDir;
jest.mock("../../utils/upload.util", () => ({
  quarantinePath: (...parts) => require("path").join(mockQuarantineDir, ...parts),
}));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { runRetentionSweep } = require("../../services/dataRetention.service");
const monitor = require("../../services/jobMonitor.service");
const { describeRouting } = require("../../services/alert.service");
const { initRetentionScheduler } = require("../../middlewares/retentionScheduler.middleware");
const { initQuarantineSweep } = require("../../middlewares/quarantineSweepScheduler.middleware");

const HOUR = 60 * 60 * 1000;

describe("P7-02 / ADR-082 alert routing — a real HTTP receiver gets the alert", () => {
  const saved = { ...process.env };
  let server;
  let received;
  let statusDir;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    statusDir = fs.mkdtempSync(path.join(os.tmpdir(), "p702-route-"));
    mockQuarantineDir = fs.mkdtempSync(path.join(os.tmpdir(), "p702-quar-"));
    process.env = {
      ...saved,
      JOB_STATUS_DIR: statusDir,
      ALERT_WEBHOOK_URL: `http://127.0.0.1:${server.address().port}/hooks/services/T000/B000/slack-compatible`,
    };
    for (const key of [
      "ALERT_EMAIL_TO",
      "JOB_ALERT_REPEAT_HOURS",
      "JOB_OVERDUE_GRACE_MINUTES",
      "JOB_WATCHDOG_SCHEDULER",
      "RETENTION_SCHEDULER",
      "QUARANTINE_SWEEP_SCHEDULER",
      "QUARANTINE_SWEEP_MAX_ENTRIES",
      "QUARANTINE_MAX_AGE_MINUTES",
    ]) {
      delete process.env[key];
    }
    monitor.reset();
    // Every cron.schedule returns a task the monitor can ask for its next run.
    cron.schedule.mockImplementation((expression, callback) => ({
      callback,
      getNextRun: () => new Date(Date.now() + HOUR),
      stop: jest.fn(),
    }));
  });

  afterEach(() => {
    monitor.reset();
    fs.rmSync(statusDir, { recursive: true, force: true });
    fs.rmSync(mockQuarantineDir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  /** The cron callback the scheduler registered — firing it is "the scheduled minute came". */
  const scheduledCallback = () => cron.schedule.mock.results.at(-1).value.callback;

  it("a monitored job that FAILS is POSTed to ALERT_WEBHOOK_URL as a Slack-compatible message", async () => {
    await monitor.runMonitored("retention-sweep", async () => {
      throw new Error('column "tenantId" does not exist');
    });

    expect(received).toHaveLength(1);
    const [post] = received;
    expect(post.method).toBe("POST");
    expect(post.url).toBe("/hooks/services/T000/B000/slack-compatible");
    expect(post.headers["content-type"]).toBe("application/json");
    // `text` is the field Slack and Mattermost incoming webhooks render.
    expect(post.body.text.split("\n")).toEqual([
      "[CRITICAL] Data-retention purge FAILED",
      monitor.JOBS["retention-sweep"].meaning,
      `What to do: ${monitor.JOBS["retention-sweep"].action}`,
      expect.stringContaining('Detail: column "tenantId" does not exist (consecutive failures: 1'),
    ]);
    expect(post.body.alert).toMatchObject({ key: "job.retention-sweep.failed", severity: "critical" });
  });

  it("a job that MISSED its run is POSTed by the watchdog", async () => {
    monitor.registerJob("calibration-scan", { getNextRun: () => new Date(Date.now() - 3 * HOUR) }, "0 1 * * *");

    await monitor.watchdogTick();

    expect(received).toHaveLength(1);
    expect(received[0].body.alert).toMatchObject({ key: "job.calibration-scan.missed", severity: "critical" });
    expect(received[0].body.text).toMatch(/^\[CRITICAL\] Calibration sweep DID NOT RUN\n/);
    expect(received[0].body.text).toContain("What to do: Check that exactly one backend instance");
  });

  it("the scheduled retention sweep that ran out of budget (incomplete) raises a WARNING, then says when it completes again", async () => {
    runRetentionSweep.mockResolvedValueOnce({ tenants: 3, purged: 120, skipped: 0, errors: 0, incomplete: 2 });
    initRetentionScheduler();
    const fire = scheduledCallback();

    const first = await fire();
    expect(first.outcome).toBe("success");
    expect(received).toHaveLength(1);
    expect(received[0].body.alert).toMatchObject({ key: "job.retention-sweep.incomplete", severity: "warning" });
    expect(received[0].body.text.split("\n")).toEqual([
      "[WARNING] Data-retention purge INCOMPLETE",
      monitor.JOBS["retention-sweep"].incomplete.meaning,
      `What to do: ${monitor.JOBS["retention-sweep"].incomplete.action}`,
      "Detail: 2 tenant(s) still hold data past its window after this run's budget (consecutive incomplete runs: 1)",
    ]);
    // Recorded durably, and visible to a Prometheus scrape.
    const status = JSON.parse(fs.readFileSync(monitor.statusFile("retention-sweep"), "utf8"));
    expect(status).toMatchObject({ lastOutcome: "success", consecutiveIncomplete: 1, incompleteAlerting: true });
    expect(monitor.renderMetrics()).toContain('callibrator_job_last_run_incomplete{job="retention-sweep"} 1');

    // Still incomplete the next night: throttled, not re-sent.
    runRetentionSweep.mockResolvedValueOnce({ tenants: 3, purged: 80, skipped: 0, errors: 0, incomplete: 1 });
    await fire();
    expect(received).toHaveLength(1);
    expect(monitor.getJobStates().find((s) => s.job === "retention-sweep").consecutiveIncomplete).toBe(2);

    // Complete again: one `resolved` message.
    runRetentionSweep.mockResolvedValueOnce({ tenants: 3, purged: 5, skipped: 0, errors: 0, incomplete: 0 });
    await fire();
    expect(received).toHaveLength(2);
    expect(received[1].body.alert).toMatchObject({ key: "job.retention-sweep.incomplete", severity: "resolved" });
    expect(received[1].body.text).toMatch(/^\[RESOLVED\] Data-retention purge complete again\n/);
    expect(monitor.renderMetrics()).toContain('callibrator_job_last_run_incomplete{job="retention-sweep"} 0');

    // Complete, and nothing was alerting: silence.
    runRetentionSweep.mockResolvedValueOnce({ tenants: 3, purged: 0, skipped: 0, errors: 0, incomplete: 0 });
    await fire();
    expect(received).toHaveLength(2);
  });

  it("an incomplete run that keeps recurring is re-sent after JOB_ALERT_REPEAT_HOURS", async () => {
    process.env.JOB_ALERT_REPEAT_HOURS = "0.0000001"; // 0.36 ms
    runRetentionSweep.mockResolvedValue({ tenants: 1, purged: 1, skipped: 0, errors: 0, incomplete: 1 });
    initRetentionScheduler();
    const fire = scheduledCallback();

    await fire();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fire();

    expect(received.map((r) => r.body.alert.key)).toEqual([
      "job.retention-sweep.incomplete",
      "job.retention-sweep.incomplete",
    ]);
    expect(received[1].body.text).toContain("(consecutive incomplete runs: 2)");
  });

  it("a retention sweep with tenant errors is a FAILURE, not an incomplete warning", async () => {
    runRetentionSweep.mockResolvedValueOnce({ tenants: 2, purged: 0, skipped: 0, errors: 1, incomplete: 1 });
    initRetentionScheduler();

    await scheduledCallback()();

    expect(received.map((r) => r.body.alert.key)).toEqual(["job.retention-sweep.failed"]);
  });

  it("the scheduled quarantine sweep that stopped at its entry limit (truncated) raises a WARNING", async () => {
    process.env.QUARANTINE_SWEEP_MAX_ENTRIES = "2";
    const old = new Date(Date.now() - 2 * HOUR);
    for (const name of ["a.bin", "b.bin", "c.bin", "d.bin"]) {
      const file = path.join(mockQuarantineDir, name);
      fs.writeFileSync(file, "abandoned");
      fs.utimesSync(file, old, old);
    }
    initQuarantineSweep();

    const run = await scheduledCallback()();

    expect(run.outcome).toBe("success");
    expect(run.result).toMatchObject({ truncated: true, removed: 2 });
    expect(fs.readdirSync(mockQuarantineDir)).toHaveLength(2);
    expect(received).toHaveLength(1);
    expect(received[0].body.alert).toMatchObject({ key: "job.quarantine-sweep.incomplete", severity: "warning" });
    expect(received[0].body.text.split("\n")).toEqual([
      "[WARNING] Upload quarantine sweep INCOMPLETE",
      monitor.JOBS["quarantine-sweep"].incomplete.meaning,
      `What to do: ${monitor.JOBS["quarantine-sweep"].incomplete.action}`,
      "Detail: stopped at the entry limit (QUARANTINE_SWEEP_MAX_ENTRIES) with entries left; 2 removed this run (consecutive incomplete runs: 1)",
    ]);

    // The next run drains the rest and says the backlog is cleared.
    await scheduledCallback()();
    expect(fs.readdirSync(mockQuarantineDir)).toHaveLength(0);
    expect(received.map((r) => r.body.alert.severity)).toEqual(["warning", "resolved"]);
  });

  it("a job with no `incomplete` description still alerts, with a generic one", async () => {
    await monitor.runMonitored("some-new-job", async () => ({ left: 3 }), {
      isIncomplete: (result) => `${result.left} item(s) left`,
    });

    expect(received).toHaveLength(1);
    expect(received[0].body.text).toContain('The scheduled job "some-new-job" finished without doing all its work');
    expect(received[0].body.text).toContain("Detail: 3 item(s) left (consecutive incomplete runs: 1)");
  });

  describe("routing is stated at boot (describeRouting via startWatchdog)", () => {
    it("names the webhook's host only — the URL itself is a credential", () => {
      process.env.ALERT_EMAIL_TO = "ops@example.test, oncall@example.test ,";
      expect(describeRouting()).toEqual({
        routed: true,
        webhook: `127.0.0.1:${server.address().port}`,
        email: "2 address(es)",
      });

      monitor.startWatchdog();
      const line = logger.info.mock.calls.map(([message]) => message).find((m) => m.startsWith("Alert routing:"));
      expect(line).toBe(`Alert routing: webhook=127.0.0.1:${server.address().port}, email=2 address(es)`);
      expect(line).not.toContain("slack-compatible");
    });

    it("warns when nothing is routed: alerts are log lines only", () => {
      delete process.env.ALERT_WEBHOOK_URL;
      expect(describeRouting()).toEqual({ routed: false, webhook: "off", email: "off" });

      monitor.startWatchdog();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Alert routing: NONE configured"));
    });

    it("an unparseable ALERT_WEBHOOK_URL is reported at boot, not at the first alert", () => {
      process.env.ALERT_WEBHOOK_URL = "hooks.slack.com/services/no-scheme";
      expect(describeRouting()).toEqual({ routed: true, webhook: "INVALID URL", email: "off" });
    });
  });
});
