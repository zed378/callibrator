const { Op } = require("sequelize");

jest.mock("../../models", () => ({
  Tenant: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
    destroy: jest.fn(),
  },
  User: { destroy: jest.fn(), findAll: jest.fn() },
  Subscription: { destroy: jest.fn(), findAll: jest.fn() },
  Invoice: { destroy: jest.fn(), findAll: jest.fn() },
}));

const tenantLifecycle = require("../../services/tenantLifecycle.service");
const { Tenant, TenantSettings, User, Subscription, Invoice } = require("../../models");

describe("tenantLifecycle.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("suspendTenant", () => {
    it("suspends an active tenant", async () => {
      const mockSave = jest.fn();
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
        save: mockSave,
      });
      TenantSettings.upsert.mockResolvedValue({});

      const result = await tenantLifecycle.suspendTenant("t1", "non-payment", "user-1");

      expect(result.status).toBe("suspended");
      expect(result.suspensionReason).toBe("non-payment");
      expect(mockSave).toHaveBeenCalled();
    });

    it("returns tenant immediately if already suspended", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "suspended",
      });

      const result = await tenantLifecycle.suspendTenant("t1", "non-payment", "user-1");
      expect(result.status).toBe("suspended");
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.suspendTenant("t1", "reason")).rejects.toThrow("Tenant not found");
    });
  });

  describe("resumeTenant", () => {
    it("resumes a suspended tenant", async () => {
      const mockSave = jest.fn();
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "suspended",
        save: mockSave,
      });
      TenantSettings.upsert.mockResolvedValue({});

      const result = await tenantLifecycle.resumeTenant("t1", "user-1");

      expect(result.status).toBe("active");
      expect(mockSave).toHaveBeenCalled();
    });

    it("returns tenant immediately if already active", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
      });

      const result = await tenantLifecycle.resumeTenant("t1", "user-1");
      expect(result.status).toBe("active");
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.resumeTenant("t1")).rejects.toThrow("Tenant not found");
    });
  });

  describe("enterGracePeriod", () => {
    it("enters grace period and stamps expiration", async () => {
      const mockSave = jest.fn();
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        save: mockSave,
      });

      const result = await tenantLifecycle.enterGracePeriod("t1");
      expect(result.gracePeriodExpiresAt).toBeDefined();
      expect(mockSave).toHaveBeenCalled();
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.enterGracePeriod("t1")).rejects.toThrow("Tenant not found");
    });
  });

  describe("checkGracePeriodExpired", () => {
    it("returns false if tenant not found or expiresAt is missing", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      expect(await tenantLifecycle.checkGracePeriodExpired("t1")).toBe(false);

      Tenant.findByPk.mockResolvedValue({ id: "t1" });
      expect(await tenantLifecycle.checkGracePeriodExpired("t1")).toBe(false);
    });

    it("returns true/false based on current date", async () => {
      Tenant.findByPk.mockResolvedValueOnce({
        id: "t1",
        gracePeriodExpiresAt: new Date(Date.now() - 10000),
      });
      expect(await tenantLifecycle.checkGracePeriodExpired("t1")).toBe(true);

      Tenant.findByPk.mockResolvedValueOnce({
        id: "t1",
        gracePeriodExpiresAt: new Date(Date.now() + 10000),
      });
      expect(await tenantLifecycle.checkGracePeriodExpired("t1")).toBe(false);
    });
  });

  describe("offboardTenant", () => {
    it("marks tenant as offboarded with retention expiry", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "suspended",
        save: jest.fn(),
        toJSON: () => ({ id: "t1", status: "suspended" }),
      });
      TenantSettings.upsert.mockResolvedValue({});
      User.findAll.mockResolvedValue([]);
      Subscription.findAll.mockResolvedValue([]);
      Invoice.findAll.mockResolvedValue([]);
      TenantSettings.findAll.mockResolvedValue([]);

      const result = await tenantLifecycle.offboardTenant("t1");

      expect(result.tenant.status).toBe("deleted");
      expect(result.tenant.offboardRetentionExpiresAt).toBeDefined();
    });

    it("returns immediately if already offboarded and force is false", async () => {
      const mockTenant = {
        id: "t1",
        status: "deleted",
      };
      Tenant.findByPk.mockResolvedValue(mockTenant);

      const result = await tenantLifecycle.offboardTenant("t1", false);
      expect(result).toBe(mockTenant);
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.offboardTenant("t1")).rejects.toThrow("Tenant not found");
    });
  });

  describe("cancelOffboarding", () => {
    it("cancels offboarding and resets active state", async () => {
      const mockSave = jest.fn();
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "deleted",
        save: mockSave,
      });

      const result = await tenantLifecycle.cancelOffboarding("t1");
      expect(result.status).toBe("active");
      expect(result.offboardedAt).toBeNull();
      expect(mockSave).toHaveBeenCalled();
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.cancelOffboarding("t1")).rejects.toThrow("Tenant not found");
    });

    it("throws 400 if tenant is not currently offboarded", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
      });
      await expect(tenantLifecycle.cancelOffboarding("t1")).rejects.toThrow("Tenant is not offboarded");
    });
  });

  describe("hardDeleteOffboardedTenant", () => {
    it("hard-deletes tenant and related data after retention", async () => {
      const mockDestroy = jest.fn();
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "deleted",
        offboardRetentionExpiresAt: new Date(Date.now() - 86400000),
        destroy: mockDestroy,
      });
      User.destroy.mockResolvedValue(3);
      Subscription.destroy.mockResolvedValue(1);
      Invoice.destroy.mockResolvedValue(5);
      TenantSettings.destroy.mockResolvedValue(10);

      await tenantLifecycle.hardDeleteOffboardedTenant("t1");

      expect(User.destroy).toHaveBeenCalledWith({ where: { tenantId: "t1" }, force: true });
      expect(mockDestroy).toHaveBeenCalledWith({ force: true });
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.hardDeleteOffboardedTenant("t1")).rejects.toThrow("Tenant not found");
    });

    it("throws 400 if tenant is not offboarded", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
      });
      await expect(tenantLifecycle.hardDeleteOffboardedTenant("t1")).rejects.toThrow("Tenant is not offboarded");
    });

    it("throws 400 if retention period has not expired yet", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "deleted",
        offboardRetentionExpiresAt: new Date(Date.now() + 86400000),
      });
      await expect(tenantLifecycle.hardDeleteOffboardedTenant("t1")).rejects.toThrow("Retention period has not expired yet");
    });
  });

  describe("exportTenantData", () => {
    it("exports tenant data successfully", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        toJSON: () => ({ id: "t1", name: "Test" }),
      });
      TenantSettings.findAll.mockResolvedValue([]);
      Subscription.findAll.mockResolvedValue([]);
      Invoice.findAll.mockResolvedValue([]);
      User.findAll.mockResolvedValue([]);

      const result = await tenantLifecycle.exportTenantData("t1");

      expect(result.tenant.id).toBe("t1");
      expect(result.exportedAt).toBeDefined();
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.exportTenantData("t1")).rejects.toThrow("Tenant not found");
    });
  });

  describe("getTenantLifecycleStatus", () => {
    it("returns correct tenant status and lifecycle settings", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
        gracePeriodExpiresAt: null,
        offboardedAt: null,
        offboardRetentionExpiresAt: null,
      });
      TenantSettings.findOne.mockResolvedValue({ value: "ACTIVE" });

      const result = await tenantLifecycle.getTenantLifecycleStatus("t1");
      expect(result.status).toBe("active");
      expect(result.lifecycleStatus).toBe("ACTIVE");
    });

    it("throws 404 if tenant not found", async () => {
      Tenant.findByPk.mockResolvedValue(null);
      await expect(tenantLifecycle.getTenantLifecycleStatus("t1")).rejects.toThrow("Tenant not found");
    });
  });

  describe("processExpiredGracePeriods", () => {
    it("offboards suspended tenants whose grace periods have expired", async () => {
      // Mock findAll to return one suspended tenant with expired grace period
      Tenant.findAll.mockResolvedValue([
        {
          id: "t1",
          status: "suspended",
          gracePeriodExpiresAt: new Date(Date.now() - 10000),
        },
      ]);
      // Mock findByPk for offboardTenant internal call
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "suspended",
        save: jest.fn(),
        toJSON: () => ({ id: "t1", status: "suspended" }),
      });
      User.findAll.mockResolvedValue([]);
      Subscription.findAll.mockResolvedValue([]);
      Invoice.findAll.mockResolvedValue([]);
      TenantSettings.findAll.mockResolvedValue([]);

      const result = await tenantLifecycle.processExpiredGracePeriods();
      expect(result.length).toBe(1);
      expect(result[0].tenantId).toBe("t1");
      expect(result[0].action).toBe("offboarded");
    });
  });

  // ================================================================
  // Coverage: exportTenantData serializes every association
  // ================================================================
  describe("exportTenantData serialization", () => {
    it("calls toJSON on the tenant and on every associated row", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        toJSON: () => ({ id: "t1", name: "Acme" }),
      });
      User.findAll.mockResolvedValue([
        { toJSON: () => ({ id: "u1", email: "a@example.com" }) },
        { toJSON: () => ({ id: "u2", email: "b@example.com" }) },
      ]);
      TenantSettings.findAll.mockResolvedValue([
        { toJSON: () => ({ key: "lifecycle_status", value: "ACTIVE" }) },
      ]);
      Subscription.findAll.mockResolvedValue([
        { toJSON: () => ({ id: "s1", planId: "pro" }) },
      ]);
      Invoice.findAll.mockResolvedValue([
        { toJSON: () => ({ id: "i1", amount: 100 }) },
        { toJSON: () => ({ id: "i2", amount: 250 }) },
      ]);

      const result = await tenantLifecycle.exportTenantData("t1");

      expect(result.tenant).toEqual({ id: "t1", name: "Acme" });
      expect(result.users).toEqual([
        { id: "u1", email: "a@example.com" },
        { id: "u2", email: "b@example.com" },
      ]);
      expect(result.settings).toEqual([{ key: "lifecycle_status", value: "ACTIVE" }]);
      expect(result.subscriptions).toEqual([{ id: "s1", planId: "pro" }]);
      expect(result.invoices).toEqual([
        { id: "i1", amount: 100 },
        { id: "i2", amount: 250 },
      ]);
      expect(result.exportedAt).toBeInstanceOf(Date);

      expect(User.findAll).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
      expect(TenantSettings.findAll).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
      expect(Subscription.findAll).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
      expect(Invoice.findAll).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
    });
  });

  describe("getTenantLifecycleStatus lifecycleStatus fallback", () => {
    it("falls back to tenant.status when no lifecycle_status setting exists", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "suspended",
        gracePeriodExpiresAt: null,
        offboardedAt: null,
        offboardRetentionExpiresAt: null,
      });
      TenantSettings.findOne.mockResolvedValue(null);

      const result = await tenantLifecycle.getTenantLifecycleStatus("t1");

      // No setting row -> lifecycleStatus falls back to tenant.status (the enum value).
      expect(result.lifecycleStatus).toBe("suspended");
      expect(result.gracePeriodExpired).toBe(false);
    });

    it("falls back to tenant.status when the setting row has a null value", async () => {
      Tenant.findByPk.mockResolvedValue({
        id: "t1",
        status: "active",
        gracePeriodExpiresAt: null,
        offboardedAt: null,
        offboardRetentionExpiresAt: null,
      });
      TenantSettings.findOne.mockResolvedValue({ value: null });

      const result = await tenantLifecycle.getTenantLifecycleStatus("t1");

      // Null setting value -> falls back to tenant.status (the enum value).
      expect(result.lifecycleStatus).toBe("active");
    });
  });

  describe("processExpiredGracePeriods no-op paths", () => {
    it("returns an empty list when no suspended tenant has an expired grace period", async () => {
      const future = new Date(Date.now() + 86400000);
      Tenant.findAll.mockResolvedValue([
        { id: "t1", status: "suspended", gracePeriodExpiresAt: future },
      ]);

      const result = await tenantLifecycle.processExpiredGracePeriods();

      expect(result).toEqual([]);
      expect(Tenant.findByPk).not.toHaveBeenCalled();
    });

    it("returns an empty list when no tenants match the query", async () => {
      Tenant.findAll.mockResolvedValue([]);

      const result = await tenantLifecycle.processExpiredGracePeriods();

      expect(result).toEqual([]);
    });
  });
});
