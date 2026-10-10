/**
 * P21-01 — catalogue proposals: the tenant side (ipm.route) and the operator's queue and decisions
 * (admin.route) — spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.6, § 7.4, § 10, § 13;
 * ADR-125 § 5, Am. 1 § 11.
 *
 * REAL: both routers and their gates (dynamicAccess with the matrix granted, denyApiKey, the admin
 * router's rbac + superAdminOnly, validate), the controller, the proposal and template services,
 * the audit service, the models and the tenant hooks over memoryDb. DOUBLED: redis, and the
 * notification service (its delivery path is not under test — that it is called inside the
 * decision's transaction is).
 *
 * Two tenants (CLAUDE.md): tenant B asking for tenant A's proposal by id — read or withdraw — gets
 * the 404 a missing id gets, and nothing is written; B's list never holds A's.
 *
 * @two-tenant api/ipm.route.ts GET /template-proposals/:proposalId
 * @two-tenant api/ipm.route.ts POST /template-proposals/:proposalId/withdraw
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as IpmRoute from "../../routes/api/ipm.route";
import type * as AdminRoute from "../../routes/api/admin.route";
import type * as ModelsModule from "../../models";
import { DEF, seedCatalogue, seedType } from "../fixtures/catalogueSeed";

const emitNotification = jest.fn<Promise<null>, [unknown, unknown]>(() => Promise.resolve(null));
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/notification.service", () => ({ emitNotification: (data: unknown, options: unknown) => emitNotification(data, options) }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const ipmRouter = jest.requireActual<typeof IpmRoute>("../../routes/api/ipm.route");
const adminRouter = jest.requireActual<typeof AdminRoute>("../../routes/api/admin.route");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const TYPE_A = "a1a1a1a1-0000-4000-8000-000000000001";
const TYPE_NEW = "a1a1a1a1-0000-4000-8000-000000000009";
const TYPE_RETIRED = "a1a1a1a1-0000-4000-8000-000000000003";
const P_A = "9a9a0000-0000-4000-8000-00000000000a";
const P_A2 = "9a9a0000-0000-4000-8000-00000000000c";
const P_NEW = "9a9a0000-0000-4000-8000-00000000000d";
const P_B = "9a9a0000-0000-4000-8000-00000000000b";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let ctx: SuiteContext;
let operator: Principal;
let tenantA: string;
let tenantB: string;

interface Res {
  status: number;
  body: { data?: Record<string, unknown> & Record<string, unknown>[]; meta?: Record<string, unknown>; message?: string };
}
const tenantCall = async (who: Principal, method: string, path: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<Res> => {
  as(who);
  return (await call(ipmRouter, method, path, { body, query, baseUrl: "/api/v1/ipm", routeFile: "api/ipm.route.ts" })) as unknown as Res;
};
const adminCall = async (who: Principal, method: string, path: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<Res> => {
  as(who);
  return (await call(adminRouter, method, path, { body, query, baseUrl: "/api/v1/admin", routeFile: "api/admin.route.ts" })) as unknown as Res;
};

const proposal = (id: string, tenantId: string, submittedBy: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  tenantId,
  kind: "add_items",
  deviceTypeId: TYPE_A,
  proposedItems: [{ section: "function", label: "Synthetic extra check", inputKind: "tri_state" }],
  reason: "Synthetic reason",
  status: "submitted",
  submittedBy,
  ...extra,
});

beforeEach(() => {
  mdb.reset();
  emitNotification.mockClear();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  tenantB = fx.tenantB.id;
  ctx = { owner: fx.principal(fx.tenantA, "TENANT_ADMIN"), other: fx.principal(fx.tenantB, "TENANT_ADMIN") };
  operator = fx.superAdmin;
  seedTenants(mdb, fx, [ctx.owner, ctx.other, operator]);
  seedCatalogue(mdb);
  seedType(mdb, TYPE_A, "Test Device Type A");
  seedType(mdb, TYPE_NEW, "Test Device Type New");
  seedType(mdb, TYPE_RETIRED, "Test Device Type Retired", "retired");
  mdb.seed("InspectionTemplateProposal", [
    proposal(P_A, tenantA, ctx.owner.id),
    proposal(P_A2, tenantA, ctx.owner.id, { kind: "change_items", proposedItems: [{ itemDefinitionId: DEF.power, section: "function", label: "x", inputKind: "tri_state" }] }),
    proposal(P_NEW, tenantA, ctx.owner.id, { kind: "new_device_type", deviceTypeId: null, proposedDeviceTypeName: "Synthetic New Type", proposedItems: [] }),
    proposal(P_B, tenantB, ctx.other.id),
  ]);
});

twoTenantSuite({
  module: "ipm template proposals",
  router: ipmRouter,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /template-proposals/:proposalId", method: "GET", path: (id) => `/template-proposals/${id}`, id: () => P_A },
    {
      key: "POST /template-proposals/:proposalId/withdraw",
      method: "POST",
      path: (id) => `/template-proposals/${id}/withdraw`,
      id: () => P_A,
      writes: ["InspectionTemplateProposal", "AuditLog"],
    },
  ],
});

describe("the tenant side", () => {
  it("each tenant lists its own proposals only", async () => {
    const a = await tenantCall(ctx.owner, "GET", "/template-proposals");
    expect((a.body.data as unknown as { id: string }[]).map((p) => p.id).sort()).toEqual([P_A, P_A2, P_NEW].sort());
    const b = await tenantCall(ctx.other, "GET", "/template-proposals", {}, { status: "submitted" });
    expect((b.body.data as unknown as { id: string }[]).map((p) => p.id)).toEqual([P_B]);
    expect(b.body.meta).toEqual({ total: 1, page: 1, limit: 25, totalPages: 1 });
  });

  it("submits in the caller's tenant (never the body's), audited there", async () => {
    const created = await tenantCall(ctx.other, "POST", "/template-proposals", {
      kind: "add_items",
      deviceTypeId: TYPE_A,
      basedOnVersionId: "5eedca7a-0000-4000-8000-000000000002",
      proposedItems: [{ section: "function", label: "Synthetic proposed check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] }],
      reason: "We need this check",
    });
    expect(created.status).toBe(201);
    const id = String(created.body.data?.["id"]);
    expect(mdb.rows("InspectionTemplateProposal").find((r) => r["id"] === id)?.["tenantId"]).toBe(tenantB);
    expect(mdb.rows("AuditLog").filter((r) => r["resourceId"] === id)).toEqual([expect.objectContaining({ tenantId: tenantB, action: "CREATE" })]);
    expect((await tenantCall(ctx.other, "POST", "/template-proposals", { kind: "new_device_type", proposedDeviceTypeName: "X", reason: "why", tenantId: tenantA })).status).toBe(400);
    const newType = await tenantCall(ctx.other, "POST", "/template-proposals", { kind: "new_device_type", proposedDeviceTypeName: "Synthetic Type", reason: "Needed" });
    expect(newType.body.data).toMatchObject({ status: "submitted", deviceTypeId: null, basedOnVersionId: null, proposedItems: [] });
    expect((await tenantCall(ctx.other, "POST", "/template-proposals", { kind: "add_items", deviceTypeId: MISSING, proposedItems: [{ section: "function", label: "x", inputKind: "tri_state" }], reason: "why" })).status).toBe(404);
    const draft = await models.InspectionTemplateVersion.create({ templateId: "5eedca7a-0000-4000-8000-000000000001" as never, status: "draft", revision: 0 });
    expect((await tenantCall(ctx.other, "POST", "/template-proposals", { kind: "new_device_type", proposedDeviceTypeName: "New", basedOnVersionId: draft.id, reason: "why" })).body.message).toBe("Checklist version not found");
    expect((await tenantCall(ctx.other, "POST", "/template-proposals", { kind: "new_device_type", proposedDeviceTypeName: "New", basedOnVersionId: MISSING, reason: "why" })).status).toBe(404);
  });

  it("a decided or withdrawn proposal cannot be withdrawn (409 names when)", async () => {
    expect((await tenantCall(ctx.owner, "POST", `/template-proposals/${P_A}/withdraw`)).status).toBe(200);
    expect((await tenantCall(ctx.owner, "POST", `/template-proposals/${P_A}/withdraw`)).body.message).toMatch(/^This proposal was withdrawn on \d{4}-\d{2}-\d{2}; it can no longer be withdrawn\.$/);
    await adminCall(operator, "POST", `/ipm/template-proposals/${P_A2}/reject`, { decisionNote: "Not needed" });
    expect((await tenantCall(ctx.owner, "POST", `/template-proposals/${P_A2}/withdraw`)).body.message).toMatch(/^This proposal was rejected on/);
  });
});

describe("the operator's queue and decisions", () => {
  it("the queue spans tenants (oldest first, with the tenant); a tenant administrator is refused (403)", async () => {
    const queue = await adminCall(operator, "GET", "/ipm/template-proposals", {}, { status: "submitted" });
    expect(queue.status).toBe(200);
    expect((queue.body.data as unknown as { tenantId: string }[]).map((r) => r.tenantId).sort()).toEqual([tenantA, tenantA, tenantA, tenantB].sort());
    // P22-01 follow-up: each row names its tenant by display name only (no other tenant field).
    const rows = queue.body.data as unknown as { tenantId: string; tenantName: string | null }[];
    expect(rows.every((r) => typeof r.tenantName === "string" && r.tenantName.length > 0)).toBe(true);
    expect(new Set(rows.map((r) => `${r.tenantId}:${String(r.tenantName)}`)).size).toBe(2);
    expect(Object.keys(rows[0] ?? {}).filter((k) => k.startsWith("tenant")).sort()).toEqual(["tenantId", "tenantName"]);
    expect((await adminCall(ctx.owner, "GET", "/ipm/template-proposals")).status).toBe(403);
    expect((await adminCall(ctx.owner, "POST", `/ipm/template-proposals/${P_A}/accept`, {})).status).toBe(403);
  });

  it("the tenant name: null when the tenant row is gone; an empty page reads no tenant", async () => {
    const spy = jest.spyOn(models.Tenant, "findAll").mockResolvedValueOnce([]);
    const queue = await adminCall(operator, "GET", "/ipm/template-proposals", {}, { status: "submitted" });
    expect((queue.body.data as unknown as { tenantName: unknown }[]).map((r) => r.tenantName)).toEqual([null, null, null, null]);
    spy.mockClear();
    const empty = await adminCall(operator, "GET", "/ipm/template-proposals", {}, { status: "accepted" });
    expect([empty.status, empty.body.data]).toEqual([200, []]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("accept opens a draft (creating the checklist when none), links an open one, copies nothing; audited in the proposal's tenant; the submitter notified", async () => {
    const accepted = await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/accept`, { decisionNote: "Good idea" });
    expect(accepted.status).toBe(200);
    const draftId = String(accepted.body.data?.["resultingVersionId"]);
    const draft = await models.InspectionTemplateVersion.findOne({ where: { id: draftId } });
    expect(draft?.status).toBe("draft");
    expect(await models.InspectionTemplateItem.count({ where: { versionId: draftId } })).toBe(0);
    expect(mdb.rows("AuditLog").filter((r) => r["resourceId"] === P_A)).toEqual([expect.objectContaining({ tenantId: tenantA, action: "APPROVE" })]);
    expect(emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenantA, userId: ctx.owner.id, title: "Checklist proposal accepted" }),
      expect.objectContaining({ transaction: expect.anything() as unknown }),
    );
    // Another proposal on the same type links the same open draft.
    const linked = await adminCall(operator, "POST", `/ipm/template-proposals/${P_B}/accept`, { deviceTypeId: TYPE_A });
    expect(linked.body.data?.["resultingVersionId"]).toBe(draftId);
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/accept`, {})).body.message).toMatch(/^This proposal was already accepted on/);
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${MISSING}/accept`, {})).status).toBe(404);
    await tenantCall(ctx.owner, "POST", `/template-proposals/${P_A2}/withdraw`);
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A2}/accept`, {})).body.message).toMatch(/^This proposal was already withdrawn on/);
  });

  it("a new-type proposal needs the type the operator created; another type is refused", async () => {
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_NEW}/accept`, {})).body.message).toMatch(/^Name the device type you created/);
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A2}/accept`, { deviceTypeId: TYPE_NEW })).body.message).toBe("This proposal is about another device type.");
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_NEW}/accept`, { deviceTypeId: TYPE_RETIRED })).status).toBe(409);
    const ok = await adminCall(operator, "POST", `/ipm/template-proposals/${P_NEW}/accept`, { deviceTypeId: TYPE_NEW });
    expect(ok.body.data).toMatchObject({ status: "accepted", deviceTypeId: TYPE_NEW });
    expect(await models.InspectionTemplate.count({ where: { deviceTypeId: TYPE_NEW } })).toBe(1);
  });

  it("a retired checklist takes no new draft (409); reject needs a note and notifies", async () => {
    const template = await models.InspectionTemplate.create({ deviceTypeId: TYPE_A as never, status: "retired" });
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/accept`, {})).body.message).toMatch(/is retired; reactivate it first\.$/);
    expect(template.status).toBe("retired");
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/reject`, {})).status).toBe(400);
    const rejected = await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/reject`, { decisionNote: "Out of scope" });
    expect(rejected.body.data).toMatchObject({ status: "rejected", decisionNote: "Out of scope" });
    expect(mdb.rows("AuditLog").filter((r) => r["resourceId"] === P_A)).toEqual([expect.objectContaining({ tenantId: tenantA, action: "UPDATE" })]);
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Checklist proposal rejected" }), expect.anything());
    expect((await adminCall(operator, "POST", `/ipm/template-proposals/${P_A}/reject`, { decisionNote: "Again" })).status).toBe(409);
  });
});
