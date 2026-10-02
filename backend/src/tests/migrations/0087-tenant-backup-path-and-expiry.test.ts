/**
 * Migration 0087 — tenant_backups.backup_path TEXT, and the expiry the HTTP
 * path never stamped (S-32, ADR-080).
 *
 * Against a statement-recording double: the registration, the statements in
 * one transaction, idempotence, the backfill's exact rule, and a down that
 * refuses to truncate. The DDL and the backfill on PostgreSQL 18 are
 * secretsAtRest.s20.live.test.js (S-32 block).
 *
 * P9-23: 0087 is TypeScript now (its recorded name is still
 * "0087-tenant-backup-path-and-expiry.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async sequelize: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0087-tenant-backup-path-and-expiry";
import defineTenantBackup from "../../models/tenantBackup.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (fake: object): Context => fake as Context;

interface QueryOptions {
  replacements?: unknown;
}

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0087-tenant-backup-path-and-expiry.ts"), "utf8");

const TenantBackup = defineTenantBackup(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
/** The parts of the model these assertions read. */
const model = TenantBackup as unknown as {
  rawAttributes: Record<string, { type: { key: string }; values?: string[] }>;
  STATUS: Record<string, string>;
};

const fakeContext = ({
  type = "character varying",
  longest = 40,
}: { type?: string | null; longest?: number } = {}) => {
  const state = { type, statements: [] as string[], inTransaction: 0 };
  const query = jest.fn(async (sql: string, options: QueryOptions = {}): Promise<unknown> => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.includes("information_schema.columns")) {
      expect(options.replacements).toEqual({ table: "tenant_backups", column: "backup_path" });
      return state.type === null ? [] : [{ data_type: state.type }];
    }
    expect(state.inTransaction).toBe(1);
    state.statements.push(s);
    if (s.startsWith("ALTER TABLE")) {
      state.type = s.endsWith("TEXT") ? "text" : "character varying";
      return [[], {}];
    }
    if (s.startsWith("SELECT COALESCE")) {
      return [[{ longest: String(longest) }], {}];
    }
    return [[], {}];
  });
  const transaction = jest.fn(async (fn: () => Promise<unknown>) => {
    state.inTransaction += 1;
    try {
      return await fn();
    } finally {
      state.inTransaction -= 1;
    }
  });
  const sequelize = { query, transaction };
  return { state, sequelize, context: ctx({ sequelize }) };
};

describe("migration 0087 — tenant_backups.backup_path and expires_at", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0087-tenant-backup-path-and-expiry.js", require("../migrations/0087-tenant-backup-path-and-expiry")]',
    );
  });

  it("swallows nothing: no try/catch (D-14)", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("the model agrees: backupPath is TEXT, and the status ENUM is still exactly STATUS", () => {
    expect(model.rawAttributes["backupPath"]?.type.key).toBe("TEXT");
    expect(model.rawAttributes["status"]?.values).toEqual(Object.values(model.STATUS));
  });

  it("widens backup_path and backfills the expiry, in one transaction", async () => {
    const { state, sequelize, context } = fakeContext();
    await migration.up({ context });
    expect(state.statements).toEqual([
      "ALTER TABLE tenant_backups ALTER COLUMN backup_path TYPE TEXT",
      migration.BACKFILL_SQL.replace(/\s+/g, " ").trim(),
    ]);
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it("the backfill is the pruner's rule, for completed rows with no expiry and a positive retention only", () => {
    const sql = migration.BACKFILL_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("SET expires_at = created_at + retention_days * interval '1 day'");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("expires_at IS NULL");
    expect(sql).toContain("retention_days > 0");
  });

  it("is idempotent: already TEXT, only the (self-limiting) backfill runs", async () => {
    const { state, context } = fakeContext({ type: "text" });
    await migration.up({ context });
    expect(state.statements).toEqual([migration.BACKFILL_SQL.replace(/\s+/g, " ").trim()]);
  });

  it("does nothing when the table does not exist (db.sync builds it)", async () => {
    const { sequelize, context } = fakeContext({ type: null });
    await migration.up({ context });
    await migration.down({ context });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("down narrows back to VARCHAR(255), and does nothing when already narrow", async () => {
    const { state, context } = fakeContext({ type: "text" });
    await migration.down({ context });
    expect(state.statements).toEqual([
      "SELECT COALESCE(max(length(backup_path)), 0) AS longest FROM tenant_backups",
      "ALTER TABLE tenant_backups ALTER COLUMN backup_path TYPE VARCHAR(255)",
    ]);
    state.statements = [];
    await migration.down({ context });
    expect(state.statements).toEqual([]);
  });

  it("down REFUSES rather than truncate a path longer than 255 characters", async () => {
    const { state, context } = fakeContext({ type: "text", longest: 300 });
    await expect(migration.down({ context })).rejects.toThrow(
      "0087 down refused: tenant_backups.backup_path holds a value of 300 characters, longer than VARCHAR(255) (nothing was changed).",
    );
    expect(state.type).toBe("text");
  });
});
