/**
 * Branch/line coverage tests for tenantHierarchy.service.js
 *
 * Complements tenantHierarchy.service.test.js — targets the max-depth rollback,
 * the role-cascade path (HIERARCHY_CASCADE_ROLES), createSubOrganization's
 * failure handling, and the "all" data-visibility scope.
 *
 * HIERARCHY_ENABLED / HIERARCHY_MAX_DEPTH / HIERARCHY_CASCADE_ROLES are read at
 * module load, so every test sets env then re-requires the service.
 */

// Every mocked value below is defined OUTSIDE its factory so it keeps a stable
// identity across the jest.resetModules() calls each test makes. A factory-local
// jest.fn()/Symbol/class would be re-created on each registry reset, so the copy
// the service sees would never be the copy these tests assert against.
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: mockLogger,
}));

// Mirrors the real AppError: (status, message) with a `.status` property.
class MockAppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}
jest.mock("../../utils/appError.util", () => ({ AppError: MockAppError }));

const mockOp = {
  like: Symbol("Op.like"),
  or: Symbol("Op.or"),
  in: Symbol("Op.in"),
};
jest.mock("../../config", () => ({
  db: { Sequelize: { Op: mockOp } },
}));

const logger = mockLogger;
const AppError = MockAppError;
const db = { Sequelize: { Op: mockOp } };

