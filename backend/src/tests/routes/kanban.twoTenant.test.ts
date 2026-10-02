/**
 * Two tenants — every /kanban/projects/:projectId route (CLAUDE.md: "Every
 * new :id route needs a two-tenant test asserting 404").
 *
 * The routes carry `auth` only; kanban.service#assertAccess resolves the
 * caller's project (tenant-scoped) and membership level on every call
 * (constants/routeGateExemptions). KanbanProject and KanbanCard are
 * tenant-scoped models; columns, sprints, labels, members and relations are
 * NOT — they are reached through their project. So each route is probed in
 * every way an id can cross the boundary:
 *
 *  - PROJECT: tenant B's project OWNER names tenant A's project;
 *  - CHILD: the same owner names ITS OWN project and a child (column, sprint,
 *    label, member, card, relation) of tenant A's project.
 *
 * Every probe answers the 404 a never-existing id gets, and writes nothing.
 * The owner of tenant A's project reaches every route (positive control).
 *
 * REAL router, validateUuid, validate, controller, kanban service, attachment
 * service and notification service on the REAL models and tenant hooks
 * (fixtures/memoryDb). The card-number claim is raw SQL; `onQuery` answers it
 * and asserts its tenant predicate. The socket is not started, so
 * emitToBoard emits nothing (config/socket: `io && ...`).
 *
 * @two-tenant api/kanban.route.ts GET /projects/:projectId
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/members
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/members/:memberId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/members/:memberId
 * @two-tenant api/kanban.route.ts GET /projects/:projectId/sprints
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/sprints
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/sprints/migrate
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/sprints/:sprintId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/sprints/:sprintId
 * @two-tenant api/kanban.route.ts GET /projects/:projectId/metrics
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/columns
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/columns/reorder
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/columns/:columnId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/columns/:columnId
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/cards
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/cards/:cardId/move
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/cards/:cardId/relations
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/cards/:cardId/relations/:relationId
 * @two-tenant api/kanban.route.ts GET /projects/:projectId/cards/:cardId
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/cards/:cardId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/cards/:cardId
 * @two-tenant api/kanban.route.ts POST /projects/:projectId/labels
 * @two-tenant api/kanban.route.ts PATCH /projects/:projectId/labels/:labelId
 * @two-tenant api/kanban.route.ts DELETE /projects/:projectId/labels/:labelId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, RouteResponse } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/kanban.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, probeCrossTenant } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { MISSING_ID } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/kanban.route");

/** One tenant's board: every id a route can name. */
interface Board {
  readonly project: string;
  readonly todo: string;
  readonly doing: string;
  readonly done: string;
  readonly sprint: string;
  readonly label: string;
  readonly member: string;
  readonly card: string;
  readonly card2: string;
  readonly relation: string;
}

