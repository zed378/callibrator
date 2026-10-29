/* eslint-disable no-restricted-properties -- scheduler tests mutate process.env */
/**
 * Tests for calibrationScheduler middleware
 */

import type * as SchedulerModule from "../../middlewares/calibrationScheduler.middleware";

jest.mock("../../services/jobMonitor.service", () =>
  (jest.requireActual<{ create: () => unknown }>("../fixtures/jobMonitorMock")).create(),
);
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../services/calibrationScheduler.service", () => ({
  runCalibrationScan: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const cron = require("node-cron") as { schedule: jest.Mock; validate: jest.Mock };
const { logger } = require("../../middlewares/activityLog.middleware") as {
  logger: Record<"info" | "error" | "warn", jest.Mock>;
};
const { runCalibrationScan } = require("../../services/calibrationScheduler.service") as {
  runCalibrationScan: jest.Mock;
};
const { initCalibrationScheduler } =
  require("../../middlewares/calibrationScheduler.middleware") as typeof SchedulerModule;
const monitor = require("../../services/jobMonitor.service") as Record<string, jest.Mock>;
/* eslint-enable @typescript-eslint/no-require-imports */

describe("calibrationScheduler middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    cron.schedule.mockClear();
    cron.validate.mockClear();
  });

  afterEach(() => {
    process.env["CALIBRATION_SCHEDULER"] = originalEnv["CALIBRATION_SCHEDULER"];
    process.env["NODE_ENV"] = originalEnv["NODE_ENV"];
  });

  describe("initCalibrationScheduler", () => {
    it("should log info and return when CALIBRATION_SCHEDULER is 'disabled'", () => {
      process.env["CALIBRATION_SCHEDULER"] = "disabled";
      initCalibrationScheduler();

      expect(logger.info).toHaveBeenCalledWith(
        "Calibration scheduler disabled via CALIBRATION_SCHEDULER",
      );
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("should log info and return when CALIBRATION_SCHEDULER is 'off'", () => {
      process.env["CALIBRATION_SCHEDULER"] = "off";
      initCalibrationScheduler();

      expect(logger.info).toHaveBeenCalledWith(
        "Calibration scheduler disabled via CALIBRATION_SCHEDULER",
      );
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("should log error and return when cron expression is invalid", () => {
      cron.validate.mockReturnValue(false);
      process.env["CALIBRATION_SCHEDULER"] = "not-a-cron";
      initCalibrationScheduler();

      expect(cron.validate).toHaveBeenCalledWith("not-a-cron");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid CALIBRATION_SCHEDULER cron expression"),
      );
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("should log info with custom schedule when expression is valid", () => {
      cron.validate.mockReturnValue(true);
      process.env["CALIBRATION_SCHEDULER"] = "0 3 * * *";
      initCalibrationScheduler();

      expect(cron.validate).toHaveBeenCalledWith("0 3 * * *");
      expect(logger.info).toHaveBeenCalledWith(
        "Calibration scheduler scheduled with: 0 3 * * *",
      );
    });

    it("should log info with default schedule when no env var is set", () => {
      delete process.env["CALIBRATION_SCHEDULER"];
      cron.validate.mockReturnValue(true);
      initCalibrationScheduler();

      expect(cron.validate).toHaveBeenCalledWith("0 1 * * *");
      expect(logger.info).toHaveBeenCalledWith(
        "Calibration scheduler scheduled at 1:00 AM daily",
      );
    });

    it("should register a cron job with the provided schedule", () => {
      cron.validate.mockReturnValue(true);
      process.env["CALIBRATION_SCHEDULER"] = "0 2 * * *";
      initCalibrationScheduler();

      expect(cron.schedule).toHaveBeenCalledTimes(1);
      const [expr, callback] = cron.schedule.mock.calls[0] as [string, unknown];
      expect(expr).toBe("0 2 * * *");
      expect(typeof callback).toBe("function");
    });

    it("should run calibration scan and log summary when cron fires successfully", async () => {
      cron.validate.mockReturnValue(true);
      process.env["CALIBRATION_SCHEDULER"] = "0 1 * * *";
      runCalibrationScan.mockResolvedValue({
        scanned: 5,
        workOrdersCreated: 2,
        notificationsCreated: 3,
        skipped: 0,
        overdue: 1,
        errors: 0,
      });

      initCalibrationScheduler();

      // Trigger the cron callback
      const [, callback] = cron.schedule.mock.calls[0] as [string, () => Promise<unknown>];
      await callback();

      expect(logger.info).toHaveBeenCalledWith("Running calibration scheduler scan...");
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Calibration scan complete: scanned=5"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("workOrdersCreated=2"),
      );
    });

    it("should log error when calibration scan throws", async () => {
      cron.validate.mockReturnValue(true);
      process.env["CALIBRATION_SCHEDULER"] = "0 1 * * *";
      runCalibrationScan.mockRejectedValue(new Error("DB connection failed"));

      initCalibrationScheduler();

      const [, callback] = cron.schedule.mock.calls[0] as [string, () => Promise<unknown>];
      await callback();

      expect(logger.error).toHaveBeenCalledWith(
        "Error during scheduled calibration scan: DB connection failed",
      );
    });

    it("should use default schedule when env var is empty string", () => {
      cron.validate.mockReturnValue(true);
      process.env["CALIBRATION_SCHEDULER"] = "";
      initCalibrationScheduler();

      expect(cron.validate).toHaveBeenCalledWith("0 1 * * *");
    });
  });

  describe("P7-02 job monitoring", () => {
    it("a scan that finishes with per-device errors is a FAILED run", async () => {
      cron.validate.mockReturnValue(true);
      delete process.env["CALIBRATION_SCHEDULER"];
      runCalibrationScan.mockResolvedValue({
        scanned: 5, workOrdersCreated: 0, notificationsCreated: 0, skipped: 0, overdue: 0, errors: 2,
      });
      initCalibrationScheduler();
      const calls = cron.schedule.mock.calls as [string, () => Promise<{ outcome: string; error: string }>][];
      const run = await (calls[0] as [string, () => Promise<{ outcome: string; error: string }>])[1]();
      expect(run).toEqual(expect.objectContaining({
        outcome: "failure", error: "2 device(s) failed during the scan",
      }));
      expect(monitor["registerJob"]).toHaveBeenCalledWith("calibration-scan", undefined, "0 1 * * *");
    });

    it("a clean scan succeeds; a thrown scan fails", async () => {
      cron.validate.mockReturnValue(true);
      runCalibrationScan.mockResolvedValueOnce({ errors: 0 }).mockRejectedValueOnce(new Error("x"));
      initCalibrationScheduler();
      const [, callback] = cron.schedule.mock.calls[0] as [string, () => Promise<{ outcome: string }>];
      expect((await callback()).outcome).toBe("success");
      expect((await callback()).outcome).toBe("failure");
    });

    it("disabled is reported as disabled; an invalid expression is alerted", () => {
      process.env["CALIBRATION_SCHEDULER"] = "off";
      initCalibrationScheduler();
      expect(monitor["markDisabled"]).toHaveBeenCalledWith("calibration-scan", "disabled via CALIBRATION_SCHEDULER");
      process.env["CALIBRATION_SCHEDULER"] = "bad";
      cron.validate.mockReturnValue(false);
      initCalibrationScheduler();
      expect(monitor["refuseSchedule"]).toHaveBeenCalledWith("calibration-scan", "CALIBRATION_SCHEDULER", "bad");
    });
  });
});
