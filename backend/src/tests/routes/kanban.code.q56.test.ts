/**
 * Q-56 (kanban half) — `GET /kanban/projects` returns the board's `code`.
 *
 * `kanban_projects.code` exists (the card-key prefix, e.g. "MGT" -> MGT-1) and
 * `getProject` returns it, but `listProjects` dropped it — so the project
 * list never carried the prefix the board view shows. Fail-before: the list
 * rows have no `code` key at all.
 *
 * REAL router, auth mocked, service, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as KanbanRoute from "../../routes/api/kanban.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof KanbanRoute>("../../routes/api/kanban.route");

const PROJECT = "a0560000-0000-4000-8000-000000000001";
const PROJECT_NULL = "a0560000-0000-4000-8000-000000000002";

let adminId = "";
let tenantAId = "";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  adminId = admin.id;
  tenantAId = fx.tenantA.id;
  mdb.seed("KanbanProject", {
    id: PROJECT, tenantId: fx.tenantA.id, name: "ICU devices", code: "ICU",
    description: null, color: "#2f6fdf", createdBy: admin.id,
  });
  mdb.seed("KanbanProjectMember", { projectId: PROJECT, userId: admin.id, accessLevel: "owner" });
  as(admin);
});

const data = (body: unknown): Record<string, unknown>[] =>
  (body as { data: Record<string, unknown>[] }).data;

describe("Q-56 — the project list returns the board code", () => {
  it("GET /kanban/projects carries code on every row", async () => {
    const res = await call(router, "GET", "/projects", {});
    expect(res.status).toBe(200);
    expect(data(res.body)).toHaveLength(1);
    expect(data(res.body)[0]?.["code"]).toBe("ICU");
  });

  it("a board with no code answers null, not a missing key", async () => {
    mdb.seed("KanbanProject", {
      id: PROJECT_NULL, tenantId: tenantAId,
      name: "No prefix", code: null, description: null, color: null, createdBy: null,
    });
    mdb.seed("KanbanProjectMember", { projectId: PROJECT_NULL, userId: adminId, accessLevel: "owner" });
    const res = await call(router, "GET", "/projects", {});
    expect(res.status).toBe(200);
    const rows = data(res.body);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.prototype.hasOwnProperty.call(row, "code")).toBe(true);
    }
    expect(rows.map((r) => r["code"]).sort()).toEqual(["ICU", null].sort());
  });
});
