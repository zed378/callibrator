/**
 * Two tenants — every /tickets/:ticketId route (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404").
 *
 * These routes carry `auth` only; the ticket service scopes by tenant
 * (`tenantScope`) and decides who is a responder. The probe is tenant B's
 * ADMINISTRATOR — a responder, who sees the whole queue of their own tenant —
 * against tenant A's ticket: the widest tenant-bound reach there is. (The
 * super admin is, by design, a cross-tenant responder: memory/ticket-support-desk,
 * not a two-tenant case.) The owner is tenant A's requester who raised it.
 *
 * REAL router, validateUuid, validate, controller, ticket service and
 * notification service on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/tickets.route.ts GET /:ticketId
 * @two-tenant api/tickets.route.ts PATCH /:ticketId
 * @two-tenant api/tickets.route.ts DELETE /:ticketId
 * @two-tenant api/tickets.route.ts POST /:ticketId/assign
 * @two-tenant api/tickets.route.ts POST /:ticketId/comments
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/tickets.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tickets.route");

const TICKET_A = "a1000000-0000-4000-8000-000000000001";

interface TicketContext extends SuiteContext {
  agent: Principal;
}
let ctx: TicketContext;

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "USER"),
    agent: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"),
    other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN"),
  };
  seedTenants(mdb, fx, [ctx.owner, ctx.agent, ctx.other]);
  mdb.seed("Ticket", {
    id: TICKET_A,
    tenantId: fx.tenantA.id,
    number: 1,
    ticketKey: "TKT-1",
    subject: "Cannot print certificate",
    status: "open",
    priority: "medium",
    category: "support",
    createdBy: ctx.owner.id,
  });
});

twoTenantSuite<TicketContext>({
  module: "tickets",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:ticketId", method: "GET", path: (id) => `/${id}`, id: () => TICKET_A },
    {
      key: "PATCH /:ticketId",
      method: "PATCH",
      path: (id) => `/${id}`,
      id: () => TICKET_A,
      body: { priority: "high" },
      writes: ["Ticket"],
    },
    { key: "DELETE /:ticketId", method: "DELETE", path: (id) => `/${id}`, id: () => TICKET_A, writes: ["Ticket"] },
    {
      key: "POST /:ticketId/assign",
      method: "POST",
      path: (id) => `/${id}/assign`,
      id: () => TICKET_A,
      body: () => ({ assignedTo: ctx.agent.id }),
      writes: ["Ticket", "Notification"],
    },
    {
      key: "POST /:ticketId/comments",
      method: "POST",
      path: (id) => `/${id}/comments`,
      id: () => TICKET_A,
      body: { body: "Any update?" },
      writes: ["TicketComment"],
    },
  ],
});
