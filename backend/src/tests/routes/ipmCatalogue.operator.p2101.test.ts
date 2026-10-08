/**
 * P21-01 — the global inspection catalogue through its REAL routers (spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 7, § 8, § 10, § 13; ADR-125 and Am. 1 – 3).
 *
 * REAL: deviceTypes.route and ipm.route with their gates (auth's principal from the fixture,
 * superAdminOnly, denyApiKey, dynamicAccess with the role matrix granted, validate from params /
 * query / body), the controller, the catalogue services, the audit service, the models and the
 * tenant + facility hooks over memoryDb. DOUBLED: redis.
 *
 * What it pins, row by row of § 7.1 – § 7.3: every 409 with its explanation; the draft's revision
 * (optimistic concurrency); publish materialises the base, retires the previous version, numbers
 * it, hashes the contract's canonical text, writes ONE APPROVE audit row; a base publish rebases
 * every published type checklist and leaves its open operator draft alone; a draft is a 404 to a
 * tenant user; the published document's strong ETag answers 304 and moves with a publish and a
 * type rename, not with a draft edit; a publish forced to fail AFTER its audit write leaves no audit
 * row and no version change (audit inside the transaction).
 */
import { createHash } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as TypesRoute from "../../routes/api/deviceTypes.route";
import type * as IpmRoute from "../../routes/api/ipm.route";
import type * as TemplateService from "../../services/inspectionTemplate.service";
import type * as Shared from "../../services/inspectionCatalogue.shared";
import type AuditServiceModule from "../../services/audit.service";
import type * as ModelsModule from "../../models";
import { canonicalTemplateVersion, type CanonicalTemplateItemInput } from "@callibrator/contracts/inspectionValues";
import { BASE_TEMPLATE, BASE_V1, DEF, seedCatalogue, seedType } from "../fixtures/catalogueSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const typesRouter = jest.requireActual<typeof TypesRoute>("../../routes/api/deviceTypes.route");
const ipmRouter = jest.requireActual<typeof IpmRoute>("../../routes/api/ipm.route");
const templateService = jest.requireActual<typeof TemplateService>("../../services/inspectionTemplate.service");
const shared = jest.requireActual<typeof Shared>("../../services/inspectionCatalogue.shared");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const TYPE_A = "a1a1a1a1-0000-4000-8000-000000000001";
const TYPE_B = "a1a1a1a1-0000-4000-8000-000000000002";
const TYPE_RETIRED = "a1a1a1a1-0000-4000-8000-000000000003";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let operator: Principal;
let tenantAdmin: Principal;
let technician: Principal;

interface Body {
  data?: Record<string, unknown> & { items?: Record<string, unknown>[] };
  meta?: Record<string, unknown>;
  message?: string;
}
interface Res {
  status: number;
  body: Body;
  headers: Record<string, unknown>;
}
const send = async (
  router: unknown,
  base: string,
  file: string,
  who: Principal,
  method: string,
  path: string,
  body: unknown = {},
  query: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Res> => {
  as(who);
  return (await call(router, method, path, { body, query, headers, baseUrl: base, routeFile: file })) as unknown as Res;
};
const types = (who: Principal, method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<Res> =>
  send(typesRouter, "/api/v1/device-types", "api/deviceTypes.route.ts", who, method, path, body, query);
const ipm = (
  who: Principal,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Res> => send(ipmRouter, "/api/v1/ipm", "api/ipm.route.ts", who, method, path, body, query, headers);

/** The audit rows that exist (a rolled-back write is undone in the table). */
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((r) => (r["changes"] as Record<string, unknown> | undefined)?.["operation"] === operation);

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  operator = fx.superAdmin;
  tenantAdmin = fx.principal(fx.tenantA, "TENANT_ADMIN");
  technician = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [operator, tenantAdmin, technician]);
  seedCatalogue(mdb);
  seedType(mdb, TYPE_A, "Test Device Type A");
  seedType(mdb, TYPE_B, "Test Device Type B");
  seedType(mdb, TYPE_RETIRED, "Test Device Type Retired", "retired");
});