const board = (t: "a" | "b"): Board => {
  const id = (n: number): string => `${t.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    project: id(1),
    todo: id(2),
    doing: id(3),
    done: id(4),
    sprint: id(5),
    label: id(6),
    member: id(7),
    card: id(8),
    card2: id(9),
    relation: id(10),
  };
};
const A = board("a");
const B = board("b");

let ownerA: Principal;
let ownerB: Principal;
let colleagueA: Principal;
let tenantIdA = "";

const seedBoard = (ids: Board, tenantId: string, owner: Principal, memberUser: Principal): void => {
  mdb.seed("KanbanProject", { id: ids.project, tenantId, name: "Ward rollout", code: "WR", createdBy: owner.id });
  mdb.seed("KanbanColumn", [
    { id: ids.todo, projectId: ids.project, name: "To do", position: 0 },
    { id: ids.doing, projectId: ids.project, name: "Doing", position: 1 },
    { id: ids.done, projectId: ids.project, name: "Done", position: 2, isDone: true },
  ]);
  mdb.seed("KanbanSprint", { id: ids.sprint, projectId: ids.project, name: "Sprint 1", status: "planned" });
  mdb.seed("KanbanLabel", { id: ids.label, projectId: ids.project, name: "urgent" });
  mdb.seed("KanbanProjectMember", [
    { projectId: ids.project, userId: owner.id, accessLevel: "owner" },
    { id: ids.member, projectId: ids.project, userId: memberUser.id, accessLevel: "viewer" },
  ]);
  mdb.seed("KanbanCard", [
    { id: ids.card, tenantId, projectId: ids.project, columnId: ids.todo, title: "Label pumps", position: 0, createdBy: owner.id },
    { id: ids.card2, tenantId, projectId: ids.project, columnId: ids.todo, title: "Train staff", position: 1, createdBy: owner.id },
  ]);
  mdb.seed("KanbanCardRelation", [
    { id: ids.relation, projectId: ids.project, sourceCardId: ids.card, targetCardId: ids.card2, type: "blocks" },
    { projectId: ids.project, sourceCardId: ids.card2, targetCardId: ids.card, type: "blocked_by" },
  ]);
};

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  ownerA = fx.principal(fx.tenantA, "USER");
  colleagueA = fx.principal(fx.tenantA, "TECHNICIAN");
  ownerB = fx.principal(fx.tenantB, "USER");
  const colleagueB = fx.principal(fx.tenantB, "TECHNICIAN");
  tenantIdA = fx.tenantA.id;
  seedTenants(mdb, fx, [ownerA, colleagueA, ownerB, colleagueB]);
  seedBoard(A, fx.tenantA.id, ownerA, colleagueA);
  seedBoard(B, fx.tenantB.id, ownerB, colleagueB);
  // createCard claims the next card number in raw SQL: it must name the tenant.
  mdb.onQuery((sql, options) => {
    // P9-18: sent through sql() — the tenant is bound as $2.
    expect(sql).toContain("tenant_id = $2");
    expect(options.bind).toEqual([A.project, tenantIdA]);
    return [{ card_seq: 3 }];
  });
});

/**
 * A route: its path from (project, child, grandchild) ids, and its body built
 * from the board whose project is named (so only the probed id is foreign).
 */
interface KanbanRoute {
  readonly key: string;
  readonly method: string;
  readonly path: (project: string, child: string, grandchild: string) => string;
  /** Which board child the route names after the project, if any. */
  readonly child?: keyof Board;
  readonly grandchild?: keyof Board;
  readonly body?: (b: Board, colleague: Principal) => unknown;
  readonly writes?: readonly string[];
}

const ROUTES: readonly KanbanRoute[] = [
  { key: "GET /projects/:projectId", method: "GET", path: (p) => `/projects/${p}` },
  {
    key: "PATCH /projects/:projectId",
    method: "PATCH",
    path: (p) => `/projects/${p}`,
    body: () => ({ name: "Renamed" }),
    writes: ["KanbanProject"],
  },
  { key: "DELETE /projects/:projectId", method: "DELETE", path: (p) => `/projects/${p}`, writes: ["KanbanProject"] },
  {
    key: "POST /projects/:projectId/members",
    method: "POST",
    path: (p) => `/projects/${p}/members`,
    body: (_b, colleague) => ({ userId: colleague.id, accessLevel: "editor" }),
    writes: ["KanbanProjectMember"],
  },
  {
    key: "PATCH /projects/:projectId/members/:memberId",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/members/${c}`,
    child: "member",
    body: () => ({ accessLevel: "editor" }),
    writes: ["KanbanProjectMember"],
  },
  {
    key: "DELETE /projects/:projectId/members/:memberId",
    method: "DELETE",
    path: (p, c) => `/projects/${p}/members/${c}`,
    child: "member",
    writes: ["KanbanProjectMember"],
  },
  { key: "GET /projects/:projectId/sprints", method: "GET", path: (p) => `/projects/${p}/sprints` },
  {
    key: "POST /projects/:projectId/sprints",
    method: "POST",
    path: (p) => `/projects/${p}/sprints`,
    body: () => ({ name: "Sprint 2" }),
    writes: ["KanbanSprint"],
  },
  {
    key: "POST /projects/:projectId/sprints/migrate",
    method: "POST",
    path: (p) => `/projects/${p}/sprints/migrate`,
    body: (b) => ({ allNotDone: true, targetSprintId: b.sprint }),
    writes: ["KanbanCard"],
  },
  {
    key: "PATCH /projects/:projectId/sprints/:sprintId",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/sprints/${c}`,
    child: "sprint",
    body: () => ({ status: "active" }),
    writes: ["KanbanSprint"],
  },
  {
    key: "DELETE /projects/:projectId/sprints/:sprintId",
    method: "DELETE",
    path: (p, c) => `/projects/${p}/sprints/${c}`,
    child: "sprint",
    writes: ["KanbanSprint"],
  },
  { key: "GET /projects/:projectId/metrics", method: "GET", path: (p) => `/projects/${p}/metrics` },
  {
    key: "POST /projects/:projectId/columns",
    method: "POST",
    path: (p) => `/projects/${p}/columns`,
    body: () => ({ name: "Review" }),
    writes: ["KanbanColumn"],
  },
  {
    key: "POST /projects/:projectId/columns/reorder",
    method: "POST",
    path: (p) => `/projects/${p}/columns/reorder`,
    body: (b) => ({ order: [b.doing, b.todo, b.done] }),
    writes: ["KanbanColumn"],
  },
  {
    key: "PATCH /projects/:projectId/columns/:columnId",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/columns/${c}`,
    child: "doing",
    body: () => ({ name: "In progress" }),
    writes: ["KanbanColumn"],
  },
  {
    key: "DELETE /projects/:projectId/columns/:columnId",
    method: "DELETE",
    path: (p, c) => `/projects/${p}/columns/${c}`,
    child: "doing",
    writes: ["KanbanColumn"],
  },
  {
    key: "POST /projects/:projectId/cards",
    method: "POST",
    path: (p) => `/projects/${p}/cards`,
    body: (b) => ({ columnId: b.todo, title: "Order spares" }),
    writes: ["KanbanCard"],
  },
  {
    key: "PATCH /projects/:projectId/cards/:cardId/move",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/cards/${c}/move`,
    child: "card",
    body: (b) => ({ columnId: b.doing, position: 0 }),
    writes: ["KanbanCard"],
  },
  {
    key: "POST /projects/:projectId/cards/:cardId/relations",
    method: "POST",
    path: (p, c) => `/projects/${p}/cards/${c}/relations`,
    child: "card2",
    body: (b) => ({ targetCardId: b.card, type: "relates_to" }),
    writes: ["KanbanCardRelation"],
  },
  {
    key: "DELETE /projects/:projectId/cards/:cardId/relations/:relationId",
    method: "DELETE",
    path: (p, c, g) => `/projects/${p}/cards/${c}/relations/${g}`,
    child: "card",
    grandchild: "relation",
    writes: ["KanbanCardRelation"],
  },
  { key: "GET /projects/:projectId/cards/:cardId", method: "GET", path: (p, c) => `/projects/${p}/cards/${c}`, child: "card" },
  {
    key: "PATCH /projects/:projectId/cards/:cardId",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/cards/${c}`,
    child: "card",
    body: () => ({ title: "Label every pump" }),
    writes: ["KanbanCard"],
  },
  {
    key: "DELETE /projects/:projectId/cards/:cardId",
    method: "DELETE",
    path: (p, c) => `/projects/${p}/cards/${c}`,
    child: "card",
    writes: ["KanbanCard"],
  },
  {
    key: "POST /projects/:projectId/labels",
    method: "POST",
    path: (p) => `/projects/${p}/labels`,
    body: () => ({ name: "blocked" }),
    writes: ["KanbanLabel"],
  },
  {
    key: "PATCH /projects/:projectId/labels/:labelId",
    method: "PATCH",
    path: (p, c) => `/projects/${p}/labels/${c}`,
    child: "label",
    body: () => ({ color: "#ff0000" }),
    writes: ["KanbanLabel"],
  },
  {
    key: "DELETE /projects/:projectId/labels/:labelId",
    method: "DELETE",
    path: (p, c) => `/projects/${p}/labels/${c}`,
    child: "label",
    writes: ["KanbanLabel"],
  },
];

