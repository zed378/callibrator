/**
 * P24-06 — the SQL-dump import's sweep is scheduled hourly, monitored (P7-02),
 * can be disabled, and refuses an invalid expression with an alert: the
 * quarantine sweep's contract (quarantineSweepScheduler.s33), for the dumps.
 *
 * TypeScript without jest's hoisting: the mocks are registered first, then the
 * module under test is loaded.
 */
import type * as CronModule from "node-cron";
import { environment } from "../../config/env";

const penv = environment();

jest.mock("../../services/jobMonitor.service", () => (jest.requireActual<{ create(): unknown }>("../fixtures/jobMonitorMock")).create());
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: jest.requireActual<typeof CronModule>("node-cron").validate,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
const sweep = jest.fn();
jest.mock("../../services/upstreamSqlImport.service", () => ({ sweepUpstreamSqlImports: (...a: unknown[]) => sweep(...a) as unknown }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks; typed by the members used */
const cron = require("node-cron") as { schedule: jest.Mock };
const { logger } = require("../../middlewares/activityLog.middleware") as { logger: { info: jest.Mock; error: jest.Mock } };
const monitor = require("../../services/jobMonitor.service") as { registerJob: jest.Mock; markDisabled: jest.Mock; refuseSchedule: jest.Mock };
const scheduler = require("../../middlewares/upstreamSqlImportSweepScheduler.middleware") as {
  initUpstreamSqlImportSweep(): void;
  DEFAULT_SCHEDULE: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P24-06 upstream SQL import sweep scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete penv["UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER"];
  });

  it("schedules hourly by default, registered with the job monitor", () => {
    scheduler.initUpstreamSqlImportSweep();
    expect(scheduler.DEFAULT_SCHEDULE).toBe("41 * * * *");
    expect(cron.schedule).toHaveBeenCalledWith("41 * * * *", expect.any(Function));
    expect(monitor.registerJob).toHaveBeenCalledWith("upstream-sql-import-sweep", { id: "task" }, "41 * * * *");
  });

  it("a sweep that did something says so; one that did nothing is quiet", async () => {
    scheduler.initUpstreamSqlImportSweep();
    const tick = (cron.schedule.mock.calls[0] as [string, () => Promise<{ outcome: string }>])[1];
    sweep.mockResolvedValueOnce({ interrupted: 1, purged: 2, orphans: 0 });
    expect((await tick()).outcome).toBe("success");
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1 interrupted run(s) failed, 2 expired file(s) and 0 orphan file(s) deleted"));
    logger.info.mockClear();
    sweep.mockResolvedValueOnce({ interrupted: 0, purged: 0, orphans: 0 });
    await tick();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(["disabled", "off"])("%s turns it off and reports it disabled", (value) => {
    penv["UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER"] = value;
    scheduler.initUpstreamSqlImportSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith("upstream-sql-import-sweep", "disabled via UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER");
  });

  it("an invalid expression is refused with an alert, and nothing is scheduled", () => {
    penv["UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER"] = "every hour";
    scheduler.initUpstreamSqlImportSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"every hour"'));
    expect(monitor.refuseSchedule).toHaveBeenCalledWith("upstream-sql-import-sweep", "UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER", "every hour");
  });
});
