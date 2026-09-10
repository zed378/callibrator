/**
 * Tests for networkSecurity controller
 */

jest.mock("../../services/networkSecurity.service", () => ({
  getTenantIpAllowlist: jest.fn(),
  setTenantIpAllowlist: jest.fn(),
  getTenantGeofence: jest.fn(),
  setTenantGeofence: jest.fn(),
  evaluateLoginSecurity: jest.fn(),
}));

jest.mock("../../validators/networkSecurity.validator", () => ({
  validate: jest.fn((data, schema) => { return { ...data }; }),
  ipAllowlistSchema: {},
  geofenceSchema: {},
  evaluateLoginSchema: {},
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const networkSecurityService = require("../../services/networkSecurity.service");
const networkSecurityController = require("../../controllers/networkSecurity.controller");
const { validate, ipAllowlistSchema, geofenceSchema, evaluateLoginSchema } = require("../../validators/networkSecurity.validator");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("networkSecurity Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    validate.mockImplementation((data, schema) => { return { ...data }; });
    req = {
      body: {},
      params: {},
      query: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getIpAllowlist", () => {
    it("should return the IP allowlist for the tenant", async () => {
      networkSecurityService.getTenantIpAllowlist.mockResolvedValue(["192.168.1.0/24"]);

      await networkSecurityController.getIpAllowlist(req, res, next);

      expect(networkSecurityService.getTenantIpAllowlist).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("setIpAllowlist", () => {
    it("should update the IP allowlist", async () => {
      req.body = { cidrs: ["192.168.1.0/24", "10.0.0.0/8"] };
      networkSecurityService.setTenantIpAllowlist.mockResolvedValue({ tenantId: VALID_TENANT_ID, allowlist: ["192.168.1.0/24", "10.0.0.0/8"] });

      await networkSecurityController.setIpAllowlist(req, res, next);

      expect(validate).toHaveBeenCalledWith(req.body, ipAllowlistSchema);
      expect(networkSecurityService.setTenantIpAllowlist).toHaveBeenCalledWith(VALID_TENANT_ID, ["192.168.1.0/24", "10.0.0.0/8"]);
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      validate.mockImplementation((data, schema) => {
        throw { status: 400, message: "Validation failed", errors: { cidrs: "Required" } };
      });
      req.body = { cidrs: "invalid" };

      await networkSecurityController.setIpAllowlist(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("getGeofence", () => {
    it("should return the geofence for the tenant", async () => {
      networkSecurityService.getTenantGeofence.mockResolvedValue({ latitude: -6.2, longitude: 106.8, radiusKm: 50 });

      await networkSecurityController.getGeofence(req, res, next);

      expect(networkSecurityService.getTenantGeofence).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return null geofence when not set", async () => {
      networkSecurityService.getTenantGeofence.mockResolvedValue(null);

      await networkSecurityController.getGeofence(req, res, next);

      expect(success).toHaveBeenCalled();
    });
  });

  describe("setGeofence", () => {
    it("should update the geofence", async () => {
      req.body = { latitude: -6.2, longitude: 106.8, radiusKm: 30 };
      networkSecurityService.setTenantGeofence.mockResolvedValue({ tenantId: VALID_TENANT_ID, geofence: { latitude: -6.2, longitude: 106.8, radiusKm: 30 } });

      await networkSecurityController.setGeofence(req, res, next);

      expect(validate).toHaveBeenCalledWith(req.body, geofenceSchema);
      expect(networkSecurityService.setTenantGeofence).toHaveBeenCalledWith(VALID_TENANT_ID, { latitude: -6.2, longitude: 106.8, radiusKm: 30 });
      expect(success).toHaveBeenCalled();
    });

    it("should use default radius when not provided", async () => {
      req.body = { latitude: -6.2, longitude: 106.8 };
      validate.mockImplementation((data, schema) => { return { latitude: -6.2, longitude: 106.8 }; });
      networkSecurityService.setTenantGeofence.mockResolvedValue({ tenantId: VALID_TENANT_ID });

      await networkSecurityController.setGeofence(req, res, next);

      expect(networkSecurityService.setTenantGeofence).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      validate.mockImplementation((data, schema) => {
        throw { status: 400, message: "Validation failed", errors: { latitude: "Required" } };
      });
      req.body = { latitude: "invalid" };

      await networkSecurityController.setGeofence(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("evaluateLogin", () => {
    it("should evaluate login security", async () => {
      req.body = { ip: "192.168.1.100", latitude: -6.2, longitude: 106.8 };
      networkSecurityService.evaluateLoginSecurity.mockResolvedValue({ allowed: true, ip: { allowed: true }, geofence: { allowed: true } });

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(validate).toHaveBeenCalledWith(req.body, evaluateLoginSchema);
      expect(networkSecurityService.evaluateLoginSecurity).toHaveBeenCalledWith(VALID_TENANT_ID, "192.168.1.100", -6.2, 106.8);
      expect(success).toHaveBeenCalled();
    });

    it("should return requiresStepUp when not allowed", async () => {
      req.body = { ip: "10.0.0.1", latitude: -6.2, longitude: 106.8 };
      validate.mockImplementation((data, schema) => { return { ip: "10.0.0.1", latitude: -6.2, longitude: 106.8 }; });
      networkSecurityService.evaluateLoginSecurity.mockResolvedValue({ allowed: false, requiresStepUp: true });

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      validate.mockImplementation((data, schema) => {
        throw { status: 400, message: "Validation failed", errors: { ip: "Invalid" } };
      });
      req.body = { ip: "not-an-ip" };

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });
});