/** A type checklist with a published v1 holding the leakage item, through the routes. */
const publishTypeV1 = async (typeId = TYPE_A): Promise<{ templateId: string; versionId: string }> => {
  const template = await ipm(operator, "POST", "/templates", { deviceTypeId: typeId });
  expect(template.status).toBe(201);
  const templateId = String(template.body.data?.["id"]);
  const draft = await ipm(operator, "POST", `/templates/${templateId}/versions`, { copyFrom: "published" });
  expect(draft.status).toBe(201);
  const versionId = String(draft.body.data?.["id"]);
  const saved = await ipm(operator, "PUT", `/template-versions/${versionId}/items`, { revision: 0, items: [{ itemDefinitionId: DEF.leakage }] });
  expect(saved.status).toBe(200);
  const published = await ipm(operator, "POST", `/template-versions/${versionId}/publish`, { revision: 1, changeNote: "First checklist" });
  expect(published.status).toBe(200);
  return { templateId, versionId };
};

describe("device types (§ 7.1)", () => {
  it("the operator creates, renames, retires and reactivates — each audited under the platform tenant", async () => {
    const created = await types(operator, "POST", "/", { name: "  Test   Infusion  Pump " });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "Test Infusion Pump", status: "active" });
    const id = String(created.body.data?.["id"]);
    expect((await types(operator, "PATCH", `/${id}`, { name: "Test Syringe Pump" })).body.data?.["name"]).toBe("Test Syringe Pump");
    expect((await types(operator, "POST", `/${id}/retire`)).body.data?.["status"]).toBe("retired");
    expect((await types(operator, "POST", `/${id}/reactivate`)).body.data?.["status"]).toBe("active");
    for (const op of ["CREATE_DEVICE_TYPE", "RENAME_DEVICE_TYPE", "RETIRE_DEVICE_TYPE", "REACTIVATE_DEVICE_TYPE"]) {
      expect(audits(op)).toEqual([expect.objectContaining({ tenantId: "00000000-0000-4000-8000-000000000001", resourceType: "DeviceType", resourceId: id })]);
    }
  });

  it("each 409 explains the state", async () => {
    expect((await types(operator, "POST", "/", { name: "test device type a" })).body.message).toBe('A device type named "Test Device Type A" already exists.');
    expect((await types(operator, "POST", "/", { name: "TEST DEVICE TYPE RETIRED" })).body.message).toMatch(/status: retired — reactivate it instead/);
    expect((await types(operator, "PATCH", `/${TYPE_A}`, { name: "Test Device Type B" })).status).toBe(409);
    expect((await types(operator, "PATCH", `/${TYPE_RETIRED}`, { name: "Renamed" })).body.message).toMatch(/retired; reactivate it before renaming/);
    expect((await types(operator, "POST", `/${TYPE_RETIRED}/retire`)).body.message).toBe("This device type is already retired.");
    expect((await types(operator, "POST", `/${TYPE_A}/reactivate`)).body.message).toBe("This device type is active.");
    expect((await types(operator, "POST", `/${MISSING}/retire`)).status).toBe(404);
  });

  it("a unique-index race after the pre-check is the same 409; any other failure passes through", async () => {
    const spy = jest.spyOn(models.DeviceType, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    expect((await types(operator, "POST", "/", { name: "Raced Type" })).status).toBe(409);
    spy.mockRejectedValueOnce(new Error("boom"));
    expect((await types(operator, "POST", "/", { name: "Broken Type" })).status).toBe(500);
    spy.mockRestore();
  });

  it("any catalogue reader lists and reads types; only the operator writes (403 for a tenant administrator)", async () => {
    const list = await types(technician, "GET", "/", undefined, { status: "all", search: "type", page: 1, limit: 2 });
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
    expect((await types(technician, "GET", "/", undefined, {})).body.meta?.["total"]).toBe(2);
    expect((await types(technician, "GET", "/", undefined, { status: "retired" })).body.meta?.["total"]).toBe(1);
    expect((await types(technician, "GET", `/${TYPE_RETIRED}`)).body.data).toEqual({ id: TYPE_RETIRED, name: "Test Device Type Retired", status: "retired" });
    expect((await types(technician, "GET", `/${MISSING}`)).status).toBe(404);
    expect((await types(tenantAdmin, "POST", "/", { name: "Not Allowed" })).status).toBe(403);
    expect((await types(tenantAdmin, "POST", `/${TYPE_A}/retire`)).status).toBe(403);
  });
});

