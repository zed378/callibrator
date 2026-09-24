/**
 * Tests for the e-Signature service functions that the controller called but
 * that were never implemented (the routes 500'd). Covers every branch of
 * getKeyPairs, deleteKeyPair, getWorkflows, updateWorkflow, deleteWorkflow and
 * getSignatureHistory.
 */

// A-104 — updateWorkflow/deleteWorkflow run in a transaction and write an
// audit row through audit.service, which reads AuditLog from the models
// barrel. The transaction is a pass-through here; the commit/rollback
// contract is pinned against the auditLedger fixture in
// esignature.workflowAudit.a104.test.js.
const mockAuditCreate = jest.fn(async (values) => ({ id: "audit-1", ...values }));

const load = (models) => {
  jest.doMock("../../models", () => ({ AuditLog: { create: mockAuditCreate }, ...models }));
  jest.doMock("../../config", () => ({ db: { transaction: async (cb) => cb("TX") } }));
  jest.resetModules();
  return require("../../services/eSignature.service");
};

describe("eSignature.service — implemented workflow/key methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    delete process.env.ESIGN_ENABLED;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------- getKeyPairs
  describe("getKeyPairs", () => {
    it("maps stored keys to public metadata only", async () => {
      const findAll = jest.fn().mockResolvedValue([
        {
          id: "tk-1",
          keyId: "key-1",
          keyType: "esignature",
          algorithm: "RS256",
          publicKey: "PUB",
          createdAt: new Date("2026-01-01"),
        },
      ]);
      const { getKeyPairs } = load({ TenantKey: { findAll } });

      const result = await getKeyPairs("tenant-1");

      expect(findAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1" },
        order: [["createdAt", "DESC"]],
      });
      expect(result).toEqual([
        {
          id: "tk-1",
          keyId: "key-1",
          keyType: "esignature",
          algorithm: "RS256",
          publicKey: "PUB",
          createdAt: new Date("2026-01-01"),
        },
      ]);
      // Private key must never surface.
      expect(result[0]).not.toHaveProperty("privateKey");
    });

    it("throws 500 when the query fails", async () => {
      const findAll = jest.fn().mockRejectedValue(new Error("db down"));
      const { getKeyPairs } = load({ TenantKey: { findAll } });

      await expect(getKeyPairs("tenant-1")).rejects.toThrow(
        "Failed to list key pairs",
      );
    });
  });

  // -------------------------------------------------------------- deleteKeyPair
  describe("deleteKeyPair", () => {
    it("soft-deletes an owned key", async () => {
      const destroy = jest.fn().mockResolvedValue(true);
      const findOne = jest.fn().mockResolvedValue({ id: "tk-1", destroy });
      const { deleteKeyPair } = load({ TenantKey: { findOne } });

      const result = await deleteKeyPair("tk-1", "tenant-1");

      expect(findOne).toHaveBeenCalledWith({
        where: { id: "tk-1", tenantId: "tenant-1" },
      });
      expect(destroy).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("throws 404 when the key does not exist", async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const { deleteKeyPair } = load({ TenantKey: { findOne } });

      await expect(deleteKeyPair("missing", "tenant-1")).rejects.toThrow(
        "Key pair not found",
      );
    });

    it("wraps an unexpected failure as 500", async () => {
      const findOne = jest.fn().mockRejectedValue(new Error("boom"));
      const { deleteKeyPair } = load({ TenantKey: { findOne } });

      await expect(deleteKeyPair("tk-1", "tenant-1")).rejects.toThrow(
        "Failed to delete key pair",
      );
    });
  });

  // --------------------------------------------------------------- getWorkflows
  describe("getWorkflows", () => {
    it("filters by status when provided", async () => {
      const findAll = jest.fn().mockResolvedValue([{ id: "wf-1" }]);
      const { getWorkflows } = load({ SignatureWorkflow: { findAll } });

      const result = await getWorkflows("tenant-1", { status: "pending" });

      expect(findAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", status: "pending" },
        order: [["createdAt", "DESC"]],
      });
      expect(result).toHaveLength(1);
    });

    it("lists all workflows when no status filter is given", async () => {
      const findAll = jest.fn().mockResolvedValue([]);
      const { getWorkflows } = load({ SignatureWorkflow: { findAll } });

      await getWorkflows("tenant-1");

      expect(findAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1" },
        order: [["createdAt", "DESC"]],
      });
    });

    it("throws 500 on query failure", async () => {
      const findAll = jest.fn().mockRejectedValue(new Error("db"));
      const { getWorkflows } = load({ SignatureWorkflow: { findAll } });

      await expect(getWorkflows("tenant-1")).rejects.toThrow(
        "Failed to list workflows",
      );
    });
  });

  // -------------------------------------------------------------- updateWorkflow
  describe("updateWorkflow", () => {
    it("patches only the allowed fields", async () => {
      const update = jest.fn().mockResolvedValue(true);
      const workflow = { status: "pending", update };
      const findOne = jest.fn().mockResolvedValue(workflow);
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      await updateWorkflow("wf-1", "tenant-1", {
        subject: "New subject",
        message: "hi",
        expiresAt: "2026-12-31",
        status: "completed", // must be ignored
        documentId: "evil", // must be ignored
      });

      expect(update).toHaveBeenCalledWith(
        {
          subject: "New subject",
          message: "hi",
          expiresAt: "2026-12-31",
        },
        { transaction: "TX" },
      );
      expect(findOne).toHaveBeenCalledWith({
        where: { id: "wf-1", tenantId: "tenant-1" },
        transaction: "TX",
        lock: true,
      });
    });

    it("returns the workflow after update", async () => {
      const workflow = { status: "pending", update: jest.fn().mockResolvedValue(true) };
      const findOne = jest.fn().mockResolvedValue(workflow);
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      const result = await updateWorkflow("wf-1", "tenant-1", { subject: "x" });

      expect(result).toBe(workflow);
    });

    // A-104 — nothing to change is nothing written: no update, no audit row.
    it("writes nothing, audit row included, when updates are omitted", async () => {
      const update = jest.fn().mockResolvedValue(true);
      const workflow = { status: "pending", update };
      const findOne = jest.fn().mockResolvedValue(workflow);
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      await expect(updateWorkflow("wf-1", "tenant-1")).resolves.toBe(workflow);

      expect(update).not.toHaveBeenCalled();
      expect(mockAuditCreate).not.toHaveBeenCalled();
    });

    it("throws 404 when the workflow is absent", async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      await expect(updateWorkflow("wf-1", "tenant-1", {})).rejects.toThrow(
        "Workflow not found",
      );
    });

    // A-92 — a closed workflow is a state conflict: 409 with the state and why,
    // not a 400 (the same body is accepted while the workflow is open).
    it.each([
      ["completed", "every signer has signed"],
      ["cancelled", "cancellation is final; create a new workflow instead"],
    ])("refuses to update a %s workflow with a 409 that explains the state", async (status, why) => {
      const update = jest.fn();
      const findOne = jest.fn().mockResolvedValue({ status, update });
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      const err = await updateWorkflow("wf-1", "tenant-1", { subject: "x" }).catch((e) => e);

      expect(err.status).toBe(409);
      expect(err.message).toContain(`This signature workflow is "${status}" and cannot be edited`);
      expect(err.message).toContain(why);
      expect(update).not.toHaveBeenCalled();
    });

    it("wraps an unexpected failure as 500", async () => {
      const findOne = jest.fn().mockRejectedValue(new Error("boom"));
      const { updateWorkflow } = load({ SignatureWorkflow: { findOne } });

      await expect(updateWorkflow("wf-1", "tenant-1", {})).rejects.toThrow(
        "Failed to update workflow",
      );
    });
  });

  // -------------------------------------------------------------- deleteWorkflow
  describe("deleteWorkflow", () => {
    it("soft-deletes an owned workflow", async () => {
      const destroy = jest.fn().mockResolvedValue(true);
      const findOne = jest.fn().mockResolvedValue({ id: "wf-1", destroy });
      // A-130: a workflow with no signature may still be deleted.
      const count = jest.fn().mockResolvedValue(0);
      const { deleteWorkflow } = load({ SignatureWorkflow: { findOne }, SignatureRecord: { count } });

      const result = await deleteWorkflow("wf-1", "tenant-1", { userId: "admin-1" });

      expect(destroy).toHaveBeenCalledWith({ transaction: "TX" });
      expect(result).toEqual({ success: true });
    });

    it("throws 404 when the workflow is absent", async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const { deleteWorkflow } = load({ SignatureWorkflow: { findOne } });

      await expect(deleteWorkflow("wf-1", "tenant-1")).rejects.toThrow(
        "Workflow not found",
      );
    });

    it("wraps an unexpected failure as 500", async () => {
      const findOne = jest.fn().mockRejectedValue(new Error("boom"));
      const { deleteWorkflow } = load({ SignatureWorkflow: { findOne } });

      await expect(deleteWorkflow("wf-1", "tenant-1")).rejects.toThrow(
        "Failed to delete workflow",
      );
    });
  });

  // ------------------------------------------------------- getSignatureHistory
  describe("getSignatureHistory", () => {
    // A-129 (F-9): the tenant-wide history is for a caller holding `qms`
    // read (canManage). The own-signatures scope is pinned in
    // esignature.history.a129.test.js.
    it("returns the tenant's records with no filters, to a manager", async () => {
      const findAll = jest.fn().mockResolvedValue([{ id: "sig-1" }]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      const result = await getSignatureHistory("tenant-1", {}, { callerId: "u-9", canManage: true });

      const arg = findAll.mock.calls[0][0];
      expect(arg.where).toEqual({ tenantId: "tenant-1" });
      expect(arg.attributes).toBeUndefined();
      expect(arg.order).toEqual([["signedAt", "DESC"]]);
      expect(result).toHaveLength(1);
    });

    it("with no filters and no scope it is deny-by-default: no caller, no rows", async () => {
      const findAll = jest.fn().mockResolvedValue([]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await getSignatureHistory("tenant-1");

      expect(findAll.mock.calls[0][0].where).toEqual({ tenantId: "tenant-1", userId: null });
    });

    it("filters by startDate only", async () => {
      const { Op } = require("sequelize");
      const findAll = jest.fn().mockResolvedValue([]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await getSignatureHistory("tenant-1", { startDate: "2026-01-01" });

      const where = findAll.mock.calls[0][0].where;
      expect(where.signedAt[Op.gte]).toEqual(new Date("2026-01-01"));
      expect(where.signedAt[Op.lte]).toBeUndefined();
    });

    it("filters by endDate only", async () => {
      const { Op } = require("sequelize");
      const findAll = jest.fn().mockResolvedValue([]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await getSignatureHistory("tenant-1", { endDate: "2026-02-01" });

      const where = findAll.mock.calls[0][0].where;
      expect(where.signedAt[Op.lte]).toEqual(new Date("2026-02-01"));
      expect(where.signedAt[Op.gte]).toBeUndefined();
    });

    it("filters by signer", async () => {
      const findAll = jest.fn().mockResolvedValue([]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await getSignatureHistory("tenant-1", { userId: "u-1" }, { callerId: "u-9", canManage: true });

      expect(findAll.mock.calls[0][0].where).toMatchObject({
        tenantId: "tenant-1",
        userId: "u-1",
      });
    });

    it("filters by a signedAt date range", async () => {
      const { Op } = require("sequelize");
      const findAll = jest.fn().mockResolvedValue([]);
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await getSignatureHistory("tenant-1", {
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      });

      const where = findAll.mock.calls[0][0].where;
      expect(where.signedAt[Op.gte]).toEqual(new Date("2026-01-01"));
      expect(where.signedAt[Op.lte]).toEqual(new Date("2026-02-01"));
    });

    it("throws 500 on query failure", async () => {
      const findAll = jest.fn().mockRejectedValue(new Error("db"));
      const { getSignatureHistory } = load({ SignatureRecord: { findAll } });

      await expect(getSignatureHistory("tenant-1", {})).rejects.toThrow(
        "Failed to get signature history",
      );
    });
  });
});
