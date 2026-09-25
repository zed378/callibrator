/**
 * P6-05 — utils/schemaVerify.util.js compares the models with the database.
 *
 * The doubles here stand for information_schema / pg_trigger / pg_indexes.
 * The same checks against a real, synced and migrated PostgreSQL — including
 * a dropped column and a dropped trigger being caught — are in
 * services/dataIntegrity.p6.live.test.js ("P6-05 — verifySchema against
 * information_schema").
 */
const { verifySchema, assertSchemaMatchesModels, EXPECTED_OBJECTS, TAG } = require("../../utils/schemaVerify.util");

const model = (name, tableName, attributes) => ({
  name,
  getTableName: () => tableName,
  rawAttributes: attributes,
});

const col = (table_name, column_name, extra = {}) => ({
  table_name,
  column_name,
  is_nullable: "YES",
  column_default: null,
  is_identity: "NO",
  is_generated: "NEVER",
  ...extra,
});

const rowsOf = (kind) =>
  EXPECTED_OBJECTS.filter((o) => o.kind === kind).map((o) => ({ table_name: o.table, name: o.name }));
const ALL_OBJECTS = { triggers: rowsOf("trigger"), indexes: rowsOf("index"), constraints: rowsOf("constraint") };

/**
 * @param {object[]} models - fake models
 * @param {object[]} columns - information_schema.columns rows
 * @param {{triggers?: object[], indexes?: object[]}} [objects]
 */
const fakeSequelize = (models, columns, objects = ALL_OBJECTS) => ({
  models: Object.fromEntries(models.map((m) => [m.name, m])),
  query: jest.fn(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return columns;
    }
    if (sql.includes("pg_trigger")) {
      return objects.triggers || [];
    }
    if (sql.includes("pg_constraint")) {
      return objects.constraints || [];
    }
    if (sql.includes("relrowsecurity")) {
      return objects.rls || [];
    }
    return objects.indexes || [];
  }),
});

const devices = model("Device", "devices", {
  id: { field: "id", type: { key: "UUID" } },
  serialNumber: { field: "serial_number", type: { key: "STRING" } },
  label: { type: { key: "VIRTUAL" } }, // no column
  plain: { type: { key: "STRING" } }, // no `field`: the attribute name is the column
});
// A schema-qualified table name comes back as an object.
const stocks = model("Stock", { tableName: "stocks", schema: "public" }, {
  id: { field: "id", type: { key: "UUID" } },
});

const HEALTHY = [
  col("devices", "id", { is_nullable: "NO" }),
  col("devices", "serial_number"),
  col("devices", "plain"),
  col("stocks", "id", { is_nullable: "NO" }),
];

