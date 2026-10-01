/**
 * W-13 — no scheduled job's failure ends in a log line nobody reads.
 *
 * The card's fix was delivered by P7-02 (jobMonitor.service: a durable run
 * record per job, an alert on failure, a watchdog for a run that never
 * happened, GET /api/v1/health/jobs) and A-14 (the Console transport in
 * production, so `docker logs` is not empty). Their behaviour is tested in
 * jobMonitor.service.p702.test.js — "a throw is a FAILED run: recorded, and
 * alerted with what it means and what to do" is the card's last box — and
 * activityLog.a14.stdout.test.js.
 *
 * What neither pins is COVERAGE: that the NEXT scheduler is monitored too.
 * This scan fails when a file under src/ calls `cron.schedule(` without
 * running its job through `runMonitored` and registering it with
 * `registerJob` (so the watchdog knows its schedule). The one exemption is
 * the watchdog itself.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "../..");

/** Files that schedule with cron but are not a job to monitor, with the reason. */
const EXEMPT = {
  // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087).
  "services/jobMonitor.service.ts": "the watchdog: it is what checks the others",
};

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : sourceFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

const schedulers = sourceFiles(SRC)
  .map((file) => ({
    rel: path.relative(SRC, file).split(path.sep).join("/"),
    text: fs.readFileSync(file, "utf8"),
  }))
  .filter(({ text }) => text.includes("cron.schedule("));

describe("W-13 — every scheduled job is monitored", () => {
  it("finds the schedulers it is checking (the scan is not vacuous)", () => {
    expect(schedulers.length).toBeGreaterThanOrEqual(9);
  });

  it("every cron.schedule call site runs its job through runMonitored and registers it, or is a named exemption", () => {
    const unmonitored = schedulers
      .filter(({ rel }) => !EXEMPT[rel])
      .filter(({ text }) => !text.includes("runMonitored(") || !text.includes("registerJob("))
      .map(({ rel }) => rel);
    expect(unmonitored).toEqual([]);
  });

  it("the monitor has a description (what a failure means, what to do) for every job it is given", () => {
    const { JOBS } = require("../../services/jobMonitor.service");
    const names = schedulers
      .filter(({ rel }) => !EXEMPT[rel])
      .flatMap(({ text }) => [...text.matchAll(/const JOB = "([^"]+)"/g)].map((m) => m[1]));
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names.filter((name) => !JOBS[name])).toEqual([]);
  });
});