describe("the item library (operator)", () => {
  const leak = { section: "electrical_safety", label: "Synthetic patient leakage", inputKind: "measured_with_limit", unit: "uA", limitText: "≤ 0,5 µA", allowedOutcomes: ["pass", "fail"] };

  it("a limit is parsed from its text; the unit normalised; notes stay the operator's", async () => {
    const created = await ipm(operator, "POST", "/item-definitions", { content: leak, notes: "operator only", defaultRequired: false });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ unit: "µA", limitOp: "lte", limitValue: "0.5", limitText: "≤ 0,5 µA", defaultRequired: false, notes: "operator only" });
    const id = String(created.body.data?.["id"]);
    expect(audits("CREATE_ITEM_DEFINITION")[0]?.["changes"]).toMatchObject({ after: { notesLength: 13 } });
    expect(JSON.stringify(audits("CREATE_ITEM_DEFINITION"))).not.toContain("operator only");
    const changed = await ipm(operator, "PATCH", `/item-definitions/${id}`, { content: { ...leak, limitText: "< 1 µA" } });
    expect(changed.body.data).toMatchObject({ limitOp: "lt", limitValue: "1" });
    expect((await ipm(operator, "PATCH", `/item-definitions/${id}`, { notes: null, defaultRequired: true })).body.data).toMatchObject({ notes: null, defaultRequired: true });
    expect((await ipm(operator, "PATCH", `/item-definitions/${id}`, { content: { section: "function", label: "x", inputKind: "tri_state", allowedOutcomes: ["pass"] } })).status).toBe(400);
    expect((await ipm(operator, "POST", `/item-definitions/${id}/retire`)).body.data?.["status"]).toBe("retired");
    expect((await ipm(operator, "POST", `/item-definitions/${id}/retire`)).body.message).toBe("This item definition is already retired.");
    expect((await ipm(operator, "PATCH", `/item-definitions/${id}`, { notes: "x" })).status).toBe(409);
    expect((await ipm(operator, "GET", `/item-definitions/${id}`)).body.data?.["status"]).toBe("retired");
    expect((await ipm(operator, "GET", `/item-definitions/${MISSING}`)).status).toBe(404);
  });

  it("defaults: required by default, no notes; an edit of a definition without notes", async () => {
    const created = await ipm(operator, "POST", "/item-definitions", { content: { section: "function", label: "Synthetic default", inputKind: "tri_state", allowedOutcomes: ["pass"] } });
    expect(created.body.data).toMatchObject({ defaultRequired: true, notes: null });
    const edited = await ipm(operator, "PATCH", `/item-definitions/${String(created.body.data?.["id"])}`, { defaultRequired: false });
    expect(edited.body.data).toMatchObject({ defaultRequired: false });
    expect(audits("UPDATE_ITEM_DEFINITION")[0]?.["changes"]).toMatchObject({ before: { notesLength: 0 } });
  });

  it("refuses a limit in another unit than its item (400 before the service)", async () => {
    const res = await ipm(operator, "POST", "/item-definitions", { content: { ...leak, limitText: "≤ 1 mA" } });
    expect(res.status).toBe(400);
  });

  it("lists by section, kind, status and label", async () => {
    expect((await ipm(operator, "GET", "/item-definitions", undefined, {})).body.meta?.["total"]).toBe(7);
    expect((await ipm(operator, "GET", "/item-definitions", undefined, { status: "all" })).body.meta?.["total"]).toBe(8);
    expect((await ipm(operator, "GET", "/item-definitions", undefined, { section: "function", status: "retired" })).body.meta?.["total"]).toBe(1);
    expect((await ipm(operator, "GET", "/item-definitions", undefined, { inputKind: "measured", search: "temperature" })).body.meta?.["total"]).toBe(1);
    expect((await ipm(tenantAdmin, "GET", "/item-definitions")).status).toBe(403);
  });
});

