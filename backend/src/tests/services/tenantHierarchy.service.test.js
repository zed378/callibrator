// eslint-disable-next-line no-undef
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("../../config", () => ({
  db: {
    Sequelize: {
      Op: {
        like: { [Symbol.toStringTag]: "Op.like" },
        or: { [Symbol.toStringTag]: "Op.or" },
        in: { [Symbol.toStringTag]: "Op.in" },
      },
    },
  },
}));

describe("tenantHierarchy.service", () => {
  let tenantHierarchyService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HIERARCHY_ENABLED;
    delete process.env.HIERARCHY_MAX_DEPTH;
    delete process.env.HIERARCHY_CASCADE_ROLES;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("createSubOrganization", () => {
    it("should throw error when hierarchy is disabled", async () => {
      process.env.HIERARCHY_ENABLED = "false";
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      await expect(
        tenantHierarchyService.createSubOrganization("parent-1", {
          name: "Child Org",
        }),
      ).rejects.toThrow("Tenant hierarchy is disabled");
    });

    it("should throw error when parent tenant not found", async () => {
      process.env.HIERARCHY_ENABLED = "true";
      const mockTenant = { findByPk: jest.fn().mockResolvedValue(null) };
      const mockModels = { Tenant: mockTenant };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      await expect(
        tenantHierarchyService.createSubOrganization("nonexistent", {
          name: "Child Org",
        }),
      ).rejects.toThrow("Parent tenant not found");
    });

    it("should throw error when parent tenant is not active", async () => {
      process.env.HIERARCHY_ENABLED = "true";
      const mockTenant = {
        findByPk: jest.fn().mockResolvedValue({
          id: "parent-1",
          code: "PARENT",
          status: "inactive",
        }),
      };
      const mockModels = { Tenant: mockTenant };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      await expect(
        tenantHierarchyService.createSubOrganization("parent-1", {
          name: "Child Org",
        }),
      ).rejects.toThrow("Parent tenant must be active");
    });

    it("should create sub-organization successfully", async () => {
      process.env.HIERARCHY_ENABLED = "true";
      const mockTenant = {
        findByPk: jest.fn().mockResolvedValue({
          id: "parent-1",
          code: "PARENT",
          status: "active",
          plan: "professional",
        }),
        create: jest.fn().mockResolvedValue({
          id: "child-1",
          code: "PARENT_001",
          name: "Child Org",
          status: "active",
        }),
      };
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          tenantCode: "PARENT",
          path: "/parent",
          depth: 0,
        }),
        create: jest.fn().mockResolvedValue({
          id: "hierarchy-1",
          tenantId: "child-1",
          tenantCode: "PARENT_001",
          parentCode: "PARENT",
          path: "/parent/parent_001",
          depth: 1,
          destroy: jest.fn().mockResolvedValue(true),
        }),
        count: jest.fn().mockResolvedValue(0),
      };
      const mockCascade = jest.fn().mockResolvedValue(true);
      const mockModels = {
        Tenant: mockTenant,
        TenantHierarchy: mockHierarchy,
        Role: {},
        User: {},
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.createSubOrganization(
        "parent-1",
        { name: "Child Org" },
      );

      expect(result.tenantId).toBeDefined();
      expect(result.code).toBe("PARENT_001");
      expect(result.depth).toBe(1);
    });
  });

  describe("getTenantTree", () => {
    it("should return root tree when hierarchy not found", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getTenantTree("tenant-1");

      expect(result.isRoot).toBe(true);
      expect(result.children).toEqual([]);
    });

    it("should return tree with children", async () => {
      const mockHierarchy = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({
            tenantCode: "PARENT",
            depth: 0,
            path: "/parent",
            tenant: { id: "tenant-1", name: "Parent", code: "PARENT" },
          })
          .mockResolvedValueOnce(null),
        findAll: jest.fn().mockResolvedValue([
          {
            tenant: { id: "child-1", name: "Child 1", code: "CHILD_001" },
            depth: 1,
          },
        ]),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getTenantTree("tenant-1");

      expect(result.isRoot).toBe(true);
      expect(result.depth).toBe(0);
      expect(result.children).toHaveLength(1);
      expect(result.children[0].tenantId).toBe("child-1");
    });

    it("should return empty children on error", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockRejectedValue(new Error("DB error")),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getTenantTree("tenant-1");

      expect(result.isRoot).toBe(true);
      expect(result.children).toEqual([]);
    });
  });

  describe("getDescendantTenants", () => {
    it("should return empty array when hierarchy not found", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getDescendantTenants("tenant-1");

      expect(result).toEqual([]);
    });

    it("should return descendant tenant IDs", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          path: "/parent/child",
        }),
        findAll: jest
          .fn()
          .mockResolvedValue([{ tenantId: "desc-1" }, { tenantId: "desc-2" }]),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getDescendantTenants("tenant-1");

      expect(result).toEqual(["desc-1", "desc-2"]);
    });

    it("should return empty array on error", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockRejectedValue(new Error("DB error")),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getDescendantTenants("tenant-1");

      expect(result).toEqual([]);
    });
  });

  describe("getAncestorTenants", () => {
    it("should return empty array when hierarchy not found", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getAncestorTenants("tenant-1");

      expect(result).toEqual([]);
    });

    it("should return ancestor tenants", async () => {
      const mockHierarchy = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({
            path: "/parent/child/grandchild",
            depth: 2,
          })
          .mockResolvedValueOnce({
            tenant: {
              id: "parent-1",
              code: "PARENT",
              name: "Parent",
              status: "active",
            },
            depth: 0,
          })
          .mockResolvedValueOnce({
            tenant: {
              id: "child-1",
              code: "CHILD",
              name: "Child",
              status: "active",
            },
            depth: 1,
          }),
      };
      const mockModels = {
        TenantHierarchy: mockHierarchy,
        Tenant: {},
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getAncestorTenants("tenant-1");

      expect(result).toHaveLength(2);
      expect(result[0].tenantId).toBe("parent-1");
      expect(result[1].tenantId).toBe("child-1");
    });

    it("should return empty array on error", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockRejectedValue(new Error("DB error")),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getAncestorTenants("tenant-1");

      expect(result).toEqual([]);
    });
  });

  describe("getDataVisibilityScope", () => {
    it("should return self scope", async () => {
      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getDataVisibilityScope(
        "tenant-1",
        "self",
      );

      expect(result.tenantIds).toEqual(["tenant-1"]);
      expect(result.scope).toBe("self");
    });

    it("should return subtree scope", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          path: "/parent",
        }),
        findAll: jest
          .fn()
          .mockResolvedValue([{ tenantId: "desc-1" }, { tenantId: "desc-2" }]),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getDataVisibilityScope(
        "tenant-1",
        "subtree",
      );

      expect(result.tenantIds).toContain("tenant-1");
      expect(result.tenantIds).toContain("desc-1");
      expect(result.tenantIds).toContain("desc-2");
      expect(result.scope).toBe("subtree");
    });

    it("should return self scope for unknown scope", async () => {
      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.getDataVisibilityScope(
        "tenant-1",
        "unknown",
      );

      expect(result.tenantIds).toEqual(["tenant-1"]);
      expect(result.scope).toBe("self");
    });
  });

  describe("buildTenantFilter", () => {
    it("should return tenant filter with in clause", async () => {
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          path: "/parent",
        }),
        findAll: jest.fn().mockResolvedValue([{ tenantId: "desc-1" }]),
      };
      const mockModels = { TenantHierarchy: mockHierarchy };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result = await tenantHierarchyService.buildTenantFilter(
        "tenant-1",
        "subtree",
      );

      expect(result.tenantId).toBeDefined();
    });
  });

  describe("assignRoleToUserAcrossHierarchy", () => {
    it("should assign role to user across tenants", async () => {
      const mockUser = {
        findByPk: jest
          .fn()
          .mockResolvedValue({ id: "user-1", tenantId: "parent-tenant-id" }),
        update: jest.fn().mockResolvedValue([1]),
      };
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          path: "/parent",
        }),
        findAll: jest
          .fn()
          .mockResolvedValue([{ tenantId: "t1" }, { tenantId: "t2" }]),
      };
      const mockModels = {
        User: mockUser,
        TenantHierarchy: mockHierarchy,
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.assignRoleToUserAcrossHierarchy(
          "user-1",
          "role-1",
          "subtree",
        );

      expect(result.success).toBe(true);
      expect(result.tenantCount).toBe(3);
    });

    it("should throw error on assignment failure", async () => {
      const mockUser = {
        findByPk: jest
          .fn()
          .mockResolvedValue({ id: "user-1", tenantId: "parent-tenant-id" }),
        update: jest.fn().mockRejectedValue(new Error("Update failed")),
      };
      const mockHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          path: "/parent",
        }),
        findAll: jest.fn().mockResolvedValue([{ tenantId: "t1" }]),
      };
      const mockModels = {
        User: mockUser,
        TenantHierarchy: mockHierarchy,
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      await expect(
        tenantHierarchyService.assignRoleToUserAcrossHierarchy(
          "user-1",
          "role-1",
          "subtree",
        ),
      ).rejects.toThrow("Failed to assign role");
    });
  });

  describe("getUserRolesAcrossTenants", () => {
    it("should return user roles across tenants", async () => {
      const mockUser = {
        findAll: jest.fn().mockResolvedValue([
          {
            tenantId: "tenant-1",
            Tenant: { name: "Tenant 1", code: "T1" },
            Role: { id: "role-1", name: "Admin", level: 3 },
          },
        ]),
      };
      const mockModels = {
        User: mockUser,
        Role: {},
        Tenant: {},
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getUserRolesAcrossTenants("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe("tenant-1");
      expect(result[0].role.name).toBe("Admin");
    });

    it("should return empty array on error", async () => {
      const mockUser = {
        findAll: jest.fn().mockRejectedValue(new Error("DB error")),
      };
      const mockModels = {
        User: mockUser,
        Role: {},
        Tenant: {},
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const result =
        await tenantHierarchyService.getUserRolesAcrossTenants("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("should return service status", () => {
      process.env.HIERARCHY_ENABLED = "true";
      process.env.HIERARCHY_MAX_DEPTH = "10";
      process.env.HIERARCHY_CASCADE_ROLES = "true";
      jest.resetModules();
      tenantHierarchyService = require("../../services/tenantHierarchy.service");

      const status = tenantHierarchyService.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.maxDepth).toBe(10);
      expect(status.cascadeRoles).toBe(true);
    });
  });

  describe("HIERARCHY_SCOPE", () => {
    it("should have correct scope values", () => {
      jest.resetModules();
      const {
        HIERARCHY_SCOPE,
      } = require("../../services/tenantHierarchy.service");

      expect(HIERARCHY_SCOPE.SELF).toBe("self");
      expect(HIERARCHY_SCOPE.SUBTREE).toBe("subtree");
      expect(HIERARCHY_SCOPE.ALL).toBe("all");
    });
  });
});
