/**
 * The audit ledger fixture must itself be trustworthy: a fixture that accepts
 * any `action` is the defect A-41/A-42 are about (a mock accepted "RESTORE").
 */
const { createLedger } = require("../fixtures/auditLedger");
const { AUDIT_ACTIONS } = require("../../constants/auditActions");
const constantsBarrel = require("../../constants");

describe("auditLedger fixture", () => {
  it("takes the action ENUM from models/auditLog.model.js — the six documented values", () => {
    const ledger = createLedger();
    // Independent list: docs/DATABASE/10-AUDIT-LOGS.md § The Six Actions.
    expect([...ledger.AUDIT_ACTIONS].sort()).toEqual(
      ["APPROVE", "CREATE", "DELETE", "EXPORT", "LOGIN", "UPDATE"],
    );
  });

  it("the shared AUDIT_ACTIONS constant is exactly the model ENUM", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual([...createLedger().AUDIT_ACTIONS].sort());
    expect(constantsBarrel.AUDIT_ACTIONS).toBe(AUDIT_ACTIONS);
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true);
  });

  it.each(["RESTORE", "DOCUMENT_SIGNED", "SIGNATURE_REVOKED", "create", "approve"])(
    "refuses action %s as PostgreSQL does",
    async (action) => {
      const ledger = createLedger();
      await expect(
        ledger.AuditLog.create({ tenantId: "t", action, resourceType: "X" }),
      ).rejects.toThrow(/invalid input value for enum enum_audit_logs_action/);
      expect(ledger.auditRows()).toEqual([]);
    },
  );

  it("refuses a row with no resourceType (entityType is not a column)", async () => {
    const ledger = createLedger();
    await expect(
      ledger.AuditLog.create({ tenantId: "t", action: "UPDATE", entityType: "X" }),
    ).rejects.toThrow(/AuditLog.resourceType cannot be null/);
  });

  it("commits staged writes only when the managed transaction resolves", async () => {
    const ledger = createLedger();
    await ledger.transaction(async (t) => {
      ledger.write("things", { id: 1 }, { transaction: t });
      await ledger.AuditLog.create(
        { tenantId: "t", action: "CREATE", resourceType: "Thing" },
        { transaction: t },
      );
      expect(ledger.committed("things")).toEqual([]);
    });
    expect(ledger.committed("things")).toEqual([{ id: 1 }]);
    expect(ledger.auditRows()).toHaveLength(1);
  });

  it("discards every staged write, including the audit row, on rollback", async () => {
    const ledger = createLedger();
    await expect(
      ledger.transaction(async (t) => {
        ledger.write("things", { id: 1 }, { transaction: t });
        await ledger.AuditLog.create(
          { tenantId: "t", action: "CREATE", resourceType: "Thing" },
          { transaction: t },
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(ledger.committed("things")).toEqual([]);
    expect(ledger.auditRows()).toEqual([]);
  });

  it("a write without an explicit transaction joins the ambient one (Sequelize CLS)", async () => {
    const ledger = createLedger();
    await expect(
      ledger.transaction(async () => {
        ledger.write("things", { id: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(ledger.committed("things")).toEqual([]);
  });

  it("with cls:false a write without an explicit transaction autocommits and survives the rollback", async () => {
    const ledger = createLedger({ cls: false });
    await expect(
      ledger.transaction(async () => {
        ledger.write("things", { id: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(ledger.committed("things")).toEqual([{ id: 1 }]);
  });

  it("transaction: null opts out and autocommits", async () => {
    const ledger = createLedger();
    await expect(
      ledger.transaction(async () => {
        ledger.write("things", { id: 1 }, { transaction: null });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(ledger.committed("things")).toEqual([{ id: 1 }]);
  });

  it("a swallowed failure aborts the transaction: COMMIT silently rolls back, as PostgreSQL does", async () => {
    const ledger = createLedger();
    await expect(
      ledger.transaction(async (t) => {
        ledger.write("things", { id: 1 }, { transaction: t });
        await ledger.AuditLog.create(
          { tenantId: "t", action: "RESTORE", resourceType: "Thing" },
          { transaction: t },
        ).catch(() => null);
      }),
    ).resolves.toBeUndefined();
    expect(ledger.committed("things")).toEqual([]);
    expect(() => ledger.write("things", { id: 2 }, { transaction: { aborted: true } })).toThrow(
      /current transaction is aborted/,
    );
  });

  it("failNext makes the next write to a table fail and aborts its transaction", async () => {
    const ledger = createLedger();
    ledger.failNext("audit_logs", new Error("disk full"));
    await expect(
      ledger.transaction(async (t) => {
        ledger.write("things", { id: 1 }, { transaction: t });
        await ledger.AuditLog.create(
          { tenantId: "t", action: "CREATE", resourceType: "Thing" },
          { transaction: t },
        );
      }),
    ).rejects.toThrow("disk full");
    expect(ledger.committed("things")).toEqual([]);
    expect(ledger.auditRows()).toEqual([]);
  });

  it("an unmanaged transaction commits and rolls back on request", async () => {
    const ledger = createLedger();
    const t = await ledger.transaction();
    ledger.write("things", { id: 1 }, { transaction: t });
    await t.rollback();
    const t2 = await ledger.transaction();
    ledger.write("things", { id: 2 }, { transaction: t2 });
    await t2.commit();
    await expect(t2.commit()).rejects.toThrow(/already finished/);
    expect(ledger.committed("things")).toEqual([{ id: 2 }]);
  });
});
