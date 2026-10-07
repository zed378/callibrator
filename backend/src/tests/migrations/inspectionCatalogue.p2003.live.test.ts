/**
 * P20-01 / P20-03 against a REAL PostgreSQL 18 — migrations 0111 (device_types,
 * calibration_devices.device_type_id) and 0112 (the inspection catalogue).
 *
 * On an EMPTY scratch database: db.sync() (today's models create the catalogue
 * tables, with no CHECK, trigger or revoke) and the migrations up to 0110. Then:
 *
 *  - FAIL-BEFORE: without 0111/0112 the application role may DELETE a device
 *    type and a published version's content can be rewritten — nothing refuses;
 *  - 0111 + 0112 up: every trigger ENABLE ALWAYS, every key RESTRICT, the
 *    application role without DELETE (items: with DELETE, ADR-125 Am. 2), the
 *    base checklist v1 seeded, its content_hash equal to SHA-256 of the
 *    contract's canonical text RECOMPUTED FROM THE ROWS, its audit row;
 *  - AS callibrator_app (SET LOCAL ROLE — never as the owner, CLAUDE.md
 *    Evidence): the lifecycle the triggers hold (spec § 7.7) — a draft's items
 *    written and deleted; publish; a published version's content refused, its
 *    items refused; retire once; retired and discarded final; DELETE refused
 *    everywhere; the partial unique indexes refuse a second draft and a second
 *    published; the CHECKs refuse two publishers and a malformed limit;
 *  - the owner is refused too (the triggers bind every role), TRUNCATE included;
 *  - schemaVerify passes (the control objects of EXPECTED_OBJECTS exist);
 *  - a REBOOT on the migrated database — db.sync() (showIndex on every new
 *    index: the 0109 INCLUDE crash class) + the migrator (applies nothing) +
 *    the schema check;
 *  - 0112 down refuses while a non-seed row exists; down/down, then up/up
 *    through the migrations' own createTable path: the same objects, the same
 *    hash, ONE audit row.
 *
 *   docker run -d --name p2003-pg18 -e POSTGRES_PASSWORD=p2003pass \
 *     -p 127.0.0.1:55203:5432 pgvector/pgvector:pg18
 *   P2003_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55203 DB_NAME=p2003_scratch \
 *     DB_USER=postgres DB_PASS=p2003pass npm test -- src/tests/migrations/inspectionCatalogue.p2003.live --coverage=false
 *   docker rm -f p2003-pg18
 */
import { createHash } from "node:crypto";
import { Sequelize } from "sequelize";
import {
  canonicalTemplateVersion,
  type CanonicalTemplateItemInput,
} from "@callibrator/contracts/inspectionValues";
import { env } from "../../config/env";

const live = env("P2003_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const BASE_TEMPLATE = "5eedca7a-0000-4000-8000-000000000001";
const BASE_VERSION = "5eedca7a-0000-4000-8000-000000000002";
const TYPE = "a2003000-0000-4000-8000-000000000071";
const TYPE_TEMPLATE = "a2003000-0000-4000-8000-000000000072";
const DRAFT = "a2003000-0000-4000-8000-000000000073";
const SECOND = "a2003000-0000-4000-8000-000000000074";
const DEFINITION = "a2003000-0000-4000-8000-000000000075";
const ITEM = "a2003000-0000-4000-8000-000000000076";
const ITEM_2 = "a2003000-0000-4000-8000-000000000077";
const TENANT = "a2003000-0000-4000-8000-000000000078";
const USER = "a2003000-0000-4000-8000-000000000079";
const PROPOSAL = "a2003000-0000-4000-8000-00000000007a";
const FAIL_BEFORE_TYPE = "a2003000-0000-4000-8000-00000000007b";

type Row = Record<string, unknown>;
interface LiveTx {
  rollback(): Promise<void>;
  commit(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[]; objects: number }> };
  m0111: Migration;
  m0112: Migration & { seedContentHash(): string };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
      m0111: require("../../migrations/0111-device-types") as Migration,
      m0112: require("../../migrations/0112-inspection-catalogue") as Graph["m0112"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The PostgreSQL error `sql` raises inside a savepoint of `t` (as `role`, when given): "<code> <message>", or null. */
const errorOf = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = APP_ROLE) => {
  await db.query("SAVEPOINT probe", { transaction: t });
  try {
    if (role) {
      await db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
    }
    await db.query(sql, { transaction: t, replacements });
    await db.query("RESET ROLE", { transaction: t });
    await db.query("RELEASE SAVEPOINT probe", { transaction: t });
    return null;
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probe", { transaction: t });
    await db.query("RESET ROLE", { transaction: t });
    const e = err as { parent?: { code?: string; message?: string } };
    return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
  }
};

/** Run `sql` as the application role, keeping its effect (it must succeed). */
const asApp = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}): Promise<void> => {
  expect(await errorOf(db, t, sql, replacements, APP_ROLE)).toBeNull();
};

