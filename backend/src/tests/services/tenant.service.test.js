/**
 * Tests for tenant service
 */

jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: {
    user: jest.fn((userId) => `user:${userId}`),
    userByEmail: jest.fn((email) => `user:email:${email}`),
    userByUsername: jest.fn((username) => `user:username:${username}`),
    tenant: jest.fn((tenantId) => `tenant:${tenantId}`),
    tenantByCode: jest.fn((code) => `tenant:code:${code}`),
    tenantSettings: jest.fn((tenantId) => `tenant:settings:${tenantId}`),
    role: jest.fn((roleId) => `role:${roleId}`),
    permissions: jest.fn((roleId) => `permissions:role:${roleId}`),
    userPermissions: jest.fn((userId) => `permissions:user:${userId}`),
    session: jest.fn((sessionHash) => `session:${sessionHash}`),
    rateLimit: jest.fn((identifier) => `ratelimit:${identifier}`),
    lock: jest.fn((resource) => `lock:${resource}`),
  },
}));

// Mirrors the REAL AppError(status, message) signature from
// src/utils/appError.util.js. This mock used to declare (message, status) —
// the arguments reversed — which made a genuinely swapped `new AppError(msg,
// 400)` call in tenant.service.js look correct and hid the bug.
jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status = 500, message = "Internal Server Error") {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
}));

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

// Mock validators - validate() returns sanitized data, formatErrors returns array
jest.mock("../../validators/tenant.validator", () => ({
  createTenantSchema: {
    validate: jest.fn((body) => ({
      value: { ...body, status: body.status?.toUpperCase() || "ACTIVE" },
    })),
  },
  updateTenantSchema: {
    validate: jest.fn((body) => ({
      value: { ...body, status: body.status?.toUpperCase() || "ACTIVE" },
    })),
  },
  validate: jest.fn((body, schema) => {
    const { value } = schema.validate(body);
    return value;
  }),
  formatErrors: jest.fn((details) => details),
}));

jest.mock("../../config", () => {
  const mockTx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      transaction: jest.fn().mockImplementation((options) => {
        if (typeof options === "function") {
          return options(mockTx);
        }
        return Promise.resolve(mockTx);
      }),
      sequelize: {
        fn: jest.fn(),
        op: {},
      },
    },
  };
});

// Mock models with proper jest mock functions
const mockFindAll = jest.fn();
const mockFindOne = jest.fn();
const mockFindByPk = jest.fn();
const mockCreate = jest.fn();
const mockCount = jest.fn();
const mockUpdate = jest.fn();
const mockDestroy = jest.fn();

jest.mock("../../models", () => ({
  Tenants: {
    findAll: mockFindAll,
    findOne: mockFindOne,
    findByPk: mockFindByPk,
    create: mockCreate,
    count: mockCount,
    update: mockUpdate,
    destroy: mockDestroy,
  },
  Users: {
    count: mockCount,
    findAll: jest.fn(),
  },
  TenantSettings: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    bulkDestroy: jest.fn(),
    findOrCreate: jest.fn(),
  },
}));

// Now import after mocks are set up
const tenantService = require("../../services/tenant.service");
const { Tenants, Users, TenantSettings } = require("../../models");
const { get, set, del, delPattern } = require("../../services/redis.service");

// Assign the mock functions to the imported objects
Tenants.findAll = mockFindAll;
Tenants.findOne = mockFindOne;
Tenants.findByPk = mockFindByPk;
Tenants.create = mockCreate;
Tenants.count = mockCount;
Tenants.update = mockUpdate;
Tenants.destroy = mockDestroy;
Users.count = mockCount;
Users.findAll = jest.fn();
TenantSettings.findAll = jest.fn();
TenantSettings.findOrCreate = jest.fn();