describe("templates and drafts (§ 7.1, § 7.2)", () => {
  it("a type checklist: create, open a draft, save items at a revision, note, publish — the base materialised, hashed, audited", async () => {
    const template = await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_A });
    expect(template.body.data).toMatchObject({ deviceTypeId: TYPE_A, deviceTypeName: "Test Device Type A", publishedVersion: null, openDraft: null });
    const templateId = String(template.body.data?.["id"]);
    expect((await ipm(operator, "GET", "/templates", undefined, { deviceTypeId: TYPE_A })).body.data).toEqual([
      expect.objectContaining({ id: templateId, publishedVersion: null, openDraft: null }),
    ]);
    const draft = await ipm(operator, "POST", `/templates/${templateId}/versions`, {});
    expect((await ipm(operator, "GET", "/templates", undefined, { hasDraft: "true" })).body.data).toEqual([
      expect.objectContaining({ id: templateId, openDraft: expect.objectContaining({ revision: 0 }) as unknown }),
    ]);
    expect(draft.body.data).toMatchObject({ status: "draft", revision: 0, items: [] });
    const versionId = String(draft.body.data?.["id"]);
    expect((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).body.message).toMatch(/already has an open draft, created on \d{4}-\d{2}-\d{2} — edit or discard it\./);

    const items = [{ itemDefinitionId: DEF.power, required: false }, { itemDefinitionId: DEF.extraFunction }, { itemDefinitionId: DEF.extraSafety }, { itemDefinitionId: DEF.leakage, content: { section: "electrical_safety", label: "Leakage, type-specific", inputKind: "measured_with_limit", unit: "µA", limitText: "≤ 50 µA", allowedOutcomes: ["pass", "fail", "not_applicable"] } }];
    const saved = await ipm(operator, "PUT", `/template-versions/${versionId}/items`, { revision: 0, items });
    expect(saved.status).toBe(200);
    expect(saved.body.data?.["revision"]).toBe(1);
    expect(saved.body.data?.items?.map((i) => [i["label"], i["required"], i["limitValue"]])).toEqual([
      ["Synthetic cable check", true, null],
      ["Leakage, type-specific", true, "50"],
      ["Synthetic power-on check", false, null],
      ["Synthetic second function check", true, null],
    ]);
    expect((await ipm(operator, "PUT", `/template-versions/${versionId}/items`, { revision: 0, items })).body.message).toMatch(/\(revision 1\); reload it before saving\./);
    expect((await ipm(operator, "PATCH", `/template-versions/${versionId}`, { revision: 1, changeNote: "A note" })).body.data?.["revision"]).toBe(2);

    const published = await ipm(operator, "POST", `/template-versions/${versionId}/publish`, { revision: 2, changeNote: "First type checklist" });
    expect(published.status).toBe(200);
    const version = published.body.data?.["version"] as Record<string, unknown> & { items: CanonicalTemplateItemInput[] };
    expect(version).toMatchObject({ status: "published", versionNumber: 1, baseVersionId: BASE_V1, changeNote: "First type checklist" });
    expect(version.items.map((i) => [i.section, i.origin])).toEqual([
      ["environment", "base"],
      ["other_safety", "base"],
      ["other_safety", "type"],
      ["electrical_safety", "type"],
      ["function", "type"],
      ["function", "type"],
    ]);
    const expected = createHash("sha256")
      .update(canonicalTemplateVersion({ templateId, deviceTypeId: TYPE_A, versionNumber: 1, baseVersionId: BASE_V1, items: version.items }), "utf8")
      .digest("hex");
    expect(version["contentHash"]).toBe(expected);
    expect(published.body.data?.["retiredVersionId"]).toBeNull();
    expect(audits("PUBLISH_TEMPLATE_VERSION")).toEqual([
      expect.objectContaining({ action: "APPROVE", resourceId: versionId, changes: expect.objectContaining({ contentHash: expected, versionNumber: 1 }) as unknown }),
    ]);
    for (const op of ["CREATE_TEMPLATE", "CREATE_DRAFT", "EDIT_DRAFT_ITEMS", "EDIT_DRAFT_NOTE"]) {
      expect(audits(op)).toHaveLength(1);
    }

    // A published version never changes: the service's 409 names it.
    expect((await ipm(operator, "PUT", `/template-versions/${versionId}/items`, { revision: 2, items: [] })).body.message).toMatch(
      /^Version 1 of the checklist for "Test Device Type A" was published on \d{4}-\d{2}-\d{2} and cannot be changed — create a new draft\.$/,
    );
    expect((await ipm(operator, "POST", `/template-versions/${versionId}/publish`, { revision: 2, changeNote: "again" })).body.message).toBe(
      "Only a draft can be published; this version is published.",
    );
    expect((await ipm(operator, "POST", `/template-versions/${versionId}/discard`)).body.message).toBe("Only a draft can be discarded; this version is published.");

    // A second draft copies the published version's OWN (type) items, not the base's; v2 retires v1.
    const second = await ipm(operator, "POST", `/templates/${templateId}/versions`, { copyFrom: "published" });
    expect(second.body.data?.items?.map((i) => i["origin"])).toEqual(["type", "type", "type", "type"]);
    const v2 = await ipm(operator, "POST", `/template-versions/${String(second.body.data?.["id"])}/publish`, { revision: 0, changeNote: "Second" });
    expect(v2.body.data).toMatchObject({ retiredVersionId: versionId, version: { versionNumber: 2 } });
    expect((await ipm(operator, "GET", "/templates", undefined, { deviceTypeId: TYPE_A })).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ publishedVersion: expect.objectContaining({ versionNumber: 2 }) as unknown })]),
    );
  });

  it("refuses what cannot be published or saved (400) with each reason", async () => {
    const { templateId } = await publishTypeV1();
    const draftId = String((await ipm(operator, "POST", `/templates/${templateId}/versions`, { copyFrom: "empty" })).body.data?.["id"]);
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 0, changeNote: "Empty" })).body.message).toBe("A checklist version needs at least one item.");
    const put = (items: unknown[]): Promise<Res> => ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 0, items });
    expect((await put([{ itemDefinitionId: MISSING }])).body.message).toBe("Item 1: unknown item definition.");
    expect((await put([{ itemDefinitionId: DEF.retired }])).body.message).toMatch(/is retired; it cannot be added to a draft/);
    expect((await put([{ itemDefinitionId: DEF.power, content: { section: "completeness", label: "x", inputKind: "tri_state", allowedOutcomes: ["pass"] } }])).body.message).toBe(
      "Item 1: an item keeps its definition's section and input kind.",
    );
    expect((await put([{ itemDefinitionId: DEF.power }, { itemDefinitionId: DEF.power }])).status).toBe(400);
    expect((await put([{ itemDefinitionId: DEF.temperature }])).status).toBe(200);
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 1, changeNote: "Twice" })).body.message).toBe(
      '"Synthetic room temperature" is already in the base checklist; remove it from this one.',
    );
    expect((await ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 1, items: [{ itemDefinitionId: DEF.power }] })).status).toBe(200);
    // An item the contract would refuse, planted in the draft: publish checks every item again.
    mdb.seed("InspectionTemplateItem", {
      id: "bad00000-0000-4000-8000-000000000001",
      versionId: draftId,
      itemDefinitionId: DEF.pressure,
      origin: "type",
      section: "performance",
      label: "Planted",
      inputKind: "setting_measured_reference",
      unit: "kPa",
      limitOp: "plus_minus",
      limitTolerance: "3",
      limitText: "± 3 mmHg",
      allowedOutcomes: ["pass", "fail"],
      required: true,
      sortOrder: 0,
    });
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 2, changeNote: "Bad" })).body.message).toBe(
      '"Planted": the limit is in mmHg but the item records kPa.',
    );
  });

  it("refuses more than 60 items of one section", async () => {
    const draftTemplate = await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_B });
    const draftId = String((await ipm(operator, "POST", `/templates/${String(draftTemplate.body.data?.["id"])}/versions`, {})).body.data?.["id"]);
    const ids = Array.from({ length: 61 }, (_v, n) => `f0f00000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    mdb.seed(
      "InspectionItemDefinition",
      ids.map((id) => ({ id, section: "function", label: `Synthetic check ${id}`, inputKind: "tri_state", allowedOutcomes: ["pass", "fail"], status: "active", defaultRequired: true })),
    );
    const res = await ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 0, items: ids.map((itemDefinitionId) => ({ itemDefinitionId })) });
    expect(res.body.message).toBe("At most 60 items in the function section.");
  });

  it("templates: one per active type; retiring retires its version; the base is never retired", async () => {
    const { templateId, versionId } = await publishTypeV1();
    expect((await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_A })).body.message).toBe('A checklist for "Test Device Type A" already exists.');
    expect((await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_RETIRED })).status).toBe(409);
    expect((await ipm(operator, "POST", "/templates", { deviceTypeId: MISSING })).status).toBe(404);
    const draftId = String((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).body.data?.["id"]);
    const retired = await ipm(operator, "POST", `/templates/${templateId}/retire`);
    expect(retired.body.data).toEqual({ id: templateId, status: "retired", retiredVersionId: versionId });
    expect((await ipm(operator, "POST", `/templates/${templateId}/retire`)).body.message).toBe('The checklist for "Test Device Type A" is already retired.');
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 0, changeNote: "Nope" })).body.message).toBe(
      'The checklist for "Test Device Type A" is retired; reactivate it first.',
    );
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/discard`)).body.data?.["status"]).toBe("discarded");
    expect((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).status).toBe(409);
    expect((await ipm(operator, "POST", `/templates/${templateId}/reactivate`)).body.data).toEqual({ id: templateId, status: "active", retiredVersionId: null });
    expect((await ipm(operator, "POST", `/templates/${templateId}/reactivate`)).body.message).toBe('The checklist for "Test Device Type A" is active.');
    expect((await ipm(operator, "POST", `/templates/${BASE_TEMPLATE}/retire`)).body.message).toMatch(/^The base checklist is never retired/);
    const unpublished = String((await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_B })).body.data?.["id"]);
    expect((await ipm(operator, "POST", `/templates/${unpublished}/retire`)).body.data).toEqual({ id: unpublished, status: "retired", retiredVersionId: null });
    expect((await ipm(operator, "POST", `/templates/${MISSING}/retire`)).status).toBe(404);
    expect((await ipm(operator, "PATCH", `/template-versions/${draftId}`, { revision: 0, changeNote: "late" })).body.message).toMatch(/^This draft was discarded on/);
    const hasDraft = await ipm(operator, "GET", "/templates", undefined, { hasDraft: "true" });
    expect(hasDraft.body.meta?.["total"]).toBe(0);
    expect((await ipm(operator, "GET", "/templates", undefined, { hasDraft: "false", status: "active" })).body.meta?.["total"]).toBe(2);
    expect((await ipm(operator, "GET", "/templates", undefined, { status: "retired" })).body.meta?.["total"]).toBe(1);
  });

  it("versions: a draft is the operator's (404 to a tenant user); a retired one stays readable; the history lists every status", async () => {
    const { templateId, versionId } = await publishTypeV1();
    const draftId = String((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).body.data?.["id"]);
    await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 0, changeNote: "Two" });
    const third = String((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).body.data?.["id"]);
    expect((await ipm(technician, "GET", `/template-versions/${third}`)).status).toBe(404);
    expect((await ipm(technician, "GET", `/template-versions/${MISSING}`)).body).toEqual((await ipm(technician, "GET", `/template-versions/${third}`)).body);
    expect((await ipm(operator, "GET", `/template-versions/${third}`)).body.data?.["status"]).toBe("draft");
    const old = await ipm(technician, "GET", `/template-versions/${versionId}`);
    expect(old.body.data).toMatchObject({ status: "retired", deviceTypeId: TYPE_A });
    expect(JSON.stringify(old.body)).not.toMatch(/publishedBy|createdBy|retiredBy/);
    expect((await ipm(technician, "GET", `/template-versions/${BASE_V1}`)).body.data?.["deviceTypeId"]).toBeNull();
    const history = await ipm(operator, "GET", "/template-versions", undefined, { templateId });
    expect(history.body.meta?.["total"]).toBe(3);
    expect((await ipm(operator, "GET", "/template-versions", undefined, { templateId, status: "retired" })).body.meta?.["total"]).toBe(1);
    expect((await ipm(operator, "GET", "/template-versions", undefined, { templateId: MISSING })).status).toBe(404);
    expect((await ipm(operator, "POST", `/template-versions/${MISSING}/discard`)).status).toBe(404);
  });
});

