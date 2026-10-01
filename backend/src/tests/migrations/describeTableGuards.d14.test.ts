/**
 * D-14 — the five migrations that recorded themselves applied on ANY
 * `describeTable` error: 0002, 0004, 0009, 0013, 0016.
 *
 * Each opened with `try { desc = await context.describeTable(T) } catch {
 * return }` — "table not present yet (fresh DB handled by db.sync)". That
 * cannot happen: boot runs db.sync() before migrator.up(), so the table always
 * exists and the catch could only swallow a REAL failure (a lost connection, a
 * permission, a lock timeout), which Umzug then recorded as a successful
 * migration that never runs again. 0009 and 0016 had already lost theirs;
 * 0002, 0004 and 0013 lose theirs now.
 *
 * Editing an applied migration here changes nothing on a database that has
 * run it (they are frozen by name and never re-run); on a fresh database the
 * table exists and the behaviour is identical. Only a failure changes: it now
 * fails the migration instead of being recorded as applied.
 *
 * Proven on PostgreSQL 16.13: a fresh database built by db.sync() + every
 * migration still applies all of them; with the 0002/0004/0013 rows deleted
 * from schema_migrations a re-run is a no-op (the columns exist).
 *
 * P9-23: the five are TypeScript now (their recorded names still end ".js");
 * this suite reads the .ts sources and loads the modules by extensionless path.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes } from "sequelize";
import type { QueryInterface } from "sequelize";

interface Migration {
  up: (params: { context: QueryInterface }) => Promise<void>;
  down: (params: { context: QueryInterface }) => Promise<void>;
}

const load = (name: string): Migration => jest.requireActual<Migration>(`../../migrations/${name}`);

const MIGRATIONS = [
  "0002-add-stripe-invoice-id",
  "0004-add-mfa-fields",
  "0009-add-uncertainty-budgets",
  "0013-add-tenant-parent-id",
  "0016-add-attachment-storage-key",
];

const lostConnection = (): Error => new Error("Connection terminated unexpectedly");

/** A QueryInterface whose describeTable always fails, as a dropped connection would. */
const failingQueryInterface = () => {
  const qi = {
    describeTable: jest.fn((): Promise<never> => Promise.reject(lostConnection())),
    addColumn: jest.fn(),
    // 0009's down removes without describing first; its failure must propagate too.
    removeColumn: jest.fn((): Promise<never> => Promise.reject(lostConnection())),
    sequelize: { Sequelize: { DataTypes } },
  };
  return { qi, context: qi as unknown as QueryInterface };
};

describe.each(MIGRATIONS)("migration %s — D-14: no swallowed describeTable", (name) => {
  const file = path.join(__dirname, "../../migrations", `${name}.ts`);
  const source = fs.readFileSync(file, "utf8");
  const migration = load(name);

  it("has no try/catch and no .catch()", () => {
    expect(source).not.toMatch(/\btry\s*\{/);
    expect(source).not.toMatch(/\}\s*catch\b/);
    expect(source).not.toMatch(/\.catch\(/);
  });

  it("up: a throwing describeTable propagates (Umzug does not record it applied) and nothing is altered", async () => {
    const { qi, context } = failingQueryInterface();

    await expect(migration.up({ context })).rejects.toThrow("Connection terminated unexpectedly");
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("down: a throwing describeTable propagates too", async () => {
    const { context } = failingQueryInterface();

    await expect(migration.down({ context })).rejects.toThrow("Connection terminated unexpectedly");
  });
});

describe("D-14 — the guarded migrations still behave on a present table", () => {
  const present = (columns: Record<string, object>) => {
    const qi = {
      describeTable: jest.fn(() => Promise.resolve(columns)),
      addColumn: jest.fn(() => Promise.resolve()),
      removeColumn: jest.fn(() => Promise.resolve()),
      sequelize: { Sequelize: { DataTypes } },
    };
    return { qi, context: qi as unknown as QueryInterface };
  };
  const columnsOf = (calls: unknown[][]): unknown[] => calls.map((c) => c[1]);

  it.each([
    ["0002-add-stripe-invoice-id", ["stripe_invoice_id"]],
    ["0004-add-mfa-fields", ["mfa_enabled", "mfa_secret"]],
    ["0013-add-tenant-parent-id", ["parent_id"]],
    ["0016-add-attachment-storage-key", ["storage_key"]],
  ])("%s adds its columns when absent, and nothing when present; down removes them", async (name, columns) => {
    const migration = load(name);

    const empty = present({});
    await migration.up({ context: empty.context });
    expect(columnsOf(empty.qi.addColumn.mock.calls)).toEqual(columns);

    const full = present(Object.fromEntries(columns.map((c) => [c, {}])));
    await migration.up({ context: full.context });
    expect(full.qi.addColumn).not.toHaveBeenCalled();

    await migration.down({ context: full.context });
    expect(columnsOf(full.qi.removeColumn.mock.calls)).toEqual(columns);

    await migration.down({ context: empty.context });
    expect(empty.qi.removeColumn).not.toHaveBeenCalled();
  });

  it("0009 adds each column only when absent (it describes two tables)", async () => {
    const migration = load("0009-add-uncertainty-budgets");

    const empty = present({});
    await migration.up({ context: empty.context });
    expect(empty.qi.addColumn.mock.calls.map((c: unknown[]) => [c[0], c[1]])).toEqual([
      ["calibration_devices", "uncertainty_budget"],
      ["calibration_records", "measurement_uncertainty"],
    ]);

    const full = present({ uncertainty_budget: {}, measurement_uncertainty: {} });
    await migration.up({ context: full.context });
    expect(full.qi.addColumn).not.toHaveBeenCalled();
  });
});