// Load the service with the given env + mocked models.
const loadService = (env, models) => {
  for (const key of [
    "HIERARCHY_ENABLED",
    "HIERARCHY_MAX_DEPTH",
    "HIERARCHY_CASCADE_ROLES",
  ]) {
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  jest.doMock("../../models", () => models);
  jest.resetModules();
  return require("../../services/tenantHierarchy.service");
};

describe("tenantHierarchy.service (coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.HIERARCHY_ENABLED;
    delete process.env.HIERARCHY_MAX_DEPTH;
    delete process.env.HIERARCHY_CASCADE_ROLES;
  });

  // ================================================================
  describe("createSubOrganization", () => {
    const activeParent = {
      id: "parent-1",
      code: "PARENT",
      status: "active",
      plan: "business",
    };

    it("derives the path from the parent code when the parent has no hierarchy row", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1" }),
      };
      const TenantHierarchy = {
        findOne: jest.fn().mockResolvedValue(null), // parent is not in the hierarchy table
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue({
          path: "/parent/parent_003",
          depth: 1,
        }),
      };
      const svc = loadService({ HIERARCHY_ENABLED: "true" }, { Tenant, TenantHierarchy });

      const result = await svc.createSubOrganization("parent-1", { name: "Branch C" });

      expect(result).toEqual({
        tenantId: "child-1",
        code: "PARENT_003",
        path: "/parent/parent_003",
        depth: 1,
      });
      expect(Tenant.create).toHaveBeenCalledWith({
        name: "Branch C",
        code: "PARENT_003",
        status: "active",
        parentId: "parent-1",
        plan: "business",
      });
      // depth falls back to 0 + 1 and the path is derived from the parent code
      expect(TenantHierarchy.create).toHaveBeenCalledWith({
        tenantId: "child-1",
        tenantCode: "PARENT_003",
        parentCode: "PARENT",
        path: "/parent/parent_003",
        depth: 1,
      });
    });

    it("rolls back the tenant and hierarchy rows when max depth is exceeded", async () => {
      const tenantDestroy = jest.fn().mockResolvedValue(true);
      const hierarchyDestroy = jest.fn().mockResolvedValue(true);
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1", destroy: tenantDestroy }),
      };
      const TenantHierarchy = {
        findOne: jest.fn().mockResolvedValue({
          tenantCode: "PARENT",
          path: "/root/parent",
          depth: 2,
        }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          path: "/root/parent/parent_001",
          depth: 3,
          destroy: hierarchyDestroy,
        }),
      };
      const svc = loadService(
        { HIERARCHY_ENABLED: "true", HIERARCHY_MAX_DEPTH: "2" },
        { Tenant, TenantHierarchy },
      );

      // NOTE: only the rollback + rejection are asserted here. The status code
      // this surfaces is covered by the known defect reported separately
      // (the depth guard throws inside the try block and is swallowed by the
      // catch at tenantHierarchy.service.js:113-119), so pinning it would
      // enshrine the bug.
      await expect(
        svc.createSubOrganization("parent-1", { name: "Too Deep" }),
      ).rejects.toBeInstanceOf(AppError);

      expect(tenantDestroy).toHaveBeenCalled();
      expect(hierarchyDestroy).toHaveBeenCalled();
    });

    it("wraps an unexpected model failure and logs it", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockRejectedValue(new Error("unique violation")),
      };
      const TenantHierarchy = {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      };
      const svc = loadService({ HIERARCHY_ENABLED: "true" }, { Tenant, TenantHierarchy });

      await expect(
        svc.createSubOrganization("parent-1", { name: "Boom" }),
      ).rejects.toMatchObject({
        status: 500,
        message: "Failed to create sub-organization",
      });

      expect(logger.error).toHaveBeenCalledWith("Failed to create sub-organization", {
        parentTenantId: "parent-1",
        error: "unique violation",
      });
      expect(TenantHierarchy.create).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("createSubOrganization with role cascade enabled", () => {
    const activeParent = {
      id: "parent-1",
      code: "PARENT",
      status: "active",
      plan: "free",
    };

    const baseHierarchy = () => ({
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ path: "/parent/parent_001", depth: 1 }),
    });

    it("copies parent roles and menu permissions onto the new child tenant", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1" }),
      };
      const Role = {
        findByPk: jest.fn().mockResolvedValue({
          id: "role-1",
          name: "Manager",
          level: 3,
          description: "Runs the branch",
        }),
        findOne: jest.fn().mockResolvedValue(null), // child has no such role yet
        create: jest.fn().mockResolvedValue({ id: "child-role-1" }),
      };
      const RoleMenuPermission = {
        findAll: jest
          .fn()
          .mockResolvedValue([{ menuGroupId: "mg-1", permissionType: "write" }]),
        findOrCreate: jest.fn().mockResolvedValue([{}, true]),
      };
      const User = {
        findAll: jest.fn().mockResolvedValue([
          { id: "u1", roleId: "role-1" },
          { id: "u2", roleId: "role-1" }, // duplicate roleId → deduped
        ]),
      };
      const svc = loadService(
        { HIERARCHY_ENABLED: "true", HIERARCHY_CASCADE_ROLES: "true" },
        { Tenant, TenantHierarchy: baseHierarchy(), Role, User, RoleMenuPermission },
      );

      const result = await svc.createSubOrganization("parent-1", { name: "Branch A" });

      expect(result.tenantId).toBe("child-1");
      expect(User.findAll).toHaveBeenCalledWith({
        where: { tenantId: "parent-1" },
        include: [Role],
      });
      expect(Role.findByPk).toHaveBeenCalledTimes(1); // deduped
      expect(Role.create).toHaveBeenCalledWith({
        name: "Manager",
        level: 3,
        tenantId: "child-1",
        description: "Cascaded from parent: Runs the branch",
      });
      expect(RoleMenuPermission.findOrCreate).toHaveBeenCalledWith({
        where: { roleId: "child-role-1", menuGroupId: "mg-1" },
        defaults: {
          roleId: "child-role-1",
          menuGroupId: "mg-1",
          permissionType: "write",
        },
      });
      expect(logger.info).toHaveBeenCalledWith("Roles cascaded", {
        fromTenant: "parent-1",
        toTenant: "child-1",
      });
    });

    it("reuses an existing child role instead of creating a duplicate", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1" }),
      };
      const Role = {
        findByPk: jest.fn().mockResolvedValue({
          id: "role-1",
          name: "Manager",
          level: 3,
          description: "d",
        }),
        findOne: jest.fn().mockResolvedValue({ id: "existing-child-role" }),
        create: jest.fn(),
      };
      const RoleMenuPermission = {
        findAll: jest.fn().mockResolvedValue([]),
        findOrCreate: jest.fn(),
      };
      const User = {
        findAll: jest.fn().mockResolvedValue([{ id: "u1", roleId: "role-1" }]),
      };
      const svc = loadService(
        { HIERARCHY_ENABLED: "true", HIERARCHY_CASCADE_ROLES: "true" },
        { Tenant, TenantHierarchy: baseHierarchy(), Role, User, RoleMenuPermission },
      );

      await svc.createSubOrganization("parent-1", { name: "Branch A" });

      expect(Role.findOne).toHaveBeenCalledWith({
        where: { name: "Manager", tenantId: "child-1" },
      });
      expect(Role.create).not.toHaveBeenCalled();
      expect(RoleMenuPermission.findOrCreate).not.toHaveBeenCalled();
    });

    it("skips a roleId whose role row has disappeared", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1" }),
      };
      const Role = {
        findByPk: jest.fn().mockResolvedValue(null), // dangling roleId
        findOne: jest.fn(),
        create: jest.fn(),
      };
      const RoleMenuPermission = { findAll: jest.fn(), findOrCreate: jest.fn() };
      const User = {
        findAll: jest.fn().mockResolvedValue([{ id: "u1", roleId: "ghost-role" }]),
      };
      const svc = loadService(
        { HIERARCHY_ENABLED: "true", HIERARCHY_CASCADE_ROLES: "true" },
        { Tenant, TenantHierarchy: baseHierarchy(), Role, User, RoleMenuPermission },
      );

      const result = await svc.createSubOrganization("parent-1", { name: "Branch A" });

      expect(result.tenantId).toBe("child-1");
      expect(Role.findOne).not.toHaveBeenCalled();
      expect(Role.create).not.toHaveBeenCalled();
    });

    it("treats a cascade failure as non-fatal and still returns the new tenant", async () => {
      const Tenant = {
        findByPk: jest.fn().mockResolvedValue(activeParent),
        create: jest.fn().mockResolvedValue({ id: "child-1" }),
      };
      const Role = { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn() };
      const RoleMenuPermission = { findAll: jest.fn(), findOrCreate: jest.fn() };
      const User = {
        findAll: jest.fn().mockRejectedValue(new Error("users table locked")),
      };
      const svc = loadService(
        { HIERARCHY_ENABLED: "true", HIERARCHY_CASCADE_ROLES: "true" },
        { Tenant, TenantHierarchy: baseHierarchy(), Role, User, RoleMenuPermission },
      );

      const result = await svc.createSubOrganization("parent-1", { name: "Branch A" });

      expect(result.tenantId).toBe("child-1");
      expect(logger.warn).toHaveBeenCalledWith("Role cascade failed (non-fatal)", {
        parentTenantId: "parent-1",
        childTenantId: "child-1",
        error: "users table locked",
      });
      expect(logger.info).toHaveBeenCalledWith(
        "Sub-organization created",
        expect.objectContaining({ childTenantId: "child-1" }),
      );
    });
  });

  // ================================================================
  describe("getDataVisibilityScope (all)", () => {
    it("returns every tenant under the root code when an ancestor exists", async () => {
      const Tenant = {
        findAll: jest
          .fn()
          .mockResolvedValue([{ id: "root-1" }, { id: "child-1" }, { id: "child-2" }]),
      };
      const TenantHierarchy = {
        findOne: jest
          .fn()
          // getAncestorTenants: the tenant's own hierarchy row
          .mockResolvedValueOnce({ path: "/root/branch", depth: 1 })
          // then the lookup for the "/root" ancestor
          .mockResolvedValueOnce({
            tenant: { id: "root-1", code: "ROOT", name: "Root", status: "active" },
            depth: 0,
          }),
      };
      const svc = loadService({}, { Tenant, TenantHierarchy });

      const result = await svc.getDataVisibilityScope("tenant-1", "all");

      expect(result).toEqual({
        tenantIds: ["root-1", "child-1", "child-2"],
        scope: "all",
      });
      expect(Tenant.findAll).toHaveBeenCalledWith({
        where: {
          [db.Sequelize.Op.or]: [
            { code: "ROOT" },
            { code: { [db.Sequelize.Op.like]: "ROOT_%" } },
          ],
        },
        attributes: ["id"],
      });
    });

    it("falls back to self scope when the tenant has no ancestors", async () => {
      const Tenant = { findAll: jest.fn() };
      const TenantHierarchy = { findOne: jest.fn().mockResolvedValue(null) };
      const svc = loadService({}, { Tenant, TenantHierarchy });

      const result = await svc.getDataVisibilityScope("tenant-1", "all");

      expect(result).toEqual({ tenantIds: ["tenant-1"], scope: "self" });
      expect(Tenant.findAll).not.toHaveBeenCalled();
    });

    it("defaults to self scope when no scope argument is given", async () => {
      const svc = loadService({}, { TenantHierarchy: { findOne: jest.fn() } });

      const result = await svc.getDataVisibilityScope("tenant-1");

      expect(result).toEqual({ tenantIds: ["tenant-1"], scope: "self" });
    });
  });

  // ================================================================
  describe("getAncestorTenants", () => {
    it("skips path segments with no hierarchy row and no loaded tenant", async () => {
      const TenantHierarchy = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ path: "/root/mid/leaf", depth: 2 })
          .mockResolvedValueOnce(null) // "/root" has no hierarchy row
          .mockResolvedValueOnce({ depth: 1, tenant: null }), // "/root/mid" row without tenant
      };
      const svc = loadService({}, { TenantHierarchy, Tenant: {} });

      const result = await svc.getAncestorTenants("tenant-1");

      expect(result).toEqual([]);
      expect(TenantHierarchy.findOne).toHaveBeenCalledTimes(3);
    });
  });

  // ================================================================
  describe("assignRoleToUserAcrossHierarchy", () => {
    it("defaults to subtree scope when no scope is given", async () => {
      const User = { update: jest.fn().mockResolvedValue([1]) };
      const TenantHierarchy = {
        findOne: jest.fn().mockResolvedValue({ path: "/parent" }),
        findAll: jest.fn().mockResolvedValue([]),
      };
      const svc = loadService({}, { User, TenantHierarchy });

      const result = await svc.assignRoleToUserAcrossHierarchy("user-1", "role-1");

      expect(result).toEqual({ success: true, tenantCount: 1 });
      expect(User.update).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "Role assigned across hierarchy",
        expect.objectContaining({
          userId: "user-1",
          roleId: "role-1",
          scope: "subtree",
        }),
      );
    });
  });

  // ================================================================
  describe("buildTenantFilter", () => {
    it("defaults to a self-scoped IN filter", async () => {
      const svc = loadService({}, { TenantHierarchy: { findOne: jest.fn() } });

      const filter = await svc.buildTenantFilter("tenant-1");

      expect(filter).toEqual({
        tenantId: { [db.Sequelize.Op.in]: ["tenant-1"] },
      });
    });
  });

  // ================================================================
  describe("getUserRolesAcrossTenants", () => {
    it("leaves tenant name/code undefined when the association is not loaded", async () => {
      const User = {
        findAll: jest.fn().mockResolvedValue([
          { tenantId: "tenant-1", Tenant: null, Role: null },
        ]),
      };
      const svc = loadService({}, { User, Role: {}, Tenant: {} });

      const result = await svc.getUserRolesAcrossTenants("user-1");

      expect(result).toEqual([
        {
          tenantId: "tenant-1",
          tenantName: undefined,
          tenantCode: undefined,
          role: null,
        },
      ]);
    });
  });

  // ================================================================
  describe("getStatus", () => {
    it("reports the disabled defaults when no hierarchy env is set", () => {
      const svc = loadService({}, {});

      expect(svc.getStatus()).toEqual({
        enabled: false,
        maxDepth: 5,
        cascadeRoles: false,
      });
    });

    it("falls back to a max depth of 5 when the env value is not a number", () => {
      const svc = loadService({ HIERARCHY_MAX_DEPTH: "not-a-number" }, {});

      expect(svc.getStatus().maxDepth).toBe(5);
    });
  });
});
