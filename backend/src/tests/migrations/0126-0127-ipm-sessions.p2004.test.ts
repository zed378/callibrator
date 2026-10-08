/**
 * Migrations 0126 (P20-04: the IPM tables, keys, facility triggers and grants) and 0127 (P20-05: the
 * immutability triggers) — ADR-126 § 5, Am. 1–2; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 4, § 5, § 9.1 and MEMORY/specs/P19-06-ipm-report-document.md § 4.
 *
 * Proves the LOGIC against a fake QueryInterface: what each issues, in ONE transaction, on a fresh
 * database (sync() made the tables) and on one where the migration creates them; that the tables
 * it creates are the models' (column for column); that 0117's two functions keep every branch
 * byte for byte and only gain the `result` branch; that each throws — and so is not recorded as
 * applied — when a prerequisite is absent; that `down` refuses while a row exists and restores
 * 0117's functions exactly. That the triggers FIRE, the keys refuse and cascade under a device
 * move, the grants hold as `callibrator_app` and the owner is bound too is proven on PostgreSQL 18
 * by inspectionSessions.p2004.live, inspectionImmutable.p2005.live and deviceMove.p2007.live.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import { INSPECTION_SECTION_RULES } from "@callibrator/contracts/inspectionValues";
import m0117 from "../../migrations/0117-client-facilities";
import m0126 from "../../migrations/0126-ipm-sessions";
import m0127 from "../../migrations/0127-ipm-immutability";
import defineInspectionSession from "../../models/inspectionSession.model";
import defineInspectionResult from "../../models/inspectionResult.model";
import defineInspectionSessionSignature from "../../models/inspectionSessionSignature.model";
import defineIdempotencyKey from "../../models/idempotencyKey.model";

const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");

const PREREQUISITES = [
  "tenants", "users", "api_keys", "warehouses", "calibration_devices", "maintenance_work_orders",
  "inspection_template_versions", "inspection_template_items", "inspection_item_definitions",
  "client_facilities", "client_facility_moves",
];
const IPM_TABLES = ["inspection_sessions", "inspection_results", "inspection_session_signatures", "idempotency_keys"];
const FUNCTIONS = ["facility_insert_default", "facility_column_guard", "facility_accepts_inserts", "facility_move_admits"];

interface FakeOptions {
  tables?: string[];
  columns?: string[];
  constraints?: string[];
  functions?: string[];
  roleExists?: boolean;
  rowsIn?: Record<string, number>;
}

const fake = ({
  tables = [...PREREQUISITES, ...IPM_TABLES],
  columns = ["calibration_devices.client_facility_id"],
  constraints = [],
  functions = FUNCTIONS,
  roleExists = true,
  rowsIn = {},
}: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0, created: [] as string[] };
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
      if (sql.includes("FROM pg_proc")) {
        return Promise.resolve([functions.includes(String(r["name"])) ? [{ x: 1 }] : [], null]);
      }
      if (sql.includes("FROM pg_roles")) {
        return Promise.resolve([[{ exists: roleExists }], null]);
      }
      const counted = /^SELECT count\(\*\)::int AS n FROM (\w+)$/.exec(sql);
      if (counted) {
        return Promise.resolve([[{ n: rowsIn[counted[1] ?? ""] ?? 0 }], null]);
      }
      state.statements.push(sql);
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn(async (work: (t: unknown) => Promise<void>) => {
      state.transactions += 1;
      await work({ id: "tx" });
    }),
  };
  const createTable = jest.fn((table: string, attributes: Record<string, unknown>, options: { transaction?: unknown }) => {
    expect(options.transaction).toBeDefined();
    state.created.push(table);
    return Promise.resolve(attributes);
  });
  return { state, createTable, context: { sequelize, createTable } as unknown as QueryInterface };
};

interface AttributeLike {
  type: { key: string; options?: { length?: number }; values?: readonly string[] };
  allowNull?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  references?: { model: string; key: string };
  onDelete?: string;
  field?: string;
}

/**
 * A column default as the database sees it: DataTypes.NOW is `now()` (the model holds an instance,
 * the migration the class — both "now"); UUIDV4 is generated by Sequelize, never a column default.
 */
const defaultOf = (value: unknown): unknown => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const key = (value as { key?: string }).key;
  if (key === "UUIDV4") {
    return undefined;
  }
  return key === "NOW" ? "now" : value;
};

