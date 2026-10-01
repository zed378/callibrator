jest.mock("../../models", () => ({
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
    destroy: jest.fn(),
  },
  Tenant: { findByPk: jest.fn() },
}));
// A-280 (ADR-094): a setting change and its audit rows share a transaction.
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("tx")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

const networkSecurity = require("../../services/networkSecurity.service");
const { TenantSettings, Tenant } = require("../../models");
const auditService = require("../../services/audit.service");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

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

    // A-280 (ADR-094)
    it("records the change, before and after, under PLATFORM and the tenant, in the upsert's transaction", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["192.168.1.0/24"]) });
      await networkSecurity.setTenantIpAllowlist("t1", ["10.0.0.0/8"], { userId: "op-1", ipAddress: "10.9.9.9", userAgent: "UA" });

      expect(TenantSettings.upsert.mock.calls[0][1]).toEqual({ transaction: "tx" });
      const calls = auditService.logAction.mock.calls;
      expect(calls.map(([e]) => e.tenantId)).toEqual([PLATFORM_TENANT_ID, "t1"]);
      for (const [entry, opts] of calls) {
        expect(opts).toEqual({ transaction: "tx" });
        expect(entry).toMatchObject({
          userId: "op-1",
          action: "UPDATE",
          resourceType: "TenantSettings",
          resourceId: "t1",
          ipAddress: "10.9.9.9",
          userAgent: "UA",
          changes: { operation: "SET_IP_ALLOWLIST", before: ["192.168.1.0/24"], after: ["10.0.0.0/8"] },
        });
      }
    });

    it("assertTenantExists: 404 for no id or an unknown tenant, passes for a real one", async () => {
      await expect(networkSecurity.assertTenantExists(undefined)).rejects.toMatchObject({ status: 404 });
      Tenant.findByPk.mockResolvedValueOnce(null);
      await expect(networkSecurity.assertTenantExists("t9")).rejects.toMatchObject({ status: 404, message: "Tenant not found" });
      Tenant.findByPk.mockResolvedValueOnce({ id: "t1" });
      await expect(networkSecurity.assertTenantExists("t1")).resolves.toBeUndefined();
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
      // A-280: recorded twice, with the operator (none given: null, fails closed).
      expect(auditService.logAction.mock.calls.map(([e]) => [e.tenantId, e.changes.operation, e.userId])).toEqual([
        [PLATFORM_TENANT_ID, "SET_GEOFENCE", null],
        ["t1", "SET_GEOFENCE", null],
      ]);
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

    // A-288 (ADR-100): the evaluation route and the sign-in share one matcher.
    it("matches an IPv4-mapped IPv6 address and an IPv6 range; a missing address matches nothing", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify(["10.0.0.0/8", "2001:db8::/32"]) });
      expect((await networkSecurity.checkIpAllowlist("t1", "::ffff:10.1.2.3")).allowed).toBe(true);
      expect((await networkSecurity.checkIpAllowlist("t1", "2001:db8::5")).allowed).toBe(true);
      expect((await networkSecurity.checkIpAllowlist("t1", undefined)).allowed).toBe(false);
    });
  });
});
