/**
 * P21-03a — the IPM session aggregate's draft life, row by row of spec P19-02 § 7.1 / § 7.2 (each
 * 409 asserting its top-level `code` AND its explanation), § 9.3 (`clientRef`), § 9.4 (results
 * against the pinned version), § 10.2 (the reads) and § 14 (the audit rows, inside the write).
 *
 * REAL: the router's chain, the controller, ipmSession.service, the models and the tenant + facility
 * hooks over memoryDb. Synthetic data only (fixtures/ipmSeed).
 */
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as Service from "../../services/ipmSession.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type ModelsModule from "../../models";
import { BASE_VERSION, IPM, seedIpmWorld, submittedSession, type IpmWorld } from "../fixtures/ipmSeed";
import { DEF } from "../fixtures/catalogueSeed";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const service = jest.requireActual<typeof Service>("../../services/ipmSession.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const D3 = "d1000000-0000-4000-8000-0000000000f3";
const VOIDED = "5e550000-0000-4000-8000-0000000002f1";
const DISCARDED = "5e550000-0000-4000-8000-0000000003f1";
const IMPORTED = "5e550000-0000-4000-8000-0000000004f1";
const HEAD = "5e550000-0000-4000-8000-0000000005f1";

interface Body {
  data?: Record<string, unknown> | Record<string, unknown>[] | null;
  meta?: Record<string, unknown>;
  message?: string;
  code?: string;
  draftId?: string;
  headId?: string;
}
interface Res { status: number; body: Body }

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<Res> => {
  as(principal);
  return call(sessions, method, url, { body, query, routeFile: "api/ipmSessions.route.ts" }) as Promise<Res>;
};
const data = (res: Res): Record<string, unknown> => res.body.data as Record<string, unknown>;
const rows = (res: Res): Record<string, unknown>[] => res.body.data as Record<string, unknown>[];
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["operation"] === operation);
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const table = (mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown }).rowsOf(
    (mdb as unknown as { model: (n: string) => unknown }).model(model),
  );
  Object.assign(table.find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const expectConflict = (res: Res, code: string, message: string | RegExp): void => {
  expect(res.status).toBe(409);
  expect(res.body.code).toBe(code);
  if (typeof message === "string") {
    expect(res.body.message).toBe(message);
  } else {
    expect(res.body.message).toMatch(message);
  }
};

// ------------------------------------------------------------------
// CREATE (§ 7.1)
// ------------------------------------------------------------------

describe("POST /ipm/sessions — a root draft", () => {
  it("pins the device type's published version, stamps the context, answers the prefill and writes one audit row", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, performedAt: "2026-10-08T01:00:00Z" });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("IPM draft created");
    expect(data(res)).toMatchObject({
      deviceId: IPM.D1,
      clientFacilityId: IPM.F1,
      templateVersionId: IPM.TYPE_V1,
      templateVersionNumber: 2,
      templateContentHash: "b".repeat(64),
      status: "draft",
      effective: false,
      revision: 0,
      createdBy: world.staff.id,
      performedBy: world.staff.id,
      capturedOffline: false,
      results: [],
      notices: [],
      device: { id: IPM.D1, qrCode: "TST000001", deviceTypeId: IPM.TYPE },
    });
    expect(data(res)).not.toHaveProperty("legacyKey");
    expect(data(res)["performerDisplay"]).toMatchObject({ redacted: false });
    const [row] = audits("CREATE_IPM_DRAFT");
    expect(row).toMatchObject({ action: "CREATE", resourceType: "InspectionSession", clientFacilityId: IPM.F1 });
    expect(row?.["changes"]).toEqual({ operation: "CREATE_IPM_DRAFT", deviceId: IPM.D1, templateVersionId: IPM.TYPE_V1, capturedOffline: false, clientRef: false });
  });

  it("a device without a type pins the base checklist", async () => {
    mdb.seed("CalibrationDevice", { id: D3, tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat sintetis 3", status: "maintenance", isDeleted: false });
    const res = await send(world.staff, "POST", "/", { deviceId: D3 });
    expect([res.status, data(res)["templateVersionId"]]).toEqual([201, BASE_VERSION]);
  });

  it("no published checklist → 409 IPM_NO_CHECKLIST", async () => {
    await models.InspectionTemplate.update({ status: "retired" }, { where: { status: "active" } });
    expectConflict(await send(world.staff, "POST", "/", { deviceId: IPM.D1 }), "IPM_NO_CHECKLIST", "No checklist is published for this device type; an IPM cannot be started.");
  });

  it.each([
    ["retired", "IPM_DEVICE_RETIRED", "This device was retired; an IPM cannot be started. A tenant administrator can reinstate it."],
    ["inactive", "IPM_DEVICE_INACTIVE", "This device is inactive; activate it before an IPM."],
  ])("a %s device → 409 %s", async (status, code, message) => {
    setRow("CalibrationDevice", IPM.D1, { status });
    expectConflict(await send(world.staff, "POST", "/", { deviceId: IPM.D1 }), code, message);
  });

  it("an ended facility → 409 IPM_FACILITY_ENDED, naming it", async () => {
    setRow("ClientFacility", IPM.F1, { status: "ended", statusReason: "Contract ended" });
    expectConflict(await send(world.staff, "POST", "/", { deviceId: IPM.D1 }), "IPM_FACILITY_ENDED", "Facility One has ended; new records cannot be added. Reinstate it first.");
  });

  it("the caller's open root draft for the device → 409 IPM_DRAFT_EXISTS with its own draftId", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D2 });
    expectConflict(res, "IPM_DRAFT_EXISTS", /^You already have an IPM draft for this device, started \d{4}-\d{2}-\d{2} — resume or discard it\.$/);
    expect(res.body.draftId).toBe(IPM.DRAFT2);
  });

  it("another technician's draft of the device does not block the caller (one per technician, G-S9)", async () => {
    const res = await send(world.bound2, "POST", "/", { deviceId: IPM.D1 });
    expect(res.status).toBe(201);
  });

  it.each([
    ["a draft version", IPM.TYPE_DRAFT],
    ["no version", MISSING],
  ])("%s named → 400 Unknown checklist version.", async (_label, versionId) => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: versionId });
    expect([res.status, res.body.message]).toEqual([400, "Unknown checklist version."]);
  });

  it("a retired version online → 409 IPM_VERSION_RETIRED naming its replacement; offline it is accepted with a notice", async () => {
    expectConflict(
      await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: IPM.TYPE_V0 }),
      "IPM_VERSION_RETIRED",
      "This checklist was replaced by version 2 on 2026-10-02; reload to start with it.",
    );
    const offline = await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: IPM.TYPE_V0, capturedOffline: true });
    expect([offline.status, data(offline)["templateVersionId"], data(offline)["capturedOffline"]]).toEqual([201, IPM.TYPE_V0, true]);
    expect(data(offline)["notices"]).toEqual(["This IPM uses a checklist that is not the device's current one (captured offline)."]);
  });

  it("a retired version with no current one names 'a newer version'", async () => {
    await models.InspectionTemplate.update({ status: "retired" }, { where: { status: "active" } });
    expectConflict(
      await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: IPM.TYPE_V0 }),
      "IPM_VERSION_RETIRED",
      "This checklist was replaced by a newer version on 2026-10-02; reload to start with it.",
    );
  });

  it("a published version that is not the device's current one → 409 IPM_VERSION_STALE online, accepted offline", async () => {
    expectConflict(await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: BASE_VERSION }), "IPM_VERSION_STALE", "The checklist for this device type changed; reload.");
    const offline = await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: BASE_VERSION, capturedOffline: true });
    expect([offline.status, data(offline)["templateVersionId"]]).toEqual([201, BASE_VERSION]);
  });

  it("the current version named is accepted with no notice", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, templateVersionId: IPM.TYPE_V1 });
    expect([res.status, data(res)["notices"]]).toEqual([201, []]);
  });

  it("a date more than five minutes ahead → 400, nothing written", async () => {
    const before = mdb.committed().length;
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, performedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    expect([res.status, res.body.message]).toEqual([400, "The inspection cannot be dated in the future."]);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("a server-owned field in the body is refused by the strict contract (FT-91)", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, tenantId: world.tenantB, createdBy: world.other.id, status: "submitted" });
    expect(res.status).toBe(400);
  });

  it("clientRef: the caller's own capture is answered 200 with the same session (AM-16)", async () => {
    const ref = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
    const first = await send(world.staff, "POST", "/", { deviceId: IPM.D1, clientRef: ref, capturedOffline: true, clientCapturedAt: "2026-10-09T00:00:00Z" });
    const again = await send(world.staff, "POST", "/", { deviceId: IPM.D1, clientRef: ref });
    expect([first.status, again.status, again.body.message]).toEqual([201, 200, "IPM draft created (already recorded)"]);
    expect(data(again)["id"]).toBe(data(first)["id"]);
    expect(audits("CREATE_IPM_DRAFT")).toHaveLength(1);
    expect(audits("CREATE_IPM_DRAFT")[0]?.["changes"]).toMatchObject({ clientRef: true, capturedOffline: true });
  });

  it("clientRef reused where the caller cannot see the session → 409 IPM_CLIENT_REF_REUSED (the unique index answers)", async () => {
    jest.spyOn(models.InspectionSession, "create").mockRejectedValueOnce(
      new UniqueConstraintError({ message: "dup", fields: { client_ref: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0b" } }),
    );
    expectConflict(
      await send(world.staff, "POST", "/", { deviceId: IPM.D1, clientRef: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0b" }),
      "IPM_CLIENT_REF_REUSED",
      "This capture reference was already used.",
    );
  });

  it("another unique violation is not mistaken for a reused reference", async () => {
    jest.spyOn(models.InspectionSession, "create").mockRejectedValueOnce(new UniqueConstraintError({ message: "dup", fields: { visit_number: 1 } }));
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect([res.status, res.body.code]).toEqual([500, undefined]);
  });

  it("an actor without a person (an API key reaching the service) is refused 403", async () => {
    await expect(service.createSession(world.tenantA as TenantId, { deviceId: IPM.D1 }, { userId: null, tenantAdmin: false })).rejects.toMatchObject({
      status: 403,
      message: "An IPM is recorded by a person, not by an API key.",
    });
  });

  it("an API key is refused at the route (G-S8)", async () => {
    const res = await send({ ...world.staff, isApiKey: true }, "POST", "/", { deviceId: IPM.D1 });
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------------
// HEADER (§ 7.2)
// ------------------------------------------------------------------

describe("PATCH /ipm/sessions/:sessionId — a draft's header", () => {
  it("saves the given fields, bumps the revision and audits the field names (never the text)", async () => {
    const res = await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, {
      revision: 0,
      notes: "Synthetic note",
      recommendation: "needs_repair",
      inspectionOutcome: "fail",
      maintenanceOutcome: "pass",
      locationId: IPM.ROOM2,
      performedAt: "2026-10-08T03:00:00Z",
    });
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ revision: 1, notes: "Synthetic note", recommendation: "needs_repair", locationId: IPM.ROOM2 });
    expect(audits("EDIT_IPM_DRAFT")[0]?.["changes"]).toEqual({
      operation: "EDIT_IPM_DRAFT",
      revisionBefore: 0,
      revisionAfter: 1,
      fields: ["performedAt", "locationId", "inspectionOutcome", "maintenanceOutcome", "recommendation", "notes"],
    });
  });

  it("clearing the room is allowed", async () => {
    const res = await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, locationId: null });
    expect([res.status, data(res)["locationId"]]).toEqual([200, null]);
  });

  it.each([
    ["a store", IPM.STORE1],
    ["a room of another facility", IPM.ROOM1],
  ])("%s as the room → 400", async (_label, locationId) => {
    const res = await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, locationId });
    expect([res.status, res.body.message]).toEqual([400, "Choose a room of this device's facility."]);
  });

  it("a stale revision → 409 IPM_REVISION_CONFLICT", async () => {
    expectConflict(
      await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 4, notes: "x" }),
      "IPM_REVISION_CONFLICT",
      /^This draft was saved at .+ \(revision 0\); reload it before saving\.$/,
    );
  });

  it("a future date → 400", async () => {
    const res = await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, performedAt: new Date(Date.now() + 3600 * 1000).toISOString() });
    expect(res.status).toBe(400);
  });

  it.each([
    ["submitted", { status: "submitted" }, "This IPM was submitted on 2026-10-01 and cannot be edited — submit a correction instead."],
    ["voided", { status: "voided", voidedAt: new Date("2026-10-03T00:00:00Z") }, "This IPM was voided on 2026-10-03 and cannot be edited — start a new IPM."],
    ["voided with no stamp", { status: "voided", voidedAt: null }, "This IPM was voided on an unknown date and cannot be edited — start a new IPM."],
    ["discarded", { status: "discarded", discardedAt: new Date("2026-10-04T00:00:00Z") }, "This IPM draft was discarded on 2026-10-04 and cannot be edited — start a new IPM."],
  ])("a %s session → 409 IPM_NOT_DRAFT with the state explanation", async (_label, values, message) => {
    setRow("InspectionSession", IPM.DRAFT2, { submittedAt: new Date("2026-10-01T03:00:00Z"), ...values });
    expectConflict(await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, notes: "x" }), "IPM_NOT_DRAFT", message);
  });

  it("a missing session → 404", async () => {
    const res = await send(world.staff, "PATCH", `/${MISSING}`, { revision: 0 });
    expect(res.status).toBe(404);
  });
});

