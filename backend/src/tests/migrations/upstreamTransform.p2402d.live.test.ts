/**
 * P24-02d (ADR-129 Am. 6) — the transform's templates step on a REAL PostgreSQL 18, on the
 * transform role's own connection:
 *
 *  - migration 0138: down / up / up rebuilds the same grants and reasons; the transform role may
 *    read, insert and update the three template tables, never delete;
 *  - one published version per device type: the type's items in upstream order per section, the
 *    seeded base materialised, `content_hash` equal to the contracts' canonical hash recomputed from
 *    the stored rows, a duplicate pair collapsed, an unresolved row and an operator-managed type
 *    quarantined; CREATE / APPROVE audit rows under the PLATFORM tenant, none per item;
 *  - a re-run of the same values writes nothing; a relabelled item publishes version 2 and retires 1.
 *
 * Synthetic values only; nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:56240:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56240 DB_USER=postgres DB_PASS=p2402pass npm run test:live -- --only=p2402d
 *   docker rm -f p2402-pg18
 */
import { createHash } from "crypto";
import type { Transaction } from "sequelize";
import { canonicalTemplateVersion, type CanonicalTemplateItemInput } from "@callibrator/contracts/inspectionValues";
import { env } from "../../config/env";
import type { TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a4";
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const OPERATOR_TYPE = "a2402000-0000-4000-8000-0000000000b4";
const OPERATOR_TEMPLATE = "a2402000-0000-4000-8000-0000000000b5";
const OPERATOR_VERSION = "a2402000-0000-4000-8000-0000000000b6";
const RUN_1 = "a2402000-0000-4000-8000-0000000000e4";
const RUN_2 = "a2402000-0000-4000-8000-0000000000e5";
const RUN_3 = "a2402000-0000-4000-8000-0000000000e6";
const TEMPLATE_TYPES = "('InspectionTemplate', 'InspectionTemplateVersion', 'InspectionTemplateItem')";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<Transaction>;
  transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  steps: require("../../services/upstreamImport/transform/steps") as typeof StepsModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0138: require("../../migrations/0138-upstream-transform-templates") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P24-02d — the templates step on live PostgreSQL 18, as the transform role", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await g.db.transaction();
    try {
      await g.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await g.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const lit = (value: string | number | null): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly (string | number | null)[])[]): string =>
    list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  /** Stage the synthetic types, two checklists and their mappings for `run`; `relabel` renames function item 2. */
  const stage = (run: string, relabel: string | null = null): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_alat (import_run_id, source_row_number, id, nama_alat) VALUES
         ${values(run, [[1, "Pompa Sintetis"], [2, "Monitor Sintetis"], [3, "Buatan Operator"]])}`,
      `INSERT INTO upstream_import.stg_mst_pemeriksaan_fungsi_alat (import_run_id, source_row_number, id, description, status) VALUES
         ${values(run, [[1, "Alarm sintetis", "0,1,-1"], [2, relabel ?? "Tombol sintetis", "0,1,-1"]])}`,
      `INSERT INTO upstream_import.stg_mst_kelengkapan_alat (import_run_id, source_row_number, id, description, status) VALUES
         ${values(run, [[1, "Kabel daya sintetis", "0,1,-1"]])}`,
      // 11 duplicates 10; 14 names a type that does not exist; 15 is the operator's type.
      `INSERT INTO upstream_import.stg_mapping_fugsi_alat (import_run_id, source_row_number, id, id_alat, id_pemeriksaan_fungsi_alat) VALUES
         ${values(run, [[12, 1, 2], [10, 1, 1], [11, 1, 1], [13, 2, 1], [14, 99, 1], [15, 3, 1]])}`,
      `INSERT INTO upstream_import.stg_mapping_kelengkapan_alat (import_run_id, source_row_number, id, id_alat, id_kelengkapan_alat) VALUES
         ${values(run, [[10, 1, 1]])}`,
    );

  const steps = (): TransformStep[] =>
    ["device_types", "inspection_item_definitions", "inspection_templates", "audit_logs"].map((id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep);

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: "UTC", steps: steps() });

  const templateAudits = async (): Promise<Row[]> =>
    rows(
      `SELECT resource_type, action::text AS action, count(*)::int AS n, bool_and(tenant_id = '${PLATFORM}') AS platform, bool_and(client_facility_id IS NULL) AS no_facility
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' AND resource_type IN ${TEMPLATE_TYPES} GROUP BY 1, 2 ORDER BY 1, 2`,
    );

  /** The type's versions: number, status, publisher. */
  const versionsOf = async (typeName: string): Promise<Row[]> =>
    rows(
      `SELECT v.version_number AS n, v.status::text AS status, v.published_by_system AS by
         FROM inspection_template_versions v JOIN inspection_templates t ON t.id = v.template_id JOIN device_types d ON d.id = t.device_type_id
        WHERE d.name = '${typeName}' ORDER BY v.version_number`,
    );

  /** The stored content hash of `typeName`'s published version, and the canonical hash recomputed from its stored rows. */
  const hashes = async (typeName: string): Promise<{ stored: string; recomputed: string }> => {
    const [version] = await rows(
      `SELECT v.id, v.template_id, t.device_type_id, v.version_number, v.base_version_id, v.content_hash
         FROM inspection_template_versions v JOIN inspection_templates t ON t.id = v.template_id JOIN device_types d ON d.id = t.device_type_id
        WHERE d.name = '${typeName}' AND v.status = 'published'`,
    );
    const items = (await rows(
      `SELECT id, item_definition_id AS "itemDefinitionId", origin::text AS origin, section::text AS section, label, input_kind::text AS "inputKind",
              unit, symbol, setting_text AS "settingText", setting_value::text AS "settingValue", limit_op::text AS "limitOp",
              limit_value::text AS "limitValue", limit_low::text AS "limitLow", limit_high::text AS "limitHigh", limit_nominal::text AS "limitNominal",
              limit_tolerance::text AS "limitTolerance", limit_text AS "limitText", valid_min::text AS "validMin", valid_max::text AS "validMax",
              warn_min::text AS "warnMin", warn_max::text AS "warnMax", allowed_outcomes::text[] AS "allowedOutcomes", required, sort_order AS "sortOrder"
         FROM inspection_template_items WHERE version_id = '${String(version?.["id"])}'`,
    )) as unknown as CanonicalTemplateItemInput[];
    const canonical = canonicalTemplateVersion({
      templateId: String(version?.["template_id"]),
      deviceTypeId: String(version?.["device_type_id"]),
      versionNumber: Number(version?.["version_number"]),
      baseVersionId: String(version?.["base_version_id"]),
      items,
    });
    return { stored: String(version?.["content_hash"]), recomputed: createHash("sha256").update(canonical, "utf8").digest("hex") };
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis', 'p2402d', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES (gen_random_uuid(), '${PROVIDER}', 'Penyedia Sintetis', 'SELF', true, now(), now())`);
    // The operator's own type and checklist, published by someone other than the transform.
    await g.db.query(`INSERT INTO device_types (id, name, status, created_at, updated_at) VALUES ('${OPERATOR_TYPE}', 'Buatan Operator', 'active', now(), now())`);
    await g.db.query(`INSERT INTO inspection_templates (id, device_type_id, status, created_at, updated_at) VALUES ('${OPERATOR_TEMPLATE}', '${OPERATOR_TYPE}', 'active', now(), now())`);
    await g.db.query(`INSERT INTO inspection_template_versions (id, template_id, status, revision, created_at, updated_at) VALUES ('${OPERATOR_VERSION}', '${OPERATOR_TEMPLATE}', 'draft', 0, now(), now())`);
    await g.db.query(
      `UPDATE inspection_template_versions SET status = 'published', version_number = 1, content_hash = '${"0".repeat(64)}', change_note = 'Operator checklist',
              published_at = now(), published_by_system = 'system:catalogue-seed', updated_at = now() WHERE id = '${OPERATOR_VERSION}'`,
    );
    const common = "import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, id integer";
    const pk = "PRIMARY KEY (import_run_id, source_row_number)";
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_alat (${common}, nama_alat varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_pemeriksaan_fungsi_alat (${common}, description varchar(255), status varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_kelengkapan_alat (${common}, description varchar(255), status varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mapping_fugsi_alat (${common}, id_alat integer, id_pemeriksaan_fungsi_alat integer, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mapping_kelengkapan_alat (${common}, id_alat integer, id_kelengkapan_alat integer, ${pk})`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0138: down / up / up rebuilds the same grants and reasons; no DELETE on the three tables", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || ':' || privilege_type AS o FROM information_schema.role_table_grants
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name LIKE 'inspection_template%' AND table_name <> 'inspection_template_proposals'
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    expect(before.map((r) => String(r["o"])).filter((o) => !o.startsWith("c:"))).toEqual([
      "inspection_template_items:INSERT",
      "inspection_template_items:SELECT",
      "inspection_template_items:UPDATE",
      "inspection_template_versions:INSERT",
      "inspection_template_versions:SELECT",
      "inspection_template_versions:UPDATE",
      "inspection_templates:INSERT",
      "inspection_templates:SELECT",
      "inspection_templates:UPDATE",
    ]);
    const check = String(before.find((r) => String(r["o"]).startsWith("c:"))?.["o"]);
    expect(check).toContain("'reference_unresolved'");
    expect(check).toContain("'template_operator_managed'");
    await g.m0138.down({ context: g.db.getQueryInterface() });
    await g.m0138.up({ context: g.db.getQueryInterface() });
    await g.m0138.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
    for (const table of ["inspection_templates", "inspection_template_versions", "inspection_template_items"]) {
      expect(await errorAs(TRANSFORM_ROLE, `DELETE FROM ${table} WHERE false`)).toMatch(/^42501/);
    }
  });

  it("the first transform: version 1 per type with the base materialised and a verifiable hash; duplicates collapsed; the rest quarantined", async () => {
    await stage(RUN_1);
    const summary = await transform(RUN_1);
    expect(summary.steps.find((s) => s.step === "inspection_templates")?.sources.filter((s) => s.staged > 0)).toEqual([
      { table: "mapping_fugsi_alat", staged: 6, mapped: 4, unchanged: 0, quarantined: { reference_unresolved: 1, template_operator_managed: 1 } },
      { table: "mapping_kelengkapan_alat", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
    ]);
    expect(await versionsOf("Pompa Sintetis")).toEqual([{ n: 1, status: "published", by: "system:upstream-transform" }]);
    expect(await versionsOf("Monitor Sintetis")).toEqual([{ n: 1, status: "published", by: "system:upstream-transform" }]);
    expect(await versionsOf("Buatan Operator")).toEqual([{ n: 1, status: "published", by: "system:catalogue-seed" }]);
    const items = await rows(
      `SELECT i.origin::text AS origin, i.section::text AS section, i.label, i.sort_order AS position
         FROM inspection_template_items i JOIN inspection_template_versions v ON v.id = i.version_id AND v.status = 'published'
         JOIN inspection_templates t ON t.id = v.template_id JOIN device_types d ON d.id = t.device_type_id
        WHERE d.name = 'Pompa Sintetis' AND i.origin = 'type' ORDER BY 2, 4`,
    );
    expect(items).toEqual([
      { origin: "type", section: "completeness", label: "Kabel daya sintetis", position: 0 },
      { origin: "type", section: "function", label: "Alarm sintetis", position: 0 },
      { origin: "type", section: "function", label: "Tombol sintetis", position: 1 },
    ]);
    const [base] = await rows(
      `SELECT (SELECT count(*)::int FROM inspection_template_items WHERE version_id = b.id) AS seeded,
              (SELECT count(*)::int FROM inspection_template_items i JOIN inspection_template_versions v ON v.id = i.version_id AND v.status = 'published'
                 JOIN inspection_templates t ON t.id = v.template_id JOIN device_types d ON d.id = t.device_type_id
                WHERE d.name = 'Pompa Sintetis' AND i.origin = 'base' AND v.base_version_id = b.id) AS copied
         FROM inspection_template_versions b JOIN inspection_templates bt ON bt.id = b.template_id AND bt.device_type_id IS NULL WHERE b.status = 'published'`,
    );
    expect(Number(base?.["seeded"])).toBeGreaterThan(0);
    expect(base?.["copied"]).toBe(base?.["seeded"]);
    const pompa = await hashes("Pompa Sintetis");
    expect(pompa.stored).toMatch(/^[0-9a-f]{64}$/);
    expect(pompa.recomputed).toBe(pompa.stored);
    const merged = await rows(
      `SELECT legacy_id, target_id::text AS target, source_values FROM upstream_import.id_map
        WHERE source_table = 'mapping_fugsi_alat' AND legacy_id IN ('10', '11') ORDER BY 1`,
    );
    expect(merged[0]?.["target"]).toBe(merged[1]?.["target"]);
    expect(merged[1]?.["source_values"]).toEqual({ mergedIntoLegacyId: "10" });
    expect(await templateAudits()).toEqual([
      { resource_type: "InspectionTemplate", action: "CREATE", n: 2, platform: true, no_facility: true },
      { resource_type: "InspectionTemplateVersion", action: "APPROVE", n: 2, platform: true, no_facility: true },
    ]);
  });

  it("the same values again write nothing; a relabelled item publishes version 2 and retires version 1", async () => {
    const before = await templateAudits();
    await stage(RUN_2);
    const again = await transform(RUN_2);
    expect(again.steps.find((s) => s.step === "inspection_templates")?.sources.find((s) => s.table === "mapping_fugsi_alat")).toMatchObject({ mapped: 0, unchanged: 4 });
    expect(await templateAudits()).toEqual(before);
    expect(await versionsOf("Pompa Sintetis")).toHaveLength(1);

    await stage(RUN_3, "Tombol sintetis baru");
    await transform(RUN_3);
    expect(await versionsOf("Pompa Sintetis")).toEqual([
      { n: 1, status: "retired", by: "system:upstream-transform" },
      { n: 2, status: "published", by: "system:upstream-transform" },
    ]);
    expect(await versionsOf("Monitor Sintetis")).toHaveLength(1);
    const pompa = await hashes("Pompa Sintetis");
    expect(pompa.recomputed).toBe(pompa.stored);
    const [target] = await rows(
      `SELECT v.status::text AS status FROM upstream_import.id_map m JOIN inspection_template_items i ON i.id = m.target_id
         JOIN inspection_template_versions v ON v.id = i.version_id WHERE m.source_table = 'mapping_fugsi_alat' AND m.legacy_id = '10'`,
    );
    expect(target).toEqual({ status: "published" });
    expect(await templateAudits()).toEqual([
      { resource_type: "InspectionTemplate", action: "CREATE", n: 2, platform: true, no_facility: true },
      { resource_type: "InspectionTemplateVersion", action: "APPROVE", n: 3, platform: true, no_facility: true },
    ]);
  });
});