const rows = async (db: LiveDb, sql: string, replacements: object = {}, transaction?: LiveTx): Promise<Row[]> =>
  (await db.query(sql, { replacements, transaction }))[0];

const inRolledBack = async (db: LiveDb, work: (t: LiveTx) => Promise<void>): Promise<void> => {
  const t = await db.transaction();
  try {
    await work(t);
  } finally {
    await t.rollback();
  }
};

const TRIGGERS = [
  "device_types:device_types_no_delete",
  "device_types:device_types_no_truncate",
  "inspection_item_definitions:inspection_item_definitions_no_delete",
  "inspection_item_definitions:inspection_item_definitions_no_truncate",
  "inspection_template_items:inspection_template_items_draft_only",
  "inspection_template_items:inspection_template_items_no_truncate",
  "inspection_template_proposals:inspection_template_proposals_no_delete",
  "inspection_template_proposals:inspection_template_proposals_no_truncate",
  "inspection_template_versions:inspection_template_versions_immutable",
  "inspection_template_versions:inspection_template_versions_no_truncate",
  "inspection_templates:inspection_templates_no_delete",
  "inspection_templates:inspection_templates_no_truncate",
];

const catalogueTriggers = async (db: LiveDb): Promise<string[]> =>
  (
    await rows(
      db,
      `SELECT c.relname || ':' || t.tgname || ':' || t.tgenabled::text AS t FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND (c.relname = 'device_types' OR c.relname LIKE 'inspection_%') ORDER BY 1`,
    )
  )
    .map((r) => String(r["t"]))
    .sort();

/** The base version's items read back from PostgreSQL, as the canonical form reads them. */
const storedItems = async (db: LiveDb, versionId: string): Promise<CanonicalTemplateItemInput[]> =>
  (
    await rows(
      db,
      `SELECT id, item_definition_id, origin::text, section::text, label, input_kind::text, unit, symbol, setting_text,
              setting_value::text, limit_op::text, limit_value::text, limit_low::text, limit_high::text,
              limit_nominal::text, limit_tolerance::text, limit_text, valid_min::text, valid_max::text,
              warn_min::text, warn_max::text, allowed_outcomes::text[] AS allowed_outcomes, required, sort_order
         FROM inspection_template_items WHERE version_id = :versionId`,
      { versionId },
    )
  ).map((r) => ({
    id: String(r["id"]),
    itemDefinitionId: String(r["item_definition_id"]),
    origin: r["origin"] as CanonicalTemplateItemInput["origin"],
    section: r["section"] as CanonicalTemplateItemInput["section"],
    label: String(r["label"]),
    inputKind: r["input_kind"] as CanonicalTemplateItemInput["inputKind"],
    unit: r["unit"] as string | null,
    symbol: r["symbol"] as string | null,
    settingText: r["setting_text"] as string | null,
    settingValue: r["setting_value"] as string | null,
    limitOp: r["limit_op"] as CanonicalTemplateItemInput["limitOp"],
    limitValue: r["limit_value"] as string | null,
    limitLow: r["limit_low"] as string | null,
    limitHigh: r["limit_high"] as string | null,
    limitNominal: r["limit_nominal"] as string | null,
    limitTolerance: r["limit_tolerance"] as string | null,
    limitText: r["limit_text"] as string | null,
    validMin: r["valid_min"] as string | null,
    validMax: r["valid_max"] as string | null,
    warnMin: r["warn_min"] as string | null,
    warnMax: r["warn_max"] as string | null,
    allowedOutcomes: r["allowed_outcomes"] as CanonicalTemplateItemInput["allowedOutcomes"],
    required: r["required"] === true,
    sortOrder: Number(r["sort_order"]),
  }));

