/**
 * P21-03b (spec P19-02 § 9.1) — the idempotency key purge runs daily under the one scheduler
 * switch (ADR-060), monitored (P7-02), and refuses an invalid expression with an alert.
 */
import type * as SchedulerModule from "../../middlewares/idempotencyKeyPurgeScheduler.middleware";

jest.mock("../../services/jobMonitor.service", () =>
  (jest.requireActual<{ create: () => unknown }>("../fixtures/jobMonitorMock")).create(),
);
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: jest.requireActual<{ validate: (s: string) => boolean }>("node-cron").validate,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/idempotency.service", () => ({ purgeExpiredIdempotencyKeys: jest.fn() }));
// The one scheduler switch (ADR-060), doubled: the setting each case stands for.
jest.mock("../../utils/schedulerSwitch.util", () => ({ scheduleSetting: jest.fn((_name: string, fallback: string) => fallback) }));

/* eslint-disable @typescript-eslint/no-require-imports -- the mocked modules, read as the scheduler reads them */
const cron = require("node-cron") as { schedule: jest.Mock };
const { logger } = require("../../middlewares/activityLog.middleware") as { logger: Record<"info" | "warn" | "error", jest.Mock> };
const { purgeExpiredIdempotencyKeys } = require("../../services/idempotency.service") as { purgeExpiredIdempotencyKeys: jest.Mock };
const { scheduleSetting } = require("../../utils/schedulerSwitch.util") as { scheduleSetting: jest.Mock };
const monitor = require("../../services/jobMonitor.service") as Record<"registerJob" | "markDisabled" | "refuseSchedule" | "runMonitored", jest.Mock>;
const { initIdempotencyKeyPurge, runPurge, DEFAULT_SCHEDULE } = require("../../middlewares/idempotencyKeyPurgeScheduler.middleware") as typeof SchedulerModule;
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P21-03 idempotency key purge scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("schedules daily by default, registers with the job monitor and runs monitored", () => {
    initIdempotencyKeyPurge();
    expect(DEFAULT_SCHEDULE).toBe("53 3 * * *");
    expect(monitor.registerJob).toHaveBeenCalledWith("idempotency-key-purge", { id: "task" }, "53 3 * * *");
    const tick = (cron.schedule.mock.calls as unknown[][])[0]?.[1] as () => unknown;
    tick();
    expect(monitor.runMonitored).toHaveBeenCalledWith("idempotency-key-purge", runPurge);
  });

  it("is switched off by its setting (or SCHEDULERS_ENABLED=false, which the switch answers as `disabled`)", () => {
    scheduleSetting.mockReturnValueOnce("disabled");
    initIdempotencyKeyPurge();
    expect(scheduleSetting).toHaveBeenCalledWith("IDEMPOTENCY_KEY_PURGE_SCHEDULER", "53 3 * * *");
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith("idempotency-key-purge", "disabled via IDEMPOTENCY_KEY_PURGE_SCHEDULER");
    scheduleSetting.mockReturnValueOnce("off");
    initIdempotencyKeyPurge();
    expect([cron.schedule.mock.calls.length, monitor.markDisabled.mock.calls.length]).toEqual([0, 2]);
  });

  it("refuses an invalid expression with an alert", () => {
    scheduleSetting.mockReturnValueOnce("not a cron");
    initIdempotencyKeyPurge();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.refuseSchedule).toHaveBeenCalledWith("idempotency-key-purge", "IDEMPOTENCY_KEY_PURGE_SCHEDULER", "not a cron");
    expect(logger.error).toHaveBeenCalled();
  });

  it("a run logs its count, warns at its bound, and is quiet when nothing expired", async () => {
    purgeExpiredIdempotencyKeys.mockResolvedValueOnce({ deleted: 3, stoppedEarly: false });
    await runPurge();
    expect(logger.info).toHaveBeenCalledWith("Idempotency key purge removed 3 expired key(s)");
    purgeExpiredIdempotencyKeys.mockResolvedValueOnce({ deleted: 50000, stoppedEarly: true });
    await runPurge();
    expect(logger.warn).toHaveBeenCalledWith(
      "Idempotency key purge removed 50000 row(s) and stopped at its per-run bound; the next run continues",
    );
    jest.clearAllMocks();
    purgeExpiredIdempotencyKeys.mockResolvedValueOnce({ deleted: 0, stoppedEarly: false });
    await runPurge();
    expect([logger.info.mock.calls, logger.warn.mock.calls]).toEqual([[], []]);
  });
});
