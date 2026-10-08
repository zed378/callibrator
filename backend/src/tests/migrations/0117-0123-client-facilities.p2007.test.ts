/**
 * Migrations 0117 – 0123 — the client-facility dimension (P20-07, M1 – M7; ADR-124 Am. 2, Am. 3;
 * spec MEMORY/specs/P19-04-client-facilities.md § 4 – § 6).
 *
 * Proves the LOGIC against a fake QueryInterface: what each issues, in ONE transaction, on an
 * upgraded database and on a fresh one (sync() made the tables and columns); that the tables 0117
 * creates are the models' (column for column); that each throws — and so is not recorded as
 * applied — when a prerequisite is absent or a row cannot be back-filled; that nothing is
 * swallowed; that every `down` refuses while facilities are in use. That the triggers FIRE, the
 * keys refuse and cascade, the grants hold as `callibrator_app`, the back-fill reconciles on
 * realistic data and the schema boots, reboots and upgrades is proven on PostgreSQL 18 by
 * clientFacilities.p2007.live.test.ts, deviceMove.p2007.live.test.ts and upgradeBoot.am3.live.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import { environment } from "../../config/env";
import m0117 from "../../migrations/0117-client-facilities";
import m0118 from "../../migrations/0118-facility-devices";
import m0119 from "../../migrations/0119-facility-calibration-records";
import m0120 from "../../migrations/0120-facility-certificates";
import m0121 from "../../migrations/0121-facility-work-orders";
import m0122 from "../../migrations/0122-facility-iot-readings";
import m0123 from "../../migrations/0123-facility-nullable";
import m0057 from "../../migrations/0057-calibration-records-append-only";
import * as shared from "../../migrations/facilityMigration.shared";
import defineClientFacility from "../../models/clientFacility.model";
import defineClientFacilityMove from "../../models/clientFacilityMove.model";
import { FACILITY_BOUND_ROLES } from "../../constants/facilityAccess";
import { LINKABLE_RESOURCES } from "../../constants/attachmentResources";
import { SYSTEM_ACTORS } from "../../constants/systemActors";
import { NO_FACILITY_ID } from "../../types/ids";

const processEnv = environment();
const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");
const MANIFEST = read("../../config/migrator.ts");
const FILES = [
  "0117-client-facilities",
  "0118-facility-devices",
  "0119-facility-calibration-records",
  "0120-facility-certificates",
  "0121-facility-work-orders",
  "0122-facility-iot-readings",
  "0123-facility-nullable",
] as const;

const ALL_TABLES = [
  "tenants", "users", "roles", "calibration_devices", "audit_logs", "client_facilities", "client_facility_moves",
  "calibration_records", "certificates", "maintenance_work_orders", "iot_readings", "attachments", "non_conformances", "warehouses",
];
const FUNCTIONS = ["facility_insert_default", "facility_column_guard", "facility_accepts_inserts", "facility_move_admits"];

interface FakeOptions {
  tables?: string[];
  /** "table.column" */
  columns?: string[];
  constraints?: string[];
  functions?: string[];
  roleExists?: boolean;
  /** tgenabled of 0057's trigger, or null */
  appendOnlyState?: string | null;
  nonSelf?: number;
  moves?: number;
  bound?: number;
  /** rows left with no facility after a back-fill */
  leftover?: number;
  survivingConstraints?: number;
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

const fake = ({
  tables = ALL_TABLES,
  columns = [],
  constraints = [],
  functions = FUNCTIONS,
  roleExists = true,
  appendOnlyState = "O",
  nonSelf = 0,
  moves = 0,
  bound = 0,
  leftover = 0,
  survivingConstraints = 0,
  failOn = null,
}: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0, created: [] as string[], triggerState: appendOnlyState };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      const r = options.replacements ?? {};
      const one = (row: Record<string, unknown>) => Promise.resolve([[row], null]);
      if (sql.includes("to_regclass")) {
        return one({ present: tables.includes(String(r["table"])) });
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve([columns.includes(`${String(r["table"])}.${String(r["column"])}`) ? [{ x: 1 }] : [], null]);
      }
      if (sql.startsWith("SELECT conname FROM pg_constraint")) {
        return Promise.resolve([constraints.map((conname) => ({ conname })), null]);
      }
      if (sql.includes("FROM pg_proc")) {
        return Promise.resolve([functions.includes(String(r["name"])) ? [{ x: 1 }] : [], null]);
      }
      if (sql.includes("FROM pg_roles")) {
        return one({ exists: roleExists });
      }
      if (sql.includes("FROM pg_trigger")) {
        return Promise.resolve([state.triggerState === null ? [] : [{ state: state.triggerState }], null]);
      }
      if (sql.includes("count(*)::int AS n FROM pg_constraint")) {
        return one({ n: survivingConstraints });
      }
      if (sql.includes("FROM client_facilities WHERE NOT is_self")) {
        return one({ n: nonSelf });
      }
      if (sql.includes("count(*)::int AS n FROM client_facility_moves")) {
        return one({ n: moves });
      }
      if (sql.includes("FROM users WHERE client_facility_id IS NOT NULL")) {
        return one({ n: bound });
      }
      if (sql.includes("WHERE client_facility_id IS NULL") && sql.startsWith("SELECT count(*)")) {
        return one({ n: leftover });
      }
      if (failOn?.test(sql)) {
        return Promise.reject(new Error("lock timeout"));
      }
      const flat = sql.replace(/\s+/g, " ").trim();
      state.statements.push(flat);
      // 0119 reads the trigger's state back: ENABLE / DISABLE change it as PostgreSQL would.
      if (flat.includes("DISABLE TRIGGER calibration_records_append_only")) {
        state.triggerState = "D";
      } else if (flat.includes("ENABLE REPLICA TRIGGER calibration_records_append_only")) {
        state.triggerState = "R";
      } else if (flat.includes("ENABLE ALWAYS TRIGGER calibration_records_append_only")) {
        state.triggerState = "A";
      } else if (flat.includes("ENABLE TRIGGER calibration_records_append_only")) {
        state.triggerState = "O";
      }
      if (flat.startsWith("UPDATE")) {
        return Promise.resolve([[], { rowCount: 7 }]);
      }
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
const ClientFacility = defineClientFacility(sequelize, DataTypes);
const ClientFacilityMove = defineClientFacilityMove(sequelize, DataTypes);

