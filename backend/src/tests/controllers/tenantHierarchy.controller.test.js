/**
 * Tests for tenantHierarchy controller
 */

jest.mock("../../services/tenantHierarchy.service", () => ({
  createSubOrganization: jest.fn(),
  getTenantTree: jest.fn(),
  getDescendantTenants: jest.fn(),
  getAncestorTenants: jest.fn(),
  getDataVisibilityScope: jest.fn(),
  assignRoleToUserAcrossHierarchy: jest.fn(),
  getUserRolesAcrossTenants: jest.fn(),
  getStatus: jest.fn(() => ({ enabled: true, maxDepth: 5, cascadeRoles: false })),
}));

jest.mock("../../models", () => ({
  Tenant: {
    findByPk: jest.fn(),
    update: jest.fn(),
  },
  TenantHierarchy: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
  AppError: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const tenantHierarchyController = require("../../controllers/tenantHierarchy.controller");
const tenantHierarchyService = require("../../services/tenantHierarchy.service");
const { success, error } = require("../../utils/response.util");

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const ROLE_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("tenantHierarchy Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    error.mockImplementation((res, message, statusCode) => {
      res.status(statusCode).json({
        success: false,
        status: statusCode,
        message,
        data: null,
      });
    });
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: USER_ID, tenantId: TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createSubOrganization", () => {
    it("should create a sub-organization", async () => {
      req.params = { parentTenantId: TENANT_ID };
      req.body = { name: "Branch A" };
      tenantHierarchyService.createSubOrganization.mockResolvedValue({
        tenantId: "child-1",
        code: "PARENT_001",
        path: "/parent/child",
      });

      await tenantHierarchyController.createSubOrganization(req, res, next);

      expect(tenantHierarchyService.createSubOrganization).toHaveBeenCalledWith(
        TENANT_ID,
        { name: "Branch A" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getTenantTree", () => {
    it("should get tenant tree for current user tenant", async () => {
      tenantHierarchyService.getTenantTree.mockResolvedValue({
        isRoot: true,
        depth: 0,
        children: [],
      });

      await tenantHierarchyController.getTenantTree(req, res, next);

      expect(tenantHierarchyService.getTenantTree).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getDescendants", () => {
    it("should get descendant tenants", async () => {
      tenantHierarchyService.getDescendantTenants.mockResolvedValue([
        { tenantId: "child-1", name: "Branch A" },
      ]);

      await tenantHierarchyController.getDescendants(req, res, next);

      expect(tenantHierarchyService.getDescendantTenants).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getAncestors", () => {
    it("should get ancestor tenants", async () => {
      tenantHierarchyService.getAncestorTenants.mockResolvedValue([
        { tenantId: "parent-1", name: "HQ" },
      ]);

      await tenantHierarchyController.getAncestors(req, res, next);

      expect(tenantHierarchyService.getAncestorTenants).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getDataVisibilityScope", () => {
    it("should return visibility scope with default self", async () => {
      tenantHierarchyService.getDataVisibilityScope.mockResolvedValue({
        tenantIds: [TENANT_ID],
        scope: "self",
      });

      await tenantHierarchyController.getDataVisibilityScope(req, res, next);

      expect(tenantHierarchyService.getDataVisibilityScope).toHaveBeenCalledWith(TENANT_ID, "self");
    });
  });

  describe("assignRoleAcrossHierarchy", () => {
    it("should assign role across hierarchy", async () => {
      req.params = { userId: USER_ID };
      req.body = { roleId: ROLE_ID, scope: "subtree" };
      tenantHierarchyService.assignRoleToUserAcrossHierarchy.mockResolvedValue({
        success: true,
        tenantCount: 3,
      });

      await tenantHierarchyController.assignRoleAcrossHierarchy(req, res, next);

      expect(tenantHierarchyService.assignRoleToUserAcrossHierarchy).toHaveBeenCalledWith(
        USER_ID,
        ROLE_ID,
        "subtree",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should default scope to subtree when the body omits it", async () => {
      req.params = { userId: USER_ID };
      req.body = { roleId: ROLE_ID };
      tenantHierarchyService.assignRoleToUserAcrossHierarchy.mockResolvedValue({
        success: true,
        tenantCount: 1,
      });

      await tenantHierarchyController.assignRoleAcrossHierarchy(req, res, next);

      expect(tenantHierarchyService.assignRoleToUserAcrossHierarchy).toHaveBeenCalledWith(
        USER_ID,
        ROLE_ID,
        "subtree",
      );
    });
  });

  describe("getUserRolesAcrossTenants", () => {
    it("should get user roles across tenants", async () => {
      req.params = { userId: USER_ID };
      tenantHierarchyService.getUserRolesAcrossTenants.mockResolvedValue([
        { tenantId: TENANT_ID, role: { name: "ADMIN" } },
      ]);

      await tenantHierarchyController.getUserRolesAcrossTenants(req, res, next);

      expect(tenantHierarchyService.getUserRolesAcrossTenants).toHaveBeenCalledWith(USER_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("should return service status", async () => {
      await tenantHierarchyController.getStatus(req, res, next);

      expect(tenantHierarchyService.getStatus).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getTenantChildren", () => {
    it("should get child tenants of a tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getTenantTree.mockResolvedValue({
        isRoot: true,
        children: [{ tenantId: "child-1", name: "Branch A" }],
      });

      await tenantHierarchyController.getTenantChildren(req, res, next);

      expect(tenantHierarchyService.getTenantTree).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return an empty children array when the tree has no children key", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getTenantTree.mockResolvedValue({ isRoot: true });

      await tenantHierarchyController.getTenantChildren(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        { children: [] },
        "Child tenants retrieved",
      );
    });
  });

  describe("getTenantParent", () => {
    it("should get parent tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getAncestorTenants.mockResolvedValue([
        { tenantId: "parent-1", name: "HQ" },
      ]);

      await tenantHierarchyController.getTenantParent(req, res, next);

      expect(tenantHierarchyService.getAncestorTenants).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should report a root tenant when there are no ancestors", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getAncestorTenants.mockResolvedValue([]);

      await tenantHierarchyController.getTenantParent(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        { parent: null },
        "Tenant is a root tenant (no parent)",
      );
    });

    it("should pick the nearest ancestor as the parent", async () => {
      req.params = { tenantId: TENANT_ID };
      // getAncestorTenants returns root-first; the parent is the LAST element.
      tenantHierarchyService.getAncestorTenants.mockResolvedValue([
        { tenantId: "root-1", name: "Root" },
        { tenantId: "parent-1", name: "HQ" },
      ]);

      await tenantHierarchyController.getTenantParent(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        { parent: { tenantId: "parent-1", name: "HQ" } },
        "Parent tenant retrieved",
      );
    });
  });

  describe("getTenantDescendants", () => {
    it("should get all descendant tenants", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getDescendantTenants.mockResolvedValue([
        { tenantId: "child-1" },
      ]);

      await tenantHierarchyController.getTenantDescendants(req, res, next);

      expect(tenantHierarchyService.getDescendantTenants).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getTenantAncestors", () => {
    it("should get all ancestor tenants", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantHierarchyService.getAncestorTenants.mockResolvedValue([
        { tenantId: "parent-1" },
      ]);

      await tenantHierarchyController.getTenantAncestors(req, res, next);

      expect(tenantHierarchyService.getAncestorTenants).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("addChildTenant", () => {
    // Validation moved into the controller: the route used to pass the Joi
    // schema's own `.validate` as express middleware, which threw on every
    // request. These cases pin the validated behaviour.
    it("should add a child tenant under a parent, applying schema defaults", async () => {
      req.params = { parentId: TENANT_ID };
      req.body = { name: "New Branch" };
      tenantHierarchyService.createSubOrganization.mockResolvedValue({
        tenantId: "child-2",
      });

      await tenantHierarchyController.addChildTenant(req, res, next);

      // Joi applies plan="free" by default.
      expect(tenantHierarchyService.createSubOrganization).toHaveBeenCalledWith(
        TENANT_ID,
        { name: "New Branch", plan: "free" },
      );
      // 201 must be the status code, not the meta argument.
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: "child-2" },
        null,
        "Child tenant created",
        201,
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should strip unknown fields before hitting the service", async () => {
      req.params = { parentId: TENANT_ID };
      req.body = { name: "New Branch", plan: "business", hacker: "ignored" };
      tenantHierarchyService.createSubOrganization.mockResolvedValue({
        tenantId: "child-3",
      });

      await tenantHierarchyController.addChildTenant(req, res, next);

      expect(tenantHierarchyService.createSubOrganization).toHaveBeenCalledWith(
        TENANT_ID,
        { name: "New Branch", plan: "business" },
      );
    });

    it("should reject a body with no name", async () => {
      req.params = { parentId: TENANT_ID };
      req.body = {};

      await tenantHierarchyController.addChildTenant(req, res, next);

      expect(tenantHierarchyService.createSubOrganization).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400 }),
      );
    });

    it("should reject an invalid plan", async () => {
      req.params = { parentId: TENANT_ID };
      req.body = { name: "New Branch", plan: "not-a-plan" };

      await tenantHierarchyController.addChildTenant(req, res, next);

      expect(tenantHierarchyService.createSubOrganization).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400 }),
      );
    });

    it("should use a generic message when the error carries no formattable details", async () => {
      // formatErrors() returns "" for empty details, so the controller falls back
      // to "Validation failed". Joi always populates details for a real error, so
      // this defensive arm is only reachable by stubbing validate().
      const validator = require("../../validators/tenantHierarchy.validator");
      const spy = jest
        .spyOn(validator.addChild, "validate")
        .mockReturnValue({ error: { details: [] }, value: undefined });

      req.params = { parentId: TENANT_ID };
      req.body = { name: "New Branch" };

      await tenantHierarchyController.addChildTenant(req, res, next);

      expect(tenantHierarchyService.createSubOrganization).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400, message: "Validation failed" }),
      );

      spy.mockRestore();
    });
  });

  describe("updateTenantParent", () => {
    it("should update a tenant's parent", async () => {
      const { Tenant, TenantHierarchy } = require("../../models");
      Tenant.findByPk.mockImplementation(() =>
        Promise.resolve({
          id: TENANT_ID,
          code: "MASTER",
          parentId: null,
          save: () => {},
        }),
      );
      Tenant.update.mockResolvedValue([1]);
      TenantHierarchy.findOne.mockImplementation(({ where }) => {
        if (where.tenantId) {
          return Promise.resolve({
            tenantCode: "MASTER",
            update: () => {},
          });
        }
        return Promise.resolve({
          tenantCode: "MASTER",
          depth: 0,
          path: "/master",
          update: () => {},
        });
      });

      req.params = { tenantId: TENANT_ID };
      req.body = { newParentId: TENANT_ID };

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(success).toHaveBeenCalled();
    });

    it("should return 404 when tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      req.params = { tenantId: TENANT_ID };
      req.body = { newParentId: "new-parent" };

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 404 when new parent not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockImplementation((id) => {
        if (id === TENANT_ID) return Promise.resolve({ save: () => {} });
        return Promise.resolve(null);
      });

      req.params = { tenantId: TENANT_ID };
      req.body = { newParentId: "nonexistent-parent" };

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should still reparent when the tenant has no hierarchy row", async () => {
      const { Tenant, TenantHierarchy } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ id: TENANT_ID, code: "MASTER" });
      Tenant.update.mockResolvedValue([1]);
      TenantHierarchy.findOne.mockResolvedValue(null);

      req.params = { tenantId: TENANT_ID };
      req.body = { newParentId: "parent-9" };

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(Tenant.update).toHaveBeenCalledWith(
        { parentId: "parent-9" },
        { where: { id: TENANT_ID } },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: TENANT_ID, newParentId: "parent-9" },
        "Parent tenant updated successfully",
      );
    });

    it("should derive the path from the parent code when the parent has no hierarchy row", async () => {
      const { Tenant, TenantHierarchy } = require("../../models");
      Tenant.findByPk.mockImplementation((id) =>
        Promise.resolve(
          id === TENANT_ID
            ? { id: TENANT_ID, code: "CHILD" }
            : { id: "parent-9", code: "HQ" },
        ),
      );
      Tenant.update.mockResolvedValue([1]);

      const hierarchyUpdate = jest.fn();
      TenantHierarchy.findOne.mockImplementation(({ where }) => {
        // The tenant has a hierarchy row; the new parent does not.
        if (where.tenantId) {
          return Promise.resolve({
            tenantCode: "CHILD",
            update: hierarchyUpdate,
          });
        }
        return Promise.resolve(null);
      });

      req.params = { tenantId: TENANT_ID };
      req.body = { newParentId: "parent-9" };

      await tenantHierarchyController.updateTenantParent(req, res, next);

      // With no parent hierarchy row the path is built from the parent's code
      // and depth restarts at 0 + 1.
      expect(hierarchyUpdate).toHaveBeenCalledWith({
        parentCode: "HQ",
        path: "/hq/child",
        depth: 1,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("removeTenantParent", () => {
    it("should remove a tenant's parent", async () => {
      const { Tenant, TenantHierarchy } = require("../../models");
      Tenant.findByPk.mockResolvedValue({
        id: TENANT_ID,
        parentId: "parent-1",
      });
      TenantHierarchy.findOne.mockResolvedValue({
        tenantCode: "PARENT",
        update: () => {},
      });

      req.params = { tenantId: TENANT_ID };

      await tenantHierarchyController.removeTenantParent(req, res, next);

      expect(success).toHaveBeenCalled();
    });

    it("should handle tenant not found", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue(null);

      req.params = { tenantId: TENANT_ID };

      await tenantHierarchyController.removeTenantParent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should handle already root tenant", async () => {
      const { Tenant } = require("../../models");
      Tenant.findByPk.mockResolvedValue({
        id: TENANT_ID,
        parentId: null,
      });

      req.params = { tenantId: TENANT_ID };

      await tenantHierarchyController.removeTenantParent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should still detach the parent when there is no hierarchy row", async () => {
      const { Tenant, TenantHierarchy } = require("../../models");
      Tenant.findByPk.mockResolvedValue({ id: TENANT_ID, parentId: "parent-1" });
      Tenant.update.mockResolvedValue([1]);
      TenantHierarchy.findOne.mockResolvedValue(null);

      req.params = { tenantId: TENANT_ID };

      await tenantHierarchyController.removeTenantParent(req, res, next);

      expect(Tenant.update).toHaveBeenCalledWith(
        { parentId: null },
        { where: { id: TENANT_ID } },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: TENANT_ID, status: "root" },
        "Parent relationship removed successfully",
      );
    });
  });

  describe("getCrossTenantRoles", () => {
    it("should return cross-tenant roles with userId filter", async () => {
      req.query = { userId: USER_ID };
      tenantHierarchyService.getUserRolesAcrossTenants.mockResolvedValue([
        { tenantId: TENANT_ID, role: { name: "ADMIN" } },
      ]);

      await tenantHierarchyController.getCrossTenantRoles(req, res, next);

      expect(tenantHierarchyService.getUserRolesAcrossTenants).toHaveBeenCalledWith(USER_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return empty when no userId filter", async () => {
      req.query = {};

      await tenantHierarchyController.getCrossTenantRoles(req, res, next);

      expect(success).toHaveBeenCalled();
    });
  });
});