describe("publishing the base rebases every published type checklist (§ 7.3)", () => {
  it("a new type version per typed template, the old one retired; the operator's open draft untouched", async () => {
    const a = await publishTypeV1(TYPE_A);
    await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_B });
    const openDraft = String((await ipm(operator, "POST", `/templates/${a.templateId}/versions`, {})).body.data?.["id"]);
    const baseDraft = await ipm(operator, "POST", `/templates/${BASE_TEMPLATE}/versions`, { copyFrom: "published" });
    expect(baseDraft.body.data?.items?.map((i) => i["origin"])).toEqual(["base", "base"]);
    const baseDraftId = String(baseDraft.body.data?.["id"]);
    await ipm(operator, "PUT", `/template-versions/${baseDraftId}/items`, { revision: 0, items: [{ itemDefinitionId: DEF.temperature }] });
    const published = await ipm(operator, "POST", `/template-versions/${baseDraftId}/publish`, { revision: 1, changeNote: "Base two" });
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ retiredVersionId: BASE_V1, version: { versionNumber: 2, baseVersionId: null } });
    const rebased = published.body.data?.["rebasedVersionIds"] as string[];
    expect(rebased).toHaveLength(1);
    const typeV2 = (await ipm(technician, "GET", `/template-versions/${String(rebased[0])}`)).body.data;
    expect(typeV2).toMatchObject({ status: "published", versionNumber: 2, baseVersionId: baseDraftId, rebasedFromVersionId: a.versionId, changeNote: "Rebased onto base version 2" });
    expect(typeV2?.items?.map((i) => [i["origin"], i["label"]])).toEqual([
      ["base", "Synthetic room temperature"],
      ["type", "Synthetic leakage check"],
    ]);
    expect((await ipm(technician, "GET", `/template-versions/${a.versionId}`)).body.data?.["status"]).toBe("retired");
    expect((await ipm(operator, "GET", `/template-versions/${openDraft}`)).body.data).toMatchObject({ status: "draft", revision: 0 });
    expect(audits("REBASE_TEMPLATE_VERSION")).toEqual([expect.objectContaining({ resourceId: rebased[0] })]);
  });

  it("a type checklist cannot publish while the base has no published version", async () => {
    const template = await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_A });
    const draftId = String((await ipm(operator, "POST", `/templates/${String(template.body.data?.["id"])}/versions`, {})).body.data?.["id"]);
    await ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 0, items: [{ itemDefinitionId: DEF.power }] });
    await models.InspectionTemplateVersion.update({ status: "retired", retiredAt: new Date() }, { where: { id: BASE_V1 } });
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 1, changeNote: "No base" })).body.message).toBe(
      "The base checklist has no published version; publish the base first.",
    );
    await models.InspectionTemplate.update({ deviceTypeId: TYPE_B as never }, { where: { id: BASE_TEMPLATE } });
    expect((await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 1, changeNote: "No base" })).status).toBe(409);
  });
});

