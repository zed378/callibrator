// eslint-disable-next-line no-undef
jest.mock("../../models", () => {
  const mockTenant = {
    findByPk: jest.fn(),
  };
  const mockUser = {
    count: jest.fn(),
  };
  const mockAttachment = {
    sum: jest.fn(),
  };
  return {
    Tenant: mockTenant,
    User: mockUser,
    Attachment: mockAttachment,
  };
});

const {
  PLAN_FEATURES,
  PLAN_ORDER,
  getSeatUsage,
  checkSeatQuota,
  getStorageUsageMb,
  checkStorageQuota,
  planHasFeature,
  checkFeature,
  getUsageSummary,
} = require("../../services/quota.service");

describe("quota.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("PLAN_FEATURES", () => {
    it("should have correct features for free plan", () => {
      expect(PLAN_FEATURES.free).toEqual(["core"]);
    });

    it("should have correct features for professional plan", () => {
      expect(PLAN_FEATURES.professional).toEqual([
        "core",
        "reports",
        "webhooks",
      ]);
    });

    it("should have correct features for business plan", () => {
      expect(PLAN_FEATURES.business).toEqual([
        "core",
        "reports",
        "webhooks",
        "api_keys",
        "sso",
        "search",
      ]);
    });

    it("should have correct features for enterprise plan", () => {
      expect(PLAN_FEATURES.enterprise).toEqual([
        "core",
        "reports",
        "webhooks",
        "api_keys",
        "sso",
        "search",
        "audit_export",
        "custom_branding",
      ]);
    });
  });

  describe("PLAN_ORDER", () => {
    it("should have correct plan order", () => {
      expect(PLAN_ORDER).toEqual([
        "free",
        "professional",
        "business",
        "enterprise",
      ]);
    });
  });

  describe("getSeatUsage", () => {
    it("should count users for tenant", async () => {
      const { User } = require("../../models");
      User.count.mockResolvedValue(10);

      const result = await getSeatUsage("tenant-1");

      expect(User.count).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1" },
      });
      expect(result).toBe(10);
    });
  });

  describe("checkSeatQuota", () => {
    it("should return unlimited when tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      const result = await checkSeatQuota("nonexistent");

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(0);
      expect(result.unlimited).toBe(true);
    });

    it("should return unlimited when limit is null", async () => {
      const { Tenant } = require("../../models");
      const { User } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitSeats: null });
      User.count.mockResolvedValue(5);

      const result = await checkSeatQuota("tenant-1");

      expect(result.unlimited).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(5);
    });

    it("should return unlimited when limit is negative", async () => {
      const { Tenant } = require("../../models");
      const { User } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitSeats: -1 });
      User.count.mockResolvedValue(5);

      const result = await checkSeatQuota("tenant-1");

      expect(result.unlimited).toBe(true);
    });

    it("should return allowed true when under limit", async () => {
      const { Tenant } = require("../../models");
      const { User } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitSeats: 20 });
      User.count.mockResolvedValue(10);

      const result = await checkSeatQuota("tenant-1");

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
      expect(result.used).toBe(10);
      expect(result.unlimited).toBe(false);
    });

    it("should return allowed false when at limit", async () => {
      const { Tenant } = require("../../models");
      const { User } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitSeats: 10 });
      User.count.mockResolvedValue(10);

      const result = await checkSeatQuota("tenant-1");

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.used).toBe(10);
    });
  });

  describe("getStorageUsageMb", () => {
    it("should return 0 when Attachment not available", async () => {
      const { Attachment } = require("../../models");
      Attachment.sum.mockResolvedValue(null);

      const result = await getStorageUsageMb("tenant-1");

      expect(result).toBe(0);
    });

    it("should return 0 when tenantId not provided", async () => {
      const result = await getStorageUsageMb(null);

      expect(result).toBe(0);
    });

    it("should convert bytes to MB", async () => {
      const { Attachment } = require("../../models");
      Attachment.sum.mockResolvedValue(1048576); // 1 MB in bytes

      const result = await getStorageUsageMb("tenant-1");

      expect(result).toBe(1);
    });
  });

  describe("checkStorageQuota", () => {
    it("should return unlimited when tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      const result = await checkStorageQuota("nonexistent");

      expect(result.allowed).toBe(true);
      expect(result.unlimited).toBe(true);
    });

    it("should return unlimited when limit is null", async () => {
      const { Tenant } = require("../../models");
      const { Attachment } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitStorageMb: null });
      Attachment.sum.mockResolvedValue(0);

      const result = await checkStorageQuota("tenant-1");

      expect(result.unlimited).toBe(true);
      expect(result.allowed).toBe(true);
    });

    it("should return allowed true when under limit", async () => {
      const { Tenant } = require("../../models");
      const { Attachment } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitStorageMb: 100 });
      Attachment.sum.mockResolvedValue(5242880); // 5 MB

      const result = await checkStorageQuota("tenant-1");

      expect(result.allowed).toBe(true);
      expect(result.limitMb).toBe(100);
      expect(result.usedMb).toBe(5);
    });

    it("should include incoming bytes in calculation", async () => {
      const { Tenant } = require("../../models");
      const { Attachment } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ limitStorageMb: 10 });
      Attachment.sum.mockResolvedValue(8388608); // 8 MB
      // incoming: 3 MB = 3145728 bytes
      const result = await checkStorageQuota("tenant-1", 3145728);

      expect(result.allowed).toBe(false);
      expect(result.incomingMb).toBe(3);
    });
  });

  describe("planHasFeature", () => {
    it("should return true for core feature in any plan", () => {
      expect(planHasFeature("free", "core")).toBe(true);
      expect(planHasFeature("enterprise", "core")).toBe(true);
    });

    it("should return true for professional features in higher plans", () => {
      expect(planHasFeature("professional", "reports")).toBe(true);
      expect(planHasFeature("business", "reports")).toBe(true);
      expect(planHasFeature("enterprise", "reports")).toBe(true);
    });

    it("should return false for feature not in plan", () => {
      expect(planHasFeature("free", "reports")).toBe(false);
      expect(planHasFeature("free", "sso")).toBe(false);
    });

    it("should default to free for unknown plan", () => {
      expect(planHasFeature("unknown_plan", "core")).toBe(true);
      expect(planHasFeature("unknown_plan", "reports")).toBe(false);
    });
  });

  describe("checkFeature", () => {
    it("should return allowed true for feature in plan", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ plan: "professional" });

      const result = await checkFeature("tenant-1", "reports");

      expect(result.allowed).toBe(true);
      expect(result.plan).toBe("professional");
      expect(result.feature).toBe("reports");
    });

    it("should return allowed false for feature not in plan", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ plan: "free" });

      const result = await checkFeature("tenant-1", "sso");

      expect(result.allowed).toBe(false);
      expect(result.plan).toBe("free");
    });

    it("should default to free when tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      const result = await checkFeature("nonexistent", "core");

      expect(result.allowed).toBe(true);
      expect(result.plan).toBe("free");
    });
  });

  describe("getUsageSummary", () => {
    it("should return null when tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getUsageSummary("nonexistent");

      expect(result).toBe(null);
    });

    it("should return null without querying when no tenantId is given", async () => {
      const { Tenant } = require("../../models");

      const result = await getUsageSummary(undefined);

      // getTenant short-circuits on a falsy id rather than hitting the DB.
      expect(result).toBe(null);
      expect(Tenant.findByPk).not.toHaveBeenCalled();
    });

    it("should fall back to the free feature set for an unknown plan", async () => {
      const { Tenant, User, Attachment } = require("../../models");
      Tenant.findByPk.mockResolvedValue({
        plan: "legacy-unknown",
        status: "active",
        limitSeats: 1,
        limitStorageMb: 1,
      });
      User.count.mockResolvedValue(0);
      Attachment.sum.mockResolvedValue(0);

      const result = await getUsageSummary("tenant-1");

      // PLAN_FEATURES[plan] is undefined -> falls back to PLAN_FEATURES.free
      expect(Array.isArray(result.features)).toBe(true);
      expect(result.plan).toBe("legacy-unknown");
    });

    it("should return usage summary with all fields", async () => {
      const { Tenant } = require("../../models");
      const { User } = require("../../models");
      const { Attachment } = require("../../models");

      Tenant.findByPk.mockResolvedValue({
        plan: "professional",
        status: "active",
        limitSeats: 20,
        limitStorageMb: 100,
      });
      User.count.mockResolvedValue(5);
      Attachment.sum.mockResolvedValue(5242880); // 5 MB

      const result = await getUsageSummary("tenant-1");

      expect(result.plan).toBe("professional");
      expect(result.status).toBe("active");
      expect(result.features).toContain("reports");
      expect(result.seats.used).toBe(5);
      expect(result.seats.limit).toBe(20);
      expect(result.storage.limitMb).toBe(100);
    });
  });
});