describe("verifySchema", () => {
  it("a database that matches the models reports no problem", async () => {
    const result = await verifySchema(fakeSequelize([devices, stocks], HEALTHY));
    expect(result).toEqual({ problems: [], notes: [], tables: 2, columns: 4, objects: EXPECTED_OBJECTS.length });
  });

  it("names a missing table", async () => {
    const result = await verifySchema(fakeSequelize([devices, stocks], HEALTHY.filter((c) => c.table_name !== "stocks")));
    expect(result.problems).toEqual(["table stocks (model Stock) does not exist"]);
  });

  it("names a missing column — the silent-no-op migration (PR-5)", async () => {
    const result = await verifySchema(
      fakeSequelize([devices], HEALTHY.filter((c) => c.column_name !== "serial_number")),
    );
    expect(result.problems).toEqual([
      expect.stringMatching(/^column devices\.serial_number \(model Device\.serialNumber\) does not exist/),
    ]);
  });

  it("an undeclared NOT NULL column with no default is a problem: every insert would fail", async () => {
    const result = await verifySchema(
      fakeSequelize([devices], [...HEALTHY, col("devices", "legacy_code", { is_nullable: "NO" })]),
    );
    expect(result.problems).toEqual([
      expect.stringMatching(/^column devices\.legacy_code is NOT NULL with no default/),
    ]);
  });

  it.each([
    ["nullable", { is_nullable: "YES" }],
    ["defaulted", { is_nullable: "NO", column_default: "'x'::text" }],
    ["identity", { is_nullable: "NO", is_identity: "YES" }],
    ["generated", { is_nullable: "NO", is_generated: "ALWAYS" }],
  ])("an undeclared %s column is only a note", async (_label, extra) => {
    const result = await verifySchema(fakeSequelize([devices], [...HEALTHY, col("devices", "legacy", extra)]));
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual(["column devices.legacy is not declared by model Device"]);
  });

  it("names every control object that is missing — a dropped trigger is a dropped control", async () => {
    const result = await verifySchema(fakeSequelize([devices], HEALTHY, {}));
    expect(result.problems).toEqual(
      EXPECTED_OBJECTS.map((o) => `${o.kind} ${o.name} on ${o.table} does not exist — ${o.why}`),
    );
  });

  it("A-242: a table with row level security enabled is a problem (ADR-029 removed RLS)", async () => {
    const result = await verifySchema(
      fakeSequelize([devices], HEALTHY, { ...ALL_OBJECTS, rls: [{ table_name: "workflow_steps" }] }),
    );
    expect(result.problems).toEqual([
      expect.stringMatching(/^row level security is enabled on workflow_steps — ADR-029 removed RLS/),
    ]);
  });

  it("an object of the same name on ANOTHER table does not count", async () => {
    const triggers = ALL_OBJECTS.triggers.map((t) => ({ ...t, table_name: "elsewhere" }));
    const result = await verifySchema(fakeSequelize([devices], HEALTHY, { ...ALL_OBJECTS, triggers }));
    expect(result.problems).toHaveLength(triggers.length);
  });

  it("checks the append-only trigger, the void CHECK, the per-tenant serial index, the stock reason CHECK and the case-insensitive identity indexes", () => {
    expect(EXPECTED_OBJECTS.map((o) => `${o.kind}:${o.name}`)).toEqual([
      "trigger:calibration_records_append_only",
      "trigger:calibration_records_no_truncate",
      "constraint:calibration_records_void_reason_check",
      "index:calibration_devices_tenant_id_serial_number_unique",
      "constraint:stock_adjustments_reason_not_blank",
      "index:users_email_lower_unique",
      "index:users_username_lower_unique",
    ]);
  });
});

describe("assertSchemaMatchesModels", () => {
  const logger = () => ({ info: jest.fn(), error: jest.fn() });

  it("logs OK with the counts, and notes at info", async () => {
    const log = logger();
    const sequelize = fakeSequelize([devices], [...HEALTHY, col("devices", "legacy")]);
    const result = await assertSchemaMatchesModels({ sequelize, logger: log, mode: undefined });
    expect(result.problems).toEqual([]);
    expect(log.info).toHaveBeenCalledWith(`${TAG} note: column devices.legacy is not declared by model Device`);
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/^\[schema-verify\] OK: 1 tables, 3 columns and 7 control objects/));
    expect(log.error).not.toHaveBeenCalled();
  });

  it("THROWS on a mismatch, naming each one — it is not swallowed (the P6-05 abuse case)", async () => {
    const log = logger();
    const sequelize = fakeSequelize([devices], [], {});
    await expect(assertSchemaMatchesModels({ sequelize, logger: log, mode: undefined })).rejects.toThrow(
      /FAILED: 8 mismatch\(es\)[\s\S]*table devices \(model Device\) does not exist/,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^\[schema-verify\] MISMATCH: table devices/));
  });

  it("SCHEMA_VERIFY=warn logs every problem at error level and continues", async () => {
    const log = logger();
    const sequelize = fakeSequelize([devices], []);
    const result = await assertSchemaMatchesModels({ sequelize, logger: log, mode: "warn" });
    expect(result.problems).toHaveLength(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/Continuing ONLY because SCHEMA_VERIFY=warn/));
  });

  it("reads SCHEMA_VERIFY from the environment by default", async () => {
    const saved = process.env.SCHEMA_VERIFY;
    process.env.SCHEMA_VERIFY = "warn";
    try {
      const result = await assertSchemaMatchesModels({ sequelize: fakeSequelize([devices], []), logger: logger() });
      expect(result.problems).toHaveLength(1);
    } finally {
      if (saved === undefined) {
        delete process.env.SCHEMA_VERIFY;
      } else {
        process.env.SCHEMA_VERIFY = saved;
      }
    }
  });
});