describe("the published catalogue document (§ 8.3)", () => {
  it("strong ETag; If-None-Match → 304 with no body; a publish and a rename move it, a draft edit does not", async () => {
    const first = await ipm(technician, "GET", "/templates/published");
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.body.data).toMatchObject({ schema: "inspection-catalogue-v1", deviceTypes: [{ id: TYPE_A, name: "Test Device Type A" }, { id: TYPE_B, name: "Test Device Type B" }] });
    expect(JSON.stringify(first.body)).not.toMatch(/notes|publishedBy|createdBy/);
    const notModified = await ipm(technician, "GET", "/templates/published", undefined, {}, { "If-None-Match": `"other", ${etag}` });
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeNull();

    const { templateId } = await publishTypeV1();
    const afterPublish = await ipm(technician, "GET", "/templates/published");
    expect(afterPublish.headers["etag"]).not.toBe(etag);
    const versions = (afterPublish.body.data?.["versions"] ?? []) as { deviceTypeId: string | null; items: unknown[] }[];
    expect(versions.map((v) => [v.deviceTypeId, v.items.length]).sort()).toEqual([[TYPE_A, 3], [null, 2]].sort());

    const draftId = String((await ipm(operator, "POST", `/templates/${templateId}/versions`, {})).body.data?.["id"]);
    await ipm(operator, "PATCH", `/template-versions/${draftId}`, { revision: 0, changeNote: "Draft only" });
    expect((await ipm(technician, "GET", "/templates/published")).headers["etag"]).toBe(afterPublish.headers["etag"]);
    await types(operator, "PATCH", `/${TYPE_B}`, { name: "Test Device Type B2" });
    expect((await ipm(technician, "GET", "/templates/published")).headers["etag"]).not.toBe(afterPublish.headers["etag"]);
  });
});

