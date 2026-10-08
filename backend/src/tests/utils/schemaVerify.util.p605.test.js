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

  it("checks the append-only trigger, the void CHECK, the serial index (per facility since 0118), the retired-device trigger (ADR-084), the stock reason CHECK and the case-insensitive identity indexes, and the audit_logs append-only triggers (Q-34, ADR-095), and the exactly-one-actor CHECKs (Q-51, migration 0105), and the inspection catalogue's triggers, unique indexes and CHECKs (P20-01/03, migrations 0111/0112), and the client-facility controls (P20-07, migrations 0117 – 0123), and the IPM aggregate's (P20-04/05, migrations 0126/0127), and the device extensions' and photo purposes' (P20-02/08, migrations 0128/0129)", () => {
    expect(EXPECTED_OBJECTS.map((o) => `${o.kind}:${o.name}`)).toEqual([
      "trigger:calibration_records_append_only",
      "trigger:calibration_records_no_truncate",
      "constraint:calibration_records_void_reason_check",
      "index:calibration_devices_tenant_facility_serial_unique", // UD-9 (P20-07, 0118) replaced 0026's per-tenant index
      "trigger:calibration_devices_retired_terminal",
      "constraint:stock_adjustments_reason_not_blank",
      "constraint:calibration_records_actor_exactly_one",
      "constraint:stock_adjustments_actor_exactly_one",
      "constraint:stock_transfers_requester_exactly_one",
      "index:users_email_lower_unique",
      "index:users_username_lower_unique",
      "trigger:audit_logs_append_only",
      "trigger:audit_logs_no_truncate",
      // P20-01 / P20-03 (migrations 0111, 0112): the inspection catalogue's controls.
      "trigger:device_types_no_delete",
      "trigger:device_types_no_truncate",
      "trigger:inspection_item_definitions_no_delete",
      "trigger:inspection_item_definitions_no_truncate",
      "trigger:inspection_templates_no_delete",
      "trigger:inspection_templates_no_truncate",
      "trigger:inspection_template_proposals_no_delete",
      "trigger:inspection_template_proposals_no_truncate",
      "trigger:inspection_template_versions_immutable",
      "trigger:inspection_template_versions_no_truncate",
      "trigger:inspection_template_items_draft_only",
      "trigger:inspection_template_items_no_truncate",
      "index:device_types_name_unique",
      "index:inspection_templates_one_base",
      "index:inspection_template_versions_one_published",
      "index:inspection_template_versions_one_draft",
      "constraint:inspection_template_versions_published_complete",
      "constraint:inspection_template_versions_publisher_exactly_one",
      // P20-07 (migrations 0117 – 0123): the client-facility dimension, written out by hand.
      "index:client_facilities_one_self",
      "index:client_facilities_tenant_id_id_unique",
      "constraint:client_facilities_self_active",
      "trigger:client_facilities_identity_immutable",
      "trigger:client_facility_moves_append_only",
      "trigger:client_facility_moves_no_truncate",
      "trigger:client_facility_moves_complete_at_commit",
      "trigger:calibration_devices_facility_default",
      "trigger:calibration_devices_facility_open",
      "trigger:calibration_devices_facility_guard",
      "constraint:calibration_devices_client_facility_fkey",
      "trigger:calibration_records_facility_default",
      "trigger:calibration_records_facility_open",
      "trigger:calibration_records_facility_guard",
      "constraint:calibration_records_device_facility_fkey",
      "trigger:certificates_facility_default",
      "trigger:certificates_facility_open",
      "trigger:certificates_facility_guard",
      "constraint:certificates_device_facility_fkey",
      "trigger:maintenance_work_orders_facility_default",
      "trigger:maintenance_work_orders_facility_open",
      "trigger:maintenance_work_orders_facility_guard",
      "constraint:maintenance_work_orders_device_facility_fkey",
      "trigger:iot_readings_facility_default",
      "trigger:iot_readings_facility_guard",
      "constraint:iot_readings_device_facility_fkey",
      "constraint:certificates_record_facility_fkey",
      "trigger:attachments_facility_default",
      "trigger:attachments_facility_open",
      "trigger:attachments_facility_guard",
      "trigger:attachments_facility_matches_resource",
      "constraint:attachments_facility_kind",
      "trigger:calibration_devices_attachments_follow_facility",
      "trigger:calibration_records_attachments_follow_facility",
      "trigger:certificates_attachments_follow_facility",
      "trigger:maintenance_work_orders_attachments_follow_facility",
      "trigger:non_conformances_facility_default",
      "trigger:non_conformances_facility_open",
      "trigger:non_conformances_facility_guard",
      "constraint:non_conformances_facility_follows_device",
      "constraint:non_conformances_device_facility_fkey",
      "constraint:warehouses_client_facility_fkey",
      "constraint:users_client_facility_fkey",
      "trigger:users_facility_binding_guard",
      "trigger:users_facility_bound_role",
      // P20-04 / P20-05 (migrations 0126, 0127): the IPM aggregate's controls.
      "trigger:inspection_sessions_facility_default",
      "trigger:inspection_sessions_facility_open",
      "trigger:inspection_sessions_facility_guard",
      "trigger:inspection_results_facility_default",
      "trigger:inspection_results_facility_open",
      "trigger:inspection_results_facility_guard",
      "trigger:inspection_session_signatures_facility_default",
      "trigger:inspection_session_signatures_facility_open",
      "trigger:inspection_session_signatures_facility_guard",
      "constraint:inspection_sessions_device_facility_fkey",
      "constraint:inspection_results_session_facility_fkey",
      "constraint:inspection_session_signatures_session_facility_fkey",
      "index:inspection_sessions_tenant_facility_id_unique",
      "index:inspection_sessions_visit_unique",
      "index:inspection_sessions_linear_chain",
      "index:inspection_sessions_one_root_draft",
      "index:inspection_sessions_client_ref_unique",
      "index:inspection_sessions_report_number_unique",
      "index:inspection_results_one_per_item",
      "index:inspection_session_signatures_session_kind_unique",
      "index:idempotency_keys_user_key_unique",
      "constraint:inspection_sessions_issued_fields",
      "constraint:idempotency_keys_one_principal",
      "trigger:inspection_sessions_append_only",
      "trigger:inspection_sessions_no_truncate",
      "trigger:inspection_sessions_correction_same_device",
      "trigger:inspection_results_draft_only",
      "trigger:inspection_results_no_truncate",
      "trigger:inspection_session_signatures_append_only",
      "trigger:inspection_session_signatures_no_truncate",
      // P20-02 / P20-08 (migrations 0128, 0129): the device extensions and the photo purposes.
      "index:calibration_devices_tenant_qr_code_unique",
      "index:calibration_devices_client_ref_unique",
      "constraint:calibration_devices_qr_code_shape",
      "constraint:calibration_devices_next_date_has_source",
      "constraint:calibration_devices_calibration_request",
      "constraint:calibration_devices_calibration_requested_by_session_id_fkey",
      "trigger:calibration_devices_location_facility",
      "trigger:calibration_devices_request_same_device",
      "trigger:calibration_devices_next_date_source",
      "constraint:warehouses_room_has_facility",
      "index:warehouses_room_name_unique",
      "trigger:warehouses_room_devices_facility",
      "constraint:calibration_records_external_has_lab",
      "constraint:calibration_records_external_no_results",
      "constraint:attachments_purpose_values",
      "constraint:attachments_purpose_resource",
      "index:attachments_one_live_device_photo",
      "trigger:inspection_sessions_attachments_follow_facility",
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
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/^\[schema-verify\] OK: 1 tables, 3 columns and 124 control objects/));
    expect(log.error).not.toHaveBeenCalled();
  });

  it("THROWS on a mismatch, naming each one — it is not swallowed (the P6-05 abuse case)", async () => {
    const log = logger();
    const sequelize = fakeSequelize([devices], [], {});
    await expect(assertSchemaMatchesModels({ sequelize, logger: log, mode: undefined })).rejects.toThrow(
      /FAILED: 125 mismatch\(es\)[\s\S]*table devices \(model Device\) does not exist/,
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