const shape = (a: AttributeLike) => ({
  type: a.type.key,
  length: a.type.options?.length,
  values: a.type.values ? [...a.type.values] : undefined,
  allowNull: a.primaryKey !== true && a.allowNull !== false,
  primaryKey: a.primaryKey === true,
  defaultValue: a.defaultValue === undefined || typeof a.defaultValue === "object" ? undefined : a.defaultValue,
  references: a.references ? `${a.references.model}.${a.references.key}` : undefined,
  onDelete: a.onDelete,
});

/** The model's columns, by physical name, without the timestamps (the migration's are NOT NULL dates). */
const modelColumns = (model: { getAttributes(): unknown }): Record<string, ReturnType<typeof shape>> =>
  Object.fromEntries(
    Object.entries(model.getAttributes() as Record<string, AttributeLike>)
      .map(([name, a]) => [a.field ?? name, shape(a)] as const)
      .filter(([column]) => !["created_at", "updated_at"].includes(column)),
  );

const createdColumns = (attributes: Record<string, AttributeLike>): Record<string, ReturnType<typeof shape>> =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter(([c]) => !["created_at", "updated_at"].includes(c))
      .map(([c, a]) => [c, shape(a)]),
  );

/** Every column the seven add, as "table.column" — a database where they all exist (the fresh path). */
const ADDED_COLUMNS = [
  "audit_logs.client_facility_id",
  "calibration_devices.client_facility_id",
  "calibration_records.client_facility_id",
  "certificates.client_facility_id",
  "maintenance_work_orders.client_facility_id",
  "iot_readings.client_facility_id",
  ...m0123.COLUMNS.map(([t, c]) => `${t}.${c}`),
];

