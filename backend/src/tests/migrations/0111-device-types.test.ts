/**
 * Migration 0111 — `device_types` and `calibration_devices.device_type_id`
 * (P20-01; ADR-125 Amendment 1; spec P19-01 § 4.1, § 4.7).
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in ONE
 * transaction, on a fresh database (sync() made the table and the column) and
 * on an upgraded one (it makes both); that the table it creates is the model's
 * (column for column); that it throws — and so is not recorded as applied —
 * when a table or the application role is absent; that nothing is swallowed;
 * that `down` refuses while a device type exists. That the trigger FIRES, the
 * grant holds as `callibrator_app`, and the schema boots and reboots is proven
 * on PostgreSQL 18 by inspectionCatalogue.p2003.live.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import { environment } from "../../config/env";
import migration from "../../migrations/0111-device-types";
import defineDeviceType from "../../models/deviceType.model";
import defineCalibrationDevice from "../../models/calibrationDevice.model";

const processEnv = environment();
const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");
const SOURCE = read("../../migrations/0111-device-types.ts");
const MANIFEST = read("../../config/migrator.ts");

interface FakeOptions {
  tables?: string[];
  columnExists?: boolean;
  constraints?: string[];
  roleExists?: boolean;
  deviceTypeCount?: number;
  failOn?: RegExp | null;
}

interface AttributeLike {
  type: { key: string; options?: { length?: number }; values?: readonly string[] };
  allowNull?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  references?: { model: string; key: string };
  onDelete?: string;
  onUpdate?: string;
  field?: string;
}

const fakeQueryInterface = ({
  tables = ["users", "calibration_devices", "device_types"],
  columnExists = true,
  constraints = [],
  roleExists = true,
  deviceTypeCount = 0,
  failOn = null,
}: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0, created: [] as string[] };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      if (sql.includes("to_regclass")) {
        return Promise.resolve([[{ present: tables.includes(String(options.replacements?.["table"])) }], null]);
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve([columnExists ? [{ "?column?": 1 }] : [], null]);
      }
      if (sql.includes("FROM pg_constraint")) {
        return Promise.resolve([constraints.map((conname) => ({ conname })), null]);
      }
      if (sql.includes("FROM pg_roles")) {
        expect(options.replacements).toEqual({ role: "callibrator_app" });
        return Promise.resolve([[{ exists: roleExists }], null]);
      }
      if (sql.startsWith("SELECT count(*)")) {
        return Promise.resolve([[{ n: deviceTypeCount }], null]);
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
  const createTable = jest.fn((table: string, attributes: Record<string, AttributeLike>, options: { transaction?: unknown }) => {
    expect(options.transaction).toBeDefined();
    state.created.push(table);
    return Promise.resolve(attributes);
  });
  return { state, createTable, context: { sequelize, createTable } as unknown as QueryInterface };
};

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const DeviceType = defineDeviceType(sequelize, DataTypes);
const CalibrationDevice = defineCalibrationDevice(sequelize, DataTypes);

/** A column as the model or the migration declares it, reduced to what the DDL depends on. */
const shape = (a: AttributeLike) => ({
  type: a.type.key,
  length: a.type.options?.length,
  values: a.type.values ? [...a.type.values] : undefined,
  // A primary key is NOT NULL whatever allowNull says (PostgreSQL and Sequelize both).
  allowNull: a.primaryKey !== true && a.allowNull !== false,
  primaryKey: a.primaryKey === true,
  defaultValue: a.defaultValue === undefined || typeof a.defaultValue === "object" ? undefined : a.defaultValue,
  references: a.references ? `${a.references.model}.${a.references.key}` : undefined,
  onDelete: a.onDelete,
  onUpdate: a.onUpdate,
});

