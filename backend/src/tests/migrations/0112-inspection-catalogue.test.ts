/**
 * Migration 0112 — the inspection catalogue (P20-03; ADR-125 and its
 * Amendments 1 and 2; spec P19-01 § 4.2 – 4.6, § 7.7, § 12).
 *
 * Proves the LOGIC against a fake QueryInterface and the REAL models: each of
 * the five tables it creates is its model's, column for column; the CHECKs,
 * indexes, triggers (ENABLE ALWAYS) and revokes it issues, in ONE transaction;
 * the base checklist it seeds — fixed ids, every item allowed by its section's
 * rule, the content hash pinned and equal to SHA-256 of the contract's
 * canonical text; the seed and its audit row written once; that it throws —
 * and so is not recorded as applied — on a missing table, role or PLATFORM
 * tenant; that nothing is swallowed; that `down` refuses while the catalogue
 * holds more than the seed. That the triggers FIRE and the grants hold as
 * `callibrator_app`, on a fresh and an upgraded PostgreSQL 18, is
 * inspectionCatalogue.p2003.live.test.ts.
 */
import { createHash } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import {
  INSPECTION_SECTION_RULES,
  canonicalTemplateVersion,
} from "@callibrator/contracts/inspectionValues";
import migration from "../../migrations/0112-inspection-catalogue";
import { PLATFORM_TENANT_ID } from "../../constants/platformTenant";
import { SYSTEM_ACTORS } from "../../constants/systemActors";
import defineDeviceType from "../../models/deviceType.model";
import defineDefinition from "../../models/inspectionItemDefinition.model";
import defineTemplate from "../../models/inspectionTemplate.model";
import defineVersion from "../../models/inspectionTemplateVersion.model";
import defineItem from "../../models/inspectionTemplateItem.model";
import defineProposal from "../../models/inspectionTemplateProposal.model";

const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");
const SOURCE = read("../../migrations/0112-inspection-catalogue.ts");
const MANIFEST = read("../../config/migrator.ts");

const ALL_TABLES = ["users", "tenants", "device_types", "audit_logs", ...migration.TABLES];

interface FakeOptions {
  tables?: string[];
  roleExists?: boolean;
  baseExists?: boolean;
  platformExists?: boolean;
  constraints?: string[];
  extraRows?: number;
  failOn?: RegExp | null;
}

interface Statement {
  sql: string;
  replacements: Record<string, unknown>;
}

interface AttributeLike {
  type: { key: string; options?: { length?: number }; values?: readonly string[]; type?: { key: string; values?: readonly string[] } };
  allowNull?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  references?: { model: string; key: string };
  onDelete?: string;
  onUpdate?: string;
  field?: string;
}

