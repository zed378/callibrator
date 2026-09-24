/**
 * The audit ledger fixture must itself be trustworthy: a fixture that accepts
 * any `action` is the defect A-41/A-42 are about (a mock accepted "RESTORE").
 */
const { createLedger } = require("../fixtures/auditLedger");
const { AUDIT_ACTIONS } = require("../../constants/auditActions");
const constantsBarrel = require("../../constants");

/** A-124: every row names its actor; these tests are about other columns. */
const USER = { actorType: "user", userId: "u-1" };

describe("auditLedger fixture", () => {
  it("takes the action ENUM from models/auditLog.model.js — the eight documented values", () => {
    const ledger = createLedger();
    // Independent list: docs/DATABASE/10-AUDIT-LOGS.md § The Eight Actions
    // (the last two from ADR-051 Q-15, A-126).
    expect([...ledger.AUDIT_ACTIONS].sort()).toEqual(
      ["ACCOUNT_LOCKED", "APPROVE", "CREATE", "DELETE", "EXPORT", "LOGIN", "SIGNATURE_AUTH_FAILED", "UPDATE"],
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
        ledger.AuditLog.create({ tenantId: "t", ...USER, action, resourceType: "X" }),
      ).rejects.toThrow(/invalid input value for enum enum_audit_logs_action/);
      expect(ledger.auditRows()).toEqual([]);
    },
  );

  describe("A-124 — the actor columns, as migration 0033 constrains them", () => {
    // Independent of the code under test: the CHECK as written in the migration.
    const probe = (row) =>
      createLedger().AuditLog.create({ tenantId: "t", action: "UPDATE", resourceType: "X", ...row });

    it("takes actor_type from the model ENUM: user, system, unknown", () => {
      const { auditSchema } = require("../fixtures/auditLedger");
      expect([...auditSchema().actorTypes]).toEqual(["user", "system", "unknown"]);
    });

    it("refuses a row with no actor_type (NOT NULL, no default)", async () => {
      await expect(probe({ userId: "u-1" })).rejects.toThrow(/AuditLog.actorType cannot be null/);
    });

    it("refuses an actor_type outside the ENUM", async () => {
      await expect(probe({ actorType: "api_key", userId: "u-1" })).rejects.toThrow(
        /invalid input value for enum enum_audit_logs_actor_type/,
      );
    });

    it.each([
      ["a user row with no user", { actorType: "user" }],
      ["a user row with an actor name", { actorType: "user", userId: "u-1", actorName: "system:x" }],
      ["a system row with a user", { actorType: "system", userId: "u-1", actorName: "system:retention-purge" }],
      ["a system row with no name", { actorType: "system" }],
      ["a system row without the system: prefix", { actorType: "system", actorName: "retention" }],
      ["a NEW unknown row", { actorType: "unknown" }],
    ])("refuses %s (audit_logs_actor_check)", async (_label, row) => {
      await expect(probe(row)).rejects.toThrow(/violates check constraint "audit_logs_actor_check"/);
    });

    it("accepts a user row and a system row", async () => {
      await expect(probe({ actorType: "user", userId: "u-1" })).resolves.toMatchObject({ actorType: "user" });
      await expect(probe({ actorType: "system", actorName: "system:retention-purge" })).resolves.toMatchObject({
        actorType: "system",
      });
    });
  });

  it("refuses a row with no resourceType (entityType is not a column)", async () => {
    const ledger = createLedger();
    await expect(
      ledger.AuditLog.create({ tenantId: "t", ...USER, action: "UPDATE", entityType: "X" }),
    ).rejects.toThrow(/AuditLog.resourceType cannot be null/);
  });

  it("commits staged writes only when the managed transaction resolves", async () => {
    const ledger = createLedger();
    await ledger.transaction(async (t) => {
      ledger.write("things", { id: 1 }, { transaction: t });
      await ledger.AuditLog.create(
        { tenantId: "t", ...USER, action: "CREATE", resourceType: "Thing" },
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
          { tenantId: "t", ...USER, action: "CREATE", resourceType: "Thing" },
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
          { tenantId: "t", ...USER, action: "RESTORE", resourceType: "Thing" },
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
          { tenantId: "t", ...USER, action: "CREATE", resourceType: "Thing" },
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