const recomputedHash = async (db: LiveDb): Promise<string> =>
  createHash("sha256")
    .update(
      canonicalTemplateVersion({
        templateId: BASE_TEMPLATE,
        deviceTypeId: null,
        versionNumber: 1,
        baseVersionId: null,
        items: await storedItems(db, BASE_VERSION),
      }),
      "utf8",
    )
    .digest("hex");

jest.setTimeout(900000);

live("P20-01 / P20-03 — migrations 0111 and 0112 on live PostgreSQL 18", () => {
  let g: Graph;
  let admin: Sequelize;

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    admin = new Sequelize("postgres", env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    g = startProcess();
    await g.db.sync();
    await g.migrator.up({ to: "0110-search-tenant-gin.js" });
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("FAIL-BEFORE (sync() alone, no 0111/0112): the application role deletes a device type and rewrites a published version", async () => {
    expect(await catalogueTriggers(g.db)).toEqual([]);
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, "INSERT INTO device_types (id, name, status, created_at, updated_at) VALUES (:id, 'Fail-before type', 'active', now(), now())", { id: FAIL_BEFORE_TYPE });
      expect(await errorOf(g.db, t, "DELETE FROM device_types WHERE id = :id", { id: FAIL_BEFORE_TYPE })).toBeNull();
      await asApp(g.db, t, "INSERT INTO inspection_templates (id, status, created_at, updated_at) VALUES (:id, 'active', now(), now())", { id: TYPE_TEMPLATE });
      await asApp(g.db, t,
        `INSERT INTO inspection_template_versions (id, template_id, status, version_number, content_hash, change_note, revision,
           published_at, published_by_system, created_at, updated_at)
         VALUES (:id, :tpl, 'published', 1, repeat('a', 64), 'Fail-before', 0, now(), 'system:catalogue-seed', now(), now())`,
        { id: SECOND, tpl: TYPE_TEMPLATE });
      expect(await errorOf(g.db, t, "UPDATE inspection_template_versions SET change_note = 'rewritten' WHERE id = :id", { id: SECOND })).toBeNull();
      expect(await errorOf(g.db, t, "DELETE FROM inspection_template_versions WHERE id = :id", { id: SECOND })).toBeNull();
    });
  });

  it("0111 + 0112 up: twelve triggers, all ENABLE ALWAYS ('A')", async () => {
    const applied = await g.migrator.up();
    expect(applied.map((m) => m.name)).toEqual(["0111-device-types.js", "0112-inspection-catalogue.js"]);
    expect(await catalogueTriggers(g.db)).toEqual(TRIGGERS.map((t) => `${t}:A`).sort());
  });

  it("every foreign key into and inside the catalogue is RESTRICT, the device's included (G-5)", async () => {
    const fks = await rows(
      g.db,
      `SELECT conrelid::regclass::text || '.' || a.attname AS col, confdeltype
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND (conrelid::regclass::text LIKE 'inspection_%' OR conrelid::regclass::text = 'device_types'
              OR (conrelid::regclass::text = 'calibration_devices' AND a.attname = 'device_type_id'))
        ORDER BY 1`,
    );
    // device_types 2, definitions 2, templates 3, versions 8, items 2, proposals 7, the device's 1.
    expect(fks.length).toBe(25);
    expect(fks.filter((f) => f["confdeltype"] !== "r")).toEqual([]);
  });

  it("grants AS checked for callibrator_app: no DELETE or TRUNCATE on six tables; the items keep DELETE (ADR-125 Am. 2)", async () => {
    const privileges = await rows(
      g.db,
      `SELECT t, has_table_privilege(:role, t, 'SELECT') AS s, has_table_privilege(:role, t, 'INSERT') AS i,
              has_table_privilege(:role, t, 'UPDATE') AS u, has_table_privilege(:role, t, 'DELETE') AS d,
              has_table_privilege(:role, t, 'TRUNCATE') AS tr
         FROM unnest(ARRAY['device_types','inspection_item_definitions','inspection_template_items',
                           'inspection_template_proposals','inspection_template_versions','inspection_templates'])
              WITH ORDINALITY AS u(t, n) ORDER BY n`,
      { role: APP_ROLE },
    );
    expect(privileges).toEqual([
      { t: "device_types", s: true, i: true, u: true, d: false, tr: false },
      { t: "inspection_item_definitions", s: true, i: true, u: true, d: false, tr: false },
      { t: "inspection_template_items", s: true, i: true, u: true, d: true, tr: false },
      { t: "inspection_template_proposals", s: true, i: true, u: true, d: false, tr: false },
      { t: "inspection_template_versions", s: true, i: true, u: true, d: false, tr: false },
      { t: "inspection_templates", s: true, i: true, u: true, d: false, tr: false },
    ]);
  });

  it("the base checklist v1: published by system:catalogue-seed, 15 items, its hash recomputed FROM THE ROWS equals the stored one", async () => {
    const [version] = await rows(
      g.db,
      "SELECT status::text, version_number, content_hash, published_by, published_by_system FROM inspection_template_versions WHERE id = :id",
      { id: BASE_VERSION },
    );
    expect(version).toEqual({
      status: "published",
      version_number: 1,
      content_hash: g.m0112.seedContentHash(),
      published_by: null,
      published_by_system: "system:catalogue-seed",
    });
    expect(await storedItems(g.db, BASE_VERSION)).toHaveLength(15);
    expect(await recomputedHash(g.db)).toBe(version?.["content_hash"]);
    const audit = await rows(
      g.db,
      `SELECT tenant_id, actor_type::text, actor_name, action::text, changes->>'contentHash' AS hash FROM audit_logs
        WHERE resource_type = 'InspectionTemplateVersion' AND resource_id = :id`,
      { id: BASE_VERSION },
    );
    expect(audit).toEqual([
      {
        tenant_id: "00000000-0000-4000-8000-000000000001",
        actor_type: "system",
        actor_name: "system:catalogue-seed",
        action: "APPROVE",
        hash: g.m0112.seedContentHash(),
      },
    ]);
  });

  it("AS callibrator_app: the version lifecycle the database holds (spec § 7.7)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, "INSERT INTO device_types (id, name, created_at, updated_at) VALUES (:id, 'Test Device Type A', now(), now())", { id: TYPE });
      await asApp(g.db, t, "INSERT INTO inspection_templates (id, device_type_id, created_at, updated_at) VALUES (:id, :type, now(), now())", { id: TYPE_TEMPLATE, type: TYPE });
      await asApp(g.db, t,
        `INSERT INTO inspection_item_definitions (id, section, label, input_kind, unit, limit_op, limit_value, limit_text,
           allowed_outcomes, created_at, updated_at)
         VALUES (:id, 'electrical_safety', 'Synthetic leakage check', 'measured_with_limit', 'µA', 'lte', 100, '≤ 100 µA',
           '{pass,fail}', now(), now())`,
        { id: DEFINITION });
      await asApp(g.db, t, "INSERT INTO inspection_template_versions (id, template_id, created_at, updated_at) VALUES (:id, :tpl, now(), now())", { id: DRAFT, tpl: TYPE_TEMPLATE });
      // A second open draft: the partial unique index refuses it.
      expect(await errorOf(g.db, t, "INSERT INTO inspection_template_versions (id, template_id, created_at, updated_at) VALUES (:id, :tpl, now(), now())", { id: SECOND, tpl: TYPE_TEMPLATE }))
        .toMatch(/^23505 .*inspection_template_versions_one_draft/);
      const insertItem = `INSERT INTO inspection_template_items (id, version_id, item_definition_id, origin, section, label, input_kind,
           unit, limit_op, limit_value, limit_text, allowed_outcomes, required, sort_order, created_at, updated_at)
         VALUES (:id, :version, :def, 'type', 'electrical_safety', 'Synthetic leakage check', 'measured_with_limit', 'µA',
           'lte', 100, '≤ 100 µA', '{pass,fail}', true, :sort, now(), now())`;
      // A draft's items are written, changed and deleted (the wholesale replacement).
      await asApp(g.db, t, insertItem, { id: ITEM, version: DRAFT, def: DEFINITION, sort: 0 });
      await asApp(g.db, t, "UPDATE inspection_template_items SET limit_value = 110 WHERE id = :id", { id: ITEM });
      await asApp(g.db, t, "DELETE FROM inspection_template_items WHERE id = :id", { id: ITEM });
      await asApp(g.db, t, insertItem, { id: ITEM, version: DRAFT, def: DEFINITION, sort: 0 });
      // A malformed limit (between with no bounds) and a draft retired: refused.
      expect(await errorOf(g.db, t, "UPDATE inspection_template_items SET limit_op = 'between' WHERE id = :id", { id: ITEM }))
        .toMatch(/^23514 .*inspection_template_items_limit_shape/);
      expect(await errorOf(g.db, t, "UPDATE inspection_template_versions SET status = 'retired', retired_at = now() WHERE id = :id", { id: DRAFT }))
        .toMatch(/^42501 .*a draft is published or discarded, never retired/);
      // Two publishers: refused by the exactly-one CHECK.
      expect(await errorOf(g.db, t,
        `UPDATE inspection_template_versions SET status = 'published', version_number = 1, content_hash = repeat('b', 64),
           change_note = 'Synthetic v1', published_at = now(), published_by = :user, published_by_system = 'system:catalogue-seed'
         WHERE id = :id`, { id: DRAFT, user: USER }))
        .toMatch(/^23514 .*publisher_exactly_one|^23503 /);
      // Publish.
      await asApp(g.db, t,
        `UPDATE inspection_template_versions SET status = 'published', version_number = 1, content_hash = repeat('b', 64),
           change_note = 'Synthetic v1', published_at = now(), published_by_system = 'system:catalogue-seed' WHERE id = :id`,
        { id: DRAFT });
      // Published content: immutable; its items: frozen.
      expect(await errorOf(g.db, t, "UPDATE inspection_template_versions SET change_note = 'rewritten' WHERE id = :id", { id: DRAFT }))
        .toMatch(/^42501 .*is published; its content cannot be changed/);
      expect(await errorOf(g.db, t, insertItem, { id: ITEM_2, version: DRAFT, def: DEFINITION, sort: 1 }))
        .toMatch(/^42501 .*items are added only to a draft/);
      expect(await errorOf(g.db, t, "UPDATE inspection_template_items SET label = 'rewritten' WHERE id = :id", { id: ITEM }))
        .toMatch(/^42501 .*only a draft's items change/);
      expect(await errorOf(g.db, t, "DELETE FROM inspection_template_items WHERE id = :id", { id: ITEM }))
        .toMatch(/^42501 .*only a draft's items change/);
      // A second published version of the same template: the partial unique index refuses it.
      expect(await errorOf(g.db, t,
        `INSERT INTO inspection_template_versions (id, template_id, status, version_number, content_hash, change_note,
           published_at, published_by_system, created_at, updated_at)
         VALUES (:id, :tpl, 'published', 2, repeat('c', 64), 'Synthetic v2', now(), 'system:catalogue-seed', now(), now())`,
        { id: SECOND, tpl: TYPE_TEMPLATE }))
        .toMatch(/^23505 .*inspection_template_versions_one_published/);
      // Retire it — once; then final.
      await asApp(g.db, t, "UPDATE inspection_template_versions SET status = 'retired', retired_at = now() WHERE id = :id", { id: DRAFT });
      expect(await errorOf(g.db, t, "UPDATE inspection_template_versions SET status = 'published', retired_at = NULL WHERE id = :id", { id: DRAFT }))
        .toMatch(/^42501 .*is retired; its content cannot be changed/);
      // Discarded is final too.
      await asApp(g.db, t, "INSERT INTO inspection_template_versions (id, template_id, created_at, updated_at) VALUES (:id, :tpl, now(), now())", { id: SECOND, tpl: TYPE_TEMPLATE });
      await asApp(g.db, t, "UPDATE inspection_template_versions SET status = 'discarded', discarded_at = now() WHERE id = :id", { id: SECOND });
      expect(await errorOf(g.db, t, "UPDATE inspection_template_versions SET status = 'draft', discarded_at = NULL WHERE id = :id", { id: SECOND }))
        .toMatch(/^42501 .*is discarded/);
    });
  });

  it("AS callibrator_app: DELETE is refused on every catalogue table but a draft's items — and on the base version's items", async () => {
    await inRolledBack(g.db, async (t) => {
      for (const table of ["device_types", "inspection_item_definitions", "inspection_templates", "inspection_template_versions", "inspection_template_proposals"]) {
        expect(await errorOf(g.db, t, `DELETE FROM ${table}`)).toMatch(/^42501 permission denied for table/);
      }
      expect(await errorOf(g.db, t, "DELETE FROM inspection_template_items WHERE version_id = :v", { v: BASE_VERSION }))
        .toMatch(/^42501 .*only a draft's items change/);
      for (const table of ["device_types", "inspection_template_items"]) {
        expect(await errorOf(g.db, t, `TRUNCATE ${table} CASCADE`)).toMatch(/^42501 permission denied/);
      }
    });
  });

  it("the OWNER is refused too: the triggers bind every role (DELETE and TRUNCATE, each table)", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query("INSERT INTO device_types (id, name, created_at, updated_at) VALUES (:id, 'Test Device Type A', now(), now())", { transaction: t, replacements: { id: TYPE } });
      expect(await errorOf(g.db, t, "DELETE FROM device_types WHERE id = :id", { id: TYPE }, null)).toMatch(/^42501 .*device type .* cannot be deleted/);
      expect(await errorOf(g.db, t, "DELETE FROM inspection_template_versions WHERE id = :id", { id: BASE_VERSION }, null)).toMatch(/^42501 .*cannot be deleted/);
      expect(await errorOf(g.db, t, "DELETE FROM inspection_templates WHERE id = :id", { id: BASE_TEMPLATE }, null)).toMatch(/^42501 .*cannot be deleted/);
      expect(await errorOf(g.db, t, "UPDATE inspection_template_items SET label = 'x' WHERE version_id = :v", { v: BASE_VERSION }, null)).toMatch(/^42501 /);
      for (const table of ["device_types", "inspection_item_definitions", "inspection_templates", "inspection_template_versions", "inspection_template_items", "inspection_template_proposals"]) {
        expect(await errorOf(g.db, t, `TRUNCATE ${table} CASCADE`, {}, null)).toMatch(/^42501 .*TRUNCATE is refused/);
      }
    });
  });

  it("a proposal is tenant-scoped data: written as the app role, never deleted", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query("INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES (:id, 'P2003 Hospital', 'p2003', 'p2003@live.test', now(), now())", { transaction: t, replacements: { id: TENANT } });
      await g.db.query(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url, status, must_change_password,
                            is_deleted, created_at, updated_at)
         VALUES (:id, :tenant, 'p2003', 'p2003@live.test', 'x', 'P', 'X', 'default.svg', 'ACTIVE', false, false, now(), now())`,
        { transaction: t, replacements: { id: USER, tenant: TENANT } },
      );
      await asApp(g.db, t,
        `INSERT INTO inspection_template_proposals (id, tenant_id, kind, proposed_device_type_name, reason, submitted_by, created_at, updated_at)
         VALUES (:id, :tenant, 'new_device_type', 'Synthetic new type', 'Synthetic reason', :user, now(), now())`,
        { id: PROPOSAL, tenant: TENANT, user: USER });
      expect(await errorOf(g.db, t,
        `INSERT INTO inspection_template_proposals (id, tenant_id, kind, reason, submitted_by, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenant, 'add_items', 'Synthetic reason', :user, now(), now())`,
        { tenant: TENANT, user: USER })).toMatch(/^23514 .*inspection_template_proposals_target/);
      expect(await errorOf(g.db, t, "UPDATE inspection_template_proposals SET status = 'rejected', decided_at = now(), decided_by = :user WHERE id = :id", { id: PROPOSAL, user: USER }))
        .toMatch(/^23514 .*rejection_noted/);
      expect(await errorOf(g.db, t, "DELETE FROM inspection_template_proposals WHERE id = :id", { id: PROPOSAL }, null)).toMatch(/^42501 .*cannot be deleted/);
    });
  });

  it("schemaVerify passes: every table, column and control object (the catalogue's 18 among them)", async () => {
    const result = await g.schemaVerify.verifySchema(g.db);
    expect(result.problems).toEqual([]);
    expect(result.objects).toBe(31);
  });

  it("a REBOOT on the migrated database: sync() (showIndex on every new index), the migrator (nothing), the schema check", async () => {
    const next = startProcess();
    try {
      await next.db.sync();
      expect(await next.migrator.up()).toEqual([]);
      expect((await next.schemaVerify.verifySchema(next.db)).problems).toEqual([]);
    } finally {
      await next.db.close();
    }
  });

  it("0112 down REFUSES while a non-seed row exists, and changes nothing", async () => {
    await g.db.query("INSERT INTO device_types (id, name, created_at, updated_at) VALUES (:id, 'Test Device Type A', now(), now())", { replacements: { id: TYPE } });
    await g.db.query("INSERT INTO inspection_templates (id, device_type_id, created_at, updated_at) VALUES (:id, :type, now(), now())", { replacements: { id: TYPE_TEMPLATE, type: TYPE } });
    await expect(g.m0112.down({ context: g.db.getQueryInterface() })).rejects.toThrow(/holds 1 row\(s\) beyond the seeded base checklist/);
    await expect(g.m0111.down({ context: g.db.getQueryInterface() })).rejects.toThrow(/1 device type\(s\) exist/);
    expect(await catalogueTriggers(g.db)).toHaveLength(12);
  });

  it("down, down, then up, up through the migrations' own createTable path: the same objects, the same hash, ONE audit row", async () => {
    // Remove the row the previous case added, the only way the catalogue allows: as DDL, by down's own refusal lifted.
    await g.db.query("ALTER TABLE inspection_templates DISABLE TRIGGER inspection_templates_no_delete");
    await g.db.query("DELETE FROM inspection_templates WHERE id = :id", { replacements: { id: TYPE_TEMPLATE } });
    await g.db.query("ALTER TABLE inspection_templates ENABLE ALWAYS TRIGGER inspection_templates_no_delete");
    await g.db.query("ALTER TABLE device_types DISABLE TRIGGER device_types_no_delete");
    await g.db.query("DELETE FROM device_types WHERE id = :id", { replacements: { id: TYPE } });
    await g.db.query("ALTER TABLE device_types ENABLE ALWAYS TRIGGER device_types_no_delete");

    const qi = g.db.getQueryInterface();
    await g.m0112.down({ context: qi });
    await g.m0111.down({ context: qi });
    expect(await catalogueTriggers(g.db)).toEqual([]);
    expect(await rows(g.db, "SELECT to_regclass('inspection_templates') AS t, to_regclass('device_types') AS d")).toEqual([{ t: null, d: null }]);
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM pg_type WHERE typname LIKE 'enum_inspection_%' OR typname = 'enum_device_types_status'")).toEqual([{ n: 0 }]);
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'calibration_devices' AND column_name = 'device_type_id'")).toEqual([{ n: 0 }]);

    await g.m0111.up({ context: qi });
    await g.m0112.up({ context: qi });
    expect(await catalogueTriggers(g.db)).toEqual(TRIGGERS.map((t) => `${t}:A`).sort());
    expect(await recomputedHash(g.db)).toBe(g.m0112.seedContentHash());
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'InspectionTemplateVersion' AND resource_id = :id", { id: BASE_VERSION }))
      .toEqual([{ n: 1 }]);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    // Idempotent: a second up changes nothing and seeds nothing.
    await g.m0111.up({ context: qi });
    await g.m0112.up({ context: qi });
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM inspection_template_versions")).toEqual([{ n: 1 }]);
  });
});
