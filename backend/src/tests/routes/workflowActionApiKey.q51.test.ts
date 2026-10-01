/**
 * Q-51 (ADR-100 amendment, 2026-09-30) — a workflow decision is a person's.
 * `POST /workflows/instances/:instanceId/action` could be reached by an API key
 * scoped `warehouse:write` (its dynamicAccess gate), and an approval of a
 * StockTransfer then wrote the key's id into `stock_transfers.approved_by`, a
 * users FK that fails on PostgreSQL, where the approver stays user-only. The
 * route now refuses a key with 403 before any work; a user still reaches it.
 *
 * The real workflows router over memoryDb (fixtures/routeClient).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TenantRow, TwoTenantWorld } from "../fixtures/routeClient";
import type * as WorkflowRoutes from "../../routes/api/workflows.route";

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

const KEY_ID = "ab000000-0000-4000-8000-0000000000d1";
const INSTANCE = "a5200000-0000-4000-8000-000000000001";

const apiKey = (tenant: TenantRow): Principal => ({
  id: KEY_ID,
  username: "integration",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: ["warehouse:write", "certificate:write", "maintenance:write"],
});

let fx: TwoTenantWorld;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
});

it("an API key is refused with 403 and nothing is written", async () => {
  as(apiKey(fx.tenantA));
  const res = await call(workflows, "POST", `/instances/${INSTANCE}/action`, {
    body: { action: "APPROVED", comments: "by a key" },
  });
  expect(res.status).toBe(403);
  expect(mdb.writes()).toEqual([]);
});

it("control: a user passes the key refusal (and meets the ordinary not-found for a missing instance)", async () => {
  as(admin);
  const res = await call(workflows, "POST", `/instances/${INSTANCE}/action`, {
    body: { action: "APPROVED", comments: "by a person" },
  });
  expect(res.status).not.toBe(403);
});