describe("audit inside the transaction; the service paths no route takes", () => {
  it("a publish forced to fail AFTER its audit write leaves no audit row and no version change", async () => {
    const template = await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_A });
    const draftId = String((await ipm(operator, "POST", `/templates/${String(template.body.data?.["id"])}/versions`, {})).body.data?.["id"]);
    await ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 0, items: [{ itemDefinitionId: DEF.power }] });
    const real = auditService.logAction.bind(auditService);
    const spy = jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      const row = await real(entry, options);
      throw new Error(`failed after ${row ? "the" : "no"} audit write`);
    });
    const res = await ipm(operator, "POST", `/template-versions/${draftId}/publish`, { revision: 1, changeNote: "Doomed" });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(audits("PUBLISH_TEMPLATE_VERSION")).toEqual([]);
    const after = (await ipm(operator, "GET", `/template-versions/${draftId}`)).body.data;
    expect(after).toMatchObject({ status: "draft", revision: 1 });
    expect(after?.["versionNumber"] ?? null).toBeNull();
  });

  it("a system actor (the ETL's) publishes as `published_by_system`", async () => {
    as(operator);
    const template = await ipm(operator, "POST", "/templates", { deviceTypeId: TYPE_A });
    const draftId = String((await ipm(operator, "POST", `/templates/${String(template.body.data?.["id"])}/versions`, {})).body.data?.["id"]);
    await ipm(operator, "PUT", `/template-versions/${draftId}/items`, { revision: 0, items: [{ itemDefinitionId: DEF.power }] });
    const result = await templateService.publishVersion(
      { versionId: draftId, revision: 1, changeNote: "Imported" },
      { systemActor: "system:catalogue-seed" },
    );
    expect(result.version.status).toBe("published");
    const row = await models.InspectionTemplateVersion.findOne({ where: { id: draftId } });
    expect(row?.publishedBySystem).toBe("system:catalogue-seed");
    expect(row?.publishedBy ?? null).toBeNull();
    expect(shared.conflictOr(new Error("x"), "m")).toEqual(new Error("x"));
  });
});
