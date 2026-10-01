/**
 * A-282 (ADR-094, ADR-100) — writes an API key can reach are audited as
 * `system:api-key`, with the key's id in `changes.apiKeyId` and `user_id`
 * NULL.
 *
 * Before: the controllers passed `auditActor(req)`, which names `req.user.id`
 * — for a key, the KEY's id — as the row's user. `audit_logs.user_id`
 * references `users` (migration 0030), so on PostgreSQL the row fails its
 * foreign key and the write rolls back. memoryDb enforces no foreign key, so
 * this suite asserts the shape that satisfies it.
 *
 * REAL routers, gates, validators, controllers, services, audit service and
 * models (fixtures/memoryDb); every role holds every menu (grantAllMenus).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TenantRow, TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type * as WorkflowRoutes from "../../routes/api/workflows.route";
import type * as MaintenanceRoutes from "../../routes/api/maintenance.route";
import type * as DeviceRoutes from "../../routes/api/calibrationDevices.route";

const containing = (fields: Record<string, unknown>): unknown => expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const workflows = jest.requireActual<typeof WorkflowRoutes>("../../routes/api/workflows.route");
const maintenance = jest.requireActual<typeof MaintenanceRoutes>("../../routes/api/maintenance.route");
const devices = jest.requireActual<typeof DeviceRoutes>("../../routes/api/calibrationDevices.route");

const KEY_ID = "ab000000-0000-4000-8000-0000000000b2";
const WORKFLOW_A = "a2000000-0000-4000-8000-000000000001";
const DEVICE_A = "a2000000-0000-4000-8000-000000000002";
const ORDER_A = "a2000000-0000-4000-8000-000000000003";

const apiKey = (tenant: TenantRow, scopes: string[]): Principal => ({
  id: KEY_ID,
  username: "integration",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: scopes,
});

let fx: TwoTenantWorld;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Workflow", {
    id: WORKFLOW_A,
    tenantId: fx.tenantA.id,
    name: "Certificate approval",
    resourceType: "Certificate",
    isActive: true,
  });
  mdb.seed("CalibrationDevice", {
    id: DEVICE_A,
    tenantId: fx.tenantA.id,
    name: "Infusion pump",
    serialNumber: "SN-A282",
  });
  mdb.seed("MaintenanceWorkOrder", {
    id: ORDER_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    title: "Replace seal",
    type: "Corrective",
    priority: "Medium",
    status: "Open",
  });
});

/** The one committed audit row, written in the same transaction as a write to `model`. */
const oneRowWith = (model: string): Row => {
  const committed = mdb.committed();
  const audits = committed.filter((w) => w.model === "AuditLog");
  expect(audits).toHaveLength(1);
  const writeTx = new Set(committed.filter((w) => w.model === model).map((w) => w.tx));
  expect(audits[0]?.tx).not.toBeNull();
  expect(writeTx.has(audits[0]?.tx ?? null)).toBe(true);
  return mdb.rows("AuditLog")[0] ?? {};
};

const byKey = (tenantId: string): Record<string, unknown> => ({
  tenantId,
  userId: null,
  actorType: "system",
  actorName: "system:api-key",
});

describe("A-282 — workflow definitions written by an API key", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["workflows:write"]);

  it("PUT: one UPDATE row as system:api-key naming the key", async () => {
    as(key());
    const res = await call(workflows, "PUT", `/${WORKFLOW_A}`, { body: { name: "Renamed" } });
    expect(res.status).toBe(200);
    expect(oneRowWith("Workflow")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "UPDATE",
      resourceType: "Workflow",
      resourceId: WORKFLOW_A,
      changes: containing({ apiKeyId: KEY_ID }),
    });
  });

  it("DELETE: one DELETE row as system:api-key naming the key", async () => {
    as(key());
    const res = await call(workflows, "DELETE", `/${WORKFLOW_A}`);
    expect(res.status).toBe(200);
    expect(oneRowWith("Workflow")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "DELETE",
      changes: containing({ apiKeyId: KEY_ID }),
    });
  });

  it("a user's change is still recorded as that user (positive control)", async () => {
    as(admin);
    const res = await call(workflows, "PUT", `/${WORKFLOW_A}`, { body: { name: "Renamed" } });
    expect(res.status).toBe(200);
    const row = oneRowWith("Workflow");
    expect(row).toMatchObject({ userId: admin.id, actorType: "user" });
    expect(row["changes"]).not.toHaveProperty("apiKeyId");
  });
});

describe("A-282 — maintenance work orders written by an API key", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["maintenance:write"]);

  it("POST: one CREATE row as system:api-key naming the key", async () => {
    as(key());
    const res = await call(maintenance, "POST", "/", {
      body: { deviceId: DEVICE_A, title: "Calibrate", type: "Preventative" },
    });
    expect(res.status).toBe(201);
    expect(oneRowWith("MaintenanceWorkOrder")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "CREATE",
      resourceType: "MaintenanceWorkOrder",
      changes: containing({ apiKeyId: KEY_ID }),
    });
  });

  it("PATCH: one UPDATE row as system:api-key naming the key", async () => {
    as(key());
    const res = await call(maintenance, "PATCH", `/${ORDER_A}`, { body: { title: "Replace both seals" } });
    expect(res.status).toBe(200);
    expect(oneRowWith("MaintenanceWorkOrder")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "UPDATE",
      resourceId: ORDER_A,
      changes: containing({ apiKeyId: KEY_ID }),
    });
  });
});

describe("A-282 — calibration devices written by an API key", () => {
  it("PUT: one UPDATE row as system:api-key naming the key", async () => {
    as(apiKey(fx.tenantA, ["calibration:write"]));
    const res = await call(devices, "PUT", `/${DEVICE_A}`, { body: { name: "Infusion pump 2" } });
    expect(res.status).toBe(200);
    expect(oneRowWith("CalibrationDevice")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "UPDATE",
      resourceId: DEVICE_A,
      changes: containing({ apiKeyId: KEY_ID }),
    });
  });
});