describe("migration 0111 — device_types and calibration_devices.device_type_id (P20-01)", () => {
  const savedRole = processEnv["DB_APP_ROLE"];
  afterEach(() => {
    if (savedRole === undefined) {
      delete processEnv["DB_APP_ROLE"];
    } else {
      processEnv["DB_APP_ROLE"] = savedRole;
    }
  });

  it("is registered in the static manifest under a .js name, after 0110", () => {
    const entry = '["0111-device-types.js", require("../migrations/0111-device-types")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0110-search-tenant-gin.js"'));
  });

  it("creates exactly the model's table — column for column, type, nullability, default, RESTRICT keys", async () => {
    delete processEnv["DB_APP_ROLE"];
    const qi = fakeQueryInterface({ tables: ["users", "calibration_devices"] });
    await migration.up({ context: qi.context });
    expect(qi.state.created).toEqual(["device_types"]);
    const created = qi.createTable.mock.calls[0]?.[1] ?? {};
    const model = DeviceType.getAttributes() as unknown as Record<string, AttributeLike>;
    const byColumn = Object.fromEntries(
      Object.entries(model)
        .map(([name, a]) => [a.field ?? name, shape(a)] as const)
        .filter(([column]) => !["created_at", "updated_at"].includes(column)),
    );
    for (const timestamp of ["created_at", "updated_at"]) {
      expect(created[timestamp]).toMatchObject({ allowNull: false });
    }
    const migrated = Object.fromEntries(
      Object.entries(created).filter(([c]) => !["created_at", "updated_at"].includes(c)).map(([c, a]) => [c, shape(a)]),
    );
    // The model's id carries UUIDV4 as its default (an object); the table's has none — both sides drop it.
    expect(migrated).toEqual(byColumn);
    expect(byColumn["status"]).toMatchObject({ values: ["active", "retired"], defaultValue: "active", allowNull: false });
  });

  it("the device's new column is the model's: nullable, → device_types ON DELETE RESTRICT ON UPDATE CASCADE (G-5)", () => {
    const attribute = CalibrationDevice.getAttributes().deviceTypeId as unknown as AttributeLike;
    expect(shape(attribute)).toMatchObject({
      type: "UUID",
      allowNull: true,
      references: "device_types.id",
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
    expect(attribute.field).toBe(migration.COLUMN);
    expect(migration.DEVICE_FK_SQL).toBe(
      "ALTER TABLE calibration_devices ADD CONSTRAINT calibration_devices_device_type_id_fkey FOREIGN KEY (device_type_id) " +
        "REFERENCES device_types (id) ON DELETE RESTRICT ON UPDATE CASCADE",
    );
  });

  it("on an UPGRADED database (no table, no column): table, CHECKs, indexes, triggers, column, key, index, revoke — one transaction", async () => {
    delete processEnv["DB_APP_ROLE"];
    const qi = fakeQueryInterface({ tables: ["users", "calibration_devices"], columnExists: false });
    await migration.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "ALTER TABLE device_types ADD CONSTRAINT device_types_name_normalised CHECK (name <> '' AND name = btrim(regexp_replace(name, '\\s+', ' ', 'g')))",
      "ALTER TABLE device_types ADD CONSTRAINT device_types_legacy_id_positive CHECK (legacy_id IS NULL OR legacy_id > 0)",
      "CREATE UNIQUE INDEX IF NOT EXISTS device_types_name_unique ON device_types (lower(btrim(name)))",
      "CREATE UNIQUE INDEX IF NOT EXISTS device_types_legacy_id_unique ON device_types (legacy_id) WHERE legacy_id IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS device_types_created_by ON device_types (created_by)",
      "CREATE INDEX IF NOT EXISTS device_types_updated_by ON device_types (updated_by)",
      expect.stringMatching(/^CREATE OR REPLACE FUNCTION device_types_no_delete\(\) RETURNS trigger/),
      "DROP TRIGGER IF EXISTS device_types_no_delete ON device_types",
      "CREATE TRIGGER device_types_no_delete BEFORE DELETE ON device_types FOR EACH ROW EXECUTE FUNCTION device_types_no_delete()",
      "DROP TRIGGER IF EXISTS device_types_no_truncate ON device_types",
      "CREATE TRIGGER device_types_no_truncate BEFORE TRUNCATE ON device_types FOR EACH STATEMENT EXECUTE FUNCTION device_types_no_delete()",
      "ALTER TABLE device_types ENABLE ALWAYS TRIGGER device_types_no_delete",
      "ALTER TABLE device_types ENABLE ALWAYS TRIGGER device_types_no_truncate",
      "ALTER TABLE calibration_devices ADD COLUMN device_type_id UUID",
      migration.DEVICE_FK_SQL,
      "CREATE INDEX IF NOT EXISTS calibration_devices_device_type_id_tenant_id ON calibration_devices (device_type_id, tenant_id)",
      "REVOKE DELETE, TRUNCATE ON device_types FROM callibrator_app",
    ]);
  });

  it("on a FRESH database (sync() made the table, the column and its key): no CREATE, no ADD COLUMN, no second key", async () => {
    const qi = fakeQueryInterface({
      constraints: ["device_types_name_normalised", "device_types_legacy_id_positive", "calibration_devices_device_type_id_fkey"],
    });
    await migration.up({ context: qi.context });
    expect(qi.createTable).not.toHaveBeenCalled();
    expect(qi.state.statements.some((s) => s.includes("ADD COLUMN"))).toBe(false);
    expect(qi.state.statements.some((s) => s.includes("ADD CONSTRAINT"))).toBe(false);
    // The controls are (re)applied on every path: indexes, triggers, the revoke.
    expect(qi.state.statements.filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(2);
    expect(qi.state.statements).toContain("REVOKE DELETE, TRUNCATE ON device_types FROM callibrator_app");
  });

  it("the trigger function refuses DELETE and TRUNCATE with 42501, naming the row, and points to retirement", () => {
    expect(migration.FUNCTION_SQL).toContain("IF TG_OP = 'TRUNCATE' THEN");
    expect(migration.FUNCTION_SQL).toContain("device type % cannot be deleted', OLD.id");
    expect(migration.FUNCTION_SQL.match(/ERRCODE = '42501'/g)).toHaveLength(2);
    expect(migration.FUNCTION_SQL).toContain("Retire it");
  });

  it.each([["users"], ["calibration_devices"]])(
    "refuses to run — and so to be recorded as applied — when %s is absent",
    async (missing) => {
      const qi = fakeQueryInterface({ tables: ["users", "calibration_devices"].filter((t) => t !== missing) });
      await expect(migration.up({ context: qi.context })).rejects.toThrow(new RegExp(`table ${missing} does not exist`));
      expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
    },
  );

  it("refuses to run when the application role 0057 creates is absent", async () => {
    const qi = fakeQueryInterface({ roleExists: false });
    await expect(migration.up({ context: qi.context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
  });

  it("names the role from DB_APP_ROLE, and refuses one it cannot interpolate safely", async () => {
    expect(migration.appRoleName("app_role_2")).toBe("app_role_2");
    expect(migration.appRoleName("none")).toBe("callibrator_app");
    expect(migration.appRoleName("")).toBe("callibrator_app");
    expect(() => migration.appRoleName("x; DROP TABLE users")).toThrow(/not a plain lower-case identifier/);
    processEnv["DB_APP_ROLE"] = "Bad-Role";
    await expect(migration.up({ context: fakeQueryInterface().context })).rejects.toThrow(/not a plain lower-case identifier/);
  });

  it("lets a failure propagate: no try/catch, nothing swallowed", async () => {
    const qi = fakeQueryInterface({ failOn: /^REVOKE/ });
    await expect(migration.up({ context: qi.context })).rejects.toThrow("lock timeout");
    expect(SOURCE).not.toMatch(/\btry\s*\{|\.catch\(/);
  });

  it("down REFUSES while a device type exists — nothing is dropped", async () => {
    const qi = fakeQueryInterface({ deviceTypeCount: 3 });
    await expect(migration.down({ context: qi.context })).rejects.toThrow(/3 device type\(s\) exist/);
    expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("down on an empty catalogue drops the index, the column (and its key), the table, the function and the type", async () => {
    const qi = fakeQueryInterface();
    await migration.down({ context: qi.context });
    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP INDEX IF EXISTS calibration_devices_device_type_id_tenant_id",
      "ALTER TABLE calibration_devices DROP COLUMN IF EXISTS device_type_id",
      "DROP TABLE IF EXISTS device_types",
      "DROP FUNCTION IF EXISTS device_types_no_delete()",
      'DROP TYPE IF EXISTS "enum_device_types_status"',
    ]);
    // A second down (the table already gone) issues the same idempotent drops.
    const again = fakeQueryInterface({ tables: ["users", "calibration_devices"] });
    await migration.down({ context: again.context });
    expect(again.state.statements).toEqual(qi.state.statements);
  });
});
