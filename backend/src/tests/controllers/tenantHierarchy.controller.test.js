/**
 * Tests for tenantHierarchy controller
 */

jest.mock("../../services/tenantHierarchy.service", () => ({
  createSubOrganization: jest.fn(),
  getTenantTree: jest.fn(),
  getDescendantTenants: jest.fn(),
  getAncestorTenants: jest.fn(),
  getUserRolesAcrossTenants: jest.fn(),
  updateTenantParent: jest.fn(),
  removeTenantParent: jest.fn(),
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
        expect.objectContaining({ userId: expect.any(String) }), // A-187: the audit actor
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
        expect.objectContaining({ userId: expect.any(String) }), // A-187: the audit actor
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

  // A-224: the move itself (transaction, cycle and depth checks, descendant
  // paths, audit row) is the service's — tests/services/tenantHierarchy.move.a224.test.js.
  describe("updateTenantParent", () => {
    it("hands the body's newParentId and the audit actor to the service, and answers its result", async () => {
      req.params.tenantId = TENANT_ID;
      req.body = { newParentId: USER_ID };
      tenantHierarchyService.updateTenantParent.mockResolvedValueOnce({ tenantId: TENANT_ID, parentId: USER_ID });

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(tenantHierarchyService.updateTenantParent).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        expect.objectContaining({ userId: USER_ID }),
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: TENANT_ID, parentId: USER_ID },
        null,
        "Parent tenant updated successfully",
      );
    });

    it("passes an absent newParentId through (the service answers 400), with no TypeError on a bodyless request", async () => {
      req.params.tenantId = TENANT_ID;
      req.body = undefined;
      tenantHierarchyService.updateTenantParent.mockResolvedValueOnce({});

      await tenantHierarchyController.updateTenantParent(req, res, next);

      expect(tenantHierarchyService.updateTenantParent).toHaveBeenCalledWith(TENANT_ID, undefined, expect.any(Object));
    });
  });

  describe("removeTenantParent", () => {
    it("delegates to the service and reports the tenant as a root", async () => {
      req.params.tenantId = TENANT_ID;
      tenantHierarchyService.removeTenantParent.mockResolvedValueOnce({ tenantId: TENANT_ID, parentId: null });

      await tenantHierarchyController.removeTenantParent(req, res, next);

      expect(tenantHierarchyService.removeTenantParent).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ userId: USER_ID }),
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: TENANT_ID, parentId: null, status: "root" },
        null,
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
