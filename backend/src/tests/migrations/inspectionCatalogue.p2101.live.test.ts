/**
 * P21-01 against a REAL PostgreSQL 18 — the catalogue SERVICES on the real schema (0111, 0112's
 * triggers, 0125's index), where memoryDb has no trigger and no unique index:
 *
 *  - the publish order the triggers demand: items written while the version is a draft, the old
 *    published version retired BEFORE the new one is published (one published per template), every
 *    publish column set in one UPDATE — a type v1 published on the seeded base v1;
 *  - FAIL-BEFORE: with 0112's one-draft index (0125 down), publishing a new BASE while a type
 *    checklist has an open operator draft is refused by the index (23505) — the rebase cannot be
 *    written; with 0125 up, the same publish rebases the type (a published v2 carrying
 *    `rebased_from_version_id`), retires its v1, and leaves the operator draft a draft;
 *  - the rebased version's content_hash RECOMPUTED FROM THE STORED ROWS equals the stored one;
 *  - AS callibrator_app (SET LOCAL ROLE): a second OPERATOR draft is still refused (23505);
 *  - the published document and its ETag read the real rows; a draft edit leaves the ETag alone;
 *  - schemaVerify: 0 problems.
 *
 *   docker run -d --name p2101-pg18 -e POSTGRES_PASSWORD=p2101pass \
 *     -p 127.0.0.1:55211:5432 pgvector/pgvector:pg18
 *   P2101_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55211 DB_NAME=p2101_scratch \
 *     DB_USER=postgres DB_PASS=p2101pass npm test -- src/tests/migrations/inspectionCatalogue.p2101.live --coverage=false
 *   docker rm -f p2101-pg18
 * (or `npm run test:live -- --only=p2101`)
 */
import { createHash } from "node:crypto";
import { canonicalTemplateVersion, type CanonicalTemplateItemInput } from "@callibrator/contracts/inspectionValues";
import { env } from "../../config/env";
import type * as DeviceTypeService from "../../services/deviceType.service";
import type * as DefinitionService from "../../services/inspectionItemDefinition.service";
import type * as TemplateService from "../../services/inspectionTemplate.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";

const live = env("P2101_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const BASE_TEMPLATE = "5eedca7a-0000-4000-8000-000000000001";
const SEED = { systemActor: "system:catalogue-seed" } as const;

type Row = Record<string, unknown>;
interface LiveTx {
  rollback(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[] }> };
  m0125: { up(o: { context: unknown }): Promise<void>; down(o: { context: unknown }): Promise<void> };
  types: typeof DeviceTypeService;
  definitions: typeof DefinitionService;
  templates: typeof TemplateService;
  tenantStorage: typeof TenantContext.tenantStorage;
}

/* eslint-disable @typescript-eslint/no-require-imports -- one module graph, loaded in isolation; typed by the members used */
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
      m0125: require("../../migrations/0125-catalogue-rebase-drafts") as Graph["m0125"],
      types: require("../../services/deviceType.service") as typeof DeviceTypeService,
      definitions: require("../../services/inspectionItemDefinition.service") as typeof DefinitionService,
      templates: require("../../services/inspectionTemplate.service") as typeof TemplateService,
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as typeof TenantContext).tenantStorage,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const rows = async (db: LiveDb, sql: string, replacements: object = {}): Promise<Row[]> => (await db.query(sql, { replacements }))[0];

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
    required: Boolean(r["required"]),
    sortOrder: Number(r["sort_order"]),
  }));