// ------------------------------------------------------------------
// RESULTS (§ 9.4)
// ------------------------------------------------------------------

describe("PUT /ipm/sessions/:sessionId/results — checked against the pinned version", () => {
  const RESULTS = [
    { inputKind: "tri_state", templateItemId: IPM.ITEM_POWER, outcome: "pass" },
    { inputKind: "measured_with_limit", templateItemId: IPM.ITEM_LEAK, value: "50" },
    { inputKind: "setting_measured_reference", templateItemId: IPM.ITEM_PRESSURE, value1: "121", value2: "126", outcome: "pass" },
    { inputKind: "measured", templateItemId: IPM.ITEM_BASE_TEMP, value: "25,5" },
    { inputKind: "tri_state", templateItemId: IPM.ITEM_PLACEMENT, outcome: "not_applicable" },
    { inputKind: "check", adHoc: { section: "tools_used", label: "Synthetic analyser" }, outcome: "done" },
    { inputKind: "check", adHoc: { section: "tools_used", label: "Synthetic meter", unit: null } },
  ];

  it("stores the server's labels and verdicts, in read order, and audits counts and hashes", async () => {
    const res = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 0, results: RESULTS });
    expect(res.status).toBe(200);
    const results = data(res)["results"] as Record<string, unknown>[];
    expect(results.map((r) => [r["section"], r["label"], r["sortOrder"]])).toEqual([
      ["environment", "Synthetic room temperature", 1],
      ["tools_used", "Synthetic analyser", 1001],
      ["tools_used", "Synthetic meter", 1002],
      ["other_safety", "Synthetic placement", 1],
      ["electrical_safety", "Synthetic leakage check", 1],
      ["function", "Synthetic power-on check", 1],
      ["performance", "Synthetic pressure reading", 1],
    ]);
    const bySection: Record<string, Record<string, unknown>> = Object.fromEntries(results.map((r) => [String(r["section"]), r]));
    expect(bySection["environment"]).toMatchObject({ measuredValue: "25.5", outcome: null, itemDefinitionId: DEF.temperature });
    expect(bySection["electrical_safety"]).toMatchObject({ measuredValue: "50", outcome: "pass", computedOutcome: "pass", outcomeSource: "computed" });
    expect(bySection["performance"]).toMatchObject({ measuredValue1: "121", measuredValue2: "126", outcome: "pass", computedOutcome: "fail", disagreementFlag: true });
    expect(results.filter((r) => r["isAdHoc"])).toHaveLength(2);
    expect(data(res)["revision"]).toBe(1);
    const changes = audits("EDIT_IPM_RESULTS")[0]?.["changes"] as Record<string, unknown>;
    expect(changes).toMatchObject({ revisionBefore: 0, revisionAfter: 1, resultCountBefore: 0, resultCountAfter: 7 });
    expect(changes["hashAfter"]).toMatch(/^[0-9a-f]{64}$/);
    expect(changes["hashBefore"]).not.toBe(changes["hashAfter"]);
  });

  it("a second replace removes the previous rows", async () => {
    await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 0, results: RESULTS });
    const res = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 1, results: [RESULTS[0]] });
    expect((data(res)["results"] as unknown[]).length).toBe(1);
    expect(mdb.rows("InspectionResult").filter((r) => r["sessionId"] === IPM.DRAFT2)).toHaveLength(1);
  });

  it("an item of another version and an overridden computed outcome are both named in one 400; nothing is written", async () => {
    const before = mdb.committed().length;
    const res = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, {
      revision: 0,
      results: [
        { inputKind: "measured", templateItemId: "5eed0000-0000-4000-8000-0000000000b1", value: "20" },
        { inputKind: "measured_with_limit", templateItemId: IPM.ITEM_LEAK, value: "150", outcome: "pass" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "These results cannot be saved: Row 1: this item is not part of the checklist this IPM uses. " +
        'The result of "Synthetic leakage check" is computed from its limit (≤ 100 µA): fail. Re-measure instead of overriding it.',
    );
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("an ended facility → 409 IPM_FACILITY_ENDED", async () => {
    setRow("ClientFacility", IPM.F2, { status: "ended" });
    expectConflict(await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 0, results: [] }), "IPM_FACILITY_ENDED", /Facility Two has ended/);
  });

  it("a session with no pinned version (imported history) takes ad-hoc rows only", async () => {
    setRow("InspectionSession", IPM.DRAFT2, { templateVersionId: null, legacyKey: "TST000002|2026-01-01" });
    const ok = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 0, results: [RESULTS[5]] });
    expect([ok.status, data(ok)["templateContentHash"]]).toEqual([200, null]);
    const refused = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 1, results: [RESULTS[0]] });
    expect(refused.status).toBe(400);
  });

  it("the same template item twice → 400 by the contract", async () => {
    const res = await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 0, results: [RESULTS[0], RESULTS[0]] });
    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------------------------
