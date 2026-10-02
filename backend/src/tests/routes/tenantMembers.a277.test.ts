/**
 * A-277 (ADR-094) — a user named in a body must be a user of the record's
 * tenant: a ticket's `assignedTo`, a kanban member's `userId`, a card's
 * `assigneeIds`.
 *
 * Before: the ids were stored as given. Another tenant's user joined as
 * `null` (the A-75 shape, ADR-048) and was notified inside this tenant. Now
 * another tenant's user gets the SAME 404 as an id that does not exist, and
 * nothing is written.
 *
 * REAL routers (tickets, kanban), validators, controllers and services on
 * the REAL models and tenant hooks (fixtures/memoryDb). The two raw-SQL
 * counters (ticket number, card number) are answered by `onQuery`.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type {
  Principal,
  RouteResponse,
  TwoTenantWorld,
} from "../fixtures/routeClient";
import type * as TicketRoutes from "../../routes/api/tickets.route";
import type * as KanbanRoutes from "../../routes/api/kanban.route";
import type * as RiskRoutes from "../../routes/api/risk.route";

jest.mock("../../config", () => ({
  db: jest
    .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
    .memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest
  .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
  .memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } = jest.requireActual<
  typeof RouteClient
>("../fixtures/routeClient");
const tickets = jest.requireActual<typeof TicketRoutes>(
  "../../routes/api/tickets.route",
);
const kanban = jest.requireActual<typeof KanbanRoutes>(
  "../../routes/api/kanban.route",
);
const risks = jest.requireActual<typeof RiskRoutes>(
  "../../routes/api/risk.route",
);
const RISK_A = "a1000000-0000-4000-8000-0000000000f1";

const MISSING_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TICKET_A = "a1000000-0000-4000-8000-000000000001";
const PROJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const COLUMN_A = "aaaaaaaa-0000-4000-8000-000000000002";
const CARD_A = "aaaaaaaa-0000-4000-8000-000000000003";

let fx: TwoTenantWorld;
let requester: Principal;
let agentA: Principal;
let userB: Principal;

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  requester = fx.principal(fx.tenantA, "USER");
  agentA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  userB = fx.principal(fx.tenantB, "USER");
  seedTenants(mdb, fx, [requester, agentA, userB]);
  mdb.seed("Ticket", {
    id: TICKET_A,
    tenantId: fx.tenantA.id,
    number: 1,
    ticketKey: "TKT-1",
    subject: "Cannot print certificate",
    status: "open",
    priority: "medium",
    category: "support",
    createdBy: requester.id,
  });
  mdb.seed("KanbanProject", {
    id: PROJECT_A,
    tenantId: fx.tenantA.id,
    name: "Ward rollout",
    code: "WR",
    createdBy: requester.id,
  });
  mdb.seed("KanbanColumn", {
    id: COLUMN_A,
    projectId: PROJECT_A,
    name: "To do",
    position: 0,
  });
  mdb.seed("KanbanCard", {
    id: CARD_A,
    tenantId: fx.tenantA.id,
    projectId: PROJECT_A,
    columnId: COLUMN_A,
    title: "Label pumps",
    position: 0,
    createdBy: requester.id,
  });
  // The two counters are raw SQL; each names its tenant.
  mdb.onQuery((sql) => {
    if (sql.includes("ticket_counters")) {
      // P9-18: the counter is sent through sql(), which answers the rows directly.
      return [{ seq: 2 }];
    }
    // P9-18: the card_seq bump is sent through sql(), which answers the rows directly.
    return [{ card_seq: 2 }];
  });
});

/** Ask for the foreign user, then a missing one; both must be the same 404, with nothing written. */
const probe = async (
  request: (userId: string) => Promise<RouteResponse>,
): Promise<void> => {
  const before = mdb.dump();
  const foreign = await request(userB.id);
  const missing = await request(MISSING_USER);
  expect(foreign.status).toBe(404);
  expect(foreign.body).toEqual(missing.body);
  expect(mdb.dump()).toEqual(before);
  expect(mdb.committed()).toEqual([]);
};

