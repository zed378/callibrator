/**
 * Migrations 0128 (P20-02: the device extensions and the calibration-date columns) and 0129 (P20-08:
 * `attachments.purpose` and the IPM attachment type) — ADR-132, ADR-133 and Am. 1 of each; specs
 * MEMORY/specs/P19-03-device-extensions.md § 4, § 6, § 7.1, P19-05-calibration-dates.md § 4 and
 * P19-02-ipm-session-aggregate.md § 12.
 *
 * Proves the LOGIC against a fake QueryInterface: what each issues, in ONE transaction; that the
 * columns 0128 adds are the models' (type, length, nullability, default, key); that the back-fill
 * runs before the CHECK that needs it; that no unique is global; that 0129's four functions keep
 * their previous migration's text byte for byte and only gain the `inspectionsession` branch or
 * list entry; that each throws — and so is not recorded as applied — when a prerequisite is absent;
 * that `down` refuses while data would be lost and restores the previous functions and CHECK
 * exactly. That the triggers FIRE and the constraints refuse, as `callibrator_app` and as the owner,
 * is proven on PostgreSQL 18 by deviceExtensions.p2002.live.
 */
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import { ATTACHMENT_PURPOSES, QR_CODE_PATTERN } from "@callibrator/contracts/deviceValues";
import m0117 from "../../migrations/0117-client-facilities";
import m0123 from "../../migrations/0123-facility-nullable";
import m0126 from "../../migrations/0126-ipm-sessions";
import m0128 from "../../migrations/0128-device-extensions";
import m0129 from "../../migrations/0129-attachment-purpose";
import defineCalibrationDevice from "../../models/calibrationDevice.model";
import defineCalibrationRecord from "../../models/calibrationRecord.model";
import defineWarehouse from "../../models/warehouse.model";
import defineAttachment from "../../models/attachment.model";

const FOUNDATION = ["facility_insert_default", "facility_column_guard", "facility_accepts_inserts", "facility_move_admits"];
const TABLES = [...m0128.PREREQUISITES, "attachments", "client_facility_moves"];
const BASE_COLUMNS = [
  "calibration_devices.client_facility_id",
  "warehouses.client_facility_id",
  "attachments.client_facility_id",
  "inspection_sessions.client_facility_id",
];
const NEW_COLUMNS = [...m0128.COLUMNS.map(([t, c]) => `${t}.${c}`), "attachments.purpose"];

interface FakeOptions {
  tables?: string[];
  columns?: string[];
  constraints?: string[];
  types?: string[];
  functions?: string[];
  held?: number;
}

const fake = ({
  tables = TABLES,
  columns = BASE_COLUMNS,
  constraints = [],
  types = [],
  functions = FOUNDATION,
  held = 0,
}: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0, counts: [] as string[] };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      const r = options.replacements ?? {};
      if (sql.includes("to_regclass")) {
        return Promise.resolve([[{ present: tables.includes(String(r["table"])) }], null]);
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve([columns.includes(`${String(r["table"])}.${String(r["column"])}`) ? [{ x: 1 }] : [], null]);
      }
      if (sql.startsWith("SELECT conname FROM pg_constraint")) {
        return Promise.resolve([constraints.map((conname) => ({ conname })), null]);
      }
      if (sql.includes("FROM pg_type")) {
        return Promise.resolve([types.includes(String(r["name"])) ? [{ x: 1 }] : [], null]);
      }
      if (sql.includes("FROM pg_proc")) {
        return Promise.resolve([functions.includes(String(r["name"])) ? [{ x: 1 }] : [], null]);
      }
      if (sql.startsWith("SELECT count(*)::int AS n FROM")) {
        state.counts.push(sql);
        return Promise.resolve([[{ n: held }], null]);
      }
      state.statements.push(sql);
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn(async (work: (t: unknown) => Promise<void>) => {
      state.transactions += 1;
      await work({ id: "tx" });
    }),
  };
  return { state, context: { sequelize } as unknown as QueryInterface };
};