const fakeQueryInterface = ({
  tables = ALL_TABLES,
  roleExists = true,
  baseExists = false,
  platformExists = true,
  constraints = [],
  extraRows = 0,
  failOn = null,
}: FakeOptions = {}) => {
  const state = { statements: [] as Statement[], transactions: 0, created: [] as string[] };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      const replacements = options.replacements ?? {};
      if (sql.includes("to_regclass")) {
        return Promise.resolve([[{ present: tables.includes(String(replacements["table"])) }], null]);
      }
      if (sql.includes("FROM pg_constraint")) {
        return Promise.resolve([constraints.map((conname) => ({ conname })), null]);
      }
      if (sql.includes("FROM pg_roles")) {
        return Promise.resolve([[{ present: roleExists }], null]);
      }
      if (sql.includes("FROM tenants WHERE id")) {
        expect(replacements).toEqual({ id: PLATFORM_TENANT_ID });
        return Promise.resolve([[{ present: platformExists }], null]);
      }
      if (sql.includes("WHERE device_type_id IS NULL)")) {
        return Promise.resolve([[{ present: baseExists }], null]);
      }
      if (sql.includes("AS n")) {
        return Promise.resolve([[{ n: extraRows }], null]);
      }
      if (failOn?.test(sql)) {
        return Promise.reject(new Error("lock timeout"));
      }
      state.statements.push({ sql: sql.replace(/\s+/g, " ").trim(), replacements });
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

const sql = (qi: ReturnType<typeof fakeQueryInterface>): string[] => qi.state.statements.map((s) => s.sql);

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const models = {
  DeviceType: defineDeviceType(sequelize, DataTypes),
  InspectionItemDefinition: defineDefinition(sequelize, DataTypes),
  InspectionTemplate: defineTemplate(sequelize, DataTypes),
  InspectionTemplateVersion: defineVersion(sequelize, DataTypes),
  InspectionTemplateItem: defineItem(sequelize, DataTypes),
  InspectionTemplateProposal: defineProposal(sequelize, DataTypes),
};

/** A column as the model or the migration declares it, reduced to what the DDL depends on. */
const shape = (a: AttributeLike) => ({
  type: a.type.key,
  of: a.type.type?.key,
  length: a.type.options?.length,
  values: a.type.values ? [...a.type.values] : a.type.type?.values ? [...a.type.type.values] : undefined,
  // A primary key is NOT NULL whatever allowNull says (PostgreSQL and Sequelize both).
  allowNull: a.primaryKey !== true && a.allowNull !== false,
  primaryKey: a.primaryKey === true,
  // The model's id defaults to UUIDV4 (an object the table never sees); an array default is compared as JSON.
  defaultValue: Array.isArray(a.defaultValue)
    ? JSON.stringify(a.defaultValue)
    : a.defaultValue === undefined || typeof a.defaultValue === "object"
      ? undefined
      : a.defaultValue,
  references: a.references ? `${a.references.model}.${a.references.key}` : undefined,
  onDelete: a.onDelete,
  onUpdate: a.onUpdate,
});

const TIMESTAMPS = ["created_at", "updated_at"];

describe("migration 0112 — the inspection catalogue (P20-03)", () => {
  it("is registered in the static manifest under a .js name, right after 0111", () => {
    const entry = '["0112-inspection-catalogue.js", require("../migrations/0112-inspection-catalogue")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0111-device-types.js"'));
  });

  it.each([
    ["inspection_item_definitions", "InspectionItemDefinition"],
    ["inspection_templates", "InspectionTemplate"],
    ["inspection_template_versions", "InspectionTemplateVersion"],
    ["inspection_template_items", "InspectionTemplateItem"],
    ["inspection_template_proposals", "InspectionTemplateProposal"],
  ] as const)("creates %s exactly as model %s declares it, column for column", (table, modelName) => {
    const model = models[modelName] as unknown as { getTableName(): string; getAttributes(): unknown };
    expect(model.getTableName()).toBe(table);
    const declared = model.getAttributes() as Record<string, AttributeLike>;
    const byColumn = Object.fromEntries(
      Object.entries(declared)
        .filter(([name, a]) => !TIMESTAMPS.includes(a.field ?? name))
        .map(([name, a]) => [a.field ?? name, shape(a)]),
    );
    const columns = (migration.COLUMNS[table] as () => Record<string, AttributeLike>)();
    for (const timestamp of TIMESTAMPS) {
      expect(columns[timestamp]).toMatchObject({ allowNull: false });
    }
    const migrated = Object.fromEntries(
      Object.entries(columns).filter(([c]) => !TIMESTAMPS.includes(c)).map(([c, a]) => [c, shape(a)]),
    );
    expect(migrated).toEqual(byColumn);
  });

  it("every key it creates is RESTRICT (nothing in the catalogue is deleted, ADR-125)", () => {
    for (const table of migration.TABLES) {
      const columns = (migration.COLUMNS[table] as () => Record<string, AttributeLike>)();
      for (const [column, spec] of Object.entries(columns)) {
        if (spec.references) {
          expect(`${table}.${column} ${String(spec.onDelete)}`).toBe(`${table}.${column} RESTRICT`);
        }
      }
    }
  });

  it("on an UPGRADED database: creates the five tables in dependency order, in ONE transaction", async () => {
    const qi = fakeQueryInterface({ tables: ["users", "tenants", "device_types", "audit_logs"] });
    await migration.up({ context: qi.context });
    expect(qi.state.transactions).toBe(1);
    expect(qi.state.created).toEqual([
      "inspection_item_definitions",
      "inspection_templates",
      "inspection_template_versions",
      "inspection_template_items",
      "inspection_template_proposals",
    ]);
  });

  it("adds every CHECK by name, each once — and none sync() already made (a re-run adds none)", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi.context });
    const added = sql(qi).filter((s) => s.includes("ADD CONSTRAINT"));
    const names = Object.values(migration.CHECKS).flatMap((c) => Object.keys(c));
    expect(names).toHaveLength(35);
    expect(added.map((s) => /ADD CONSTRAINT (\w+)/.exec(s)?.[1])).toEqual(names);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(63);
    }
    const again = fakeQueryInterface({ constraints: names });
    await migration.up({ context: again.context });
    expect(sql(again).some((s) => s.includes("ADD CONSTRAINT"))).toBe(false);
  });

  it("the limit-shape CHECK admits one column set per operator (§ 4.2), on the library and on every copy", () => {
    for (const table of ["inspection_item_definitions", "inspection_template_items"]) {
      const checks = migration.CHECKS[table] ?? {};
      const shapeCheck = checks[`${table}_limit_shape`] ?? "";
      expect(shapeCheck).toContain("limit_op IN ('lt', 'lte', 'gt', 'gte') AND limit_value IS NOT NULL");
      expect(shapeCheck).toContain("limit_op = 'between' AND limit_low IS NOT NULL AND limit_high IS NOT NULL AND limit_low <= limit_high");
      expect(shapeCheck).toContain("limit_op IN ('plus_minus', 'plus_minus_pct') AND limit_tolerance IS NOT NULL AND limit_tolerance >= 0");
      expect(shapeCheck).toContain("limit_op IS NULL AND limit_value IS NULL");
      expect(checks[`${table}_outcomes`]).toBe("cardinality(allowed_outcomes) > 0 OR input_kind IN ('measured', 'text')");
      expect(checks[`${table}_limit_text`]).toBe("limit_op IS NULL OR (limit_text IS NOT NULL AND btrim(limit_text) <> '')");
    }
    const versions = migration.CHECKS["inspection_template_versions"] ?? {};
    expect(versions["inspection_template_versions_publisher_exactly_one"]).toBe(
      "status IN ('draft', 'discarded') OR ((published_by IS NULL) <> (published_by_system IS NULL))",
    );
  });

  it("creates the invariant indexes — one published, one draft, one base, one template per type — and a leading index on every key", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi.context });
    const indexes = sql(qi).filter((s) => /CREATE (UNIQUE )?INDEX/.test(s));
    expect(indexes).toHaveLength(32);
    expect(indexes).toEqual(expect.arrayContaining([
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_one_published ON inspection_template_versions (template_id) WHERE status = 'published'",
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_one_draft ON inspection_template_versions (template_id) WHERE status = 'draft'",
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_one_base ON inspection_templates ((device_type_id IS NULL)) WHERE device_type_id IS NULL",
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_device_type_id_unique ON inspection_templates (device_type_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_version_number_unique ON inspection_template_versions (template_id, version_number) WHERE version_number IS NOT NULL",
      "CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_items_version_definition_unique ON inspection_template_items (version_id, item_definition_id)",
      "CREATE INDEX IF NOT EXISTS inspection_template_proposals_tenant_queue ON inspection_template_proposals (tenant_id, status, created_at DESC, id)",
    ]));
    // No INCLUDE (...): Sequelize's showIndex at every boot would crash on it (U-06b).
    expect(indexes.some((s) => /\)\s*INCLUDE\s*\(/i.test(s))).toBe(false);
  });

  it("creates ten triggers, drops each first, and ENABLE ALWAYS — so session_replication_role = replica cannot pass them", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi.context });
    const created = sql(qi).filter((s) => s.startsWith("CREATE TRIGGER"));
    expect(created).toHaveLength(10);
    expect(sql(qi).filter((s) => s.startsWith("DROP TRIGGER IF EXISTS"))).toHaveLength(10);
    expect(sql(qi).filter((s) => s.includes(" ENABLE ALWAYS TRIGGER "))).toHaveLength(10);
    expect(created).toEqual(expect.arrayContaining([
      "CREATE TRIGGER inspection_template_versions_immutable BEFORE UPDATE OR DELETE ON inspection_template_versions FOR EACH ROW EXECUTE FUNCTION inspection_template_versions_guard()",
      "CREATE TRIGGER inspection_template_items_draft_only BEFORE INSERT OR UPDATE OR DELETE ON inspection_template_items FOR EACH ROW EXECUTE FUNCTION inspection_template_items_guard()",
      "CREATE TRIGGER inspection_template_proposals_no_delete BEFORE DELETE ON inspection_template_proposals FOR EACH ROW EXECUTE FUNCTION inspection_catalogue_no_delete()",
    ]));
  });

  it("the version guard: no DELETE, no TRUNCATE, identity fixed, a draft never retired, a published version only retired, the rest final", () => {
    const fn = migration.VERSIONS_GUARD_SQL;
    expect(fn).toContain("IF TG_OP = 'TRUNCATE' THEN");
    expect(fn).toContain("IF TG_OP = 'DELETE' THEN");
    expect(fn).toContain("NEW.template_id IS DISTINCT FROM OLD.template_id");
    expect(fn).toContain("IF NEW.status = 'retired' THEN");
    expect(fn).toContain("retire_columns CONSTANT text[] := ARRAY['status', 'retired_at', 'retired_by', 'updated_at', 'updated_by']");
    expect(fn).toContain("IF OLD.status = 'published' AND NEW.status = 'retired'");
    expect(fn).toContain("AND (to_jsonb(NEW) - retire_columns) = (to_jsonb(OLD) - retire_columns) THEN");
    expect(fn.match(/ERRCODE = '42501'/g)).toHaveLength(5);
  });

  it("the item guard reads the parent version FOR SHARE, on the old and the new parent, and lets the foreign key refuse a missing one", () => {
    const fn = migration.ITEMS_GUARD_SQL;
    expect(fn).toContain("WHERE id = OLD.version_id FOR SHARE");
    expect(fn).toContain("WHERE id = NEW.version_id FOR SHARE");
    expect(fn).toContain("IF parent_status IS DISTINCT FROM 'draft' THEN");
    expect(fn).toContain("IF FOUND AND parent_status <> 'draft' THEN");
    expect(fn).toContain("RETURN OLD;");
  });

  it("takes DELETE and TRUNCATE from the application role — the items keep DELETE for a draft's replacement (ADR-125 Am. 2)", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi.context });
    expect(sql(qi).filter((s) => s.startsWith("REVOKE"))).toEqual([
      "REVOKE DELETE, TRUNCATE ON inspection_item_definitions FROM callibrator_app",
      "REVOKE DELETE, TRUNCATE ON inspection_templates FROM callibrator_app",
      "REVOKE DELETE, TRUNCATE ON inspection_template_versions FROM callibrator_app",
      "REVOKE TRUNCATE ON inspection_template_items FROM callibrator_app",
      "REVOKE DELETE, TRUNCATE ON inspection_template_proposals FROM callibrator_app",
    ]);
  });

  describe("the base checklist, version 1 (§ 12)", () => {
    it("fifteen neutral items for the fixed sections, each allowed by its section's rule (spec § 5.1)", () => {
      expect(migration.SEED).toHaveLength(15);
      expect(migration.SEED.map((e) => e.section)).toEqual([
        "environment",
        "environment",
        "electrical_supply",
        "electrical_supply",
        "electrical_supply",
        "other_safety",
        "other_safety",
        "physical",
        "physical",
        "maintenance_task",
        "maintenance_task",
        "maintenance_task",
        "maintenance_task",
        "maintenance_task",
        "maintenance_task",
      ]);
      for (const entry of migration.SEED) {
        const rule = INSPECTION_SECTION_RULES[entry.section];
        expect(rule.inputKinds).toContain(entry.inputKind);
        for (const outcome of entry.allowedOutcomes) {
          expect(rule.outcomes).toContain(outcome);
        }
      }
    });

    it("the § 6.5 ranges: temperature -20..80 (warn 10..45), humidity 0..100 (warn 10..95), voltage 0..400 (warn 198..242)", () => {
      const ranges = migration.SEED.filter((e) => e.unit !== null).map(
        (e) => `${String(e.unit)} ${String(e.validMin)}..${String(e.validMax)} warn ${String(e.warnMin)}..${String(e.warnMax)}`,
      );
      expect(ranges).toEqual([
        "°C -20..80 warn 10..45",
        "% 0..100 warn 10..95",
        "V 0..400 warn 198..242",
        "V 0..400 warn 198..242",
        "V 0..400 warn 198..242",
      ]);
    });

    it("has FIXED ids, so every deployment's base version 1 is the same version", () => {
      expect(migration.BASE_TEMPLATE_ID).toBe("5eedca7a-0000-4000-8000-000000000001");
      expect(migration.BASE_VERSION_ID).toBe("5eedca7a-0000-4000-8000-000000000002");
      expect(migration.seedDefinitionId(15)).toBe("5eedca7a-0001-4000-8000-000000000015");
      expect(migration.seedItemId(1)).toBe("5eedca7a-0002-4000-8000-000000000001");
    });

    it("its content hash is SHA-256 of the contract's canonical text — pinned, so a changed canonical form fails here", () => {
      const expected = createHash("sha256")
        .update(
          canonicalTemplateVersion({
            templateId: migration.BASE_TEMPLATE_ID,
            deviceTypeId: null,
            versionNumber: 1,
            baseVersionId: null,
            items: migration.seedItems(),
          }),
          "utf8",
        )
        .digest("hex");
      expect(migration.seedContentHash()).toBe(expected);
      expect(migration.seedContentHash()).toBe("165ac87a7c780493c3f846f5614a9be723fb96ebe18c70be03381f9fa86bc89c");
    });

    it("seeds through the draft: definitions, the base template, a DRAFT, its items, then the publish UPDATE and the audit row", async () => {
      const qi = fakeQueryInterface();
      await migration.up({ context: qi.context });
      const seed = qi.state.statements.filter((s) => /^(INSERT|UPDATE)/.test(s.sql));
      expect(seed.map((s) => /^(INSERT INTO|UPDATE) (\w+)/.exec(s.sql)?.[2])).toEqual([
        ...Array<string>(15).fill("inspection_item_definitions"),
        "inspection_templates",
        "inspection_template_versions",
        ...Array<string>(15).fill("inspection_template_items"),
        "inspection_template_versions",
        "audit_logs",
      ]);
      const draft = seed[16];
      expect(draft?.sql).toContain("'draft'");
      const publish = seed[32];
      expect(publish?.sql).toContain("SET status = 'published', version_number = 1");
      expect(publish?.sql).toContain("WHERE id = :id AND status = 'draft'");
      expect(publish?.replacements).toEqual({
        id: migration.BASE_VERSION_ID,
        hash: migration.seedContentHash(),
        note: migration.SEED_CHANGE_NOTE,
        actor: "system:catalogue-seed",
      });
      expect(migration.SEED_ACTOR).toBe(SYSTEM_ACTORS.CATALOGUE_SEED);
      const item = seed[17];
      expect(item?.replacements).toMatchObject({
        id: migration.seedItemId(1),
        versionId: migration.BASE_VERSION_ID,
        definitionId: migration.seedDefinitionId(1),
        outcomes: "{}",
      });
      expect(seed[19]?.replacements).toMatchObject({ outcomes: "{not_applicable}", unit: "V", warnMin: "198" });
    });

    it("its audit row: APPROVE under the PLATFORM tenant, actor system:catalogue-seed, the version and its hash — written once", async () => {
      const qi = fakeQueryInterface();
      await migration.up({ context: qi.context });
      const audit = qi.state.statements.find((s) => s.sql.startsWith("INSERT INTO audit_logs"));
      expect(audit?.sql).toContain("'system', :actor, 'APPROVE', 'InspectionTemplateVersion', :id");
      expect(audit?.sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE resource_type = 'InspectionTemplateVersion' AND resource_id = :id AND action = 'APPROVE')");
      expect(audit?.replacements["tenantId"]).toBe(PLATFORM_TENANT_ID);
      expect(audit?.replacements["actor"]).toBe("system:catalogue-seed");
      expect(JSON.parse(String(audit?.replacements["changes"]))).toEqual({
        operation: "PUBLISH_TEMPLATE_VERSION",
        versionNumber: 1,
        contentHash: migration.seedContentHash(),
        baseVersionId: null,
        retiredVersionId: null,
        templateId: migration.BASE_TEMPLATE_ID,
        itemCount: 15,
        changeNote: migration.SEED_CHANGE_NOTE,
      });
    });

    it("does not seed again when a base template exists (a re-run, or a base the operator already has)", async () => {
      const qi = fakeQueryInterface({ baseExists: true });
      await migration.up({ context: qi.context });
      expect(sql(qi).some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    });

    it("refuses — rather than seed an unaudited publish — when the PLATFORM tenant is absent", async () => {
      const qi = fakeQueryInterface({ platformExists: false });
      await expect(migration.up({ context: qi.context })).rejects.toThrow(/the PLATFORM tenant .* does not exist/);
    });
  });

  it.each([["users"], ["tenants"], ["device_types"], ["audit_logs"]])(
    "refuses to run — and so to be recorded as applied — when %s is absent",
    async (missing) => {
      const qi = fakeQueryInterface({ tables: ALL_TABLES.filter((t) => t !== missing) });
      await expect(migration.up({ context: qi.context })).rejects.toThrow(new RegExp(`table ${missing} does not exist`));
      expect(sql(qi)).toEqual(["SET LOCAL lock_timeout = '10s'"]);
    },
  );

  it("refuses to run when the application role 0057 creates is absent; refuses a role it cannot interpolate", async () => {
    await expect(migration.up({ context: fakeQueryInterface({ roleExists: false }).context })).rejects.toThrow(
      /application role "callibrator_app" does not exist/,
    );
    expect(() => migration.appRoleName("x; DROP TABLE users")).toThrow(/not a plain lower-case identifier/);
    expect(migration.appRoleName("none")).toBe("callibrator_app");
  });

  it("lets a failure propagate: no try/catch, nothing swallowed", async () => {
    const qi = fakeQueryInterface({ failOn: /^REVOKE/ });
    await expect(migration.up({ context: qi.context })).rejects.toThrow("lock timeout");
    expect(SOURCE).not.toMatch(/\btry\s*\{|\.catch\(/);
  });

  it("down REFUSES while the catalogue holds anything beyond the seed — nothing is dropped", async () => {
    const qi = fakeQueryInterface({ extraRows: 2 });
    await expect(migration.down({ context: qi.context })).rejects.toThrow(/holds 2 row\(s\) beyond the seeded base checklist/);
    expect(sql(qi)).toEqual(["SET LOCAL lock_timeout = '10s'"]);
  });

  it("down on the seed alone drops the five tables (reverse order), the three functions and the fourteen types", async () => {
    const qi = fakeQueryInterface();
    await migration.down({ context: qi.context });
    expect(sql(qi)).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP TABLE IF EXISTS inspection_template_proposals",
      "DROP TABLE IF EXISTS inspection_template_items",
      "DROP TABLE IF EXISTS inspection_template_versions",
      "DROP TABLE IF EXISTS inspection_templates",
      "DROP TABLE IF EXISTS inspection_item_definitions",
      "DROP FUNCTION IF EXISTS inspection_catalogue_no_delete()",
      "DROP FUNCTION IF EXISTS inspection_template_versions_guard()",
      "DROP FUNCTION IF EXISTS inspection_template_items_guard()",
      ...migration.ENUM_TYPES.map((t) => `DROP TYPE IF EXISTS "${t}"`),
    ]);
    expect(migration.ENUM_TYPES).toHaveLength(14);
  });
});