describe("tenant Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    mockFindAll.mockResolvedValue([]);
    mockFindOne.mockResolvedValue(null);
    mockFindByPk.mockResolvedValue(null);
    mockCreate.mockResolvedValue(null);
    mockCount.mockResolvedValue(0);
    mockUpdate.mockResolvedValue([1]);
    mockDestroy.mockResolvedValue(1);
    get.mockResolvedValue(null);
    set.mockResolvedValue(undefined);
    del.mockResolvedValue(undefined);
    delPattern.mockResolvedValue(undefined);
    Users.findAll.mockResolvedValue([]);
    TenantSettings.findAll.mockResolvedValue([]);
    TenantSettings.findOrCreate.mockResolvedValue([{}, true]);
  });

  describe("fetchTenants", () => {
    it("should return paginated tenants", async () => {
      const mockTenants = [
        {
          id: "t-1",
          name: "Acme",
          code: "ACM",
          logo: "logo.png",
          toJSON: () => ({
            id: "t-1",
            name: "Acme",
            code: "ACM",
            logo: "logo.png",
          }),
        },
      ];
      mockFindAll.mockResolvedValue(mockTenants);
      mockCount.mockResolvedValue(1);
      get.mockResolvedValue(null);

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(mockFindAll).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should return cached result for first page", async () => {
      get.mockResolvedValue({
        rows: [{ id: "t-1" }],
        meta: { total: 1 },
      });

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(get).toHaveBeenCalled();
    });

    it("should search by name, code, description", async () => {
      mockFindAll.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
      get.mockResolvedValue(null);

      await tenantService.fetchTenants({ page: 1, limit: 10, find: "test" });

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
        }),
      );
    });
  });

  describe("fetchSpecificTenant", () => {
    it("should return tenant by id", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        code: "ACM",
        status: "ACTIVE",
        settings: {},
        users: [],
        toJSON: () => ({
          id: "t-1",
          name: "Acme",
          code: "ACM",
          status: "ACTIVE",
          settings: {},
          users: [],
        }),
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      get.mockResolvedValue(null);

      const result = await tenantService.fetchSpecificTenant("t-1");

      expect(mockFindByPk).toHaveBeenCalledWith("t-1", expect.any(Object));
      expect(result).toBeDefined();
    });

    it("should return cached result", async () => {
      get.mockResolvedValue({
        data: { id: "t-1", name: "Acme" },
      });

      const result = await tenantService.fetchSpecificTenant("t-1");

      expect(get).toHaveBeenCalled();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      const result = await tenantService.fetchSpecificTenant("invalid");

      expect(result.status).toBe(404);
    });
  });

  describe("getTenantByIdForMiddleware", () => {
    it("should return tenant with limited attributes", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        code: "ACM",
        status: "ACTIVE",
        primaryColor: "#000000",
        logo: "logo.png",
      };
      mockFindByPk.mockResolvedValue(mockTenant);

      const result = await tenantService.getTenantByIdForMiddleware("t-1");

      expect(mockFindByPk).toHaveBeenCalledWith("t-1", {
        attributes: expect.any(Array),
      });
    });
  });

  describe("getTenantByCodeForMiddleware", () => {
    it("should return active tenant by code", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        code: "ACM",
        status: "ACTIVE",
        primaryColor: "#000000",
        logo: "logo.png",
      };
      mockFindOne.mockResolvedValue(mockTenant);

      const result = await tenantService.getTenantByCodeForMiddleware("ACM");

      expect(mockFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: "ACM" }),
        }),
      );
    });
  });

  describe("getPublicBranding", () => {
    it("should return branding data", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        primaryColor: "#000000",
        logo: "logo.png",
        toJSON() {
          return this;
        },
      };
      mockFindOne.mockResolvedValue(mockTenant);
      get.mockResolvedValue(null);

      const result = await tenantService.getPublicBranding("t-1");

      expect(mockFindOne).toHaveBeenCalled();
    });

    it("should return cached branding", async () => {
      get.mockResolvedValue({
        data: { id: "t-1", primaryColor: "#000000" },
      });

      const result = await tenantService.getPublicBranding("t-1");

      expect(get).toHaveBeenCalled();
    });

    it("should return null when tenant not found", async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await tenantService.getPublicBranding("invalid");

      expect(result).toBeNull();
    });

    it("should only return active tenants", async () => {
      mockFindOne.mockResolvedValue(null);
      get.mockResolvedValue(null);

      await tenantService.getPublicBranding("t-1");

      expect(mockFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "active",
          }),
        }),
      );
    });
  });

  describe("createTenant", () => {
    it("should create a new tenant", async () => {
      const mockTenant = {
        id: "t-new",
        name: "New Tenant",
        code: "NT",
      };
      mockCreate.mockResolvedValue(mockTenant);
      mockFindOne.mockResolvedValue(null);
      set.mockResolvedValue(undefined);
      delPattern.mockResolvedValue(undefined);

      const result = await tenantService.createTenant(
        { name: "New Tenant", code: "NT" },
        "user-1",
      );

      expect(mockCreate).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw error for duplicate code", async () => {
      mockFindOne.mockResolvedValue({ id: "existing" });

      await expect(
        tenantService.createTenant({ name: "New", code: "NT" }, "user-1"),
      ).rejects.toThrow();
    });

    it("should throw error for duplicate name", async () => {
      mockFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing" });

      await expect(
        tenantService.createTenant({ name: "Existing", code: "NT" }, "user-1"),
      ).rejects.toThrow();
    });
  });

  describe("updateTenant", () => {
    it("should update a tenant", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Old",
        code: "OLD",
        update: jest.fn().mockResolvedValue(undefined),
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      mockFindOne.mockResolvedValue(null);
      set.mockResolvedValue(undefined);
      delPattern.mockResolvedValue(undefined);

      const result = await tenantService.updateTenant("t-1", {
        name: "New",
      });

      expect(mockTenant.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      await expect(
        tenantService.updateTenant("invalid", { name: "New" }),
      ).rejects.toThrow();
    });
  });

  describe("deleteTenant", () => {
    it("should delete a tenant with no users", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      mockCount.mockResolvedValue(0);
      del.mockResolvedValue(undefined);
      delPattern.mockResolvedValue(undefined);

      const result = await tenantService.deleteTenant("t-1", "user-1");

      expect(mockTenant.destroy).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should not delete tenant with users", async () => {
      const mockTenant = {
        id: "t-1",
        name: "Acme",
        logo: "default.svg",
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      mockCount.mockResolvedValue(5);

      await expect(
        tenantService.deleteTenant("t-1", "user-1"),
      ).rejects.toThrow();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      await expect(
        tenantService.deleteTenant("invalid", "user-1"),
      ).rejects.toThrow();
    });
  });

  describe("getTenantSettings", () => {
    it("should return tenant settings", async () => {
      const mockTenant = {
        id: "t-1",
        settings: { theme: "dark" },
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      TenantSettings.findAll.mockResolvedValue([
        { key: "language", value: "en" },
      ]);

      const result = await tenantService.getTenantSettings("t-1");

      expect(mockFindByPk).toHaveBeenCalledWith("t-1");
      expect(result).toBeDefined();
    });

    it("should return cached settings", async () => {
      get.mockResolvedValue({ data: { theme: "dark" } });

      const result = await tenantService.getTenantSettings("t-1");

      expect(get).toHaveBeenCalled();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      const result = await tenantService.getTenantSettings("invalid");

      expect(result.status).toBe(404);
    });
  });

  describe("updateTenantSettings", () => {
    it("should update tenant settings", async () => {
      const mockTenant = {
        id: "t-1",
        update: jest.fn().mockResolvedValue(undefined),
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      TenantSettings.findAll.mockResolvedValue([]);
      del.mockResolvedValue(undefined);

      const result = await tenantService.updateTenantSettings("t-1", {
        theme: "dark",
      });

      expect(result).toBeDefined();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      await expect(
        tenantService.updateTenantSettings("invalid", {}),
      ).rejects.toThrow();
    });
  });

  describe("getTenantUserCount", () => {
    it("should return user count", async () => {
      const mockTenant = {
        id: "t-1",
        maxUsers: 50,
      };
      mockFindByPk.mockResolvedValue(mockTenant);
      mockCount.mockResolvedValue(25);

      const result = await tenantService.getTenantUserCount("t-1");

      expect(mockFindByPk).toHaveBeenCalledWith("t-1");
      expect(mockCount).toHaveBeenCalled();
    });

    it("should return 404 when tenant not found", async () => {
      mockFindByPk.mockResolvedValue(null);

      const result = await tenantService.getTenantUserCount("invalid");

      expect(result.status).toBe(404);
    });
  });
});
