/**
 * A-318 — a ticket description is sanitized when it is saved.
 *
 * The description is rich HTML: CreateTicketModal writes it with the TipTap
 * RichTextEditor and the detail page renders it as HTML. Any tenant user
 * writes it; the platform's responders read it. The detail page sanitizes at
 * render (A-298), but the stored value went to every other reader (the API,
 * exports) as sent. Decision: rich HTML, sanitized at save with the shared
 * policy (@callibrator/contracts/contentHtml), the one the page applies again.
 *
 * REAL router, validate, controller, ticket service and models on memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/tickets.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tickets.route");

const TICKET = "a1000000-0000-4000-8000-000000000318";
const HOSTILE =
  '<p>Printer fails</p><script>alert(1)</script><img src="x" onerror="alert(2)">' +
  '<a href="javascript:alert(3)">details</a><iframe src="https://evil.example"></iframe>';
const SAFE = "<p>Steps: <strong>1</strong>, <em>2</em></p><ul><li>three</li></ul>";

let owner: Principal;

const stored = (id: string): unknown => mdb.rows("Ticket").find((r) => r["id"] === id)?.["description"];

const expectClean = (html: unknown): void => {
  expect(typeof html).toBe("string");
  const text = String(html);
  expect(text).toContain("<p>Printer fails</p>");
  expect(text).not.toMatch(/<script|onerror|javascript:|<iframe|alert\(1\)/i);
};

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  owner = fx.principal(fx.tenantA, "USER");
  seedTenants(mdb, fx, [owner]);
  mdb.seed("Ticket", {
    id: TICKET,
    tenantId: fx.tenantA.id,
    number: 1,
    ticketKey: "TKT-1",
    subject: "Cannot print",
    description: "<p>old</p>",
    status: "open",
    priority: "medium",
    category: "support",
    createdBy: owner.id,
  });
  as(owner);
  // The ticket number comes from an upsert on ticket_counters (raw SQL): the
  // only raw statement on this path, answered here deliberately.
  mdb.onQuery((sql) => {
    if (sql.includes("ticket_counters")) {
      // P9-18: the counter is sent through sql(), which answers the rows directly.
      return [{ seq: 2 }];
    }
    throw new Error(`unexpected raw SQL: ${sql}`);
  });
});

describe("A-318 — ticket description sanitized at save", () => {
  it("POST / stores the description without script, handlers or javascript: links", async () => {
    const res = await call(router, "POST", "/", { body: { subject: "Printer", description: HOSTILE } });
    expect(res.status).toBe(201);
    const created = mdb.rows("Ticket").find((r) => r["subject"] === "Printer");
    expectClean(created?.["description"]);
  });

  it("PATCH /:ticketId stores the description sanitized", async () => {
    const res = await call(router, "PATCH", `/${TICKET}`, { body: { description: HOSTILE } });
    expect(res.status).toBe(200);
    expectClean(stored(TICKET));
  });

  it("control: the editor's own markup is kept as written", async () => {
    const res = await call(router, "PATCH", `/${TICKET}`, { body: { description: SAFE } });
    expect(res.status).toBe(200);
    expect(stored(TICKET)).toBe(SAFE);
  });

  it("control: clearing the description stores null", async () => {
    const res = await call(router, "PATCH", `/${TICKET}`, { body: { description: null } });
    expect(res.status).toBe(200);
    expect(stored(TICKET)).toBeNull();
  });
});
