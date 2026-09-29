/**
 * Q-02 (ADR-084) — the pieces of the retired-is-terminal rule that the route
 * test (routes/calibrationDevices.reinstate.q02.test.js) does not reach:
 *  - recognising migration 0089's trigger error, so the race where a device is
 *    retired between the edit's read and its write is a 409, not a 500;
 *  - any other database error on that write still propagates;
 *  - which edits count as leaving retirement.
 */

const mockDevice = {};
const mockTransaction = jest.fn(async (work) => work({ id: "tx" }));

jest.mock("../../models", () => ({
  CalibrationDevice: { findOne: jest.fn(async () => mockDevice.current) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockTransaction(...args), query: jest.fn() },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const retirement = require("../../services/calibrationDeviceReinstate.service");
const devices = require("../../services/calibrationDevices.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE = "d0000000-0000-4000-8000-00000000000a";

/** The error Sequelize raises for the 0089 trigger's RAISE ... ERRCODE 23514. */
const triggerError = () =>
  Object.assign(new Error("check violation"), {
    name: "SequelizeDatabaseError",
    parent: {
      code: "23514",
      message: `calibration device ${DEVICE} is retired, and retirement is terminal (ADR-084); only an audited reinstatement may change its status`,
    },
  });

describe("Q-02 (ADR-084): retired is terminal", () => {
  describe("isRetirementTerminalViolation", () => {
    it("recognises the 0089 trigger's refusal", () => {
      expect(retirement.isRetirementTerminalViolation(triggerError())).toBe(true);
    });

    it.each([
      ["no error", null],
      ["an error with no driver error", new Error("x")],
      ["another check violation", { parent: { code: "23514", message: "violates check constraint x" } }],
      ["a check violation with no message", { parent: { code: "23514" } }],
      ["another SQLSTATE with the same words", { parent: { code: "23505", message: "retirement is terminal" } }],
    ])("does not mistake %s for it", (_label, error) => {
      expect(retirement.isRetirementTerminalViolation(error)).toBe(false);
    });
  });

  describe("leavesRetirement", () => {
    it.each([
      ["retired → active", "retired", { status: "active" }, true],
      ["RETIRED → Maintenance (any case)", "RETIRED", { status: "Maintenance" }, true],
      ["retired → retired", "retired", { status: "retired" }, false],
      ["retired, status not in the edit", "retired", { remarks: "x" }, false],
      ["retired, status null in the edit", "retired", { status: null }, false],
      ["active → retired (retiring is allowed)", "active", { status: "retired" }, false],
      ["no stored status", undefined, { status: "active" }, false],
    ])("%s", (_label, stored, changes, expected) => {
      expect(retirement.leavesRetirement({ status: stored }, changes)).toBe(expected);
    });
  });

  describe("updateCalibrationDevice, when the device is retired concurrently", () => {
    beforeEach(() => {
      mockDevice.current = {
        id: DEVICE,
        name: "Infusion pump",
        serialNumber: null,
        status: "active",
        update: jest.fn(),
      };
    });

    it("maps the trigger's refusal to the same 409 as the check before it", async () => {
      mockDevice.current.update.mockRejectedValue(triggerError());

      const result = await devices.updateCalibrationDevice(TENANT, DEVICE, { status: "maintenance" }, {});

      expect(result).toEqual(retirement.retirementConflict(mockDevice.current));
      expect(result.status).toBe(409);
    });

    it("lets any other database error through", async () => {
      const other = Object.assign(new Error("connection lost"), { parent: { code: "08006" } });
      mockDevice.current.update.mockRejectedValue(other);

      await expect(devices.updateCalibrationDevice(TENANT, DEVICE, { status: "maintenance" }, {})).rejects.toBe(other);
    });
  });

  describe("reinstate", () => {
    it("treats a missing body as no reason (400), not a crash", async () => {
      const result = await retirement.reinstate(TENANT, DEVICE, undefined, {});

      expect(result.status).toBe(400);
      expect(result.errors.map((e) => e.field).sort()).toEqual(["reason", "status"]);
    });

    it("names a status the device has not got as not retired, even when it is absent", async () => {
      mockDevice.current = { id: DEVICE, name: "Infusion pump", status: undefined };

      const result = await retirement.reinstate(TENANT, DEVICE, { reason: "Retired in error at stock take", status: "active" });

      expect(result.status).toBe(409);
    });

    it("with no actor given, passes nulls on (audit.service is what refuses an actor-less row)", async () => {
      const auditService = require("../../services/audit.service");
      const { db } = require("../../config");
      mockDevice.current = { id: DEVICE, name: "Infusion pump", status: "retired", update: jest.fn() };

      const result = await retirement.reinstate(TENANT, DEVICE, { reason: "Retired in error at stock take", status: "ACTIVE" });

      expect(result.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith("SELECT set_config(:setting, :deviceId, true)", expect.any(Object));
      expect(mockDevice.current.update).toHaveBeenCalledWith({ status: "active" }, { transaction: { id: "tx" } });
      expect(auditService.logAction.mock.calls[0][0]).toMatchObject({ userId: null, ipAddress: null, userAgent: null });
    });
  });
});