// DISCARD (§ 7.2)
// ------------------------------------------------------------------

describe("POST /ipm/sessions/:sessionId/discard", () => {
  it("by its creator: discarded, kept, audited as the creator's", async () => {
    const res = await send(world.staff, "POST", `/${IPM.DRAFT2}/discard`, { reason: "Duplicate" });
    expect([res.status, data(res)["status"]]).toEqual([200, "discarded"]);
    expect(audits("DISCARD_IPM_DRAFT")[0]?.["changes"]).toEqual({ operation: "DISCARD_IPM_DRAFT", by: "creator", reasonLength: 9 });
  });

  it("by an unbound tenant administrator", async () => {
    const res = await send(world.admin, "POST", `/${IPM.DRAFT1}/discard`);
    expect(res.status).toBe(200);
    expect(audits("DISCARD_IPM_DRAFT")[0]?.["changes"]).toEqual({ operation: "DISCARD_IPM_DRAFT", by: "administrator", reasonLength: 0 });
  });

  it("an administrator who is facility-bound cannot (the service's second layer)", async () => {
    const store = { tenantId: world.tenantA as TenantId, isSuperAdmin: false, isSystemTask: false, userId: world.admin.id, clientFacilityId: IPM.F1 as never, facilityBound: true };
    await expect(
      tenantStorage.run(store, () => service.discardSession(world.tenantA as TenantId, { sessionId: IPM.DRAFT1 }, { userId: world.admin.id, tenantAdmin: true })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("anyone else → 403; a non-draft → 409 IPM_NOT_DRAFT", async () => {
    expect((await send(world.staff, "POST", `/${IPM.DRAFT1}/discard`)).status).toBe(403);
    expectConflict(await send(world.staff, "POST", `/${IPM.S1}/discard`), "IPM_NOT_DRAFT", "Only a draft can be discarded.");
  });
});

// ------------------------------------------------------------------
// CORRECTIONS (§ 7.2)
// ------------------------------------------------------------------

describe("POST /ipm/sessions/:sessionId/corrections", () => {
  it("a new draft superseding an effective session, header and results copied, audited with the original", async () => {
    const res = await send(world.bound2, "POST", `/${IPM.S1}/corrections`, { reason: "Wrong recommendation" });
    expect(res.status).toBe(201);
    expect(data(res)).toMatchObject({
      status: "draft",
      revision: 0,
      supersedesId: IPM.S1,
      correctionReason: "Wrong recommendation",
      recommendation: "fit_for_use",
      templateVersionId: IPM.TYPE_V1,
      createdBy: IPM.BOUND2,
      clientFacilityId: IPM.F1,
    });
    expect((data(res)["results"] as Record<string, unknown>[]).map((r) => r["label"])).toEqual(["Synthetic power-on check"]);
    expect(audits("CREATE_IPM_CORRECTION")[0]?.["changes"]).toEqual({
      operation: "CREATE_IPM_CORRECTION",
      originalId: IPM.S1,
      reasonLength: 20,
      resultsCopied: true,
    });
  });

  it("clientRef: the caller's own correction is answered 200", async () => {
    const ref = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
    const first = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Wrong date", clientRef: ref });
    const again = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Wrong date", clientRef: ref });
    expect([first.status, again.status, data(again)["id"]]).toEqual([201, 200, data(first)["id"]]);
  });

  it.each([
    ["voided", { status: "voided", voidedAt: new Date("2026-10-05T00:00:00Z") }, "IPM_VOIDED", "This IPM was voided on 2026-10-05 and cannot be corrected — a void is final."],
    ["a draft", { status: "draft" }, "IPM_NOT_SUBMITTED", "Only a submitted IPM can be corrected; edit or discard the draft instead."],
    ["discarded", { status: "discarded" }, "IPM_NOT_SUBMITTED", "Only a submitted IPM can be corrected; edit or discard the draft instead."],
  ])("%s → 409 %s", async (_label, values, code, message) => {
    setRow("InspectionSession", IPM.S1, values);
    expectConflict(await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic" }), code, message);
  });

  it("a superseded session → 409 IPM_SUPERSEDED with the chain's head", async () => {
    mdb.seed("InspectionSession", [
      submittedSession(HEAD, world.tenantA, IPM.F1, IPM.D1, world.staff.id, { supersedesId: IPM.S1, correctionReason: "Earlier fix" }),
    ]);
    setRow("InspectionSession", IPM.S1, { supersededById: HEAD, supersededAt: new Date("2026-10-06T00:00:00Z") });
    const res = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic" });
    expectConflict(res, "IPM_SUPERSEDED", "This IPM was corrected on 2026-10-06; correct the latest version (visit 1).");
    expect(res.body.headId).toBe(HEAD);
  });

  it("a successor the caller cannot see ends the walk at the last visible member", async () => {
    setRow("InspectionSession", IPM.S1, { supersededById: MISSING, supersededAt: new Date("2026-10-06T00:00:00Z") });
    const res = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic" });
    expect([res.body.code, res.body.headId]).toEqual(["IPM_SUPERSEDED", IPM.S1]);
  });

  it("an open correction → 409 IPM_CORRECTION_OPEN naming who started it", async () => {
    await send(world.bound2, "POST", `/${IPM.S1}/corrections`, { reason: "First" });
    expectConflict(await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Second" }), "IPM_CORRECTION_OPEN", /^A correction of this IPM is already open \(started by .+ on \d{4}-\d{2}-\d{2}\)\.$/);
  });

  it("an open correction with no recorded creator names 'another user'", async () => {
    await send(world.bound2, "POST", `/${IPM.S1}/corrections`, { reason: "First" });
    const open = mdb.rows("InspectionSession").find((r) => r["supersedesId"] === IPM.S1) as Record<string, unknown>;
    setRow("InspectionSession", open["id"] as string, { createdBy: null });
    expectConflict(await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Second" }), "IPM_CORRECTION_OPEN", /started by another user/);
  });

  it("an ended facility → 409 IPM_FACILITY_ENDED", async () => {
    setRow("ClientFacility", IPM.F1, { status: "ended" });
    expectConflict(await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic" }), "IPM_FACILITY_ENDED", /Facility One has ended/);
  });

  it("an imported session pins the device's current checklist and copies the header only", async () => {
    mdb.seed("InspectionSession", submittedSession(IMPORTED, world.tenantA, IPM.F1, IPM.D1, world.staff.id, { templateVersionId: null, legacyKey: "TST000001|2025-01-01", createdBy: null }));
    const res = await send(world.staff, "POST", `/${IMPORTED}/corrections`, { reason: "Imported fix" });
    expect([res.status, data(res)["templateVersionId"], data(res)["results"]]).toEqual([201, IPM.TYPE_V1, []]);
    expect(audits("CREATE_IPM_CORRECTION")[0]?.["changes"]).toMatchObject({ resultsCopied: false });
  });

  it("an imported session with no checklist to pin → 409 IPM_NO_CHECKLIST", async () => {
    mdb.seed("InspectionSession", submittedSession(IMPORTED, world.tenantA, IPM.F1, IPM.D1, world.staff.id, { templateVersionId: null, legacyKey: "TST000001|2025-01-01" }));
    await models.InspectionTemplate.update({ status: "retired" }, { where: { status: "active" } });
    expectConflict(await send(world.staff, "POST", `/${IMPORTED}/corrections`, { reason: "Imported fix" }), "IPM_NO_CHECKLIST", /an imported IPM cannot be corrected yet/);
  });

  it("a missing session → 404", async () => {
    expect((await send(world.staff, "POST", `/${MISSING}/corrections`, { reason: "Synthetic" })).status).toBe(404);
  });
});

// ------------------------------------------------------------------
// READS (§ 10.2)
// ------------------------------------------------------------------

describe("the reads", () => {
  beforeEach(() => {
    mdb.seed("InspectionSession", [
      submittedSession(VOIDED, world.tenantA, IPM.F1, IPM.D1, world.staff.id, {
        status: "voided",
        visitNumber: 2,
        recommendation: "needs_repair",
        performedAt: new Date("2026-10-02T02:00:00Z"),
      }),
      { ...submittedSession(DISCARDED, world.tenantA, IPM.F1, IPM.D1, world.staff.id), status: "discarded", visitNumber: null },
    ]);
  });

  const ids = (res: Res): unknown[] => rows(res).map((r) => r["id"]);

  it("by default: submitted and voided sessions, and the caller's own drafts only; paging in meta", async () => {
    const res = await send(world.staff, "GET", "/");
    expect(res.status).toBe(200);
    expect(ids(res).sort()).toEqual([IPM.S1, IPM.S2, VOIDED, IPM.DRAFT2].sort());
    expect(res.body.meta).toEqual({ total: 4, page: 1, limit: 25, totalPages: 1 });
    const submitted = rows(res).find((r) => r["id"] === IPM.S1) as Record<string, unknown>;
    expect(submitted["performerDisplay"]).toEqual({ name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis", redacted: false });
  });

  it.each([
    ["status=discarded", { status: "discarded" }, [DISCARDED]],
    ["status=draft (every draft in scope)", { status: "draft" }, [IPM.DRAFT1, IPM.DRAFT2]],
    ["effective=true", { effective: "true" }, [IPM.S1, IPM.S2]],
    ["effective=false", { effective: "false" }, [VOIDED, IPM.DRAFT2]],
    ["deviceId", { deviceId: IPM.D2 }, [IPM.S2, IPM.DRAFT2]],
    ["clientFacilityId", { clientFacilityId: IPM.F2 }, [IPM.S2, IPM.DRAFT2]],
    ["recommendation", { recommendation: "needs_repair" }, [VOIDED]],
    ["from/to", { from: "2026-10-02T00:00:00Z", to: "2026-10-03T00:00:00Z" }, [VOIDED]],
    ["q by name", { q: "sintetis 2" }, [IPM.S2, IPM.DRAFT2]],
    ["q by QR", { q: "TST000001" }, [IPM.S1, VOIDED]],
  ])("filter %s", async (_label, query, expected) => {
    const res = await send(world.staff, "GET", "/", {}, query);
    expect([res.status, ids(res).sort()]).toEqual([200, [...expected].sort()]);
  });

  it("filter performedBy (the technician activity read, P21-07)", async () => {
    const res = await send(world.staff, "GET", "/", {}, { performedBy: IPM.BOUND, status: "draft" });
    expect(ids(res)).toEqual([IPM.DRAFT1]);
  });

  it("sort=visitNumber orders by visit, then date, then id", async () => {
    const res = await send(world.staff, "GET", "/", {}, { sort: "visitNumber", deviceId: IPM.D1 });
    expect(ids(res)).toEqual([VOIDED, IPM.S1]);
  });

  it("without a person (a key reaching the service) the default omits every draft", async () => {
    const page = await service.listSessions(null, { page: 1, limit: 25, sort: "performedAt" });
    expect(page.rows.map((r) => r["status"])).not.toContain("draft");
  });

  it("GET /:sessionId answers the results in read order; a missing one is 404", async () => {
    const res = await send(world.staff, "GET", `/${IPM.S1}`);
    expect([res.status, (data(res)["results"] as unknown[]).length]).toEqual([200, 1]);
    expect((await send(world.staff, "GET", `/${MISSING}`)).status).toBe(404);
  });

  it("a session whose device is gone from view still answers, with no prefill", async () => {
    setRow("CalibrationDevice", IPM.D1, { isDeleted: true });
    const res = await send(world.staff, "GET", `/${IPM.S1}`);
    expect([res.status, data(res)["device"]]).toEqual([200, null]);
  });

  it("the device history: 404 for a missing device", async () => {
    await expect(service.deviceSessions(world.staff.id, { calibrationDeviceId: MISSING, page: 1, limit: 25 })).rejects.toMatchObject({ status: 404 });
  });
});