live("P21-01 — the catalogue services on PostgreSQL 18 (0111, 0112, 0125)", () => {
  let g: Graph;
  let typeTemplateId = "";
  let typeV1 = "";
  let operatorDraft = "";

  /** Run `work` as the platform operator's context (the hooks skip; the catalogue is global anyway). */
  const asOperator = <T>(work: () => Promise<T>): Promise<T> =>
    g.tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, work);

  let baseDraft = "";
  /** Publish the open base draft (a copy of the published base, opened once). */
  const publishBase = (note: string): Promise<TemplateService.PublishResult> =>
    asOperator(async () => {
      baseDraft ||= (await g.templates.createDraft({ templateId: BASE_TEMPLATE, copyFrom: "published" }, SEED)).id;
      return g.templates.publishVersion({ versionId: baseDraft, revision: 0, changeNote: note }, SEED);
    });

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("0125 is applied: the one-draft index leaves out a rebase version", async () => {
    const [index] = await rows(g.db, "SELECT indexdef FROM pg_indexes WHERE indexname = 'inspection_template_versions_one_draft'");
    expect(String(index?.["indexdef"])).toMatch(/WHERE \(\(status = 'draft'::.*\) AND \(rebased_from_version_id IS NULL\)\)/);
  });

  it("a type checklist v1 publishes through the triggers (items under a draft, one UPDATE, the base materialised)", async () => {
    await asOperator(async () => {
      const type = await g.types.createDeviceType({ name: "Live Test Device Type" }, SEED);
      const definition = await g.definitions.createItemDefinition(
        { content: { section: "function", label: "Live synthetic check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] } },
        SEED,
      );
      const template = await g.templates.createTemplate(type.id as never, SEED);
      typeTemplateId = template.id;
      const draft = await g.templates.createDraft({ templateId: template.id, copyFrom: "empty" }, SEED);
      await g.templates.replaceDraftItems({ versionId: draft.id, revision: 0, items: [{ itemDefinitionId: definition.id }] }, SEED);
      const result = await g.templates.publishVersion({ versionId: draft.id, revision: 1, changeNote: "Live v1" }, SEED);
      typeV1 = result.version.id;
      expect(result.version).toMatchObject({ status: "published", versionNumber: 1 });
      expect(result.version.items.filter((i) => i.origin === "base")).toHaveLength(15);
      operatorDraft = (await g.templates.createDraft({ templateId: template.id, copyFrom: "published" }, SEED)).id;
    });
  });

  it("FAIL-BEFORE: under 0112's index, a base publish cannot rebase a type with an open draft (23505)", async () => {
    await g.m0125.down({ context: g.db.getQueryInterface() });
    await expect(publishBase("Refused by the old index")).rejects.toMatchObject({ parent: { code: "23505" } });
    expect((await rows(g.db, "SELECT count(*)::int AS n FROM inspection_template_versions WHERE template_id = :t AND status = 'published'", { t: BASE_TEMPLATE }))[0]?.["n"]).toBe(1);
    await g.m0125.up({ context: g.db.getQueryInterface() });
  });

  it("with 0125: the base publish rebases the type (v2 published, v1 retired), the operator draft untouched, the hash from the rows", async () => {
    const result = await publishBase("Base v2, live");
    expect(result.version.versionNumber).toBe(2);
    expect(result.rebasedVersionIds).toHaveLength(1);
    const [rebased] = await rows(
      g.db,
      "SELECT id, status::text, version_number, base_version_id, rebased_from_version_id, content_hash, published_by_system FROM inspection_template_versions WHERE id = :id",
      { id: result.rebasedVersionIds[0] },
    );
    expect(rebased).toMatchObject({ status: "published", version_number: 2, base_version_id: result.version.id, rebased_from_version_id: typeV1, published_by_system: "system:catalogue-seed" });
    expect((await rows(g.db, "SELECT status::text AS s FROM inspection_template_versions WHERE id = :id", { id: typeV1 }))[0]?.["s"]).toBe("retired");
    expect((await rows(g.db, "SELECT status::text AS s, revision FROM inspection_template_versions WHERE id = :id", { id: operatorDraft }))[0]).toEqual({ s: "draft", revision: 0 });
    const [template] = await rows(g.db, "SELECT device_type_id FROM inspection_templates WHERE id = :id", { id: typeTemplateId });
    const recomputed = createHash("sha256")
      .update(
        canonicalTemplateVersion({
          templateId: typeTemplateId,
          deviceTypeId: String(template?.["device_type_id"]),
          versionNumber: 2,
          baseVersionId: result.version.id,
          items: await storedItems(g.db, String(rebased?.["id"])),
        }),
        "utf8",
      )
      .digest("hex");
    expect(rebased?.["content_hash"]).toBe(recomputed);
    expect((await rows(g.db, "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = :id AND action = 'APPROVE'", { id: rebased?.["id"] }))[0]?.["n"]).toBe(1);
  });

  it("as callibrator_app, a second OPERATOR draft is still refused by the index (23505)", async () => {
    const t = await g.db.transaction();
    try {
      await g.db.query("SET LOCAL ROLE callibrator_app", { transaction: t });
      await expect(
        g.db.query(
          "INSERT INTO inspection_template_versions (id, template_id, status, revision, created_at, updated_at) VALUES (gen_random_uuid(), :t, 'draft', 0, now(), now())",
          { transaction: t, replacements: { t: typeTemplateId } },
        ),
      ).rejects.toMatchObject({ parent: { code: "23505" } });
    } finally {
      await t.rollback();
    }
  });

  it("the published document reads the real rows; a draft edit leaves its ETag alone; the schema check is clean", async () => {
    const before = await asOperator(() => g.templates.publishedCatalogueEtag());
    const document = await asOperator(() => g.templates.publishedCatalogue());
    expect(document.versions.map((v) => v.versionNumber).sort()).toEqual([2, 2]);
    expect(document.deviceTypes.map((d) => d.name)).toEqual(["Live Test Device Type"]);
    await asOperator(() => g.templates.updateDraftNote({ versionId: operatorDraft, revision: 0, changeNote: "Still a draft" }, SEED));
    expect(await asOperator(() => g.templates.publishedCatalogueEtag())).toBe(before);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });
});