const send = (route: KanbanRoute, bodyBoard: Board, colleague: Principal, url: string): Promise<RouteResponse> =>
  call(router, route.method, url, { body: route.body ? route.body(bodyBoard, colleague) : {} });

const childOf = (b: Board, key: keyof Board | undefined): string => (key ? b[key] : "");

const expectRefused = async (request: (id: string) => Promise<RouteResponse>, foreignId: string): Promise<void> => {
  const probe = await probeCrossTenant(mdb, request, foreignId, MISSING_ID);
  expect(probe.foreign.status).toBe(404);
  expect(probe.foreign.body).toEqual(probe.missing.body);
  expect(probe.tablesAfter).toEqual(probe.tablesBefore);
  expect(probe.committed).toEqual([]);
};

describe.each(ROUTES.map((r) => [r.key, r] as const))("kanban %s — two tenants", (_key, route) => {
  it("PROJECT: another tenant's project answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(ownerB);
    await expectRefused(
      (project) => send(route, A, colleagueA, route.path(project, childOf(A, route.child), childOf(A, route.grandchild))),
      A.project,
    );
  });

  if (route.child) {
    const child = route.child;
    it(`CHILD: the caller's own project with another tenant's ${child} answers 404, and nothing is written`, async () => {
      as(ownerB);
      await expectRefused((id) => send(route, B, colleagueA, route.path(B.project, id, childOf(B, route.grandchild))), A[child]);
    });
  }

  if (route.grandchild) {
    const grandchild = route.grandchild;
    it(`CHILD: the caller's own project and card with another tenant's ${grandchild} answers 404, and nothing is written`, async () => {
      as(ownerB);
      await expectRefused((id) => send(route, B, colleagueA, route.path(B.project, childOf(B, route.child), id)), A[grandchild]);
    });
  }

  it("the owning tenant's project owner reaches it", async () => {
    as(ownerA);
    const res = await send(route, A, colleagueA, route.path(A.project, childOf(A, route.child), childOf(A, route.grandchild)));

    expect([res.status >= 200 && res.status < 300, res.status, res.body]).toEqual([true, res.status, res.body]);
    for (const model of route.writes ?? []) {
      expect(mdb.committed().map((w) => w.model)).toContain(model);
    }
  });
});