interface AttributeLike {
  type: { key: string; options?: { length?: number }; values?: readonly string[] };
  allowNull?: boolean;
  defaultValue?: unknown;
  references?: { model: string; key: string };
  onDelete?: string;
  field?: string;
}

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const MODELS: Record<string, { getAttributes(): unknown }> = {
  calibration_devices: defineCalibrationDevice(sequelize, DataTypes),
  calibration_records: defineCalibrationRecord(sequelize, DataTypes),
  warehouses: defineWarehouse(sequelize, DataTypes),
  attachments: defineAttachment(sequelize, DataTypes),
};

/** The model attribute on `table.column`. */
const attributeOn = (table: string, column: string): AttributeLike => {
  const found = Object.entries((MODELS[table] as { getAttributes(): unknown }).getAttributes() as Record<string, AttributeLike>).find(
    ([name, a]) => (a.field ?? name) === column,
  );
  if (!found) {
    throw new Error(`no model attribute on ${table}.${column}`);
  }
  return found[1];
};

/** The DDL a model attribute stands for, in 0128's spelling. */
const ddlOf = (table: string, column: string, a: AttributeLike): string => {
  const base: Record<string, string> = {
    STRING: `VARCHAR(${String(a.type.options?.length)})`,
    DATEONLY: "DATE",
    DATE: "TIMESTAMP WITH TIME ZONE",
    BOOLEAN: "BOOLEAN",
    JSONB: "JSONB",
    SMALLINT: "SMALLINT",
    UUID: "UUID",
    ENUM: `"enum_${table}_${column}"`,
  };
  let ddl = base[a.type.key] ?? `?${a.type.key}`;
  if (a.allowNull === false) {
    ddl += " NOT NULL";
  }
  if (typeof a.defaultValue === "string") {
    ddl += ` DEFAULT '${a.defaultValue}'`;
  }
  if (a.references) {
    ddl += ` REFERENCES ${a.references.model} (${a.references.key}) ON DELETE ${String(a.onDelete)} ON UPDATE CASCADE`;
  }
  return ddl;
};

