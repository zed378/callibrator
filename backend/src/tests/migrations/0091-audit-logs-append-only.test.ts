/**
 * Migration 0091 — audit_logs is append-only; the only UPDATE is GDPR masking
 * (Q-34, ADR-095).
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in one
 * transaction; that it refuses (throws) rather than skips when the table or
 * the application role is absent; that it has no try/catch; that it is
 * registered and reversible; and that its mask is the value the masking
 * service writes. That the trigger FIRES — for which role, which updates
 * pass, on a fresh and an upgraded database — is proven on PostgreSQL 18 by
 * services/auditLogAppendOnly.q34.live.test.ts, as callibrator_app and as the
 * owner.
 */
import * as fs from "fs";
import * as path from "path";
import type { QueryInterface } from "sequelize";
import { environment } from "../../config/env";
import migration from "../../migrations/0091-audit-logs-append-only";

const processEnv = environment();

const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");
const SOURCE = read("../../migrations/0091-audit-logs-append-only.ts");
const MANIFEST = read("../../config/migrator.ts");
const MASKING_SERVICE = read("../../services/dataRetention.service.ts");

interface FakeOptions {
  tableExists?: boolean;
  roleExists?: boolean;
  failOn?: RegExp | null;
}

const fakeQueryInterface = ({ tableExists = true, roleExists = true, failOn = null }: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0 };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: unknown } = {}) => {
      expect(options.transaction).toBeDefined();
      if (sql.includes("to_regclass")) {
        expect(options.replacements).toEqual({ table: "audit_logs" });
        return Promise.resolve([[{ present: tableExists }], null]);
      }
      if (sql.includes("FROM pg_roles")) {
        expect(options.replacements).toEqual({ role: "callibrator_app" });
        return Promise.resolve([[{ exists: roleExists }], null]);
      }
      if (failOn?.test(sql)) {
        return Promise.reject(new Error("lock timeout"));
      }
      state.statements.push(sql.replace(/\s+/g, " ").trim());
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn(async (work: (t: unknown) => Promise<unknown>) => {
      state.transactions += 1;
      return work({ id: `tx${String(state.transactions)}` });
    }),
  };
  return { state, context: { sequelize } as unknown as QueryInterface };
};

