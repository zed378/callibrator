/**
 * A pass-through stand-in for services/jobMonitor.service in the scheduler
 * middleware tests (P7-02). It runs the job exactly as the real runMonitored
 * does — a throw or an `isFailure` reason is a failed run — but records
 * nothing to disk and raises no alerts, so each middleware test stays about
 * its own scheduler. The real monitor is tested in
 * tests/services/jobMonitor.service.test.js.
 *
 * Usage:
 *   jest.mock("../../services/jobMonitor.service", () =>
 *     require("../fixtures/jobMonitorMock").create());
 */
const create = () => ({
  runMonitored: jest.fn(async (name, fn, options = {}) => {
    try {
      const result = await fn();
      const reason = options.isFailure ? options.isFailure(result) : null;
      return reason
        ? { outcome: "failure", result, error: reason }
        : { outcome: "success", result };
    } catch (err) {
      return { outcome: "failure", error: err.message };
    }
  }),
  registerJob: jest.fn(),
  markDisabled: jest.fn(),
  refuseSchedule: jest.fn(() => Promise.resolve()),
});

module.exports = { create };
