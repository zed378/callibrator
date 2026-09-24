/**
 * A-66 — QMS mutations write their audit row inside their transaction.
 *
 * NCs and CAPAs are quality records (ISO 13485 §8.3, §8.5.2). Until 2026-09-24
 * none of the four QMS mutations wrote an audit row at all.
 *
 * Effects against the auditLedger fixture (the real audit_logs ENUM and NOT
 * NULL columns, real rollback), with `cls: false` so every write must pass
 * `{ transaction }` explicitly — an unpassed write autocommits, survives the
 * rollback, and these tests see it. `audit.service` is the REAL one.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, nc: null, capa: null };

const mockInstance = (table, fields) => {
  const instance = { ...fields };
  instance.save = async (options) => {
    const row = { ...instance };
    delete row.save;
    return mockRef.ledger.write(table, row, options);
  };
  return instance;
};

jest.mock("../../models", () => ({
  NonConformance: {
    count: jest.fn(async () => 0),
    findOne: jest.fn(async () => mockRef.nc),
    create: jest.fn(async (values, options) => {
      mockRef.ledger.write("non_conformances", { op: "create", ...values }, options);
      return { id: "nc-new", ...values };
    }),
  },
  Capa: {
    count: jest.fn(async () => 0),
    findOne: jest.fn(async () => mockRef.capa),
    create: jest.fn(async (values, options) => {
      mockRef.ledger.write("capas", { op: "create", ...values }, options);
      return { id: "capa-new", ...values };
    }),
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  // A-75: referenced device / assignee exist in the tenant.
  User: { findOne: jest.fn(async ({ where }) => ({ id: where.id })) },
  CalibrationDevice: { findOne: jest.fn(async ({ where }) => ({ id: where.id })) },
}));
jest.mock("../../config", () => ({
  db: {
    transaction: (...args) => mockRef.ledger.transaction(...args),
    // A-73: the counter claim is a write in the create's transaction — routed
    // through the ledger so a claim outside the transaction would show.
    query: jest.fn(async (sql, options) => {
      mockRef.ledger.write("qms_counters", { kind: options.replacements.kind }, options);
      return [[{ seq: 1 }]];
    }),
  },
}));

const service = require("../../services/qms.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "user-1", tenantId: "tenant-1", ipAddress: "10.0.0.1", userAgent: "UA" };

const CASES = [
  {
    name: "createNC",
    run: () =>
      service.createNC("tenant-1", "user-1", { title: "Drift", description: "d", severity: "HIGH", deviceId: "dev-1" }, actor),
    action: "CREATE",
    resourceType: "NonConformance",
    resourceId: "nc-new",
    table: "non_conformances",
  },
  {
    name: "updateNC",
    run: () => service.updateNC("tenant-1", "nc-1", { status: "CLOSED", rootCause: "sensor" }, actor),
    action: "UPDATE",
    resourceType: "NonConformance",
    resourceId: "nc-1",
    table: "non_conformances",
  },
  {
    name: "createCapa",
    run: () =>
      service.createCapa("tenant-1", { ncId: "nc-1", title: "Recal", actionPlan: "p", assignedTo: "user-2", dueDate: "2026-10-01" }, actor),
    action: "CREATE",
    resourceType: "Capa",
    resourceId: "capa-new",
    table: "capas",
  },
  {
    name: "updateCapa",
    run: () => service.updateCapa("tenant-1", "capa-1", { status: "IN_PROGRESS" }, actor),
    action: "UPDATE",
    resourceType: "Capa",
    resourceId: "capa-1",
    table: "capas",
  },
  {
    name: "updateCapa (approval)",
    run: () =>
      service.updateCapa("tenant-1", "capa-1", { approvedBy: "someone-else", verificationNotes: "effective" }, actor),
    action: "APPROVE",
    resourceType: "Capa",
    resourceId: "capa-1",
    table: "capas",
  },
];

describe("A-66 — QMS mutations audit inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.nc = mockInstance("non_conformances", {
      id: "nc-1",
      ncNumber: "NC-00001",
      status: "OPEN",
      rootCause: null,
    });
    mockRef.capa = mockInstance("capas", {
      id: "capa-1",
      capaNumber: "CAPA-00001",
      status: "DRAFT",
      approvedBy: null,
    });
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ run, action, resourceType, resourceId, table }) => {
    it("commits the change with exactly one valid audit row naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed(table)).toHaveLength(1);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          action,
          resourceType,
          resourceId,
          ipAddress: "10.0.0.1",
          userAgent: "UA",
          changes: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }),
        }),
      ]);
    });

    it("a failing audit insert rolls the QMS change back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed(table)).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a rolled-back change leaves no audit row", async () => {
      mockRef.ledger.failNext(table, new Error("write failed"));

      await expect(run()).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });

  it("a CAPA update writes its audit row in the transaction", async () => {
    await service.updateCapa("tenant-1", "capa-1", { status: "IN_PROGRESS", title: "Re-verify" }, actor);

    // Committed together: the CAPA row and its audit row, and the audit row
    // records exactly the fields that changed, before and after.
    expect(mockRef.ledger.committed("capas")).toEqual([
      expect.objectContaining({ id: "capa-1", status: "IN_PROGRESS", title: "Re-verify" }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        resourceType: "Capa",
        resourceId: "capa-1",
        changes: {
          before: { title: null, status: "DRAFT" },
          after: { title: "Re-verify", status: "IN_PROGRESS" },
          capaNumber: "CAPA-00001",
        },
      }),
    ]);
  });

  it("an approval records the CALLER in both the CAPA and its APPROVE row (A-62)", async () => {
    await service.updateCapa("tenant-1", "capa-1", { approvedBy: "someone-else" }, actor);

    expect(mockRef.ledger.committed("capas")[0].approvedBy).toBe("user-1");
    expect(mockRef.ledger.auditRows()[0]).toEqual(
      expect.objectContaining({
        action: "APPROVE",
        userId: "user-1",
        changes: expect.objectContaining({
          before: { approvedBy: null },
          after: { approvedBy: "user-1" },
        }),
      }),
    );
  });

  it("clearing an approval is recorded as an UPDATE", async () => {
    mockRef.capa.approvedBy = "user-9";

    await service.updateCapa("tenant-1", "capa-1", { approvedBy: null }, actor);

    expect(mockRef.ledger.auditRows()[0]).toEqual(
      expect.objectContaining({
        action: "UPDATE",
        changes: expect.objectContaining({ before: { approvedBy: "user-9" }, after: { approvedBy: null } }),
      }),
    );
  });

  // A-124 (ADR-051 Q-13): with no actor the audit row cannot name one, so the
  // change is refused inside its transaction — and a body id never stands in.
  it("with no actor, the approval is refused and nothing commits — never a body id", async () => {
    await expect(
      service.updateCapa("tenant-1", "capa-1", { approvedBy: "someone-else" }),
    ).rejects.toThrow(/must name its actor/);

    expect(mockRef.ledger.committed("capas")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("createNC attributes the row to the reporter even without an actor, and records absent optionals as null", async () => {
    await service.createNC("tenant-1", "user-1", { title: "Minimal" });

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        userId: "user-1",
        action: "CREATE",
        changes: {
          before: {},
          after: { ncNumber: "NC-00001", title: "Minimal", severity: "MEDIUM", status: "OPEN", deviceId: null },
        },
      }),
    ]);
  });

  it("createCapa records absent optionals as null and names the NC it answers", async () => {
    await service.createCapa("tenant-1", { ncId: "nc-1", title: "Recal" }, actor);

    expect(mockRef.ledger.auditRows()[0].changes.after).toEqual({
      capaNumber: "CAPA-00001",
      ncId: "nc-1",
      ncNumber: "NC-00001",
      title: "Recal",
      status: "DRAFT",
      assignedTo: null,
      dueDate: null,
    });
  });

  it.each([
    ["createNC", () => service.createNC("tenant-1", "user-1", { title: "t", description: "d" }, actor)],
    ["createCapa", () => service.createCapa("tenant-1", { ncId: "nc-1", title: "t", actionPlan: "p" }, actor)],
  ])("A-73: %s claims its number inside the transaction — a rollback releases it", async (name, run) => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(run()).rejects.toThrow("audit insert failed");
    expect(mockRef.ledger.committed("qms_counters")).toEqual([]);

    await run();
    expect(mockRef.ledger.committed("qms_counters")).toHaveLength(1);
  });

  it("a not-found record writes nothing and no audit row", async () => {
    mockRef.nc = null;
    mockRef.capa = null;

    await expect(service.updateNC("tenant-1", "x", { title: "t" }, actor)).rejects.toThrow(
      "Non-Conformance not found",
    );
    await expect(service.createCapa("tenant-1", { ncId: "x" }, actor)).rejects.toThrow(
      "Non-Conformance not found",
    );
    await expect(service.updateCapa("tenant-1", "x", { title: "t" }, actor)).rejects.toThrow("CAPA not found");

    expect(mockRef.ledger.rows).toEqual([]);
  });
});
