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
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS = [
  "0002-add-stripe-invoice-id",
  "0004-add-mfa-fields",
  "0009-add-uncertainty-budgets",
  "0013-add-tenant-parent-id",
  "0016-add-attachment-storage-key",
];

const lostConnection = () => new Error("Connection terminated unexpectedly");

/** A QueryInterface whose describeTable always fails, as a dropped connection would. */
const failingQueryInterface = () => ({
  describeTable: jest.fn(async () => {
    throw lostConnection();
  }),
  addColumn: jest.fn(),
  // 0009's down removes without describing first; its failure must propagate too.
  removeColumn: jest.fn(async () => {
    throw lostConnection();
  }),
  sequelize: { Sequelize: { DataTypes: require("sequelize").DataTypes } },
});

describe.each(MIGRATIONS)("migration %s — D-14: no swallowed describeTable", (name) => {
  const file = path.join(__dirname, "../../migrations", `${name}.js`);
  const source = fs.readFileSync(file, "utf8");
  const migration = require(file);

  it("has no try/catch and no .catch()", () => {
    expect(source).not.toMatch(/\btry\s*\{/);
    expect(source).not.toMatch(/\}\s*catch\b/);
    expect(source).not.toMatch(/\.catch\(/);
  });

  it("up: a throwing describeTable propagates (Umzug does not record it applied) and nothing is altered", async () => {
    const qi = failingQueryInterface();

    await expect(migration.up({ context: qi })).rejects.toThrow("Connection terminated unexpectedly");
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("down: a throwing describeTable propagates too", async () => {
    const qi = failingQueryInterface();

    await expect(migration.down({ context: qi })).rejects.toThrow("Connection terminated unexpectedly");
  });
});

describe("D-14 — the guarded migrations still behave on a present table", () => {
  const present = (columns) => ({
    describeTable: jest.fn(async () => columns),
    addColumn: jest.fn(async () => {}),
    removeColumn: jest.fn(async () => {}),
    sequelize: { Sequelize: { DataTypes: require("sequelize").DataTypes } },
  });

  it.each([
    ["0002-add-stripe-invoice-id", ["stripe_invoice_id"]],
    ["0004-add-mfa-fields", ["mfa_enabled", "mfa_secret"]],
    ["0013-add-tenant-parent-id", ["parent_id"]],
    ["0016-add-attachment-storage-key", ["storage_key"]],
  ])("%s adds its columns when absent, and nothing when present; down removes them", async (name, columns) => {
    const migration = require(`../../migrations/${name}`);

    const empty = present({});
    await migration.up({ context: empty });
    expect(empty.addColumn.mock.calls.map((c) => c[1])).toEqual(columns);

    const full = present(Object.fromEntries(columns.map((c) => [c, {}])));
    await migration.up({ context: full });
    expect(full.addColumn).not.toHaveBeenCalled();

    await migration.down({ context: full });
    expect(full.removeColumn.mock.calls.map((c) => c[1])).toEqual(columns);

    await migration.down({ context: empty });
    expect(empty.removeColumn).not.toHaveBeenCalled();
  });

  it("0009 adds each column only when absent (it describes two tables)", async () => {
    const migration = require("../../migrations/0009-add-uncertainty-budgets");

    const empty = present({});
    await migration.up({ context: empty });
    expect(empty.addColumn.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["calibration_devices", "uncertainty_budget"],
      ["calibration_records", "measurement_uncertainty"],
    ]);

    const full = present({ uncertainty_budget: {}, measurement_uncertainty: {} });
    await migration.up({ context: full });
    expect(full.addColumn).not.toHaveBeenCalled();
  });
});
