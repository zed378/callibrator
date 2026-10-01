/**
 * Migration 0078 — users.temporary_password_expires_at (A-215, ADR-068).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the User MODEL), the backfill it runs, that it is idempotent
 * and reversible, and that a failure is NOT swallowed and recorded as applied
 * (D-14: no try/catch at all). The DDL itself was run on PostgreSQL 18 — fresh
 * boot and upgrade — by authCards.a215.live.test.js.
 *
 * P9-23: 0078 is TypeScript now (its recorded name is still
 * "0078-user-temporary-password-expiry.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0078-user-temporary-password-expiry";
import defineUser from "../../models/user.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

/** The parts of a column spec / model attribute these assertions read. */
interface Attribute {
  field: string;
  type: { key: string };
  allowNull?: boolean;
  defaultValue?: unknown;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0078-user-temporary-password-expiry.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL User model on an unconnected PostgreSQL-dialect Sequelize. */
const User = defineUser(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const modelAttributes = (): Record<string, Attribute | undefined> =>
  User.getAttributes() as unknown as Record<string, Attribute | undefined>;

const BASE_COLUMNS = ["id", "tenant_id", "password", "must_change_password"];

const fakeQueryInterface = ({
  columns = BASE_COLUMNS,
  describeError = null,
}: { columns?: string[]; describeError?: Error | null } = {}) => {
  const state = {
    columns: new Set(columns),
    added: [] as { column: string; spec: Attribute }[],
    removed: [] as string[],
    queries: [] as string[],
  };
  return {
    state,
    sequelize: {
      Sequelize,
      query: jest.fn(async (sql: string) => {
        state.queries.push(sql);
      }),
    },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("users");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table: string, column: string, spec: Attribute) => {
      expect(table).toBe("users");
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe("users");
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0078 — users.temporary_password_expires_at", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0078-user-temporary-password-expiry.js", require("../migrations/0078-user-temporary-password-expiry")]',
    );
  });

  it("adds the column the User model declares — a nullable timestamp", async () => {
    const attribute = modelAttributes()["temporaryPasswordExpiresAt"] as Attribute;
    expect(attribute.field).toBe("temporary_password_expires_at");
    expect(migration.COLUMN).toBe(attribute.field);
    expect(attribute.allowNull).toBe(true);

    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });

    expect(qi.state.added).toHaveLength(1);
    const { column, spec } = qi.state.added[0] as { column: string; spec: Attribute };
    expect(column).toBe("temporary_password_expires_at");
    expect(spec.allowNull).toBe(true);
    // DATE is Sequelize's timestamp with time zone on PostgreSQL.
    expect(spec.type.key).toBe(attribute.type.key);
    expect(spec.type.key).toBe("DATE");
  });

  it("starts the clock for passwords issued before it: flagged rows with no expiry get 72 hours from now", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });

    expect(qi.state.queries).toEqual([migration.BACKFILL_SQL]);
    const sql = migration.BACKFILL_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("SET \"temporary_password_expires_at\" = now() + interval '72 hours'");
    expect(sql).toContain("WHERE must_change_password = true");
    expect(sql).toContain("AND \"temporary_password_expires_at\" IS NULL");
  });

  it("is idempotent: a re-run, or an up on a database db.sync() built, adds nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    await migration.up({ context: ctx(qi) });
    expect(qi.addColumn).toHaveBeenCalledTimes(1);

    const fresh = fakeQueryInterface({ columns: [...BASE_COLUMNS, "temporary_password_expires_at"] });
    await migration.up({ context: ctx(fresh) });
    expect(fresh.addColumn).not.toHaveBeenCalled();
    // The backfill is itself idempotent (only NULL expiries); it still runs.
    expect(fresh.state.queries).toEqual([migration.BACKFILL_SQL]);
  });

  it("is reversible, and down is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });

    expect(qi.state.removed).toEqual(["temporary_password_expires_at"]);
    expect(qi.state.columns.has("temporary_password_expires_at")).toBe(false);
  });

  it("D-14: no try/catch; every failure propagates and is never recorded as applied", async () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\}\s*catch\b/);
    expect(SOURCE).not.toMatch(/\.catch\(/);

    const lost = fakeQueryInterface({ describeError: new Error("Connection terminated unexpectedly") });
    await expect(migration.up({ context: ctx(lost) })).rejects.toThrow("Connection terminated");
    await expect(migration.down({ context: ctx(lost) })).rejects.toThrow("Connection terminated");
    expect(lost.addColumn).not.toHaveBeenCalled();

    const failingBackfill = fakeQueryInterface();
    failingBackfill.sequelize.query.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(migration.up({ context: ctx(failingBackfill) })).rejects.toThrow("lock timeout");
  });

  it("declares no index, so db.sync() before the migrator creates nothing only the migration should", () => {
    expect(SOURCE).not.toMatch(/addIndex|CREATE\s+(UNIQUE\s+)?INDEX/i);
  });
});
