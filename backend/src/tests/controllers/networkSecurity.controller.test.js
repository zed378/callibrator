/**
 * Tests for networkSecurity controller
 */

jest.mock("../../services/networkSecurity.service", () => ({
  getTenantIpAllowlist: jest.fn(),
  setTenantIpAllowlist: jest.fn(),
  getTenantGeofence: jest.fn(),
  setTenantGeofence: jest.fn(),
  evaluateLoginSecurity: jest.fn(),
  assertTenantExists: jest.fn(),
}));

// The validator module is NOT mocked: every body goes through the real Zod
// schema, and a refusal is asserted with the errors it carries.

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const networkSecurityService = require("../../services/networkSecurity.service");
const networkSecurityController = require("../../controllers/networkSecurity.controller");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("networkSecurity Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      body: {},
      params: {},
      query: {},
      // The platform operator — the only caller of the PUTs before Q-38. A
      // tenant administrator's change and its self-lockout guard (ADR-100)
      // are signInPolicy.a288 and networkSecurity.selfService.q38.
      user: { id: "user-1", tenantId: VALID_TENANT_ID, role: { name: "SUPERADMIN", roleLevel: 10 } },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  // A-280 (ADR-094): the operator names the tenant in the path; it must exist.
  describe("the tenant named in the path", () => {
    const TARGET = "550e8400-e29b-41d4-a716-4466554400bb";

    it("reads and sets that tenant's allowlist and geofence, as the operator", async () => {
      req.params = { tenantId: TARGET };
      networkSecurityService.getTenantIpAllowlist.mockResolvedValue(["10.0.0.0/8"]);
      networkSecurityService.getTenantGeofence.mockResolvedValue(null);
      networkSecurityService.setTenantIpAllowlist.mockResolvedValue({});
      networkSecurityService.setTenantGeofence.mockResolvedValue({});

      await networkSecurityController.getTenantIpAllowlistFor(req, res, next);
      await networkSecurityController.getTenantGeofenceFor(req, res, next);
      req.body = { cidrs: ["10.0.0.0/8"] };
      await networkSecurityController.setTenantIpAllowlistFor(req, res, next);
      req.body = { latitude: "-6.2", longitude: "106.8" };
      await networkSecurityController.setTenantGeofenceFor(req, res, next);

      expect(networkSecurityService.assertTenantExists).toHaveBeenCalledTimes(4);
      expect(networkSecurityService.assertTenantExists).toHaveBeenCalledWith(TARGET);
      expect(networkSecurityService.getTenantIpAllowlist).toHaveBeenCalledWith(TARGET);
      expect(networkSecurityService.getTenantGeofence).toHaveBeenCalledWith(TARGET);
      expect(networkSecurityService.setTenantIpAllowlist).toHaveBeenCalledWith(TARGET, ["10.0.0.0/8"], expect.objectContaining({ userId: "user-1" }));
      expect(networkSecurityService.setTenantGeofence).toHaveBeenCalledWith(TARGET, { latitude: -6.2, longitude: 106.8 }, expect.objectContaining({ userId: "user-1" }));
    });

    it("a tenant that does not exist stops the write with its 404", async () => {
      req.params = { tenantId: TARGET };
      req.body = { cidrs: ["10.0.0.0/8"] };
      networkSecurityService.assertTenantExists.mockRejectedValueOnce({ status: 404, message: "Tenant not found" });
      await networkSecurityController.setTenantIpAllowlistFor(req, res, next);
      expect(networkSecurityService.setTenantIpAllowlist).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
    });
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

      expect(networkSecurityService.setTenantIpAllowlist).toHaveBeenCalledWith(VALID_TENANT_ID, ["192.168.1.0/24", "10.0.0.0/8"], expect.objectContaining({ userId: "user-1" }));
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      req.body = { cidrs: "invalid" };

      await networkSecurityController.setIpAllowlist(req, res, next);

      expect(networkSecurityService.setTenantIpAllowlist).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "cidrs", message: "Invalid input: expected array, received string" }],
      });
    });

    it("refuses an entry that is not an IPv4 address or CIDR", async () => {
      req.body = { cidrs: ["10.0.0.0/8", "example.com"] };

      await networkSecurityController.setIpAllowlist(req, res, next);

      expect(networkSecurityService.setTenantIpAllowlist).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "cidrs.1", message: "Expected an IPv4 or IPv6 address or CIDR" }],
      });
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

      expect(networkSecurityService.setTenantGeofence).toHaveBeenCalledWith(VALID_TENANT_ID, { latitude: -6.2, longitude: 106.8, radiusKm: 30 }, expect.objectContaining({ userId: "user-1" }));
      expect(success).toHaveBeenCalled();
    });

    it("should use default radius when not provided", async () => {
      req.body = { latitude: "-6.2", longitude: "106.8" };
      networkSecurityService.setTenantGeofence.mockResolvedValue({ tenantId: VALID_TENANT_ID });

      await networkSecurityController.setGeofence(req, res, next);

      // Numeric strings are converted; radiusKm stays absent for the service to default.
      expect(networkSecurityService.setTenantGeofence).toHaveBeenCalledWith(VALID_TENANT_ID, { latitude: -6.2, longitude: 106.8 }, expect.objectContaining({ userId: "user-1" }));
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      req.body = { latitude: "invalid" };

      await networkSecurityController.setGeofence(req, res, next);

      expect(networkSecurityService.setTenantGeofence).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [
          { field: "latitude", message: "Invalid input: expected number, received string" },
          { field: "longitude", message: "Invalid input: expected number, received undefined" },
        ],
      });
    });
  });

  describe("evaluateLogin", () => {
    it("should evaluate login security", async () => {
      req.body = { ip: "192.168.1.100", latitude: -6.2, longitude: 106.8 };
      networkSecurityService.evaluateLoginSecurity.mockResolvedValue({ allowed: true, ip: { allowed: true }, geofence: { allowed: true } });

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(networkSecurityService.evaluateLoginSecurity).toHaveBeenCalledWith(VALID_TENANT_ID, "192.168.1.100", -6.2, 106.8);
      expect(success).toHaveBeenCalled();
    });

    it("should return requiresStepUp when not allowed", async () => {
      req.body = { ip: "10.0.0.1", latitude: -6.2, longitude: 106.8 };
      networkSecurityService.evaluateLoginSecurity.mockResolvedValue({ allowed: false, requiresStepUp: true });

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(networkSecurityService.evaluateLoginSecurity).toHaveBeenCalledWith(VALID_TENANT_ID, "10.0.0.1", -6.2, 106.8);
      expect(success).toHaveBeenCalledWith(res, { allowed: false, requiresStepUp: true }, null, "Login security evaluated");
    });

    it("should return 400 on validation failure", async () => {
      req.body = { ip: "not-an-ip" };

      await networkSecurityController.evaluateLogin(req, res, next);

      expect(networkSecurityService.evaluateLoginSecurity).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "ip", message: "Invalid IP address" }],
      });
    });
  });
});