describe("migration 0091 — audit_logs append-only (Q-34)", () => {
  const savedRole = processEnv["DB_APP_ROLE"];
  afterEach(() => {
    if (savedRole === undefined) {
      delete processEnv["DB_APP_ROLE"];
    } else {
      processEnv["DB_APP_ROLE"] = savedRole;
    }
  });

  it("is registered in the static manifest, last, under a .js manifest name", () => {
    expect(MANIFEST).toContain(
      '["0091-audit-logs-append-only.js", require("../migrations/0091-audit-logs-append-only")]',
    );
  });

  it("creates both functions and both triggers (ENABLE ALWAYS), then narrows the role — one transaction", async () => {
    delete processEnv["DB_APP_ROLE"];
    const qi = fakeQueryInterface();

    await migration.up({ context: qi.context });

    expect(qi.state.transactions).toBe(1);
    const [lock, maskFn, fn, dropRow, createRow, dropTrunc, createTrunc, alwaysRow, alwaysTrunc, revoke, grant] =
      qi.state.statements;
    expect(lock).toBe("SET LOCAL lock_timeout = '10s'");
    expect(maskFn).toMatch(/^CREATE OR REPLACE FUNCTION audit_logs_masks_only\(old_value jsonb, new_value jsonb\) RETURNS boolean LANGUAGE plpgsql IMMUTABLE/);
    expect(maskFn).toContain("to_jsonb('[REDACTED]'::text)");
    expect(fn).toMatch(/^CREATE OR REPLACE FUNCTION audit_logs_append_only\(\) RETURNS trigger/);
    expect(fn).toContain("maskable CONSTANT text[] := ARRAY['ip_address', 'user_agent', 'changes']");
    expect(fn).toMatch(/TG_OP = 'TRUNCATE'.*TRUNCATE is refused/);
    expect(fn).toMatch(/TG_OP = 'DELETE'.*cannot be deleted/);
    expect(fn).toContain("(to_jsonb(NEW) - maskable) IS DISTINCT FROM (to_jsonb(OLD) - maskable)");
    expect(fn).toContain("NEW.ip_address IS DISTINCT FROM '[REDACTED]'");
    expect(fn).toContain("NEW.user_agent IS DISTINCT FROM '[REDACTED]'");
    expect(fn).toContain("NOT audit_logs_masks_only(OLD.changes, NEW.changes)");
    expect(fn).toContain("USING ERRCODE = '42501'");
    expect(dropRow).toBe("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs");
    expect(createRow).toBe(
      "CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()",
    );
    expect(dropTrunc).toBe("DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs");
    expect(createTrunc).toBe(
      "CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only()",
    );
    expect(alwaysRow).toBe("ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_append_only");
    expect(alwaysTrunc).toBe("ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_no_truncate");
    expect(revoke).toBe("REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM callibrator_app");
    expect(grant).toBe("GRANT UPDATE (ip_address, user_agent, changes) ON audit_logs TO callibrator_app");
    expect(qi.state.statements).toHaveLength(11);
  });

  it("refuses to run — and so to be recorded as applied — when the table is absent", async () => {
    const qi = fakeQueryInterface({ tableExists: false });

    await expect(migration.up({ context: qi.context })).rejects.toThrow(/table audit_logs does not exist/);
    expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("refuses to run when the application role 0057 creates is absent", async () => {
    const qi = fakeQueryInterface({ roleExists: false });

    await expect(migration.up({ context: qi.context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
    expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("lets a failure propagate: nothing is swallowed", async () => {
    const qi = fakeQueryInterface({ failOn: /^REVOKE/ });

    await expect(migration.up({ context: qi.context })).rejects.toThrow("lock timeout");
    expect(SOURCE).not.toMatch(/\btry\s*\{|\.catch\(/);
  });

  it("is idempotent: a second run replaces the functions and the triggers", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi.context });
    await migration.up({ context: qi.context });

    expect(qi.state.statements.filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(4);
    expect(qi.state.statements.filter((s) => s.startsWith("DROP TRIGGER IF EXISTS"))).toHaveLength(4);
    expect(qi.state.statements.filter((s) => s.startsWith("CREATE OR REPLACE FUNCTION"))).toHaveLength(4);
  });

  it("down drops the triggers and functions and gives the role back UPDATE and DELETE — no row is touched", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi.context });

    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs",
      "DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs",
      "DROP FUNCTION IF EXISTS audit_logs_append_only()",
      "DROP FUNCTION IF EXISTS audit_logs_masks_only(jsonb, jsonb)",
      "GRANT UPDATE, DELETE ON audit_logs TO callibrator_app",
    ]);
  });

  it("down skips the grant when the role is gone", async () => {
    const qi = fakeQueryInterface({ roleExists: false });

    await migration.down({ context: qi.context });

    expect(qi.state.statements.some((s) => s.startsWith("GRANT"))).toBe(false);
  });

  it("uses DB_APP_ROLE when set, the default for unset / empty / none, and refuses an unsafe name", () => {
    expect(migration.appRoleName(undefined)).toBe("callibrator_app");
    expect(migration.appRoleName("")).toBe("callibrator_app");
    expect(migration.appRoleName("none")).toBe("callibrator_app");
    expect(migration.appRoleName("cal_app_2")).toBe("cal_app_2");
    expect(() => migration.appRoleName("x; DROP TABLE audit_logs")).toThrow(/not a plain lower-case identifier/);
    processEnv["DB_APP_ROLE"] = "cal_app_env";
    expect(migration.appRoleName()).toBe("cal_app_env");
  });

  it("the trigger's mask is the value the masking service writes — they cannot drift apart silently", () => {
    expect(migration.PII_MASK).toBe("[REDACTED]");
    expect(MASKING_SERVICE).toContain(`const PII_MASK = "${migration.PII_MASK}";`);
    expect(migration.MASKABLE_COLUMNS).toEqual(["ip_address", "user_agent", "changes"]);
    expect(MASKING_SERVICE).toMatch(/for \(const field of \["ipAddress", "userAgent"\]\)/);
  });
});
