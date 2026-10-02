/**
 * A-335 (2026-10-01) — the risk register accepts only its allow-listed fields.
 *
 * `POST /api/v1/risk` and `PUT /api/v1/risk/:id` mounted no `validate()`:
 * `risk.service` spread the body into `Risk.create` / `risk.update`, so a body
 * could choose the row's `id`, set its `status` on create, rewrite
 * `identifiedBy` on update, and store a severity of 99. Fail-before: against
 * the route without the schemas, the chosen id, the CLOSED status, the
 * rewritten author and the out-of-range values were all stored.
 *
 * REAL router, dynamicAccess (matrix granted), validate, controller, service,
 * audit, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as RiskRoute from "../../routes/api/risk.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RiskRoute>("../../routes/api/risk.route");

const RISK = "a3350000-0000-4000-8000-000000000001";
const CHOSEN = "a3350000-0000-4000-8000-0000000000ff";
const OTHER_USER = "a3350000-0000-4000-8000-000000000099";

let fx: ReturnType<typeof twoTenants>;
let admin: ReturnType<ReturnType<typeof twoTenants>["principal"]>;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Risk", {
    id: RISK, tenantId: fx.tenantA.id, title: "Alarm not audible", category: "SAFETY", severity: 3, likelihood: 2,
    status: "OPEN", identifiedBy: admin.id,
  });
  as(admin);
});

type Row = Record<string, unknown>;
const data = (body: unknown): Row => (body as { data: Row }).data;
const risks = (): Row[] => mdb.rows("Risk");
const stored = (id: string): Row | undefined => risks().find((row) => row["id"] === id);

describe("A-335 — a risk body carries only its allow-listed fields", () => {
  it("create: id, tenantId, identifiedBy, status, rpn and timestamps in the body are ignored", async () => {
    const res = await call(router, "POST", "/", {
      body: {
        title: "Cold-chain fridge door sensor fails",
        severity: 4,
        likelihood: 2,
        id: CHOSEN,
        tenantId: fx.tenantB.id,
        identifiedBy: OTHER_USER,
        status: "CLOSED",
        rpn: 1,
        createdAt: "2000-01-01T00:00:00.000Z",
      },
    });
    expect(res.status).toBe(201);
    const id = data(res.body)["id"] as string;
    expect(id).not.toBe(CHOSEN);
    expect(stored(CHOSEN)).toBeUndefined();
    expect(stored(id)).toMatchObject({ tenantId: fx.tenantA.id, identifiedBy: admin.id, status: "OPEN", severity: 4 });
    expect(new Date(stored(id)?.["createdAt"] as string).getFullYear()).not.toBe(2000);

    const audit = mdb.rows("AuditLog").find((a) => a["resourceId"] === id);
    const after = (audit?.["changes"] as { after: Row }).after;
    expect(Object.keys(after).sort()).toEqual(["likelihood", "severity", "title"]);
  });

  it("update: tenantId, identifiedBy and id in the body are ignored; the allowed fields and status are written", async () => {
    const res = await call(router, "PUT", `/${RISK}`, {
      body: { title: "Alarm relocated", status: "MITIGATED", tenantId: fx.tenantB.id, identifiedBy: OTHER_USER, id: CHOSEN },
    });
    expect(res.status).toBe(200);
    expect(stored(RISK)).toMatchObject({
      id: RISK, tenantId: fx.tenantA.id, identifiedBy: admin.id, title: "Alarm relocated", status: "MITIGATED",
    });
    expect(stored(CHOSEN)).toBeUndefined();
  });

  it.each([
    ["POST", "/", { title: "" }, "title"],
    ["POST", "/", { title: "x", severity: 99 }, "severity"],
    ["POST", "/", { title: "x", likelihood: 0 }, "likelihood"],
    ["POST", "/", { title: "x", category: "GOSSIP" }, "category"],
    ["POST", "/", { title: "x", assignedTo: "not-a-uuid" }, "assignedTo"],
    ["PUT", `/${RISK}`, { status: "DONE" }, "status"],
    ["PUT", `/${RISK}`, { severity: "high" }, "severity"],
  ] as const)("%s %s refuses %j with a 400 naming the field, and writes nothing", async (method, path, body, field) => {
    const before = JSON.stringify(risks());
    const res = await call(router, method, path, { body });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect(JSON.stringify(risks())).toBe(before);
  });
});