const shape = (a: AttributeLike) => ({
  type: a.type.key,
  length: a.type.options?.length,
  values: a.type.values ? [...a.type.values] : undefined,
  allowNull: a.primaryKey !== true && a.allowNull !== false,
  primaryKey: a.primaryKey === true,
  defaultValue: defaultOf(a.defaultValue),
  references: a.references ? `${a.references.model}.${a.references.key}` : undefined,
  onDelete: a.onDelete,
});

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const MODELS: Record<string, { getAttributes(): unknown }> = {
  inspection_sessions: defineInspectionSession(sequelize, DataTypes),
  inspection_results: defineInspectionResult(sequelize, DataTypes),
  inspection_session_signatures: defineInspectionSessionSignature(sequelize, DataTypes),
  idempotency_keys: defineIdempotencyKey(sequelize, DataTypes),
};

/** The model's columns by physical name, timestamps excluded (the migration's are NOT NULL dates). */
const modelColumns = (model: { getAttributes(): unknown }) =>
  Object.fromEntries(
    Object.entries(model.getAttributes() as Record<string, AttributeLike>)
      .map(([name, a]) => [a.field ?? name, shape(a)] as const)
      .filter(([column]) => !["created_at", "updated_at"].includes(column)),
  );
const createdColumns = (attributes: Record<string, AttributeLike>) =>
  Object.fromEntries(Object.entries(attributes).filter(([c]) => !["created_at", "updated_at"].includes(c)).map(([c, a]) => [c, shape(a)]));