describe("migration 0128 — the device extensions and the calibration-date columns (P20-02)", () => {
  it("adds exactly the models' columns — type, length, nullability, default and key, one for one", () => {
    for (const [table, column, ddl] of m0128.COLUMNS) {
      expect(`${table}.${column} ${ddl}`).toBe(`${table}.${column} ${ddlOf(table, column, attributeOn(table, column))}`);
    }
    // The session key is the migration's alone (no `references` on the model: sync would order a cycle).
    expect(attributeOn("calibration_devices", "calibration_requested_by_session_id").references).toBeUndefined();
    expect(m0128.SESSION_FK_SQL).toMatch(/REFERENCES inspection_sessions \(id\) ON UPDATE RESTRICT ON DELETE RESTRICT$/);
    // Each ENUM type is the contract's tuple, in its order, under Sequelize's name.
    for (const [name, values] of m0128.ENUM_TYPES) {
      const [, table, column] = /^enum_(calibration_devices|calibration_records|warehouses)_(\w+)$/.exec(name) ?? [];
      expect(attributeOn(String(table), String(column)).type.values).toEqual([...values]);
    }
  });

  it("on an upgrade: types, columns, the back-fill, then the CHECKs, indexes, the session key, functions and ENABLE ALWAYS triggers — one transaction", async () => {
    const qi = fake();
    await m0128.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    const s = qi.state.statements;
    expect(s[0]).toBe("SET LOCAL lock_timeout = '10s'");
    for (const [name] of m0128.ENUM_TYPES) {
      expect(s.some((x) => x.startsWith(`CREATE TYPE "${name}" AS ENUM (`))).toBe(true);
    }
    for (const [table, column, ddl] of m0128.COLUMNS) {
      expect(s).toContain(`ALTER TABLE ${table} ADD COLUMN "${column}" ${ddl}`);
    }
    const backfill = s.indexOf(m0128.BACKFILL_SQL);
    const pairCheck = s.findIndex((x) => x.includes("ADD CONSTRAINT calibration_devices_next_date_has_source CHECK"));
    expect(backfill).toBeGreaterThan(0);
    expect(pairCheck).toBeGreaterThan(backfill);
    for (const name of Object.keys(m0128.CHECKS)) {
      expect(s.some((x) => x.includes(`ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    expect(s.filter((x) => x.includes("INDEX IF NOT EXISTS"))).toEqual([...m0128.INDEX_SQL]);
    expect(s).toContain(m0128.SESSION_FK_SQL);
    for (const [table, name] of m0128.TRIGGERS) {
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
    // The functions exist before the triggers that call them.
    expect(s.findIndex((x) => x.includes("FUNCTION calibration_devices_location_facility()"))).toBeLessThan(
      s.findIndex((x) => x.startsWith("CREATE TRIGGER calibration_devices_location_facility")),
    );
  });

  it("on a fresh database (sync made the types and columns): none is created again; idempotent on CHECKs and the key", async () => {
    const qi = fake({
      columns: [...BASE_COLUMNS, ...NEW_COLUMNS],
      types: m0128.ENUM_TYPES.map(([name]) => name),
      constraints: [...Object.keys(m0128.CHECKS), m0128.SESSION_FK],
    });
    await m0128.up({ context: qi.context });
    const s = qi.state.statements;
    expect(s.filter((x) => x.startsWith("CREATE TYPE") || x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT"))).toEqual([]);
    expect(s).toContain(m0128.BACKFILL_SQL);
  });

  it("no uniqueness is global: QR and client_ref per tenant, the room name per facility; the QR covers deleted rows too", () => {
    const uniques = m0128.INDEX_SQL.filter((x) => x.includes("UNIQUE"));
    expect(uniques).toHaveLength(3);
    for (const statement of uniques) {
      expect(statement).toMatch(/ON \w+ \(tenant_id, /);
    }
    const qr = uniques.find((x) => x.includes("calibration_devices_tenant_qr_code_unique")) ?? "";
    expect(qr).toMatch(/WHERE qr_code IS NOT NULL$/);
    expect(qr).not.toContain("is_deleted");
    expect(uniques.find((x) => x.includes("warehouses_room_name_unique"))).toMatch(
      /\(tenant_id, client_facility_id, .*\) WHERE kind = 'room' AND is_deleted = false$/,
    );
    expect(m0128.CHECKS["calibration_devices_qr_code_shape"]?.[1]).toBe(`qr_code IS NULL OR qr_code ~ '${QR_CODE_PATTERN}'`);
  });

  it("every new foreign key has a leading index (D-20)", () => {
    for (const column of ["calibration_vendor_id", "created_by", "calibration_requested_by_session_id"]) {
      expect(m0128.INDEX_SQL).toContain(`CREATE INDEX IF NOT EXISTS calibration_devices_${column} ON calibration_devices (${column})`);
    }
    expect(m0128.INDEX_SQL).toContain("CREATE INDEX IF NOT EXISTS calibration_records_calibration_vendor_id ON calibration_records (calibration_vendor_id)");
  });

  it.each([
    ["a table", { tables: TABLES.filter((t) => t !== "inspection_sessions") }, /table inspection_sessions does not exist/],
    ["the device facility (0118)", { columns: BASE_COLUMNS.filter((c) => c !== "calibration_devices.client_facility_id") }, /calibration_devices.client_facility_id does not exist/],
    ["the warehouse facility (0123)", { columns: BASE_COLUMNS.filter((c) => c !== "warehouses.client_facility_id") }, /warehouses.client_facility_id does not exist/],
  ])("throws, changing nothing, without %s", async (_what, options, message) => {
    const qi = fake(options);
    await expect(m0128.up({ context: qi.context })).rejects.toThrow(message);
    expect(qi.state.statements.filter((x) => !x.startsWith("SET LOCAL"))).toEqual([]);
  });

  it("down REFUSES while a QR, condition, room or external record exists — and changes nothing", async () => {
    const qi = fake({ columns: [...BASE_COLUMNS, ...NEW_COLUMNS], held: 2 });
    await expect(m0128.down({ context: qi.context })).rejects.toThrow(
      /2 device\(s\) with a QR.*2 room\(s\), 2 calibration record\(s\).*restore the pre-upgrade backup/,
    );
    expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("down on an unused extension drops triggers, functions, the key, indexes, columns and types; the derived source does not count", async () => {
    const qi = fake({ columns: [...BASE_COLUMNS, ...NEW_COLUMNS] });
    await m0128.down({ context: qi.context });
    expect(qi.state.counts).toHaveLength(3);
    expect(qi.state.counts.join(" ")).not.toContain("next_calibration_date_source");
    const s = qi.state.statements;
    for (const [table, name] of m0128.TRIGGERS) {
      expect(s).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    }
    for (const [name] of m0128.FUNCTIONS) {
      expect(s).toContain(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    expect(s).toContain(`ALTER TABLE calibration_devices DROP CONSTRAINT IF EXISTS ${m0128.SESSION_FK}`);
    for (const name of m0128.INDEX_NAMES) {
      expect(s).toContain(`DROP INDEX IF EXISTS ${name}`);
    }
    for (const [table, column] of m0128.COLUMNS) {
      expect(s).toContain(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const [name] of m0128.ENUM_TYPES) {
      expect(s).toContain(`DROP TYPE IF EXISTS "${name}"`);
    }
  });

  it("down on a database 0128 never touched counts nothing", async () => {
    const qi = fake();
    await m0128.down({ context: qi.context });
    expect(qi.state.counts).toEqual([]);
  });
});

const fn = (functions: readonly (readonly string[])[], name: string): string => {
  const found = functions.find((f) => f[0] === name);
  return found?.[found.length - 1] ?? "";
};
const m0129Fn = (name: string): string => fn(m0129.FUNCTIONS, name);

describe("migration 0129 — attachments.purpose and the inspectionsession type (P20-08)", () => {
  it("the resource functions are 0117's, byte for byte, plus the inspectionsession branch", () => {
    const device = m0129Fn("facility_resource_device");
    const facility = m0129Fn("facility_resource_facility");
    expect(device).toContain(m0129.RESOURCE_DEVICE_BRANCH);
    expect(device.replace(m0129.RESOURCE_DEVICE_BRANCH, "")).toBe(fn(m0117.FUNCTIONS, "facility_resource_device"));
    expect(facility.replace(m0129.RESOURCE_FACILITY_BRANCH, "")).toBe(fn(m0117.FUNCTIONS, "facility_resource_facility"));
    // The branch sits inside the CASE, before its fall-through.
    expect(device.indexOf("WHEN 'inspectionsession'")).toBeLessThan(device.indexOf("    ELSE\n      v := NULL;"));
  });

  it("facility_insert_default is 0126's and attachments_facility_matches_resource is 0123's, but for the widened type list", () => {
    for (const [name, previous] of [
      ["facility_insert_default", fn(m0126.FUNCTIONS, "facility_insert_default")],
      ["attachments_facility_matches_resource", fn(m0123.FUNCTIONS, "attachments_facility_matches_resource")],
    ] as const) {
      const now = m0129Fn(name);
      expect(now).not.toBe(previous);
      expect(now).toContain(`IN (${m0129.NEW_TYPES})`);
      expect(now.replace(`IN (${m0129.NEW_TYPES})`, `IN (${m0129.OLD_TYPES})`)).toBe(previous);
      // 0126's `result` branch survives (0129 builds on 0126, not on 0117).
      if (name === "facility_insert_default") {
        expect(now).toContain(m0126.INSERT_DEFAULT_RESULT_BRANCH);
      }
    }
    expect(m0129.NEW_TYPES).toBe(`${m0129.OLD_TYPES}, 'inspectionsession'`);
    expect(m0129.PREVIOUS["facility_insert_default"]).toBe(fn(m0126.FUNCTIONS, "facility_insert_default"));
  });

  it("up: the purpose column, its CHECKs and one-live-photo unique, the functions, the widened CHECK, the follow trigger — one transaction", async () => {
    const qi = fake();
    await m0129.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    const s = qi.state.statements;
    expect(s).toContain("ALTER TABLE attachments ADD COLUMN purpose VARCHAR(32)");
    expect(s).toContain(`ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_values CHECK (purpose IS NULL OR purpose IN ('${ATTACHMENT_PURPOSES.join("', '")}'))`);
    expect(m0129.CHECKS["attachments_purpose_resource"]).toBe(
      "purpose IS NULL OR (purpose IN ('device_front', 'device_serial_plate', 'device_other') AND lower(resource_type) IN ('device', 'calibrationdevice')) " +
        "OR (purpose = 'ipm_evidence' AND lower(resource_type) = 'inspectionsession')",
    );
    expect(s).toContain(m0129.INDEX_SQL[0]);
    expect(m0129.INDEX_SQL[0]).toMatch(/\(tenant_id, resource_id, purpose\) WHERE purpose IN \('device_front', 'device_serial_plate'\) AND is_deleted = false$/);
    const lastFunction = Math.max(...m0129.FUNCTIONS.map(([, sql]) => s.indexOf(sql)));
    const check = s.indexOf(`ALTER TABLE attachments ADD CONSTRAINT attachments_facility_kind CHECK (${m0129.facilityKindPredicate(m0129.NEW_TYPES)})`);
    expect(lastFunction).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lastFunction);
    expect(s[check - 1]).toBe("ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_facility_kind");
    // 0123's predicate, over the widened list: the same text otherwise.
    expect(m0129.facilityKindPredicate(m0129.OLD_TYPES)).toBe(m0123.CHECKS["attachments_facility_kind"]?.[1]);
    expect(s).toContain(`CREATE ${m0129.FOLLOW_TRIGGER_SQL}`);
    expect(s).toContain("ALTER TABLE inspection_sessions ENABLE ALWAYS TRIGGER inspection_sessions_attachments_follow_facility");
  });

  it("is idempotent: an existing purpose column and CHECKs are not added again", async () => {
    const qi = fake({ columns: [...BASE_COLUMNS, "attachments.purpose"], constraints: Object.keys(m0129.CHECKS) });
    await m0129.up({ context: qi.context });
    expect(qi.state.statements.filter((x) => x.includes("ADD COLUMN") || x.includes("ADD CONSTRAINT attachments_purpose"))).toEqual([]);
  });

  it.each([
    ["the session table (0126)", { tables: TABLES.filter((t) => t !== "inspection_sessions") }, /table inspection_sessions does not exist/],
    ["0117's functions", { functions: [] }, /function facility_insert_default\(\) does not exist/],
    ["the attachment facility (0123)", { columns: BASE_COLUMNS.filter((c) => c !== "attachments.client_facility_id") }, /attachments.client_facility_id does not exist/],
    ["the session facility (0126)", { columns: BASE_COLUMNS.filter((c) => c !== "inspection_sessions.client_facility_id") }, /inspection_sessions.client_facility_id does not exist/],
  ])("throws, changing nothing, without %s", async (_what, options, message) => {
    const qi = fake(options);
    await expect(m0129.up({ context: qi.context })).rejects.toThrow(message);
    expect(qi.state.statements.filter((x) => !x.startsWith("SET LOCAL"))).toEqual([]);
  });

  it("down REFUSES while a file has a purpose or is an IPM session's", async () => {
    const qi = fake({ columns: [...BASE_COLUMNS, "attachments.purpose"], held: 1 });
    await expect(m0129.down({ context: qi.context })).rejects.toThrow(/1 attachment\(s\) with a purpose or linked to an IPM session/);
    expect(qi.state.statements).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("down restores 0117's, 0123's and 0126's functions and 0123's CHECK exactly, then drops the rest", async () => {
    const qi = fake({ columns: [...BASE_COLUMNS, "attachments.purpose"] });
    await m0129.down({ context: qi.context });
    const s = qi.state.statements;
    expect(s).toContain("DROP TRIGGER IF EXISTS inspection_sessions_attachments_follow_facility ON inspection_sessions");
    expect(s).toContain(`ALTER TABLE attachments ADD CONSTRAINT attachments_facility_kind CHECK (${String(m0123.CHECKS["attachments_facility_kind"]?.[1])})`);
    expect(s).toContain(fn(m0117.FUNCTIONS, "facility_resource_device"));
    expect(s).toContain(fn(m0117.FUNCTIONS, "facility_resource_facility"));
    expect(s).toContain(fn(m0126.FUNCTIONS, "facility_insert_default"));
    expect(s).toContain(fn(m0123.FUNCTIONS, "attachments_facility_matches_resource"));
    expect(s).toContain("DROP INDEX IF EXISTS attachments_one_live_device_photo");
    expect(s.at(-1)).toBe("ALTER TABLE attachments DROP COLUMN IF EXISTS purpose");
  });

  it("down where the column never existed counts nothing", async () => {
    const qi = fake();
    await m0129.down({ context: qi.context });
    expect(qi.state.counts).toEqual([]);
  });
});
