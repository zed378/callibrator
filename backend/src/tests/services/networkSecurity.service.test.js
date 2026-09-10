jest.mock("../../models", () => ({
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
    destroy: jest.fn(),
  },
}));

const networkSecurity = require("../../services/networkSecurity.service");
const { TenantSettings } = require("../../models");

describe("networkSecurity.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("IP Allowlist", () => {
    it("returns empty allowlist when no setting exists", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const result = await networkSecurity.getTenantIpAllowlist("t1");
      expect(result).toEqual([]);
    });

    it("returns stored allowlist", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["192.168.1.0/24"]) });
      const result = await networkSecurity.getTenantIpAllowlist("t1");
      expect(result).toEqual(["192.168.1.0/24"]);
    });

    it("sets allowlist", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      const result = await networkSecurity.setTenantIpAllowlist("t1", ["10.0.0.0/8"]);
      expect(result.allowlist).toEqual(["10.0.0.0/8"]);
    });

    it("allows IP when no restrictions", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const result = await networkSecurity.checkIpAllowlist("t1", "1.2.3.4");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("no_restrictions");
    });

    it("allows IP in allowlist", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["192.168.1.0/24"]) });
      const result = await networkSecurity.checkIpAllowlist("t1", "192.168.1.5");
      expect(result.allowed).toBe(true);
    });

    it("blocks IP outside allowlist", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["192.168.1.0/24"]) });
      const result = await networkSecurity.checkIpAllowlist("t1", "10.0.0.1");
      expect(result.allowed).toBe(false);
    });
  });

  describe("Geofence", () => {
    it("returns null when no geofence set", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const result = await networkSecurity.getTenantGeofence("t1");
      expect(result).toBeNull();
    });

    it("sets geofence", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      const result = await networkSecurity.setTenantGeofence("t1", { latitude: -6.2088, longitude: 106.8456 });
      expect(result.geofence.latitude).toBe(-6.2088);
      expect(result.geofence.radiusKm).toBe(50);
    });

    it("allows location within geofence", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ latitude: -6.2088, longitude: 106.8456, radiusKm: 50 }) });
      const result = await networkSecurity.checkGeofence("t1", -6.2088, 106.8456);
      expect(result.allowed).toBe(true);
    });

    it("blocks location outside geofence", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ latitude: -6.2088, longitude: 106.8456, radiusKm: 1 }) });
      const result = await networkSecurity.checkGeofence("t1", -6.22, 106.86);
      expect(result.allowed).toBe(false);
    });
  });

  describe("evaluateLoginSecurity", () => {
    it("allows when both checks pass", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const result = await networkSecurity.evaluateLoginSecurity("t1", "192.168.1.5", -6.2088, 106.8456);
      expect(result.allowed).toBe(true);
      expect(result.requiresStepUp).toBe(false);
    });

    it("requires step-up when IP blocked", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["192.168.1.0/24"]) });
      const result = await networkSecurity.evaluateLoginSecurity("t1", "10.0.0.1", -6.2088, 106.8456);
      expect(result.allowed).toBe(false);
      expect(result.requiresStepUp).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Corrupt/undecodable stored settings must degrade safely rather than
  // throw — these are the JSON.parse and CIDR-parse catch branches.
  // ------------------------------------------------------------------
  describe("malformed stored data", () => {
    it("returns an empty allowlist when the stored value is not JSON", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "}{not json" });

      await expect(networkSecurity.getTenantIpAllowlist("t1")).resolves.toEqual(
        [],
      );
    });

    it("returns a null geofence when the stored value is not JSON", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "}{not json" });

      await expect(networkSecurity.getTenantGeofence("t1")).resolves.toBeNull();
    });

    it("returns an empty allowlist when the stored value is empty", async () => {
      // Exercises the `setting.value || "[]"` fallback (row exists, value null).
      TenantSettings.findOne.mockResolvedValue({ value: null });

      await expect(networkSecurity.getTenantIpAllowlist("t1")).resolves.toEqual(
        [],
      );
    });

    it("returns a null geofence when the stored value is empty", async () => {
      // Exercises the `setting.value || "null"` fallback.
      TenantSettings.findOne.mockResolvedValue({ value: null });

      await expect(networkSecurity.getTenantGeofence("t1")).resolves.toBeNull();
    });

    it("treats an unparseable CIDR as not matching rather than throwing", async () => {
      TenantSettings.findOne.mockResolvedValue({
        value: JSON.stringify(["not-a-cidr"]),
      });

      const result = await networkSecurity.checkIpAllowlist("t1", "10.0.0.1");

      // isInCidr swallows the parse error and returns false.
      expect(result.allowed).toBe(false);
    });

    it("treats a malformed IP as not matching rather than throwing", async () => {
      TenantSettings.findOne.mockResolvedValue({
        value: JSON.stringify(["10.0.0.0/8"]),
      });

      const result = await networkSecurity.checkIpAllowlist("t1", "not.an.ip");

      expect(result.allowed).toBe(false);
    });
  });
});
