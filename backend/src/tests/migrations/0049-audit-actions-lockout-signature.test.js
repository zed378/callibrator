/**
 * Migration 0049 — `audit_logs.action` gains ACCOUNT_LOCKED and
 * SIGNATURE_AUTH_FAILED (A-126, ADR-051 Q-15).
 *
 * Runs the migration against a fake `sequelize` that models the ENUM type's
 * labels in `pg_enum`, the audit rows' actions and the DDL this migration
 * issues. It proves the LOGIC: the labels it adds are exactly the model ENUM's
 * tail and the AUDIT_ACTIONS constant's, it refuses a type it does not
 * recognise, it is idempotent, and `down` refuses while a row carries a new
 * label. It does not prove the DDL runs on PostgreSQL — that was checked on a
 * PostgreSQL 18 container (the A-126 section of TASKS/AUDIT-2026-09-REMEDIATION.md).
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0049-audit-actions-lockout-signature");
const { AUDIT_ACTIONS } = require("../../constants/auditActions");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0049-audit-actions-lockout-signature.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL AuditLog model on an unconnected PostgreSQL-dialect Sequelize. */
const AuditLog = require("../../models/auditLog.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const BASE = ["CREATE", "UPDATE", "DELETE", "LOGIN", "APPROVE", "EXPORT"];

/**
 * A fake `context` (QueryInterface) whose `sequelize.query` understands the
 * statements this migration issues, over `state.labels` (null = no type) and
 * `state.rowActions` (the action of every audit row).
 */
const fakeContext = ({ labels = [...BASE], rowActions = [] } = {}) => {
  const state = { labels, rowActions, statements: [], committed: false };
  const sequelize = {
    transaction: jest.fn(async (fn) => {
      const result = await fn("TX");
      state.committed = true;
      return result;
    }),
    query: jest.fn(async (sql, options = {}) => {
      expect(options.transaction).toBe("TX");
      state.statements.push(sql);
      if (/FROM pg_type/.test(sql)) {
        expect(options.replacements).toEqual({ type: "enum_audit_logs_action" });
        return [state.labels ? state.labels.map((label) => ({ label })) : []];
      }
      const add = sql.match(/^ALTER TYPE enum_audit_logs_action ADD VALUE IF NOT EXISTS '(\w+)'$/);
      if (add) {
        if (!state.labels.includes(add[1])) {state.labels.push(add[1]);}
        return [[]];
      }
      if (/^SELECT count\(\*\)::int AS n FROM audit_logs/.test(sql)) {
        const n = state.rowActions.filter((a) => options.replacements.labels.includes(a)).length;
        return [[{ n }]];
      }
      if (/^CREATE TYPE enum_audit_logs_action AS ENUM/.test(sql)) {
        state.labels = [...sql.matchAll(/'(\w+)'/g)].map((m) => m[1]);
        return [[]];
      }
      return [[]];
    }),
  };
  return { state, context: { sequelize } };
};

describe("migration 0049 — audit_logs.action gains ACCOUNT_LOCKED and SIGNATURE_AUTH_FAILED", () => {
  it("is registered in the static manifest under its frozen .js name, after every earlier entry", () => {
    const entry =
      '["0049-audit-actions-lockout-signature.js", require("../migrations/0049-audit-actions-lockout-signature")]';
    expect(MANIFEST).toContain(entry);
    const numbers = [...MANIFEST.matchAll(/\["(\d{4})-[^"]+\.js"/g)].map((m) => m[1]);
    const at = numbers.indexOf("0049");
    expect(numbers.slice(at + 1).filter((n) => n < "0049")).toEqual([]);
  });

  it("adds exactly the model ENUM's new tail, and the constant agrees", () => {
    const modelValues = AuditLog.getAttributes().action.values;
    expect(modelValues.slice(0, BASE.length)).toEqual(BASE);
    expect(modelValues.slice(BASE.length)).toEqual([...migration.NEW_ACTIONS]);
    expect([...migration.BASE_ACTIONS]).toEqual(BASE);
    expect([...AUDIT_ACTIONS]).toEqual(modelValues);
  });

  it("up appends both labels, in order, in one transaction", async () => {
    const { state, context } = fakeContext();

    await migration.up({ context });

    expect(state.labels).toEqual([...BASE, "ACCOUNT_LOCKED", "SIGNATURE_AUTH_FAILED"]);
    expect(state.committed).toBe(true);
    expect(state.statements[0]).toBe("SET LOCAL lock_timeout = '10s'");
  });

  it("up is idempotent — a second run, or a fresh database db.sync() built with all eight, changes nothing", async () => {
    const { state, context } = fakeContext({ labels: [...BASE, ...migration.NEW_ACTIONS] });

    await migration.up({ context });
    await migration.up({ context });

    expect(state.labels).toEqual([...BASE, "ACCOUNT_LOCKED", "SIGNATURE_AUTH_FAILED"]);
  });

  it("up refuses when the type does not exist — skipping would be recorded as applied", async () => {
    const { context } = fakeContext({ labels: null });

    await expect(migration.up({ context })).rejects.toThrow(
      "0049 up: type enum_audit_logs_action does not exist",
    );
  });

  it.each([
    ["a different base", ["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT", "APPROVE"]],
    ["an unknown extra label", [...BASE, "RESTORE"]],
  ])("up refuses a type with %s rather than guess", async (_, labels) => {
    const { state, context } = fakeContext({ labels });

    await expect(migration.up({ context })).rejects.toThrow("Refusing to guess");
    expect(state.statements.some((s) => /ADD VALUE/.test(s))).toBe(false);
  });

  it("down rebuilds the six-label type and converts the column when no row carries a new label", async () => {
    const { state, context } = fakeContext({ labels: [...BASE, ...migration.NEW_ACTIONS], rowActions: ["CREATE"] });

    await migration.down({ context });

    expect(state.labels).toEqual(BASE);
    expect(state.statements).toEqual(
      expect.arrayContaining([
        "LOCK TABLE audit_logs IN ACCESS EXCLUSIVE MODE",
        "ALTER TYPE enum_audit_logs_action RENAME TO enum_audit_logs_action_0049_old",
        "ALTER TABLE audit_logs ALTER COLUMN action TYPE enum_audit_logs_action USING action::text::enum_audit_logs_action",
        "DROP TYPE enum_audit_logs_action_0049_old",
      ]),
    );
  });

  it("down refuses while any audit row carries a new label — audit rows are never rewritten (Q-12)", async () => {
    const { state, context } = fakeContext({
      labels: [...BASE, ...migration.NEW_ACTIONS],
      rowActions: ["CREATE", "ACCOUNT_LOCKED"],
    });

    await expect(migration.down({ context })).rejects.toThrow(
      "0049 down: 1 audit row(s) carry ACCOUNT_LOCKED or SIGNATURE_AUTH_FAILED",
    );
    expect(state.statements.some((s) => /RENAME TO/.test(s))).toBe(false);
  });

  it("down is idempotent — on the six labels it changes nothing", async () => {
    const { state, context } = fakeContext();

    await migration.down({ context });

    expect(state.labels).toEqual(BASE);
    expect(state.statements.some((s) => /LOCK TABLE|RENAME TO|CREATE TYPE/.test(s))).toBe(false);
  });

  it("down refuses a type it does not recognise", async () => {
    const { context } = fakeContext({ labels: null });

    await expect(migration.down({ context })).rejects.toThrow("0049 down: type enum_audit_logs_action does not exist");
  });

  it("has no try/catch — every failure fails the migration (CLAUDE.md traps table)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bcatch\b/);
  });
});
