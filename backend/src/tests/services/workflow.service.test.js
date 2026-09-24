const mockTransaction = {
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
};

const mockWorkflow = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockWorkflowStep = {
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
  findAll: jest.fn(),
};

const mockWorkflowInstance = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
};

const mockWorkflowAction = {
  create: jest.fn(),
};

const mockCertificate = {
  findOne: jest.fn(),
};

const mockStockTransfer = {
  findOne: jest.fn(),
};

const mockMaintenanceWorkOrder = {
  findOne: jest.fn(),
};

jest.mock("../../models", () => {
  return {
    Workflow: mockWorkflow,
    WorkflowStep: mockWorkflowStep,
    WorkflowInstance: mockWorkflowInstance,
    WorkflowAction: mockWorkflowAction,
    Certificate: mockCertificate,
    StockTransfer: mockStockTransfer,
    MaintenanceWorkOrder: mockMaintenanceWorkOrder,
    sequelize: {
      transaction: jest.fn(() => Promise.resolve(mockTransaction)),
    },
    db: {
      sequelize: {
        transaction: jest.fn(() => Promise.resolve(mockTransaction)),
      },
    },
  };
});

// A-145 — submitAction writes its audit row inside the action's transaction.
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));

// A-183 — submitAction asks the permission gate about the record type; the
// gate itself is tested in its own suites. Allowed unless a test says not.
const mockPrincipalHasMenuPermission = jest.fn();
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  principalHasMenuPermission: (...args) => mockPrincipalHasMenuPermission(...args),
}));

// A-182 — a Certificate decision goes through the certificate state machine;
// that half is tested through the real service in
// routes/workflows.decision.a182a183.test.js.
const mockCertificateService = {
  lockForWorkflowDecision: jest.fn(),
  verifyWorkflowApprovalAuth: jest.fn(),
  applyWorkflowApproval: jest.fn(),
  applyWorkflowRejection: jest.fn(),
};
jest.mock("../../services/certificate.service", () => mockCertificateService);

/** A-182 — the re-authentication a Certificate approval carries. */
const REAUTH = { authMethod: "password", authPayload: "pw", meaning: "Reviewed and approved" };

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const workflowService = require("../../services/workflow.service");
const auditService = require("../../services/audit.service");
const { Workflow, WorkflowStep, WorkflowInstance, WorkflowAction, Certificate, StockTransfer, MaintenanceWorkOrder } = require("../../models");