describe("A-277 — a ticket's assignee is a user of the ticket's tenant", () => {
  it("raising a ticket assigned to another tenant's user is 404, like a user that does not exist", async () => {
    as(requester);
    await probe((id) =>
      call(tickets, "POST", "/", {
        body: { subject: "Printer offline", assignedTo: id },
      }),
    );
  });

  it("reassigning a ticket to another tenant's user is 404, like a user that does not exist", async () => {
    as(requester);
    await probe((id) =>
      call(tickets, "PATCH", `/${TICKET_A}`, { body: { assignedTo: id } }),
    );
  });

  it("the super admin, who works every queue, is held to the TICKET's tenant", async () => {
    as(fx.superAdmin);
    await probe((id) =>
      call(tickets, "POST", `/${TICKET_A}/assign`, {
        body: { assignedTo: id },
      }),
    );
  });

  it("a user of the ticket's own tenant is assigned (positive control)", async () => {
    as(requester);
    const res = await call(tickets, "PATCH", `/${TICKET_A}`, {
      body: { assignedTo: agentA.id },
    });
    expect(res.status).toBe(200);
    expect(mdb.rows("Ticket")[0]).toMatchObject({ assignedTo: agentA.id });
  });
});

describe("A-277 — a risk's assignee is a user of the risk's tenant", () => {
  beforeEach(() => {
    grantAllMenus();
    mdb.seed("Risk", {
      id: RISK_A,
      tenantId: fx.tenantA.id,
      title: "Pump drift",
      status: "Open",
      severity: 3,
      likelihood: 3,
    });
  });

  it("raising a risk assigned to another tenant's user is 404, like a user that does not exist", async () => {
    as(agentA);
    await probe((id) =>
      call(risks, "POST", "/", { body: { title: "New risk", assignedTo: id } }),
    );
  });

  it("reassigning a risk to another tenant's user is 404, like a user that does not exist", async () => {
    as(agentA);
    await probe((id) =>
      call(risks, "PUT", `/${RISK_A}`, { body: { assignedTo: id } }),
    );
  });

  it("a user of the risk's own tenant is assigned (positive control)", async () => {
    as(agentA);
    const res = await call(risks, "PUT", `/${RISK_A}`, {
      body: { assignedTo: requester.id },
    });
    expect(res.status).toBe(200);
  });
});

describe("A-277 — kanban members and assignees are users of the project's tenant", () => {
  it("adding another tenant's user as a member is 404, like a user that does not exist", async () => {
    as(requester);
    await probe((id) =>
      call(kanban, "POST", `/projects/${PROJECT_A}/members`, {
        body: { userId: id, accessLevel: "editor" },
      }),
    );
  });

  it("creating a card assigned to another tenant's user is 404", async () => {
    as(requester);
    await probe((id) =>
      call(kanban, "POST", `/projects/${PROJECT_A}/cards`, {
        body: {
          columnId: COLUMN_A,
          title: "Train staff",
          assigneeIds: [agentA.id, id],
        },
      }),
    );
  });

  it("assigning another tenant's user to a card is 404", async () => {
    as(requester);
    await probe((id) =>
      call(kanban, "PATCH", `/projects/${PROJECT_A}/cards/${CARD_A}`, {
        body: { assigneeIds: [id] },
      }),
    );
  });

  it("a user of the project's own tenant becomes a member (positive control)", async () => {
    as(requester);
    const res = await call(kanban, "POST", `/projects/${PROJECT_A}/members`, {
      body: { userId: agentA.id, accessLevel: "editor" },
    });
    expect(res.status).toBeLessThan(300);
    expect(mdb.rows("KanbanProjectMember")).toEqual([
      expect.objectContaining({ userId: agentA.id }),
    ]);
  });
});