describe("migrations 0117 – 0123 — client facilities (P20-07)", () => {
  const savedRole = processEnv["DB_APP_ROLE"];
  beforeEach(() => {
    delete processEnv["DB_APP_ROLE"];
  });
  afterAll(() => {
    if (savedRole === undefined) {
      delete processEnv["DB_APP_ROLE"];
    } else {
      processEnv["DB_APP_ROLE"] = savedRole;
    }
  });

  it("are registered in the static manifest under .js names, in order, after 0116", () => {
    let previous = MANIFEST.indexOf('"0116-upstream-sql-import-menu.js"');
    expect(previous).toBeGreaterThan(0);
    for (const file of FILES) {
      const entry = `["${file}.js", require("../migrations/${file}")]`;
      expect(MANIFEST).toContain(entry);
      expect(MANIFEST.indexOf(entry)).toBeGreaterThan(previous);
      previous = MANIFEST.indexOf(entry);
    }
  });

  it("no migration of the seven, nor their shared module, swallows a failure (no try/catch)", () => {
    for (const file of [...FILES, "facilityMigration.shared"]) {
      expect(read(`../../migrations/${file}.ts`)).not.toMatch(/\btry\s*\{|\.catch\(/);
    }
  });

  describe("the frozen lists the database enforces", () => {
    it("the bound roles are FACILITY_BOUND_ROLES, and the trigger names exactly them", () => {
      expect([...shared.BOUND_ROLE_NAMES]).toEqual([...FACILITY_BOUND_ROLES]);
      const fn = m0117.FUNCTIONS.find(([name]) => name === "users_bound_role_check")?.[2] ?? "";
      expect(fn).toContain("NOT IN ('HEALTHCARE ADMIN', 'HEALTHCARE TECHNICIAN', 'FACILITY MAINTENANCE', 'ROOM USER')");
    });

    it("the facility-scoped attachment types are the linkable ones minus the provider-internal kanban card", () => {
      expect([...shared.FACILITY_ATTACHMENT_TYPES].sort()).toEqual(
        Object.keys(LINKABLE_RESOURCES).filter((t) => t !== "kanbancard").sort(),
      );
    });

    it("the deny sentinel is types/ids NO_FACILITY_ID, and 0117's CHECK refuses it as an id", () => {
      expect(shared.NO_FACILITY_ID).toBe(NO_FACILITY_ID);
      expect(m0117.CHECKS["client_facilities_id_not_sentinel"]).toBe(`id <> '${NO_FACILITY_ID}'::uuid`);
    });

    it("the back-fill's system actor is on the closed list", () => {
      expect(m0117.BACKFILL_ACTOR).toBe(SYSTEM_ACTORS.CLIENT_FACILITY_BACKFILL);
    });

    it("names the role from DB_APP_ROLE, and refuses one it cannot interpolate safely", async () => {
      expect(shared.appRoleName("x", "app_role_2")).toBe("app_role_2");
      expect(shared.appRoleName("x", "none")).toBe("callibrator_app");
      expect(() => shared.appRoleName("0117", "x; DROP TABLE users")).toThrow(/0117: DB_APP_ROLE .* not a plain lower-case identifier/);
      processEnv["DB_APP_ROLE"] = "Bad-Role";
      await expect(m0117.up({ context: fake().context })).rejects.toThrow(/not a plain lower-case identifier/);
    });
  });

  describe("0117 — client_facilities, client_facility_moves, the functions, one self facility per tenant", () => {
    it("creates exactly the models' tables — column for column, type, nullability, default, keys", async () => {
      const qi = fake({ tables: ALL_TABLES.filter((t) => !t.startsWith("client_facilit")) });
      await m0117.up({ context: qi.context });
      expect(qi.state.created).toEqual(["client_facilities", "client_facility_moves"]);
      const facilities = qi.createTable.mock.calls[0]?.[1] ?? {};
      const moves = qi.createTable.mock.calls[1]?.[1] ?? {};
      expect(createdColumns(facilities)).toEqual(modelColumns(ClientFacility));
      // The move log has no updated_at (updatedAt: false); created_at is the model's createdAt.
      expect(createdColumns(moves)).toEqual(modelColumns(ClientFacilityMove));
      expect(facilities["created_at"]).toMatchObject({ allowNull: false });
      expect(moves["created_at"]).toMatchObject({ allowNull: false });
      expect(moves).not.toHaveProperty("updated_at");
      expect(modelColumns(ClientFacility)["kind"]).toMatchObject({ values: ["hospital", "clinic", "health_centre", "district_office", "laboratory", "other"], defaultValue: "other", allowNull: false });
      expect(modelColumns(ClientFacility)["status"]).toMatchObject({ values: ["active", "inactive", "ended"], defaultValue: "active" });
      expect(modelColumns(ClientFacilityMove)["status"]).toMatchObject({ values: ["in_progress", "completed"], defaultValue: "in_progress" });
    });

    it("on an UPGRADED database: CHECKs, indexes, composite keys, functions, ENABLE ALWAYS triggers, the revoke, the audit column and its index, then the self facilities — one transaction", async () => {
      const qi = fake({ tables: ALL_TABLES.filter((t) => !t.startsWith("client_facilit")) });
      await m0117.up({ context: qi.context });
      expect(qi.state.transactions).toBe(1);
      const s = qi.state.statements;
      expect(s[0]).toBe("SET LOCAL lock_timeout = '10s'");
      for (const [name, predicate] of Object.entries(m0117.CHECKS)) {
        expect(s).toContain(`ALTER TABLE client_facilities ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
      for (const [name, predicate] of Object.entries(m0117.MOVE_CHECKS)) {
        expect(s).toContain(`ALTER TABLE client_facility_moves ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
      for (const statement of [...m0117.INDEX_SQL, ...Object.values(m0117.MOVE_FKS)]) {
        expect(s).toContain(statement);
      }
      expect(s.filter((x) => x.startsWith("CREATE OR REPLACE FUNCTION"))).toHaveLength(m0117.FUNCTIONS.length);
      expect(s.filter((x) => x.startsWith("CREATE TRIGGER") || x.startsWith("CREATE CONSTRAINT TRIGGER"))).toHaveLength(4);
      expect(s.filter((x) => x.includes("ENABLE ALWAYS TRIGGER"))).toHaveLength(4);
      expect(s).toContain(
        "CREATE CONSTRAINT TRIGGER client_facility_moves_complete_at_commit AFTER INSERT ON client_facility_moves DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION client_facility_moves_complete_at_commit()",
      );
      expect(s).toContain("REVOKE DELETE, TRUNCATE ON client_facility_moves FROM callibrator_app");
      expect(s).toContain("ALTER TABLE audit_logs ADD COLUMN client_facility_id UUID");
      expect(s).toContain(`CREATE INDEX IF NOT EXISTS ${m0117.AUDIT_INDEX} ON audit_logs (tenant_id, client_facility_id, created_at)`);
      // The device's (tenant_id, id) unique precedes the move log's key to it.
      expect(s.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${m0117.DEVICE_TENANT_ID_UNIQUE} ON calibration_devices (tenant_id, id)`)).toBeLessThan(
        s.indexOf(m0117.MOVE_FKS["client_facility_moves_device_fkey"] ?? "missing"),
      );
      expect(s[s.length - 1]).toBe(m0117.SELF_FACILITY_SQL.replace(/\s+/g, " ").trim());
    });

    it("on a FRESH database (sync() made the tables): no CREATE TABLE, no ADD COLUMN, no second CHECK or key", async () => {
      const qi = fake({
        columns: ADDED_COLUMNS,
        constraints: [...Object.keys(m0117.CHECKS), ...Object.keys(m0117.MOVE_CHECKS), ...Object.keys(m0117.MOVE_FKS)],
      });
      await m0117.up({ context: qi.context });
      expect(qi.createTable).not.toHaveBeenCalled();
      expect(qi.state.statements.some((x) => x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT"))).toBe(false);
      // The self facilities are ensured on every path (none exist after sync()).
      expect(qi.state.statements).toContain(m0117.SELF_FACILITY_SQL.replace(/\s+/g, " ").trim());
    });

    it("the self facility: every tenant WITHOUT one (soft-deleted ones too), code SELF, the normalised name, and its audit row in that tenant", () => {
      const sql = m0117.SELF_FACILITY_SQL;
      expect(sql).toContain("FROM tenants t");
      expect(sql).not.toMatch(/deleted_at|is_deleted/);
      expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM client_facilities f WHERE f.tenant_id = t.id AND f.is_self)");
      expect(sql).toContain("regexp_replace(btrim(t.name), '\\s+', ' ', 'g')");
      expect(sql).toContain("'SELF', 'other', true, 'active'");
      expect(sql).toContain("INSERT INTO audit_logs");
      expect(sql).toContain("SELECT gen_random_uuid(), c.tenant_id, NULL, 'system', 'system:client-facility-backfill', 'CREATE', 'ClientFacility', c.id::text,");
      expect(sql).toContain("'operation', 'CREATE_SELF_FACILITY'");
    });

    it("the functions: the column guard (42501 unless the move admits it), the insert default (Am. 3), the ended refusal, the move log's rules", () => {
      const fn = (name: string): string => m0117.FUNCTIONS.find(([n]) => n === name)?.[2] ?? "";
      expect(fn("facility_move_admits")).toContain("current_setting('callibrator.facility_move', true)");
      expect(fn("facility_move_admits")).toContain("m.status::text = 'in_progress'");
      expect(fn("facility_column_guard")).toContain("IF NOT facility_move_admits(NEW.tenant_id, v_device, OLD.client_facility_id, NEW.client_facility_id) THEN");
      expect(fn("facility_column_guard")).toContain("ERRCODE = '42501'");
      expect(fn("facility_insert_default")).toContain("has no self client facility");
      expect(fn("facility_insert_default")).toContain("serves client facilities beyond its own");
      expect(fn("facility_insert_default").match(/ERRCODE = '23502'/g)).toHaveLength(2);
      expect(fn("facility_insert_default")).toContain("FROM calibration_devices d WHERE d.id = NEW.device_id AND d.tenant_id = NEW.tenant_id");
      expect(fn("facility_accepts_inserts")).toContain("f.status::text = 'ended'");
      expect(fn("facility_accepts_inserts")).toContain("ERRCODE = '23514'");
      expect(fn("users_binding_guard")).toContain("current_setting('callibrator.facility_binding', true), '') <> OLD.id::text");
      expect(fn("client_facilities_identity_immutable")).toContain("NEW.is_self IS DISTINCT FROM OLD.is_self");
      expect(fn("client_facility_moves_append_only")).toContain("OLD.status::text <> 'in_progress' OR NEW.status::text <> 'completed'");
      expect(fn("client_facility_moves_complete_at_commit")).toContain("was not completed in its transaction");
      expect(fn("facility_resource_facility")).toContain("WHEN 'workorder', 'maintenanceworkorder' THEN");
    });

    it.each([["tenants"], ["users"], ["roles"], ["calibration_devices"], ["audit_logs"]])(
      "refuses to run — and so to be recorded as applied — when %s is absent",
      async (missing) => {
        const qi = fake({ tables: ALL_TABLES.filter((t) => t !== missing) });
        await expect(m0117.up({ context: qi.context })).rejects.toThrow(new RegExp(`0117: table ${missing} does not exist`));
        expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
      },
    );

    it("refuses to run when the application role 0057 creates is absent", async () => {
      await expect(m0117.up({ context: fake({ roleExists: false }).context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
    });

    it("lets a failure propagate", async () => {
      await expect(m0117.up({ context: fake({ failOn: /^REVOKE/ }).context })).rejects.toThrow("lock timeout");
    });

    it("down on a single-facility database drops the move log, the table, the device unique, the functions, the types — and keeps the audit column", async () => {
      const qi = fake();
      await m0117.down({ context: qi.context });
      expect(qi.state.statements).toEqual([
        "SET LOCAL lock_timeout = '10s'",
        "DROP TABLE IF EXISTS client_facility_moves",
        "DROP TABLE IF EXISTS client_facilities",
        "DROP INDEX IF EXISTS calibration_devices_tenant_id_id_unique",
        ...[...m0117.FUNCTIONS].reverse().map(([name, signature]) => `DROP FUNCTION IF EXISTS ${name}${signature}`),
        ...m0117.ENUM_TYPES.map((t) => `DROP TYPE IF EXISTS "${t}"`),
      ]);
      expect(qi.state.statements.some((x) => x.includes("audit_logs"))).toBe(false);
    });
  });

  describe("every down REFUSES while facilities are in use — nothing is dropped", () => {
    const downs = [m0117, m0118, m0119, m0120, m0121, m0122, m0123] as const;
    it.each([
      [{ nonSelf: 2 }, /2 client facilities beyond the tenants' own/],
      [{ nonSelf: 1 }, /1 client facility beyond the tenants' own/],
      [{ moves: 3 }, /3 device move\(s\)/],
      [{ bound: 4, columns: ["users.client_facility_id"] }, /4 facility-bound user\(s\)/],
    ])("%j", async (options, message) => {
      for (const migration of downs) {
        const qi = fake(options);
        await expect(migration.down({ context: qi.context })).rejects.toThrow(message);
        expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
      }
    });

    it("does not count bound users before 0123 added the column, nor rows of tables 0117 has not made", async () => {
      const qi = fake({ tables: ALL_TABLES.filter((t) => !t.startsWith("client_facilit")), bound: 9 });
      await m0118.down({ context: qi.context });
      expect(qi.state.statements.length).toBeGreaterThan(1);
    });
  });

  describe("0118 — calibration_devices.client_facility_id", () => {
    it("on an UPGRADED database: column, back-fill to the self facility, NOT NULL, target unique, key, the serial per facility, three triggers", async () => {
      const qi = fake();
      await m0118.up({ context: qi.context });
      expect(qi.state.transactions).toBe(1);
      expect(qi.state.statements).toEqual([
        "SET LOCAL lock_timeout = '10s'",
        "ALTER TABLE calibration_devices ADD COLUMN client_facility_id UUID",
        m0118.BACKFILL_SQL,
        "ALTER TABLE calibration_devices ALTER COLUMN client_facility_id SET NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS calibration_devices_tenant_facility_id_unique ON calibration_devices (tenant_id, client_facility_id, id)",
        m0118.FK_SQL,
        "DROP INDEX IF EXISTS calibration_devices_tenant_id_serial_number_unique",
        "CREATE UNIQUE INDEX IF NOT EXISTS calibration_devices_tenant_facility_serial_unique ON calibration_devices (tenant_id, client_facility_id, serial_number)",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_default ON calibration_devices",
        "CREATE TRIGGER calibration_devices_facility_default BEFORE INSERT ON calibration_devices FOR EACH ROW EXECUTE FUNCTION facility_insert_default('device')",
        "ALTER TABLE calibration_devices ENABLE ALWAYS TRIGGER calibration_devices_facility_default",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_open ON calibration_devices",
        "CREATE TRIGGER calibration_devices_facility_open BEFORE INSERT ON calibration_devices FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()",
        "ALTER TABLE calibration_devices ENABLE ALWAYS TRIGGER calibration_devices_facility_open",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_guard ON calibration_devices",
        "CREATE TRIGGER calibration_devices_facility_guard BEFORE UPDATE OF client_facility_id ON calibration_devices FOR EACH ROW EXECUTE FUNCTION facility_column_guard('device')",
        "ALTER TABLE calibration_devices ENABLE ALWAYS TRIGGER calibration_devices_facility_guard",
      ]);
      expect(m0118.BACKFILL_SQL).toBe(
        "UPDATE calibration_devices d SET client_facility_id = f.id FROM client_facilities f WHERE f.tenant_id = d.tenant_id AND f.is_self AND d.client_facility_id IS NULL",
      );
      expect(m0118.FK_SQL).toBe(
        "ALTER TABLE calibration_devices ADD CONSTRAINT calibration_devices_client_facility_fkey FOREIGN KEY (tenant_id, client_facility_id) REFERENCES client_facilities (tenant_id, id) ON DELETE RESTRICT",
      );
    });

    it("on a FRESH database: no ADD COLUMN, no second key", async () => {
      const qi = fake({ columns: ADDED_COLUMNS, constraints: [m0118.FK] });
      await m0118.up({ context: qi.context });
      expect(qi.state.statements.some((x) => x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT"))).toBe(false);
    });

    it("refuses when 0117 did not run, and when a device is left without a facility (before SET NOT NULL)", async () => {
      await expect(m0118.up({ context: fake({ functions: [] }).context })).rejects.toThrow(/function facility_insert_default\(\) does not exist — migration 0117 must run first/);
      await expect(m0118.up({ context: fake({ tables: ALL_TABLES.filter((t) => t !== "client_facility_moves") }).context })).rejects.toThrow(/table client_facility_moves does not exist/);
      const qi = fake({ leftover: 2 });
      await expect(m0118.up({ context: qi.context })).rejects.toThrow(/0118: 2 device\(s\) belong to a tenant with no self client facility/);
      expect(qi.state.statements.some((x) => x.includes("SET NOT NULL"))).toBe(false);
    });

    it("down drops the triggers, restores 0026's per-tenant serial index, drops the key, the target and the column", async () => {
      const qi = fake();
      await m0118.down({ context: qi.context });
      expect(qi.state.statements).toEqual([
        "SET LOCAL lock_timeout = '10s'",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_default ON calibration_devices",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_open ON calibration_devices",
        "DROP TRIGGER IF EXISTS calibration_devices_facility_guard ON calibration_devices",
        "DROP INDEX IF EXISTS calibration_devices_tenant_facility_serial_unique",
        "CREATE UNIQUE INDEX IF NOT EXISTS calibration_devices_tenant_id_serial_number_unique ON calibration_devices (tenant_id, serial_number)",
        "ALTER TABLE calibration_devices DROP CONSTRAINT IF EXISTS calibration_devices_client_facility_fkey",
        "DROP INDEX IF EXISTS calibration_devices_tenant_facility_id_unique",
        "ALTER TABLE calibration_devices DROP COLUMN IF EXISTS client_facility_id",
      ]);
    });
  });

  describe("0119 – 0122 — the NOT NULL children of a device", () => {
    const children = [
      [m0119, "calibration_records", "RESTRICT", true],
      [m0120, "certificates", "RESTRICT", true],
      [m0121, "maintenance_work_orders", "CASCADE", true],
      [m0122, "iot_readings", "RESTRICT", false],
    ] as const;

    it.each(children.map(([m, table, onDelete, open]) => [table, m, onDelete, open] as const))(
      "%s: column, back-fill from the device, NOT NULL, index, composite key ON UPDATE CASCADE, the triggers — one transaction",
      async (table, migration, onDelete, open) => {
        const qi = fake({ columns: ["calibration_devices.client_facility_id"] });
        await migration.up({ context: qi.context });
        expect(qi.state.transactions).toBe(1);
        const s = qi.state.statements;
        const order = [
          `ALTER TABLE ${table} ADD COLUMN client_facility_id UUID`,
          shared.childBackfillSql(table),
          `ALTER TABLE ${table} ALTER COLUMN client_facility_id SET NOT NULL`,
          `CREATE INDEX IF NOT EXISTS ${table}_tenant_facility_device ON ${table} (tenant_id, client_facility_id, device_id)`,
          `ALTER TABLE ${table} ADD CONSTRAINT ${table}_device_facility_fkey FOREIGN KEY (tenant_id, client_facility_id, device_id) ` +
            `REFERENCES calibration_devices (tenant_id, client_facility_id, id) ON UPDATE CASCADE ON DELETE ${onDelete}`,
          `CREATE TRIGGER ${table}_facility_default BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_insert_default('child')`,
          `CREATE TRIGGER ${table}_facility_guard BEFORE UPDATE OF client_facility_id ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_column_guard('child')`,
        ];
        let at = -1;
        for (const statement of order) {
          expect(s).toContain(statement);
          expect(s.indexOf(statement)).toBeGreaterThan(at);
          at = s.indexOf(statement);
        }
        expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_facility_guard`);
        expect(s.includes(`CREATE TRIGGER ${table}_facility_open BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()`)).toBe(open);
        expect(shared.childBackfillSql(table)).toBe(
          `UPDATE ${table} c SET client_facility_id = d.client_facility_id FROM calibration_devices d WHERE d.id = c.device_id AND d.tenant_id = c.tenant_id AND c.client_facility_id IS NULL`,
        );
      },
    );

    it.each(children.map(([m, table]) => [table, m] as const))("%s: refuses before 0118, and when a row has no device to take a facility from", async (table, migration) => {
      await expect(migration.up({ context: fake().context })).rejects.toThrow(/calibration_devices.client_facility_id does not exist — migration 0118 must run first/);
      const qi = fake({ columns: ["calibration_devices.client_facility_id"], leftover: 5 });
      await expect(migration.up({ context: qi.context })).rejects.toThrow(new RegExp(`5 row\\(s\\) of ${table} have no device`));
      expect(qi.state.statements.some((x) => x.includes("SET NOT NULL"))).toBe(false);
    });

    it.each(children.map(([m, table]) => [table, m] as const))("%s: a FRESH database adds no column and no second key", async (table, migration) => {
      const qi = fake({
        columns: ADDED_COLUMNS,
        constraints: [`${table}_device_facility_fkey`, "certificates_record_facility_fkey"],
      });
      await migration.up({ context: qi.context });
      expect(qi.state.statements.some((x) => x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT"))).toBe(false);
    });

    it("0119 lifts 0057's append-only trigger for the back-fill only, and puts it back as it was ('O' → ENABLE, 'A' → ENABLE ALWAYS)", async () => {
      for (const [before, restore] of [["O", "ENABLE"], ["A", "ENABLE ALWAYS"], ["R", "ENABLE REPLICA"]] as const) {
        const qi = fake({ columns: ["calibration_devices.client_facility_id"], appendOnlyState: before });
        await m0119.up({ context: qi.context });
        const s = qi.state.statements;
        const disable = s.indexOf("ALTER TABLE calibration_records DISABLE TRIGGER calibration_records_append_only");
        const backfill = s.indexOf(shared.childBackfillSql("calibration_records"));
        const enable = s.indexOf(`ALTER TABLE calibration_records ${restore} TRIGGER calibration_records_append_only`);
        expect(disable).toBeGreaterThan(0);
        expect(backfill).toBe(disable + 1);
        expect(enable).toBe(backfill + 1);
      }
    });

    it("0119 refuses when 0057's trigger is absent, and when it was not restored", async () => {
      await expect(
        m0119.up({ context: fake({ columns: ["calibration_devices.client_facility_id"], appendOnlyState: null }).context }),
      ).rejects.toThrow(/trigger calibration_records_append_only does not exist/);
      // 'D' before (an operator left it disabled): restored to ENABLE, which is not 'D' — refused.
      await expect(
        m0119.up({ context: fake({ columns: ["calibration_devices.client_facility_id"], appendOnlyState: "D" }).context }),
      ).rejects.toThrow(/was not restored \("O" ≠ D\)/);
    });

    it("0119 replaces 0057's function: the same rules, plus ONE exception — the facility column under an admitted move", () => {
      expect(m0119.FUNCTION_SQL).toContain(`CREATE OR REPLACE FUNCTION ${m0057.FUNCTION_NAME}() RETURNS trigger`);
      expect(m0119.FUNCTION_SQL).toContain(`ARRAY[${m0057.LIFECYCLE_COLUMNS.map((c) => `'${c}'`).join(", ")}]`);
      expect(m0119.FUNCTION_SQL).toContain(
        "AND facility_move_admits(NEW.tenant_id, NEW.device_id, OLD.client_facility_id, NEW.client_facility_id) THEN\n    compared := lifecycle || ARRAY['client_facility_id'];",
      );
      // Every refusal 0057 raises, 0119 raises.
      for (const refusal of [
        "TRUNCATE is refused",
        "record % cannot be deleted",
        "the content of record % cannot be changed",
        "a supersession or void of record % is final",
      ]) {
        expect(m0057.FUNCTION_SQL).toContain(refusal);
        expect(m0119.FUNCTION_SQL).toContain(refusal);
      }
    });

    it("0120 adds the record path: deferred, MATCH SIMPLE, NO ACTION — with its index", async () => {
      const qi = fake({ columns: ["calibration_devices.client_facility_id"] });
      await m0120.up({ context: qi.context });
      expect(qi.state.statements).toContain(
        "CREATE INDEX IF NOT EXISTS certificates_tenant_facility_record ON certificates (tenant_id, client_facility_id, calibration_record_id)",
      );
      expect(qi.state.statements[qi.state.statements.length - 1]).toBe(m0120.RECORD_FK_SQL);
      expect(m0120.RECORD_FK_SQL).toBe(
        "ALTER TABLE certificates ADD CONSTRAINT certificates_record_facility_fkey FOREIGN KEY (tenant_id, client_facility_id, calibration_record_id) " +
          "REFERENCES calibration_records (tenant_id, client_facility_id, id) MATCH SIMPLE ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED",
      );
    });

    it.each(children.map(([m, table, , open]) => [table, m, open] as const))("%s: down drops the triggers, the key, the index and the column", async (table, migration, open) => {
      const qi = fake();
      await migration.down({ context: qi.context });
      expect(qi.state.statements).toEqual(
        expect.arrayContaining([
          `DROP TRIGGER IF EXISTS ${table}_facility_default ON ${table}`,
          `DROP TRIGGER IF EXISTS ${table}_facility_guard ON ${table}`,
          `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_device_facility_fkey`,
          `DROP INDEX IF EXISTS ${table}_tenant_facility_device`,
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS client_facility_id`,
        ]),
      );
      expect(qi.state.statements.includes(`DROP TRIGGER IF EXISTS ${table}_facility_open ON ${table}`)).toBe(open);
    });

    it("0119 down restores 0057's function exactly, and refuses while 0120's record key still references the target", async () => {
      const qi = fake();
      await m0119.down({ context: qi.context });
      expect(qi.state.statements).toContain(m0057.FUNCTION_SQL.replace(/\s+/g, " ").trim());
      expect(qi.state.statements[qi.state.statements.length - 1]).toBe("DROP INDEX IF EXISTS calibration_records_tenant_facility_id_unique");
      await expect(m0119.down({ context: fake({ constraints: ["certificates_record_facility_fkey"] }).context })).rejects.toThrow(/revert 0120 first/);
    });
  });

  describe("0123 — attachments, non-conformances, warehouses, users", () => {
    const READY = ["calibration_devices", "calibration_records", "certificates", "maintenance_work_orders"].map((t) => `${t}.client_facility_id`);

    it("on an UPGRADED database: the six columns, two back-fills, the CHECKs, indexes, keys, functions, triggers — one transaction", async () => {
      const qi = fake({ columns: READY });
      await m0123.up({ context: qi.context });
      expect(qi.state.transactions).toBe(1);
      const s = qi.state.statements;
      for (const [table, column, ddl] of m0123.COLUMNS) {
        expect(s).toContain(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      }
      expect(s).toContain(m0123.ATTACHMENT_BACKFILL_SQL.replace(/\s+/g, " ").trim());
      expect(s).toContain(m0123.NC_BACKFILL_SQL);
      for (const [name, [table, predicate]] of Object.entries(m0123.CHECKS)) {
        expect(s).toContain(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
      for (const statement of [...m0123.INDEX_SQL, ...Object.values(m0123.FKS).map(([, sql]) => sql)]) {
        expect(s).toContain(statement);
      }
      // Back-fills before the CHECKs that need them.
      expect(s.indexOf(m0123.NC_BACKFILL_SQL)).toBeLessThan(s.findIndex((x) => x.includes("non_conformances_facility_follows_device")));
      const created = s.filter((x) => x.startsWith("CREATE TRIGGER") || x.startsWith("CREATE CONSTRAINT TRIGGER"));
      expect(created).toHaveLength(m0123.TRIGGERS.length);
      expect(s.filter((x) => x.includes("ENABLE ALWAYS TRIGGER"))).toHaveLength(m0123.TRIGGERS.length);
      expect(s).toContain(
        "CREATE CONSTRAINT TRIGGER attachments_facility_matches_resource AFTER INSERT OR UPDATE OF client_facility_id, resource_type, resource_id ON attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION attachments_facility_matches_resource()",
      );
      expect(s).toContain(
        "CREATE CONSTRAINT TRIGGER certificates_attachments_follow_facility AFTER UPDATE OF client_facility_id ON certificates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facility_attachments_follow('certificate')",
      );
      expect(s).toContain(
        "CREATE TRIGGER non_conformances_facility_default BEFORE INSERT OR UPDATE OF device_id ON non_conformances FOR EACH ROW EXECUTE FUNCTION facility_insert_default('nc')",
      );
      expect(s).toContain(
        "CREATE TRIGGER users_facility_bound_role BEFORE INSERT OR UPDATE OF role_id, client_facility_id ON users FOR EACH ROW EXECUTE FUNCTION users_bound_role_check()",
      );
    });

    it("the rules it writes: a file has a facility exactly when linked to a facility-scoped record; an NC exactly when it has a device; a bound user has a tenant", () => {
      expect(m0123.CHECKS["attachments_facility_kind"]?.[1]).toBe(
        "(client_facility_id IS NOT NULL) = (resource_id IS NOT NULL AND lower(resource_type) IN ('certificate', 'device', 'calibrationdevice', 'calibration', 'calibrationrecord', 'workorder', 'maintenanceworkorder'))",
      );
      expect(m0123.CHECKS["non_conformances_facility_follows_device"]?.[1]).toBe("(device_id IS NULL) = (client_facility_id IS NULL)");
      expect(m0123.FKS["non_conformances_device_facility_fkey"]?.[1]).toContain("ON UPDATE CASCADE ON DELETE SET NULL (client_facility_id, device_id)");
      expect(m0123.ATTACHMENT_BACKFILL_SQL).toContain("(SELECT f.id FROM client_facilities f WHERE f.tenant_id = a.tenant_id AND f.is_self)");
    });

    it("refuses before 0118 – 0121, and with a missing table", async () => {
      await expect(m0123.up({ context: fake({ columns: READY.slice(0, 3) }).context })).rejects.toThrow(/maintenance_work_orders.client_facility_id does not exist — migrations 0118 – 0121 must run first/);
      await expect(m0123.up({ context: fake({ columns: READY, tables: ALL_TABLES.filter((t) => t !== "warehouses") }).context })).rejects.toThrow(/table warehouses does not exist/);
    });

    it("a FRESH database adds no column and no second CHECK or key", async () => {
      const qi = fake({ columns: [...READY, ...ADDED_COLUMNS], constraints: [...Object.keys(m0123.CHECKS), ...Object.keys(m0123.FKS)] });
      await m0123.up({ context: qi.context });
      expect(qi.state.statements.some((x) => x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT"))).toBe(false);
    });

    it("down drops the triggers, functions, indexes and columns — and refuses if a CHECK or key survived them", async () => {
      const qi = fake();
      await m0123.down({ context: qi.context });
      const s = qi.state.statements;
      for (const [table, name] of m0123.TRIGGERS) {
        expect(s).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      }
      for (const [table, column] of m0123.COLUMNS) {
        expect(s).toContain(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
      }
      await expect(m0123.down({ context: fake({ survivingConstraints: 1 }).context })).rejects.toThrow(/survived its column/);
    });
  });
});
