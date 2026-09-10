/**
 * Tests for calibration scheduler controller
 */

jest.mock("../../services/calibrationScheduler.service", () => ({
  runCalibrationScan: jest.fn(),
  getDueDevices: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../constants/roleConstants", () => ({
  ROLE_NAMES: {
    SUPER_ADMIN: "SUPERADMIN",
  },
}));

const calibrationSchedulerService = require("../../services/calibrationScheduler.service");
const calibrationSchedulerController = require("../../controllers/calibrationScheduler.controller");
const { success } = require("../../utils/response.util");

describe("calibrationScheduler Controller", () => {
  let req, res, next;
  const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
        role: { name: "USER" },
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("runScan", () => {
    it("should run calibration scan for tenant user", async () => {
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({
        scanned: 5,
        overdue: 2,
      });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: undefined,
      });
      expect(success).toHaveBeenCalled();
    });

    it("should run scan with leadDays from body", async () => {
      req.body.leadDays = "7";
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({
        scanned: 3,
        overdue: 1,
      });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: 7,
      });
    });

    it("should allow super admin to scan all tenants", async () => {
      req.user.role.name = "SUPERADMIN";
      req.query.allTenants = "true";
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({
        scanned: 10,
        overdue: 4,
      });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: null,
        leadDays: undefined,
      });
    });

    it("should allow super admin to target specific tenant via body only (no allTenants)", async () => {
      req.user.role.name = "SUPERADMIN";
      req.body.tenantId = "550e8400-e29b-41d4-a716-446655440099";
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({
        scanned: 1,
        overdue: 0,
      });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: "550e8400-e29b-41d4-a716-446655440099",
        leadDays: undefined,
      });
    });
  });

  describe("listDue", () => {
    it("should return due devices for tenant user", async () => {
      calibrationSchedulerService.getDueDevices.mockResolvedValue([
        { id: "dev-1", name: "Device A" },
      ]);

      await calibrationSchedulerController.listDue(req, res, next);

      expect(calibrationSchedulerService.getDueDevices).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: undefined,
      });
      expect(success).toHaveBeenCalled();
    });

    it("should filter by leadDays from query", async () => {
      req.query.leadDays = "30";
      calibrationSchedulerService.getDueDevices.mockResolvedValue([]);

      await calibrationSchedulerController.listDue(req, res, next);

      expect(calibrationSchedulerService.getDueDevices).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: 30,
      });
    });

    it("should allow super admin to list due for all tenants", async () => {
      req.user.role.name = "SUPERADMIN";
      req.query.allTenants = "true";
      calibrationSchedulerService.getDueDevices.mockResolvedValue([]);

      await calibrationSchedulerController.listDue(req, res, next);

      expect(calibrationSchedulerService.getDueDevices).toHaveBeenCalledWith({
        tenantId: null,
        leadDays: undefined,
      });
    });

    it("should allow super admin to target specific tenant via body only (no allTenants)", async () => {
      req.user.role.name = "SUPERADMIN";
      req.body.tenantId = "550e8400-e29b-41d4-a716-446655440099";
      calibrationSchedulerService.getDueDevices.mockResolvedValue([]);

      await calibrationSchedulerController.listDue(req, res, next);

      expect(calibrationSchedulerService.getDueDevices).toHaveBeenCalledWith({
        tenantId: "550e8400-e29b-41d4-a716-446655440099",
        leadDays: undefined,
      });
    });
  });

  // parseLeadDays coerces the raw value with Number() and drops anything
  // non-finite back to undefined so the service applies its own default.
  describe("parseLeadDays", () => {
    it("coerces a numeric leadDays string from the body", async () => {
      req.body.leadDays = "30";
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({ scanned: 0 });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: 30,
      });
    });

    it("drops a non-numeric leadDays to undefined", async () => {
      req.query.leadDays = "soon";
      calibrationSchedulerService.getDueDevices.mockResolvedValue([]);

      await calibrationSchedulerController.listDue(req, res, next);

      expect(calibrationSchedulerService.getDueDevices).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: undefined,
      });
    });

    it("treats a missing body as no leadDays on runScan", async () => {
      req.body = undefined;
      calibrationSchedulerService.runCalibrationScan.mockResolvedValue({ scanned: 0 });

      await calibrationSchedulerController.runScan(req, res, next);

      expect(calibrationSchedulerService.runCalibrationScan).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        leadDays: undefined,
      });
    });
  });
});