describe("Workflow Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrincipalHasMenuPermission.mockResolvedValue(true);
    // A-204 — no instance has been started unless a test says so.
    mockWorkflowInstance.count.mockResolvedValue(0);
    mockWorkflowStep.findAll.mockResolvedValue([]);
    mockCertificateService.lockForWorkflowDecision.mockImplementation(async () => ({ id: "res-1" }));
    mockCertificateService.verifyWorkflowApprovalAuth.mockResolvedValue(undefined);
    mockCertificateService.applyWorkflowApproval.mockResolvedValue(undefined);
    mockCertificateService.applyWorkflowRejection.mockResolvedValue(undefined);
    mockTransaction.commit.mockClear();
    mockTransaction.rollback.mockClear();
  });

  describe("getWorkflows", () => {
    it("should fetch all workflows for a tenant", async () => {
      const mockList = [{ id: "wf-1" }];
      Workflow.findAll.mockResolvedValue(mockList);

      const result = await workflowService.getWorkflows("tenant-1");
      expect(result).toEqual(mockList);
      expect(Workflow.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "tenant-1" },
        })
      );
    });
  });

  describe("getWorkflowById", () => {
    it("should fetch workflow by ID if it exists", async () => {
      const mockWf = { id: "wf-1" };
      Workflow.findOne.mockResolvedValue(mockWf);

      const result = await workflowService.getWorkflowById("tenant-1", "wf-1");
      expect(result).toEqual(mockWf);
    });

    it("should throw NotFoundError if workflow does not exist", async () => {
      Workflow.findOne.mockResolvedValue(null);

      await expect(
        workflowService.getWorkflowById("tenant-1", "wf-1")
      ).rejects.toThrow("Workflow not found");
    });
  });

  describe("createWorkflow", () => {
    it("should create workflow and steps, committing transaction", async () => {
      const mockWf = { id: "wf-1", resourceType: "Certificate" };
      Workflow.update.mockResolvedValue([1]);
      Workflow.create.mockResolvedValue(mockWf);
      WorkflowStep.bulkCreate.mockResolvedValue([]);
      Workflow.findOne.mockResolvedValue(mockWf);

      const data = {
        name: "Test Workflow",
        resourceType: "Certificate",
        isActive: true,
        steps: [
          { stepOrder: 1, roleId: "role-1", requiredApprovals: 2 },
        ],
      };

      const result = await workflowService.createWorkflow("tenant-1", data);
      
      expect(Workflow.update).toHaveBeenCalled();
      expect(Workflow.create).toHaveBeenCalled();
      expect(WorkflowStep.bulkCreate).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result).toEqual(mockWf);
    });

    it("should rollback transaction on error", async () => {
      Workflow.update.mockRejectedValue(new Error("DB error"));

      await expect(
        workflowService.createWorkflow("tenant-1", { steps: [] })
      ).rejects.toThrow("DB error");
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("should default isActive to true and requiredApprovals to 1 when omitted", async () => {
      const mockWf = { id: "wf-2", resourceType: "Certificate" };
      Workflow.update.mockResolvedValue([1]);
      Workflow.create.mockResolvedValue(mockWf);
      WorkflowStep.bulkCreate.mockResolvedValue([]);
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.createWorkflow("tenant-1", {
        name: "Defaults",
        resourceType: "Certificate",
        steps: [{ stepOrder: 1, roleId: "role-1" }],
      });

      expect(Workflow.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
        { transaction: mockTransaction }
      );
      expect(WorkflowStep.bulkCreate).toHaveBeenCalledWith(
        [{ workflowId: "wf-2", stepOrder: 1, roleId: "role-1", requiredApprovals: 1 }],
        { transaction: mockTransaction }
      );
    });

    it("should not deactivate sibling workflows when creating an inactive workflow", async () => {
      // Only an incoming *active* workflow should deactivate the existing one.
      const mockWf = { id: "wf-3", resourceType: "Certificate" };
      Workflow.create.mockResolvedValue(mockWf);
      WorkflowStep.bulkCreate.mockResolvedValue([]);
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.createWorkflow("tenant-1", {
        name: "Inactive",
        resourceType: "Certificate",
        isActive: false,
        steps: [{ stepOrder: 1, roleId: "role-1" }],
      });

      expect(Workflow.update).not.toHaveBeenCalled();
      expect(Workflow.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
        { transaction: mockTransaction }
      );
    });
  });

  describe("updateWorkflow", () => {
    it("should update workflow properties and steps", async () => {
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: false,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);
      Workflow.update.mockResolvedValue([1]);
      WorkflowStep.destroy.mockResolvedValue(1);
      WorkflowStep.bulkCreate.mockResolvedValue([]);

      const data = {
        name: "New Name",
        isActive: true,
        steps: [{ stepOrder: 1, roleId: "role-1" }],
      };

      const result = await workflowService.updateWorkflow("tenant-1", "wf-1", data);
      
      expect(mockWf.name).toBe("New Name");
      expect(mockWf.isActive).toBe(true);
      expect(Workflow.update).toHaveBeenCalled();
      expect(mockWf.save).toHaveBeenCalled();
      expect(WorkflowStep.destroy).toHaveBeenCalled();
      expect(WorkflowStep.bulkCreate).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result).toEqual(mockWf);
    });

    it("should rollback on update error", async () => {
      const mockWf = {
        id: "wf-1",
        save: jest.fn().mockRejectedValue(new Error("Save failed")),
      };
      Workflow.findOne.mockResolvedValue(mockWf);

      await expect(
        workflowService.updateWorkflow("tenant-1", "wf-1", { name: "New" })
      ).rejects.toThrow("Save failed");
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("should leave name and steps untouched when the payload omits them", async () => {
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: true,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.updateWorkflow("tenant-1", "wf-1", {});

      expect(mockWf.name).toBe("Old Name");
      expect(mockWf.isActive).toBe(true);
      expect(Workflow.update).not.toHaveBeenCalled();
      expect(WorkflowStep.destroy).not.toHaveBeenCalled();
      expect(WorkflowStep.bulkCreate).not.toHaveBeenCalled();
      expect(mockWf.save).toHaveBeenCalledWith({ transaction: mockTransaction });
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it("should deactivate a workflow without deactivating its siblings", async () => {
      // Turning a workflow OFF must not trigger the "only one active" sweep.
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: true,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.updateWorkflow("tenant-1", "wf-1", { isActive: false });

      expect(mockWf.isActive).toBe(false);
      expect(Workflow.update).not.toHaveBeenCalled();
      expect(mockWf.save).toHaveBeenCalled();
    });

    it("should skip the isActive sweep when the value is unchanged", async () => {
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: true,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.updateWorkflow("tenant-1", "wf-1", { isActive: true });

      expect(Workflow.update).not.toHaveBeenCalled();
      expect(mockWf.isActive).toBe(true);
    });

    it("should ignore an empty steps array rather than wiping existing steps", async () => {
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: true,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.updateWorkflow("tenant-1", "wf-1", { steps: [] });

      expect(WorkflowStep.destroy).not.toHaveBeenCalled();
      expect(WorkflowStep.bulkCreate).not.toHaveBeenCalled();
    });

    it("should default requiredApprovals to 1 on replaced steps", async () => {
      const mockWf = {
        id: "wf-1",
        name: "Old Name",
        isActive: true,
        resourceType: "Certificate",
        save: jest.fn().mockResolvedValue(),
      };
      Workflow.findOne.mockResolvedValue(mockWf);
      WorkflowStep.destroy.mockResolvedValue(1);
      WorkflowStep.bulkCreate.mockResolvedValue([]);

      await workflowService.updateWorkflow("tenant-1", "wf-1", {
        steps: [{ stepOrder: 1, roleId: "role-1" }],
      });

      expect(WorkflowStep.bulkCreate).toHaveBeenCalledWith(
        [{ workflowId: "wf-1", stepOrder: 1, roleId: "role-1", requiredApprovals: 1 }],
        { transaction: mockTransaction }
      );
    });
  });

  describe("deleteWorkflow", () => {
    it("should destroy the workflow", async () => {
      const mockWf = { id: "wf-1", destroy: jest.fn().mockResolvedValue() };
      Workflow.findOne.mockResolvedValue(mockWf);

      await workflowService.deleteWorkflow("tenant-1", "wf-1");
      expect(mockWf.destroy).toHaveBeenCalledWith({ transaction: mockTransaction });
      expect(mockTransaction.commit).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // A-204 — workflow definitions are audited, locked, and cannot erase the
  // approvals made against them.
  // ------------------------------------------------------------------
  describe("A-204 — workflow definition changes", () => {
    const ACTOR = { userId: "admin-1", ipAddress: "10.0.0.2", userAgent: "ua" };
    const definition = (fields = {}) => ({
      id: "wf-1",
      name: "Cert approval",
      resourceType: "Certificate",
      isActive: true,
      save: jest.fn().mockResolvedValue(),
      destroy: jest.fn().mockResolvedValue(),
      ...fields,
    });

    it("a create writes one CREATE audit row, with the steps, in its transaction", async () => {
      Workflow.create.mockResolvedValue(definition());
      Workflow.findOne.mockResolvedValue(definition());

      await workflowService.createWorkflow(
        "tenant-1",
        { name: "Cert approval", resourceType: "Certificate", steps: [{ stepOrder: 1, roleId: "r-1", requiredApprovals: 2 }] },
        ACTOR,
      );

      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          userId: "admin-1",
          action: "CREATE",
          resourceType: "Workflow",
          resourceId: "wf-1",
          changes: {
            before: {},
            after: {
              name: "Cert approval",
              resourceType: "Certificate",
              isActive: true,
              steps: [{ stepOrder: 1, roleId: "r-1", requiredApprovals: 2 }],
            },
          },
          ipAddress: "10.0.0.2",
          userAgent: "ua",
        },
        { transaction: mockTransaction },
      );
    });

    it("a failed audit row rolls the create back", async () => {
      Workflow.create.mockResolvedValue(definition());
      auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

      await expect(
        workflowService.createWorkflow("tenant-1", { name: "x", resourceType: "Certificate", steps: [{ stepOrder: 1, roleId: "r-1" }] }),
      ).rejects.toThrow("audit insert failed");
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });

    it("an update reads the workflow locked inside its transaction, and audits before and after", async () => {
      const wf = definition();
      Workflow.findOne.mockResolvedValue(wf);
      mockWorkflowStep.findAll.mockResolvedValue([{ stepOrder: 1, roleId: "r-old", requiredApprovals: 1 }]);

      await workflowService.updateWorkflow(
        "tenant-1",
        "wf-1",
        { name: "Renamed", steps: [{ stepOrder: 1, roleId: "r-new" }] },
        ACTOR,
      );

      expect(Workflow.findOne.mock.calls[0][0]).toEqual({
        where: { id: "wf-1", tenantId: "tenant-1" },
        transaction: mockTransaction,
        lock: "UPDATE",
      });
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE",
          resourceType: "Workflow",
          resourceId: "wf-1",
          userId: "admin-1",
          changes: {
            before: { name: "Cert approval", isActive: true, steps: [{ stepOrder: 1, roleId: "r-old", requiredApprovals: 1 }] },
            after: { name: "Renamed", isActive: true, steps: [{ stepOrder: 1, roleId: "r-new", requiredApprovals: 1 }] },
          },
        }),
        { transaction: mockTransaction },
      );
    });

    it("replacing the steps of a workflow that has been started is 409, and nothing is written", async () => {
      Workflow.findOne.mockResolvedValue(definition());
      mockWorkflowInstance.count.mockResolvedValue(3);

      await expect(
        workflowService.updateWorkflow("tenant-1", "wf-1", { steps: [{ stepOrder: 1, roleId: "r-new" }] }, ACTOR),
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("started 3 time(s)") });

      // Counted across soft-deleted instances too: their approvals reference the steps.
      expect(mockWorkflowInstance.count).toHaveBeenCalledWith({
        where: { workflowId: "wf-1" },
        paranoid: false,
        transaction: mockTransaction,
      });
      expect(WorkflowStep.destroy).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("a started workflow can still be renamed or deactivated", async () => {
      const wf = definition();
      Workflow.findOne.mockResolvedValue(wf);
      mockWorkflowInstance.count.mockResolvedValue(3);

      await workflowService.updateWorkflow("tenant-1", "wf-1", { isActive: false }, ACTOR);

      expect(wf.isActive).toBe(false);
      expect(mockWorkflowInstance.count).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it.each([["updateWorkflow", { name: "x" }], ["deleteWorkflow", undefined]])(
      "%s of a workflow not in the tenant is 404",
      async (method, data) => {
        Workflow.findOne.mockResolvedValue(null);

        const args = data ? ["tenant-1", "wf-x", data, ACTOR] : ["tenant-1", "wf-x", ACTOR];
        await expect(workflowService[method](...args)).rejects.toMatchObject({ status: 404 });
        expect(auditService.logAction).not.toHaveBeenCalled();
      },
    );

    it("deleting a workflow with pending approvals is 409, and nothing is deleted", async () => {
      const wf = definition();
      Workflow.findOne.mockResolvedValue(wf);
      mockWorkflowInstance.count.mockResolvedValue(2);

      await expect(workflowService.deleteWorkflow("tenant-1", "wf-1", ACTOR)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("2 pending approval(s)"),
      });
      expect(mockWorkflowInstance.count).toHaveBeenCalledWith({
        where: { workflowId: "wf-1", status: "PENDING" },
        transaction: mockTransaction,
      });
      expect(wf.destroy).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it("a delete writes one DELETE audit row in its transaction", async () => {
      const wf = definition();
      Workflow.findOne.mockResolvedValue(wf);

      await workflowService.deleteWorkflow("tenant-1", "wf-1", ACTOR);

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DELETE",
          resourceType: "Workflow",
          resourceId: "wf-1",
          userId: "admin-1",
          changes: {
            before: { name: "Cert approval", resourceType: "Certificate", isActive: true },
            after: { deleted: true },
          },
        }),
        { transaction: mockTransaction },
      );
    });

    it("the inbox skips an instance whose workflow is gone instead of failing", async () => {
      WorkflowInstance.findAll.mockResolvedValue([
        { id: "orphan", currentStepOrder: 1, workflow: null, actions: [] },
        { id: "ok", currentStepOrder: 1, workflow: { steps: [{ id: "s1", stepOrder: 1, roleId: "admin" }] }, actions: [] },
      ]);

      const result = await workflowService.getPendingTasks("tenant-1", { id: "u-1", roleId: "admin" });

      expect(result.map((i) => i.id)).toEqual(["ok"]);
    });
  });

  describe("startWorkflow", () => {
    it("should return null if no active workflow exists", async () => {
      Workflow.findOne.mockResolvedValue(null);
      const result = await workflowService.startWorkflow("tenant-1", "Certificate", "resource-1");
      expect(result).toBeNull();
    });

    it("should create a WorkflowInstance if active workflow exists", async () => {
      const mockWorkflow = {
        id: "wf-1",
        steps: [{ id: "step-1", stepOrder: 1, roleId: "role-1" }],
      };
      Workflow.findOne.mockResolvedValue(mockWorkflow);
      WorkflowInstance.create.mockResolvedValue({ id: "instance-1", status: "PENDING" });

      const result = await workflowService.startWorkflow("tenant-1", "Certificate", "resource-1");
      
      expect(result).toBeDefined();
      expect(WorkflowInstance.create).toHaveBeenCalled();
    });

    it("should log warn and return null when DB query throws error", async () => {
      Workflow.findOne.mockRejectedValue(new Error("Query failed"));

      const result = await workflowService.startWorkflow("tenant-1", "Certificate", "resource-1");
      expect(result).toBeNull();
    });

    it("A-190: inside a caller's transaction a failed lookup is thrown, not guessed as 'no workflow'", async () => {
      Workflow.findOne.mockRejectedValue(new Error("Query failed"));
      const tx = { id: "caller-tx" };

      await expect(
        workflowService.startWorkflow("tenant-1", "Certificate", "resource-1", tx),
      ).rejects.toThrow("Query failed");
      expect(WorkflowInstance.create).not.toHaveBeenCalled();
    });

    it("A-190: the instance is created in the caller's transaction", async () => {
      Workflow.findOne.mockResolvedValue({ id: "wf-1", steps: [{ id: "s1", stepOrder: 3 }] });
      WorkflowInstance.create.mockResolvedValue({ id: "instance-1" });
      const tx = { id: "caller-tx" };

      await workflowService.startWorkflow("tenant-1", "Certificate", "resource-1", tx);

      expect(Workflow.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction: tx }));
      expect(WorkflowInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "resource-1", status: "PENDING", currentStepOrder: 3 }),
        { transaction: tx },
      );
    });
  });

  describe("getPendingTasks", () => {
    it("should return pending tasks requiring the user's role and not already acted upon", async () => {
      const mockInstances = [
        {
          id: "instance-1",
          status: "PENDING",
          currentStepOrder: 1,
          workflow: {
            steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
          },
          actions: [],
        },
        {
          id: "instance-2",
          status: "PENDING",
          currentStepOrder: 1,
          workflow: {
            steps: [{ id: "step-2", stepOrder: 1, roleId: "admin" }],
          },
          actions: [{ stepId: "step-2", userId: "user-1" }],
        },
        {
          id: "instance-3",
          status: "PENDING",
          currentStepOrder: 1,
          workflow: {
            steps: [{ id: "step-3", stepOrder: 2, roleId: "admin" }], // mismatch currentStepOrder
          },
          actions: [],
        },
      ];

      WorkflowInstance.findAll.mockResolvedValue(mockInstances);

      const user = { id: "user-1", roleId: "admin" };
      const result = await workflowService.getPendingTasks("tenant-1", user);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("instance-1");
    });

    it("should exclude instances whose current step belongs to a different role", async () => {
      WorkflowInstance.findAll.mockResolvedValue([
        {
          id: "instance-other-role",
          status: "PENDING",
          currentStepOrder: 1,
          workflow: {
            steps: [{ id: "step-1", stepOrder: 1, roleId: "manager" }],
          },
          actions: [],
        },
      ]);

      const result = await workflowService.getPendingTasks("tenant-1", {
        id: "user-1",
        roleId: "admin",
      });

      expect(result).toEqual([]);
    });
  });

  describe("submitAction", () => {
    it("should throw 404 if instance not found", async () => {
      WorkflowInstance.findOne.mockResolvedValue(null);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", {}, {})
      ).rejects.toThrow("Workflow instance not found");
    });

    it("should throw 409 if instance status is not PENDING (A-145: a state conflict)", async () => {
      const mockInstance = { id: "instance-1", status: "APPROVED" };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", {}, {})
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("Workflow instance is already APPROVED"),
      });
    });

    it("should throw 500 if step configuration is missing", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: { steps: [] },
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", {}, {})
      ).rejects.toThrow("Workflow step configuration error");
    });

    it("should throw 403 if user does not have the required role", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [],
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", { roleId: "user" }, {})
      ).rejects.toThrow("You do not have the required role to approve this step");
    });

    it("should throw 409 if user has already acted on this step", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [{ stepId: "step-1", userId: "user-1" }],
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", { id: "user-1", roleId: "admin" }, {})
      ).rejects.toMatchObject({
        status: 409,
        message: "You have already submitted an action for this step",
      });
    });

    it("should process REJECTED action and update resource status", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});
      const lockedCert = { id: "res-1", status: "pending_approval" };
      mockCertificateService.lockForWorkflowDecision.mockResolvedValue(lockedCert);

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "REJECTED", comments: "Bad" }
      );

      expect(mockInstance.status).toBe("REJECTED");
      expect(mockInstance.save).toHaveBeenCalled();
      // A-182 — through the certificate state machine, not a blind "DRAFT".
      expect(mockCertificateService.lockForWorkflowDecision).toHaveBeenCalledWith(
        mockTransaction, "tenant-1", "res-1", "reject",
      );
      expect(mockCertificateService.applyWorkflowRejection).toHaveBeenCalledWith(
        mockTransaction, lockedCert,
        { tenantId: "tenant-1", userId: "user-1", workflowInstanceId: "instance-1", comments: "Bad" },
      );
      // A rejection is not a signature: no re-authentication.
      expect(mockCertificateService.verifyWorkflowApprovalAuth).not.toHaveBeenCalled();
      expect(Certificate.findOne).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result.status).toBe("REJECTED");
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          action: "UPDATE",
          resourceType: "WorkflowInstance",
          resourceId: "instance-1",
          changes: expect.objectContaining({
            operation: "WORKFLOW_REJECT",
            decision: "REJECTED",
            comments: "Bad",
            before: { status: "PENDING", currentStepOrder: 1 },
            after: { status: "REJECTED", currentStepOrder: 1 },
          }),
        }),
        { transaction: mockTransaction },
      );
    });

    it("should process APPROVED and advance to next step if not final", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [
            { id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 },
            { id: "step-2", stepOrder: 2, roleId: "manager", requiredApprovals: 1 },
          ],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED", ...REAUTH }
      );

      expect(mockInstance.currentStepOrder).toBe(2);
      // A-182 — an intermediate Certificate approval re-authenticates too, but
      // does not touch the certificate.
      expect(mockCertificateService.verifyWorkflowApprovalAuth).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining(REAUTH),
        { tenantId: "tenant-1", resourceType: "Certificate", resourceId: "res-1", operation: "workflow-approve" },
      );
      expect(mockCertificateService.lockForWorkflowDecision).not.toHaveBeenCalled();
      expect(mockInstance.save).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result.status).toBe("PENDING");
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "APPROVE",
          changes: expect.objectContaining({
            operation: "WORKFLOW_APPROVE",
            comments: null,
            after: { status: "PENDING", currentStepOrder: 2 },
          }),
        }),
        { transaction: mockTransaction },
      );
    });

    it("should process APPROVED, finalize workflow and update resource status (StockTransfer, MaintenanceWorkOrder)", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "StockTransfer",
          steps: [
            { id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 },
          ],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const mockST = { id: "res-1", status: "Pending", save: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValue(mockST);

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED" }
      );

      expect(mockInstance.status).toBe("APPROVED");
      expect(mockInstance.save).toHaveBeenCalled();
      expect(mockST.status).toBe("Approved");
      expect(mockST.save).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result.status).toBe("APPROVED");
    });

    it("should update MaintenanceWorkOrder when approved", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "MaintenanceWorkOrder",
          steps: [
            { id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 },
          ],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const mockWO = { id: "res-1", status: "Assigned", save: jest.fn().mockResolvedValue() };
      MaintenanceWorkOrder.findOne.mockResolvedValue(mockWO);

      await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED" }
      );

      expect(mockWO.status).toBe("Completed");
    });

    it("should process APPROVED, finalize workflow and update Certificate status", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [
            { id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 },
          ],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});
      const lockedCert = { id: "res-1", status: "pending_approval" };
      mockCertificateService.lockForWorkflowDecision.mockResolvedValue(lockedCert);

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED", ...REAUTH, ipAddress: "10.0.0.1", userAgent: "jest" }
      );

      expect(mockInstance.status).toBe("APPROVED");
      expect(mockInstance.save).toHaveBeenCalled();
      expect(mockCertificateService.lockForWorkflowDecision).toHaveBeenCalledWith(
        mockTransaction, "tenant-1", "res-1", "approve",
      );
      expect(mockCertificateService.applyWorkflowApproval).toHaveBeenCalledWith(mockTransaction, lockedCert, {
        tenantId: "tenant-1",
        approverId: "user-1",
        authOptions: { ...REAUTH, ipAddress: "10.0.0.1", userAgent: "jest" },
        workflowInstanceId: "instance-1",
      });
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: "10.0.0.1",
          userAgent: "jest",
          changes: expect.objectContaining({ meaning: REAUTH.meaning, reauthenticated: "password" }),
        }),
        { transaction: mockTransaction },
      );
      // The credential itself is never in the audit row.
      expect(JSON.stringify(auditService.logAction.mock.calls)).not.toContain(REAUTH.authPayload);
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result.status).toBe("APPROVED");
    });

    it("should process REJECTED action and update StockTransfer status", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "StockTransfer",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});
      
      const mockST = { id: "res-1", status: "Pending", save: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValue(mockST);

      await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "REJECTED" }
      );

      expect(mockST.status).toBe("Rejected");
    });

    it("should handle missing target resource gracefully during status update", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "StockTransfer",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      StockTransfer.findOne.mockResolvedValue(null);

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "REJECTED" }
      );

      expect(result.status).toBe("REJECTED");
    });

    it("should rollback transaction on submit error", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin" }],
        },
        actions: [],
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockRejectedValue(new Error("Insert error"));

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", { id: "user-1", roleId: "admin" }, { action: "APPROVED" })
      ).rejects.toThrow("Insert error");

      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // Branch coverage: approval tallying
    // ----------------------------------------------------------------
    it("should stay on the current step when required approvals are not yet met", async () => {
      // Step needs 2 approvals and this is the first one — no advance, no finalize.
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 2 }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED", ...REAUTH }
      );

      expect(WorkflowAction.create).toHaveBeenCalled();
      expect(mockCertificateService.lockForWorkflowDecision).not.toHaveBeenCalled();
      expect(mockInstance.status).toBe("PENDING");
      expect(mockInstance.currentStepOrder).toBe(1);
      expect(mockInstance.save).not.toHaveBeenCalled();
      expect(Certificate.findOne).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result).toEqual({ message: "Action submitted successfully", status: "PENDING" });
    });

    it("should finalize once a second approver meets the required approvals", async () => {
      // One prior APPROVED action by another user on this step + this one == 2.
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 2 }],
        },
        actions: [
          { stepId: "step-1", userId: "user-9", action: "APPROVED" },
        ],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED", ...REAUTH }
      );

      expect(mockInstance.status).toBe("APPROVED");
      expect(mockCertificateService.applyWorkflowApproval).toHaveBeenCalledWith(
        mockTransaction,
        { id: "res-1" },
        expect.objectContaining({ approverId: "user-1", workflowInstanceId: "instance-1" }),
      );
      expect(result.status).toBe("APPROVED");
    });

    it("should count only APPROVED actions belonging to the current step", async () => {
      // Tally must ignore (a) actions on other steps and (b) non-APPROVED actions
      // on this step. Neither of the two prior actions counts, so 0 + 1 < 2.
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "Certificate",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 2 }],
        },
        actions: [
          { stepId: "step-2", userId: "user-9", action: "APPROVED" }, // other step
          { stepId: "step-1", userId: "user-8", action: "COMMENTED" }, // not an approval
        ],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "APPROVED", ...REAUTH }
      );

      expect(mockInstance.status).toBe("PENDING");
      expect(mockInstance.save).not.toHaveBeenCalled();
      expect(result.status).toBe("PENDING");
    });

    it("should record an action with a status other than APPROVED/REJECTED without changing the instance", async () => {
      // submitAction only branches on the two known statuses; anything else is
      // persisted as an action but leaves the instance untouched.
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "StockTransfer",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});

      const result = await workflowService.submitAction(
        "tenant-1",
        "instance-1",
        { id: "user-1", roleId: "admin" },
        { action: "ESCALATED", comments: "over to you" }
      );

      expect(WorkflowAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "ESCALATED", comments: "over to you" }),
        { transaction: mockTransaction }
      );
      expect(mockInstance.status).toBe("PENDING");
      expect(mockInstance.save).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(result.status).toBe("PENDING");
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE",
          changes: expect.objectContaining({ operation: "WORKFLOW_ACTION", decision: "ESCALATED" }),
        }),
        { transaction: mockTransaction },
      );
    });

    it("A-145: a failed audit write rolls the action back instead of committing it unattributed", async () => {
      const mockInstance = {
        id: "instance-1",
        status: "PENDING",
        currentStepOrder: 1,
        workflow: {
          resourceType: "StockTransfer",
          steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 2 }],
        },
        actions: [],
        resourceId: "res-1",
        save: jest.fn().mockResolvedValue(),
      };
      WorkflowInstance.findOne.mockResolvedValue(mockInstance);
      WorkflowAction.create.mockResolvedValue({});
      auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

      await expect(
        workflowService.submitAction(
          "tenant-1",
          "instance-1",
          { id: "user-1", roleId: "admin" },
          { action: "APPROVED" },
        ),
      ).rejects.toThrow("audit insert failed");
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // A-182 / A-183
  // ------------------------------------------------------------------
  describe("submitAction — A-182 / A-183", () => {
    const certificateInstance = (overrides = {}) => ({
      id: "instance-1",
      status: "PENDING",
      currentStepOrder: 1,
      workflow: {
        resourceType: "Certificate",
        steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 1 }],
      },
      actions: [],
      resourceId: "res-1",
      save: jest.fn().mockResolvedValue(),
      ...overrides,
    });
    const APPROVER = { id: "user-1", roleId: "admin", role: { id: "admin", name: "TECHNICIAN" } };

    it("A-183: the instance is locked (FOR UPDATE) inside the transaction before anything is read", async () => {
      WorkflowInstance.findOne.mockResolvedValue(certificateInstance());
      WorkflowAction.create.mockResolvedValue({});

      await workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED", ...REAUTH });

      const [first, second] = WorkflowInstance.findOne.mock.calls.map(([options]) => options);
      expect(first).toEqual({
        where: { id: "instance-1", tenantId: "tenant-1" },
        transaction: mockTransaction,
        lock: "UPDATE",
      });
      // The read with the actions and the steps is in the same transaction.
      expect(second).toEqual(expect.objectContaining({ transaction: mockTransaction }));
    });

    it("A-183: a caller without write access to the record type is refused 403, and nothing is written", async () => {
      WorkflowInstance.findOne.mockResolvedValue(certificateInstance());
      mockPrincipalHasMenuPermission.mockResolvedValue(false);

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED", ...REAUTH }),
      ).rejects.toMatchObject({ status: 403, message: expect.stringContaining('"certificate"') });

      expect(mockPrincipalHasMenuPermission).toHaveBeenCalledWith(APPROVER, "certificate", "write");
      expect(WorkflowAction.create).not.toHaveBeenCalled();
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it.each([
      ["StockTransfer", "warehouse"],
      ["MaintenanceWorkOrder", "maintenance"],
    ])("A-183: a %s decision asks for write on %s", async (resourceType, menu) => {
      WorkflowInstance.findOne.mockResolvedValue(
        certificateInstance({ workflow: { resourceType, steps: [{ id: "step-1", stepOrder: 1, roleId: "admin", requiredApprovals: 2 }] } }),
      );
      WorkflowAction.create.mockResolvedValue({});

      await workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED" });

      expect(mockPrincipalHasMenuPermission).toHaveBeenCalledWith(APPROVER, menu, "write");
      // Not a Certificate: no re-authentication is asked for.
      expect(mockCertificateService.verifyWorkflowApprovalAuth).not.toHaveBeenCalled();
    });

    it.each([
      ["no fields", {}],
      ["no authPayload", { authMethod: "password", meaning: "ok" }],
      ["no meaning", { authMethod: "password", authPayload: "pw" }],
      ["no authMethod", { authPayload: "pw", meaning: "ok" }],
    ])("A-182: a Certificate approval with %s is 400 and nothing is written", async (_label, fields) => {
      WorkflowInstance.findOne.mockResolvedValue(certificateInstance());

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED", ...fields }),
      ).rejects.toMatchObject({ status: 400, message: workflowService.CERTIFICATE_APPROVAL_NEEDS_REAUTH });

      expect(mockCertificateService.verifyWorkflowApprovalAuth).not.toHaveBeenCalled();
      expect(WorkflowAction.create).not.toHaveBeenCalled();
    });

    it("A-182: a failed re-authentication writes nothing", async () => {
      WorkflowInstance.findOne.mockResolvedValue(certificateInstance());
      mockCertificateService.verifyWorkflowApprovalAuth.mockRejectedValue(
        Object.assign(new Error("Invalid password for e-signature."), { status: 401 }),
      );

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED", ...REAUTH }),
      ).rejects.toMatchObject({ status: 401 });

      expect(WorkflowAction.create).not.toHaveBeenCalled();
      expect(mockCertificateService.applyWorkflowApproval).not.toHaveBeenCalled();
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("A-182: a refused state check comes before re-authentication (no MFA code is consumed)", async () => {
      WorkflowInstance.findOne.mockResolvedValue(certificateInstance());
      mockCertificateService.lockForWorkflowDecision.mockRejectedValue(
        Object.assign(new Error('This certificate is "draft" and cannot be approved'), { status: 409 }),
      );

      await expect(
        workflowService.submitAction("tenant-1", "instance-1", APPROVER, { action: "APPROVED", ...REAUTH }),
      ).rejects.toMatchObject({ status: 409 });

      expect(mockCertificateService.verifyWorkflowApprovalAuth).not.toHaveBeenCalled();
      expect(WorkflowAction.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // _updateTargetResourceStatus is exercised indirectly by submitAction, which
  // always passes the approving user. These call it directly to reach the
  // no-approver / unknown-status / missing-record branches.
  // ------------------------------------------------------------------
  describe("_updateTargetResourceStatus", () => {
    const t = {};

    it("should null out approvedBy on a StockTransfer when no approver is supplied", async () => {
      const mockST = { id: "res-1", status: "Pending", save: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValue(mockST);

      await workflowService._updateTargetResourceStatus("tenant-1", "StockTransfer", "res-1", "APPROVED", t);

      expect(mockST.status).toBe("Approved");
      expect(mockST.approvedBy).toBeNull();
      expect(mockST.save).toHaveBeenCalledWith({ transaction: t });
    });

    it("A-182: never touches a Certificate — its decisions go through the certificate state machine", async () => {
      await workflowService._updateTargetResourceStatus("tenant-1", "Certificate", "res-1", "APPROVED", t);

      expect(Certificate.findOne).not.toHaveBeenCalled();
    });

    it("should leave a StockTransfer status untouched for an unrecognised final status", async () => {
      const mockST = { id: "res-1", status: "Pending", save: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValue(mockST);

      await workflowService._updateTargetResourceStatus("tenant-1", "StockTransfer", "res-1", "CANCELLED", t);

      expect(mockST.status).toBe("Pending");
      expect(mockST.save).toHaveBeenCalledWith({ transaction: t });
    });

    it("should leave a MaintenanceWorkOrder status untouched when rejected", async () => {
      // Only APPROVED maps to a work-order status ("Completed"); REJECTED is a no-op.
      const mockWo = { id: "res-1", status: "Open", save: jest.fn().mockResolvedValue() };
      MaintenanceWorkOrder.findOne.mockResolvedValue(mockWo);

      await workflowService._updateTargetResourceStatus("tenant-1", "MaintenanceWorkOrder", "res-1", "REJECTED", t);

      expect(mockWo.status).toBe("Open");
      expect(mockWo.save).toHaveBeenCalledWith({ transaction: t });
    });

    it("should no-op when a StockTransfer record is missing", async () => {
      StockTransfer.findOne.mockResolvedValue(null);

      await expect(
        workflowService._updateTargetResourceStatus("tenant-1", "StockTransfer", "gone", "APPROVED", t)
      ).resolves.toBeUndefined();
    });

    it("should no-op when a MaintenanceWorkOrder record is missing", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValue(null);

      await expect(
        workflowService._updateTargetResourceStatus("tenant-1", "MaintenanceWorkOrder", "gone", "APPROVED", t)
      ).resolves.toBeUndefined();
    });

    it("should no-op for an unknown resource type without querying any model", async () => {
      await expect(
        workflowService._updateTargetResourceStatus("tenant-1", "SomethingElse", "res-1", "APPROVED", t)
      ).resolves.toBeUndefined();

      expect(Certificate.findOne).not.toHaveBeenCalled();
      expect(StockTransfer.findOne).not.toHaveBeenCalled();
      expect(MaintenanceWorkOrder.findOne).not.toHaveBeenCalled();
    });
  });
});