describe("migration 0126 — the IPM tables (P20-04)", () => {
  it("creates exactly the models' four tables when absent — column for column, type, nullability, default, keys", async () => {
    const qi = fake({ tables: PREREQUISITES });
    await m0126.up({ context: qi.context });
    expect(qi.state.created).toEqual(IPM_TABLES);
    for (const [index, table] of IPM_TABLES.entries()) {
      const attributes = (qi.createTable.mock.calls[index]?.[1] ?? {}) as Record<string, AttributeLike>;
      expect(createdColumns(attributes)).toEqual(modelColumns(MODELS[table] as { getAttributes(): unknown }));
      expect(attributes["created_at"]).toMatchObject({ allowNull: false });
    }
    // The two append-only tables have no updated_at (updatedAt: false).
    expect(Object.keys(m0126.TABLE_COLUMNS["inspection_session_signatures"] ?? {})).not.toContain("updated_at");
    expect(Object.keys(m0126.TABLE_COLUMNS["idempotency_keys"] ?? {})).not.toContain("updated_at");
  });

  it("on a database sync() built: no createTable; NOT NULL, CHECKs, indexes, composite keys, functions, ENABLE ALWAYS triggers, grants — one transaction", async () => {
    const qi = fake();
    await m0126.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    expect(qi.state.created).toEqual([]);
    const s = qi.state.statements;
    expect(s[0]).toBe("SET LOCAL lock_timeout = '10s'");
    for (const table of ["inspection_sessions", "inspection_results", "inspection_session_signatures"]) {
      expect(s).toContain(`ALTER TABLE ${table} ALTER COLUMN client_facility_id SET NOT NULL`);
    }
    for (const [table, column] of m0126.DEFAULTS) {
      expect(s).toContain(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT now()`);
    }
    for (const name of Object.keys(m0126.CHECKS)) {
      expect(s.some((x) => x.includes(`ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    expect(s.filter((x) => x.includes("INDEX IF NOT EXISTS"))).toEqual([...m0126.INDEX_SQL]);
    // The composite-key target comes before the keys that need it.
    const target = s.findIndex((x) => x.includes("inspection_sessions_tenant_facility_id_unique"));
    const resultKey = s.findIndex((x) => x.includes("ADD CONSTRAINT inspection_results_session_facility_fkey"));
    expect(target).toBeGreaterThan(0);
    expect(resultKey).toBeGreaterThan(target);
    for (const [, statement] of Object.values(m0126.FKS)) {
      expect(s).toContain(statement);
      expect(statement).toMatch(/ON UPDATE CASCADE ON DELETE RESTRICT$/);
    }
    for (const [table, name] of m0126.TRIGGERS) {
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
    expect(s).toContain("GRANT SELECT, INSERT, UPDATE ON inspection_sessions TO callibrator_app");
    expect(s).toContain("REVOKE DELETE, TRUNCATE ON inspection_sessions FROM callibrator_app");
    expect(s).toContain("REVOKE TRUNCATE ON inspection_results FROM callibrator_app");
    expect(s).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON inspection_session_signatures FROM callibrator_app");
    expect(s).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO callibrator_app");
  });

  it("is idempotent: an existing CHECK or key is not added again", async () => {
    const qi = fake({ constraints: [...Object.keys(m0126.CHECKS), ...Object.keys(m0126.FKS)] });
    await m0126.up({ context: qi.context });
    expect(qi.state.statements.filter((x) => x.includes("ADD CONSTRAINT"))).toEqual([]);
  });

  it("every uniqueness is per tenant, session or creator — except the random verification token (ADR-126 Am. 2 § 3)", () => {
    const uniques = m0126.INDEX_SQL.filter((x) => x.startsWith("CREATE UNIQUE INDEX"));
    const global = uniques.filter((x) => !/\((tenant_id|session_id)[,)]/.test(x));
    expect(global).toEqual([
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_verification_token_unique ON inspection_sessions (verification_token) WHERE verification_token IS NOT NULL",
    ]);
    expect(new Set(m0126.INDEX_NAMES).size).toBe(m0126.INDEX_SQL.length);
  });

  it("the ad-hoc sections are the contract's (P19-01 § 5.1), not a copy", () => {
    expect([...m0126.AD_HOC_SECTIONS]).toEqual(["tools_used", "electrical_safety", "performance", "consumable"]);
    expect(m0126.AD_HOC_SECTIONS.every((section) => INSPECTION_SECTION_RULES[section as keyof typeof INSPECTION_SECTION_RULES].adHoc)).toBe(true);
  });

  it("replaces 0117's two functions with the result branch added and every other byte unchanged", () => {
    const [insertDefault, columnGuard] = m0126.FUNCTIONS;
    const original = (name: string): string => (m0117.FUNCTIONS.find(([n]) => n === name) ?? ["", "", ""])[2];
    expect(insertDefault?.[0]).toBe("facility_insert_default");
    expect(insertDefault?.[1].replace(m0126.INSERT_DEFAULT_RESULT_BRANCH, "")).toBe(original("facility_insert_default"));
    expect(insertDefault?.[1]).toContain("ELSIF TG_ARGV[0] = 'result' THEN");
    expect(insertDefault?.[1]).toContain("FROM inspection_sessions s WHERE s.id = NEW.session_id AND s.tenant_id = NEW.tenant_id");
    expect(columnGuard?.[0]).toBe("facility_column_guard");
    expect(columnGuard?.[1].replace(m0126.COLUMN_GUARD_RESULT_BRANCH, "")).toBe(original("facility_column_guard"));
    expect(columnGuard?.[1]).toContain("SELECT s.device_id INTO v_device FROM inspection_sessions s");
  });

  it.each([
    ["a referenced table", { tables: PREREQUISITES.filter((t) => t !== "inspection_template_items") }, /table inspection_template_items does not exist/],
    ["0117's functions", { functions: ["facility_insert_default"] }, /function facility_column_guard\(\) does not exist — migration 0117/],
    ["0118's device facility column", { columns: [] }, /migration 0118 must run first/],
    ["the application role", { roleExists: false }, /application role "callibrator_app" does not exist/],
  ] as const)("throws without %s — nothing is created", async (_what, options, message) => {
    const qi = fake(options as FakeOptions);
    await expect(m0126.up({ context: qi.context })).rejects.toThrow(message);
    expect(qi.state.created).toEqual([]);
    expect(qi.state.statements.filter((x) => !x.startsWith("SET LOCAL"))).toEqual([]);
  });

  it("down REFUSES while a session, result, signature or key exists — nothing is dropped", async () => {
    const qi = fake({ rowsIn: { inspection_sessions: 2, idempotency_keys: 1 } });
    await expect(m0126.down({ context: qi.context })).rejects.toThrow(
      /2 row\(s\) in inspection_sessions, 1 row\(s\) in idempotency_keys.*restore the pre-upgrade backup/,
    );
    expect(qi.state.statements.filter((x) => x.startsWith("DROP"))).toEqual([]);
  });

  it("down on an empty aggregate: the tables in reverse, the ENUM types, then 0117's functions exactly", async () => {
    const qi = fake();
    await m0126.down({ context: qi.context });
    const s = qi.state.statements;
    expect(s.filter((x) => x.startsWith("DROP TABLE"))).toEqual([...IPM_TABLES].reverse().map((t) => `DROP TABLE IF EXISTS ${t}`));
    expect(s.filter((x) => x.startsWith("DROP TYPE"))).toHaveLength(m0126.ENUM_TYPES.length);
    const restored = m0117.FUNCTIONS.filter(([n]) => n === "facility_insert_default" || n === "facility_column_guard").map(([, , sql]) => sql);
    expect(s.slice(-2).sort()).toEqual(restored.sort());
  });

  it("down skips a table that is not there", async () => {
    const qi = fake({ tables: PREREQUISITES });
    await m0126.down({ context: qi.context });
    expect(qi.state.statements.filter((x) => x.startsWith("DROP TABLE"))).toHaveLength(4);
  });
});

describe("migration 0127 — the IPM immutability triggers (P20-05)", () => {
  it("up: the four functions, then seven ENABLE ALWAYS triggers — one transaction", async () => {
    const qi = fake();
    await m0127.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    const s = qi.state.statements;
    for (const [name] of m0127.FUNCTIONS) {
      expect(s.some((x) => x.includes(`CREATE OR REPLACE FUNCTION ${name}()`))).toBe(true);
    }
    expect(m0127.TRIGGERS.map(([, name]) => name)).toEqual([
      "inspection_sessions_append_only",
      "inspection_sessions_no_truncate",
      "inspection_sessions_correction_same_device",
      "inspection_results_draft_only",
      "inspection_results_no_truncate",
      "inspection_session_signatures_append_only",
      "inspection_session_signatures_no_truncate",
    ]);
    for (const [table, name] of m0127.TRIGGERS) {
      expect(s).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
  });

  it("every trigger function admits the device move, and only through facility_move_admits", () => {
    for (const [name, sql] of m0127.FUNCTIONS) {
      if (name === "inspection_sessions_correction_same_device") {
        continue;
      }
      expect(sql).toContain("facility_move_admits(NEW.tenant_id,");
    }
  });

  it("the lifecycle and identity lists are spec § 5.1's, and disjoint", () => {
    expect([...m0127.LIFECYCLE_COLUMNS]).toEqual([
      "superseded_by_id", "superseded_at", "status", "void_reason", "voided_by", "voided_at", "updated_at", "updated_by",
    ]);
    expect([...m0127.IDENTITY_COLUMNS]).toEqual([
      "id", "tenant_id", "device_id", "created_by", "supersedes_id", "client_ref", "legacy_key", "received_at", "created_at",
    ]);
    expect(m0127.LIFECYCLE_COLUMNS.filter((c) => m0127.IDENTITY_COLUMNS.includes(c))).toEqual([]);
    // P19-06 § 4.1: the report fields are NOT lifecycle columns, so a submitted session freezes them.
    for (const column of ["report_number", "verification_token", "report_content_hash", "report_hash_scheme", "issuer_snapshot"]) {
      expect(m0127.LIFECYCLE_COLUMNS).not.toContain(column);
    }
  });

  it("throws without 0126's tables or 0117's move check — nothing is created", async () => {
    const noTables = fake({ tables: PREREQUISITES });
    await expect(m0127.up({ context: noTables.context })).rejects.toThrow(/table inspection_sessions does not exist/);
    const noMove = fake({ functions: ["facility_insert_default"] });
    await expect(m0127.up({ context: noMove.context })).rejects.toThrow(/facility_move_admits\(\) does not exist — migration 0117/);
    expect([...noTables.state.statements, ...noMove.state.statements].filter((x) => !x.startsWith("SET LOCAL"))).toEqual([]);
  });

  it("down drops the triggers of the tables still there, then the functions", async () => {
    const qi = fake({ tables: [...PREREQUISITES, "inspection_sessions"] });
    await m0127.down({ context: qi.context });
    const s = qi.state.statements;
    expect(s.filter((x) => x.startsWith("DROP TRIGGER"))).toEqual([
      "DROP TRIGGER IF EXISTS inspection_sessions_append_only ON inspection_sessions",
      "DROP TRIGGER IF EXISTS inspection_sessions_no_truncate ON inspection_sessions",
      "DROP TRIGGER IF EXISTS inspection_sessions_correction_same_device ON inspection_sessions",
    ]);
    expect(s.filter((x) => x.startsWith("DROP FUNCTION"))).toEqual(m0127.FUNCTIONS.map(([n]) => `DROP FUNCTION IF EXISTS ${n}()`));
  });
});

describe("migrations 0126 and 0127 — registered and shaped", () => {
  it("are registered right after 0125, in order, and have no try/catch", () => {
    const manifest = read("../../config/migrator.ts");
    const at = (name: string): number => manifest.indexOf(`"${name}.js"`);
    expect(at("0126-ipm-sessions")).toBeGreaterThan(at("0125-catalogue-rebase-drafts"));
    expect(at("0127-ipm-immutability")).toBeGreaterThan(at("0126-ipm-sessions"));
    for (const file of ["0126-ipm-sessions", "0127-ipm-immutability"]) {
      expect(read(`../../migrations/${file}.ts`)).not.toMatch(/\btry\s*\{/);
    }
  });
});
